'use strict'

/**
 * electron/services/aiChatRecommendService.cjs
 * 자연어 프롬프트를 기반으로 DB 후보 조회 + AI 추천을 결합한다.
 *
 * 흐름:
 *   1. OpenAI로 사용자 프롬프트 → 의도 JSON 파싱
 *   2. 의도에 맞게 DB 후보 조회 (prepared statement)
 *   3. themeCandidateService.calcScores로 로컬 점수 계산
 *   4. 상위 50개만 AI에 전달 (file_path 제외)
 *   5. AI가 최종 추천 목록 + 이유 반환
 *   6. videoId 검증 후 실제 row 첨부해 반환
 */

const path = require('path')
const { getOpenAIClient }   = require('./openaiClient.cjs')
const { calcScores }        = require('./themeCandidateService.cjs')
const { getDeleteCandidatesByDrive, calcDeleteScore } = require('./driveStatsService.cjs')

// ─────────────────────────────────────────────────────────────
// 의도 분석 (1단계 AI 호출)
// ─────────────────────────────────────────────────────────────

/**
 * 사용자 프롬프트에서 필터 조건을 JSON으로 추출한다.
 * @param {string} userPrompt
 * @returns {Promise<object>} intent JSON
 */
async function parseIntent(userPrompt) {
  const client = getOpenAIClient()
  const model  = process.env.OPENAI_MODEL || 'gpt-4.1'

  const system = `당신은 영상 라이브러리 검색 쿼리 분석기입니다.
사용자의 자연어 입력을 분석해서 아래 JSON 형식으로만 반환하세요.
설명 문장이나 마크다운 코드 블록 없이 JSON 객체 하나만 출력하세요.

중요: "영상 별점"과 "배우 별점"을 반드시 구분하세요.
- "5점 배우", "별점 5개 배우", "배우 별점 5", "평점 높은 배우", "탑 배우", "최고 평점 배우" 등
  → 배우 별점 기준이므로 actorRatingExact 또는 actorMinRating 사용
- "별점 5점짜리 배우", "별점 5점 배우", "N점짜리 배우", "N점 배우 특집" 처럼 배우 수식
  → 반드시 actorRatingExact = N 으로 설정, minRating은 0 유지
- "별점 5점 영상", "평점 높은 영상", "5점짜리 작품" 등 영상 자체 별점
  → minRating 사용 (actorRatingExact, actorMinRating은 0 유지)
- "5점 배우 작품", "5점 배우 영상 추천" 처럼 배우 별점이 명확한 경우
  → actorRatingExact 또는 actorMinRating 사용 (minRating은 0으로 유지)

중요: 삭제/정리 관련 요청을 구분하세요.
다음 표현은 볼만한 영상 추천이 아닌 "삭제 후보 추천" 모드입니다.
  → deleteMode: true 로 설정
  예: "지울만한 영상", "삭제해도 될 영상", "용량 큰데 안 보는 영상", "정리해줘",
      "D드라이브에서 지울 것", "선호도 낮은 영상 정리", "삭제요망 후보", "공간 확보"
삭제 모드에서는 drive 필드에 "D:" 형태로 드라이브를 지정하거나 null로 전체를 나타냅니다.

{
  "actorTags": [],           // 배우가 가진 태그 조건 (actors.tags LIKE)
  "videoTags": [],           // 영상 태그 조건 (videos.tags LIKE)
  "actorNames": [],          // 특정 배우명 (actors.name LIKE)
  "minRating": 0,            // 영상(videos.rating) 최소 별점 (0~5, 기본 0)
  "actorMinRating": 0,       // 배우(actors.rating) 최소 별점 (0~5, 기본 0) — 이상
  "actorRatingExact": 0,     // 배우(actors.rating) 정확히 일치 별점 (0~5, 기본 0)
  "excludeGrades": [],       // 제외할 등급 (예: ["삭제요망"])
  "onlyGrades": [],          // 이 등급만 포함 (빈 배열이면 무제한)
  "onlyNew": false,          // true면 is_new=1만
  "onlyNotCopied": false,    // true면 복사 이력 없는 것만
  "onlyFavorite": false,     // true면 favorite=1만
  "sortHint": "themeScore",  // "themeScore"|"rating"|"playCount"|"copyCount"|"recent"
  "limit": 50,               // 후보 수 (20~100)
  "deleteMode": false,       // true면 삭제 후보 추천 모드 (볼만한 영상 추천과 완전 분리)
  "drive": null              // 삭제 모드 전용: "D:" 형태 드라이브 지정 (null=전체)
}`

  const resp = await client.responses.create({
    model,
    temperature: 0.2,
    instructions: system,
    input: `다음 사용자 요청을 분석해 JSON으로 반환해 주세요: ${userPrompt}`,
    text: { format: { type: 'json_object' } },
  })

  const raw = resp.output_text?.trim() ?? ''
  try {
    let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const fb = s.indexOf('{'); if (fb > 0) s = s.slice(fb)
    const lb = s.lastIndexOf('}'); if (lb !== -1 && lb < s.length - 1) s = s.slice(0, lb + 1)
    return JSON.parse(s)
  } catch {
    return { sortHint: 'themeScore', limit: 50 }
  }
}

// ─────────────────────────────────────────────────────────────
// DB 후보 조회 (2단계)
// ─────────────────────────────────────────────────────────────

/**
 * 의도 조건으로 DB 후보를 조회한다.
 * SQL Injection 방지: 모든 값은 prepared statement 바인딩으로만 전달.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} intent
 * @returns {object[]} video rows
 */
function queryCandidates(db, intent) {
  const {
    actorTags        = [],
    videoTags        = [],
    actorNames       = [],
    minRating        = 0,
    actorMinRating   = 0,
    actorRatingExact = 0,
    excludeGrades    = [],
    onlyGrades       = [],
    onlyNew          = false,
    onlyNotCopied    = false,
    onlyFavorite     = false,
    limit            = 50,
  } = intent

  const bindings = []
  const whereClauses = [
    "v.status = 'normal'",
    "v.status != 'duplicate'",
  ]

  // 영상 최소 별점 (videos.rating)
  if (minRating > 0) {
    whereClauses.push('v.rating >= ?')
    bindings.push(minRating)
  }

  // 제외 등급 (기본 삭제요망 제외)
  const excludeList = excludeGrades.length > 0 ? excludeGrades : ['삭제요망', '삭제 요망']
  const excPlaceholders = excludeList.map(() => '?').join(',')
  whereClauses.push(`(v.grade IS NULL OR v.grade NOT IN (${excPlaceholders}))`)
  bindings.push(...excludeList)

  // 특정 등급만
  if (onlyGrades.length > 0) {
    const onlyPH = onlyGrades.map(() => '?').join(',')
    whereClauses.push(`v.grade IN (${onlyPH})`)
    bindings.push(...onlyGrades)
  }

  // NEW 전용
  if (onlyNew) {
    whereClauses.push('v.is_new = 1')
  }

  // 즐겨찾기 전용
  if (onlyFavorite) {
    whereClauses.push('v.favorite = 1')
  }

  // 영상 태그 조건 (OR)
  if (videoTags.length > 0) {
    const tagClauses = videoTags.map(() => "v.tags LIKE ?").join(' OR ')
    whereClauses.push(`(${tagClauses})`)
    videoTags.forEach(t => bindings.push(`%${t}%`))
  }

  // 배우 태그 / 배우명 / 배우 별점 조건이 있으면 JOIN 필요
  let needsActorJoin =
    actorTags.length > 0 ||
    actorNames.length > 0 ||
    actorMinRating > 0 ||
    actorRatingExact > 0

  // 미복사 전용 (copy_to_clipboard / copy_to_device 이력 없음)
  let notCopiedSubquery = ''
  if (onlyNotCopied) {
    notCopiedSubquery = `AND NOT EXISTS (
      SELECT 1 FROM video_activity_logs val
      WHERE val.video_id = v.id
        AND val.action_type IN ('copy_to_clipboard', 'copy_to_device')
    )`
  }

  // 배우 JOIN 절
  // - actorTags / actorRatingExact / actorMinRating 있을 때: INNER JOIN (조건 만족 배우가 있는 영상만)
  // - actorNames만 있을 때: LEFT JOIN + v.actor_name LIKE 폴백
  //   → video_actors 연결이 없어도 videos.actor_name 컬럼으로 매칭 가능
  let actorJoinSQL = ''
  if (needsActorJoin) {
    const joinType = (actorTags.length > 0 || actorRatingExact > 0 || actorMinRating > 0)
      ? 'JOIN'
      : 'LEFT JOIN'
    actorJoinSQL = `
      ${joinType} video_actors va2 ON va2.video_id = v.id
      ${joinType} actors a2        ON a2.id = va2.actor_id`

    if (actorTags.length > 0) {
      const atClauses = actorTags.map(() => "a2.tags LIKE ?").join(' OR ')
      whereClauses.push(`(${atClauses})`)
      actorTags.forEach(t => bindings.push(`%${t}%`))
    }
    if (actorNames.length > 0) {
      // actors 테이블 이름 OR videos.actor_name 둘 다 검색 (폴백)
      const anClauses = actorNames.map(() => "(a2.name LIKE ? OR v.actor_name LIKE ?)").join(' OR ')
      whereClauses.push(`(${anClauses})`)
      actorNames.forEach(n => { bindings.push(`%${n}%`); bindings.push(`%${n}%`) })
    }
    // 배우 별점 조건 (actors.rating)
    if (actorRatingExact > 0) {
      whereClauses.push('a2.rating = ?')
      bindings.push(actorRatingExact)
    } else if (actorMinRating > 0) {
      whereClauses.push('a2.rating >= ?')
      bindings.push(actorMinRating)
    }
  }

  const actualLimit = Math.min(Math.max(Number(limit) || 50, 10), 200)
  // 배우 별점 필터가 있으면 전체 영상을 가져와야 배우 누락이 없음
  const sqlLimit = (actorRatingExact > 0 || actorMinRating > 0) ? 2000 : actualLimit * 4

  const sql = `
    SELECT DISTINCT
      v.id, v.file_name, v.file_path, v.folder_path,
      v.code, v.actor_name, v.tags, v.rating, v.grade,
      v.recommended, v.favorite, v.is_new, v.size,
      v.play_count, v.created_at,
      COALESCE(s.copy_count, 0) AS copy_count,
      COALESCE(s.open_count, 0) AS open_count,
      COALESCE(s.download_req, 0) AS download_request_count
    FROM videos v
    ${actorJoinSQL}
    LEFT JOIN (
      SELECT
        video_id,
        SUM(CASE WHEN action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END) AS copy_count,
        SUM(CASE WHEN action_type = 'open'             THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN action_type = 'download_request' THEN 1 ELSE 0 END) AS download_req
      FROM video_activity_logs
      GROUP BY video_id
    ) s ON s.video_id = v.id
    WHERE ${whereClauses.join('\n      AND ')}
    ${notCopiedSubquery}
    LIMIT ${sqlLimit}
  `

  return db.prepare(sql).all(...bindings)
}

// ─────────────────────────────────────────────────────────────
// 로컬 점수 계산 + 배우/태그 가중치 (3단계)
// ─────────────────────────────────────────────────────────────

/**
 * DB row + actorsMap + actorCopyMap + tagCopyMap → 점수 계산 후 정렬
 */
function scoreAndSort(rows, actorsMap, actorCopyMap, tagCopyMap, sortHint, limit) {
  const scored = rows.map(v => {
    const actorList    = actorsMap[v.id] ?? []
    const primaryActor = actorList[0]?.name ?? v.actor_name ?? ''
    const tags         = (v.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    const actorCopyCount = actorCopyMap[primaryActor] || 0
    const tagCopyCount   = tags.length
      ? Math.max(...tags.map(t => tagCopyMap[t] || 0))
      : 0

    const dto = {
      id:                   v.id,
      fileName:             v.file_name,
      folderName:           v.folder_path ? path.basename(v.folder_path) : '',
      actors:               v.actor_name || actorList.map(a => a.name).join(', '),
      primaryActor,
      tags,
      rating:               v.rating             ?? 0,
      grade:                v.grade              ?? '',
      playCount:            v.play_count         ?? 0,
      downloadRequestCount: v.download_request_count ?? 0,
      copyCount:            v.copy_count         ?? 0,
      actorCopyCount,
      tagCopyCount,
      favorite:             Boolean(v.favorite),
      recommended:          Boolean(v.recommended),
      fileSize:             v.size               ?? 0,
    }
    const { themeScore } = calcScores(dto)
    return { ...v, _actors: actorList, _tags: tags, _score: themeScore, primaryActor }
  })

  // sortHint 기반 정렬
  scored.sort((a, b) => {
    if (sortHint === 'rating')    return (b.rating    ?? 0) - (a.rating    ?? 0)
    if (sortHint === 'playCount') return (b.play_count ?? 0) - (a.play_count ?? 0)
    if (sortHint === 'copyCount') return (b.copy_count ?? 0) - (a.copy_count ?? 0)
    if (sortHint === 'recent')    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    return b._score - a._score  // 기본: themeScore
  })

  // 메인 후보 (상위 ~90%) + 탐색 후보 1~2개 (순환 다양성)
  // 항상 높은 점수만 나오는 쏠림을 방지하고, 비교적 낮은 점수의 영상도 순환 노출
  const discoverCount = Math.max(1, Math.min(2, Math.floor(limit * 0.1)))
  const mainCount     = limit - discoverCount
  const mainItems     = scored.slice(0, mainCount)

  // 메인 이후 구간 (최대 mainCount*2 범위)에서 랜덤 탐색 후보 선택
  const discoverPool = scored.slice(mainCount, mainCount + mainCount * 2)
  for (let i = discoverPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[discoverPool[i], discoverPool[j]] = [discoverPool[j], discoverPool[i]]
  }
  const discoverItems = discoverPool.slice(0, discoverCount)

  return [...mainItems, ...discoverItems]
}

// ─────────────────────────────────────────────────────────────
// 배우 별점 기준 쿼리: 해당하는 모든 배우의 영상을 균등하게 커버
// ─────────────────────────────────────────────────────────────

/**
 * actorRatingExact / actorMinRating 조건에 해당하는 배우를 모두 파악하고,
 * 각 배우별로 대표 영상을 골라 최대 maxTotal개의 후보를 반환한다.
 * 이를 통해 특정 배우가 후보에서 통째로 누락되는 문제를 방지한다.
 */
function buildActorCoveredCandidates(rows, actorsMap, actorCopyMap, tagCopyMap, intent, maxTotal = 100) {
  const targetRating = intent.actorRatingExact ?? 0
  const minRating    = intent.actorMinRating   ?? 0

  // 조건에 해당하는 배우별 영상 맵 구성
  // actorName → { rating, videos[] }
  const actorMap = new Map()

  for (const v of rows) {
    const actorList = actorsMap[v.id] ?? []
    for (const actor of actorList) {
      const ar = actor.rating ?? 0
      const qualifies =
        (targetRating > 0 && ar === targetRating) ||
        (minRating > 0 && ar >= minRating)
      if (!qualifies) continue

      if (!actorMap.has(actor.name)) {
        actorMap.set(actor.name, { rating: ar, videos: [] })
      }
      actorMap.get(actor.name).videos.push(v)
    }
  }

  // 배우를 별점 내림차순으로 정렬
  const sortedActors = [...actorMap.entries()]
    .sort(([, a], [, b]) => b.rating - a.rating)

  const totalActors = sortedActors.length
  // 배우 수에 따라 배우당 최대 영상 수 결정 (최소 1개 보장)
  const maxPerActor = Math.max(1, Math.floor(maxTotal / Math.max(totalActors, 1)))

  const selected = new Set() // 중복 방지
  const result   = []

  for (const [, actorData] of sortedActors) {
    if (result.length >= maxTotal) break

    // 해당 배우 영상을 품질 순 정렬 (영상 별점 → 복사 횟수)
    const sorted = actorData.videos
      .filter(v => !selected.has(v.id))
      .sort((a, b) => {
        const rDiff = (b.rating ?? 0) - (a.rating ?? 0)
        if (rDiff !== 0) return rDiff
        return (b.copy_count ?? 0) - (a.copy_count ?? 0)
      })

    let taken = 0
    for (const v of sorted) {
      if (taken >= maxPerActor || result.length >= maxTotal) break
      if (!selected.has(v.id)) {
        selected.add(v.id)
        result.push(v)
        taken++
      }
    }
  }

  // 각 영상에 themeScore / _actors / _tags 부여
  return result.map(v => {
    const actorList      = actorsMap[v.id] ?? []
    const primaryActor   = actorList[0]?.name ?? v.actor_name ?? ''
    const tags           = (v.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    const actorCopyCount = actorCopyMap[primaryActor] || 0
    const tagCopyCount   = tags.length
      ? Math.max(...tags.map(t => tagCopyMap[t] || 0))
      : 0

    const dto = {
      id:                   v.id,
      fileName:             v.file_name,
      folderName:           v.folder_path ? path.basename(v.folder_path) : '',
      actors:               v.actor_name || actorList.map(a => a.name).join(', '),
      primaryActor,
      tags,
      rating:               v.rating             ?? 0,
      grade:                v.grade              ?? '',
      playCount:            v.play_count         ?? 0,
      downloadRequestCount: v.download_request_count ?? 0,
      copyCount:            v.copy_count         ?? 0,
      actorCopyCount,
      tagCopyCount,
      favorite:             Boolean(v.favorite),
      recommended:          Boolean(v.recommended),
      fileSize:             v.size               ?? 0,
    }
    const { themeScore } = calcScores(dto)
    return { ...v, _actors: actorList, _tags: tags, _score: themeScore, primaryActor }
  })
}

// ─────────────────────────────────────────────────────────────
// AI 최종 추천 (5단계 AI 호출)
// ─────────────────────────────────────────────────────────────

async function callAiRecommend(userPrompt, intent, candidates, maxItems = 30) {
  const client = getOpenAIClient()
  const model  = process.env.OPENAI_MODEL || 'gpt-4.1'

  // file_path 제외한 안전한 후보 목록
  const safeCandidates = candidates.map(v => ({
    id:         v.id,
    fileName:   v.file_name,
    code:       v.code        || '',
    actors:     v.actor_name  || v._actors?.map(a => a.name).join(', ') || '',
    tags:       v._tags       ?? [],
    rating:     v.rating      ?? 0,
    grade:      v.grade       ?? '',
    playCount:  v.play_count  ?? 0,
    copyCount:  v.copy_count  ?? 0,
    score:      v._score      ?? 0,
  }))

  const system = `당신은 영상 라이브러리 추천 AI입니다.
아래 후보 목록에서 사용자 요청에 가장 잘 맞는 영상을 추천하고 이유를 설명하세요.

규칙:
- 반드시 제공된 후보 목록의 id 만 사용하세요. 없는 id를 만들지 마세요.
- 최소 5개, 최대 ${maxItems}개를 추천하세요.
- 각 항목에 한국어로 간결한 추천 이유를 적으세요.
- 후보 목록 끝부분에는 순환 다양성을 위해 점수가 낮은 탐색 후보가 1~2개 포함되어 있습니다. 사용자 요청에 조금이라도 맞는다면 이들을 추천에 포함해 새로운 발견 기회를 제공하세요.
- JSON만 반환하세요. 설명 문장이나 마크다운 코드 블록 없이.

응답 형식:
{
  "summary": "전체 추천 요약 (1~2문장)",
  "reason": "이 조건으로 추천한 배경",
  "items": [
    { "videoId": 1, "reason": "추천 이유", "scoreComment": "점수 근거" }
  ]
}`

  const userMsg = `요청: "${userPrompt}"\n\n후보 목록:\n${JSON.stringify(safeCandidates)}`

  const resp = await client.responses.create({
    model,
    temperature: 0.7,
    instructions: system,
    input: userMsg,
    text: { format: { type: 'json_object' } },
  })

  const raw = resp.output_text?.trim() ?? ''
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const fb = s.indexOf('{'); if (fb > 0) s = s.slice(fb)
  const lb = s.lastIndexOf('}'); if (lb !== -1 && lb < s.length - 1) s = s.slice(0, lb + 1)
  // 문자열 리터럴 밖의 // 주석 제거
  s = s.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, str) => str ?? '')
  return JSON.parse(s)
}

// ─────────────────────────────────────────────────────────────
// 메인 진입점
// ─────────────────────────────────────────────────────────────

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userPrompt
 * @returns {Promise<{
 *   success: true,
 *   summary: string,
 *   reason: string,
 *   items: Array<{video: object, reason: string, scoreComment: string}>
 * } | { success: false, error: string }>}
 */
async function askAiChatRecommend(db, userPrompt) {
  if (!userPrompt || !userPrompt.trim()) {
    return { success: false, error: '질문을 입력해 주세요.' }
  }

  // 1. 의도 분석
  let intent
  try {
    intent = await parseIntent(userPrompt)
  } catch (err) {
    return { success: false, error: `의도 분석 실패: ${err.message}` }
  }

  // ── 삭제 후보 모드 분기 ───────────────────────────────────────
  // deleteMode=true이면 일반 추천 로직 대신 삭제 후보 조회 로직을 사용한다.
  // 두 로직은 완전히 분리되어 있으며, 볼만한 영상 추천과 절대 혼동되지 않는다.
  if (intent.deleteMode) {
    return _handleDeleteModeRecommend(db, userPrompt, intent)
  }

  // 2. DB 후보 조회 (일반 추천)
  let rows
  try {
    rows = queryCandidates(db, intent)
  } catch (err) {
    return { success: false, error: `DB 조회 실패: ${err.message}` }
  }

  if (rows.length === 0) {
    return { success: false, error: '조건에 맞는 영상이 없습니다. 조건을 완화해 보세요.' }
  }

  // 배우 연결 맵
  const videoIds = rows.map(r => r.id)
  const actorsMap = {}
  try {
    const idPH = videoIds.map(() => '?').join(',')
    const actorRows = db.prepare(`
      SELECT va.video_id, a.id AS actor_id, a.name, a.rating AS actor_rating
      FROM video_actors va
      JOIN actors a ON a.id = va.actor_id
      WHERE va.video_id IN (${idPH})
      ORDER BY va.video_id, va.order_index ASC
    `).all(...videoIds)
    for (const r of actorRows) {
      if (!actorsMap[r.video_id]) actorsMap[r.video_id] = []
      actorsMap[r.video_id].push({ name: r.name, rating: r.actor_rating })
    }
  } catch { /* actors 없는 구버전 무시 */ }

  // 배우별 / 태그별 복사 횟수 집계
  const actorCopyMap = {}
  const tagCopyMap   = {}
  try {
    const actorCopyRows = db.prepare(`
      SELECT a.name, COUNT(*) AS cnt
      FROM video_activity_logs val
      JOIN video_actors va ON va.video_id = val.video_id
      JOIN actors a ON a.id = va.actor_id
      WHERE val.action_type IN ('copy_to_clipboard', 'copy_to_device')
      GROUP BY a.name
    `).all()
    for (const r of actorCopyRows) actorCopyMap[r.name] = r.cnt
  } catch { /* 무시 */ }

  for (const v of rows) {
    const cc = v.copy_count || 0
    if (!cc) continue
    const tags = (v.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    for (const tag of tags) tagCopyMap[tag] = (tagCopyMap[tag] || 0) + cc
  }

  // 3. 후보 선정
  // 배우 별점 기준 쿼리면: 해당하는 모든 배우가 후보에 포함되도록 배우별 균등 선정
  // 일반 쿼리면: 테마 점수 기반 정렬 후 상위 N개
  const isActorRatingQuery = ((intent.actorRatingExact ?? 0) > 0 || (intent.actorMinRating ?? 0) > 0)
  let candidates, aiMaxItems
  if (isActorRatingQuery) {
    candidates = buildActorCoveredCandidates(rows, actorsMap, actorCopyMap, tagCopyMap, intent, 100)
    aiMaxItems = Math.min(candidates.length, 50)
  } else {
    const candidateLimit = Math.min(Math.max(Number(intent.limit) || 50, 20), 100)
    candidates = scoreAndSort(rows, actorsMap, actorCopyMap, tagCopyMap, intent.sortHint, candidateLimit)
    aiMaxItems = 30
  }

  // 4. AI 추천
  let aiResult
  try {
    aiResult = await callAiRecommend(userPrompt, intent, candidates, aiMaxItems)
  } catch (err) {
    return { success: false, error: `AI 추천 실패: ${err.message}` }
  }

  if (!aiResult || !Array.isArray(aiResult.items)) {
    return { success: false, error: 'AI 응답 형식이 올바르지 않습니다.' }
  }

  // 5. videoId 검증 + 실제 row 첨부
  const candidateMap = new Map(candidates.map(c => [c.id, c]))
  const items = aiResult.items
    .filter(item => candidateMap.has(Number(item.videoId)))
    .map(item => {
      const v = candidateMap.get(Number(item.videoId))
      return {
        video: {
          id:          v.id,
          file_name:   v.file_name,
          file_path:   v.file_path,
          code:        v.code        ?? '',
          actor_name:  v.actor_name  ?? '',
          tags:        v.tags        ?? '',
          rating:      v.rating      ?? 0,
          grade:       v.grade       ?? '',
          recommended: v.recommended ?? 0,
          is_new:      v.is_new      ?? 0,
          favorite:    v.favorite    ?? 0,
          play_count:  v.play_count  ?? 0,
          copy_count:  v.copy_count  ?? 0,
          themeScore:  v._score      ?? 0,
          actorsList:  actorsMap[v.id] ?? [],
        },
        reason:       item.reason       ?? '',
        scoreComment: item.scoreComment ?? '',
      }
    })

  if (items.length === 0) {
    return { success: false, error: 'AI가 유효한 추천 결과를 반환하지 않았습니다.' }
  }

  // 배우 별점 기반 요청인 경우 대표 배우 정보 집계
  const isActorRatingRequest =
    (intent.actorMinRating ?? 0) > 0 || (intent.actorRatingExact ?? 0) > 0

  let actorSummaries = []
  if (isActorRatingRequest) {
    // 추천 영상에 등장하는 배우별 통계 집계
    const actorStatsMap = new Map()
    for (const item of items) {
      const actors = actorsMap[item.video.id] ?? []
      for (const actor of actors) {
        const targetRating = intent.actorRatingExact ?? 0
        const minRat       = intent.actorMinRating   ?? 0
        const ar = actor.rating ?? 0
        if (targetRating > 0 && ar !== targetRating) continue
        if (minRat > 0 && ar < minRat) continue

        if (!actorStatsMap.has(actor.name)) {
          actorStatsMap.set(actor.name, {
            actor:       actor.name,
            actorRating: actor.rating ?? 0,
            videoCount:  0,
            tagSet:      new Set(),
            representativeVideos: [],
          })
        }
        const stat = actorStatsMap.get(actor.name)
        stat.videoCount++
        // 영상 태그 수집
        const tags = (item.video.tags || '').split(',').map(t => t.trim()).filter(Boolean)
        tags.forEach(t => stat.tagSet.add(t))
        if (stat.representativeVideos.length < 3) {
          stat.representativeVideos.push(item.video.id)
        }
      }
    }

    actorSummaries = Array.from(actorStatsMap.values())
      .sort((a, b) => b.videoCount - a.videoCount)
      .map(s => ({
        actor:       s.actor,
        actorRating: s.actorRating,
        tags:        Array.from(s.tagSet).slice(0, 5),
        videoCount:  s.videoCount,
        recommendedVideos: s.representativeVideos,
      }))
  }

  const result = {
    success:   true,
    summary:   aiResult.summary ?? '',
    reason:    aiResult.reason  ?? '',
    intent,
    items,
  }

  if (isActorRatingRequest && actorSummaries.length > 0) {
    result.actorSummaries = actorSummaries
  }

  return result
}

// ─────────────────────────────────────────────────────────────
// 삭제 후보 추천 모드 (deleteMode=true)
// 일반 추천(볼만한 영상)과 완전히 분리된 별도 경로
// ─────────────────────────────────────────────────────────────

/**
 * 삭제 후보 추천 결과를 AI 요약과 함께 반환한다.
 * @param {import('better-sqlite3').Database} db
 * @param {string} userPrompt
 * @param {object} intent
 */
async function _handleDeleteModeRecommend(db, userPrompt, intent) {
  const drive = intent.drive || null

  // 삭제 후보 조회 (driveStatsService)
  let deleteResult
  try {
    deleteResult = getDeleteCandidatesByDrive(db, drive)
  } catch (err) {
    return { success: false, error: `삭제 후보 조회 실패: ${err.message}` }
  }

  const candidates = deleteResult.candidates
  if (candidates.length === 0) {
    return {
      success:     true,
      deleteMode:  true,
      summary:     '삭제 후보 영상이 없습니다.',
      reason:      '현재 조건에 해당하는 삭제 후보가 없습니다.',
      intent,
      items:       [],
      driveInfo: {
        drive:         deleteResult.drive,
        freeSpace:     deleteResult.freeSpace,
        totalDiskSize: deleteResult.totalDiskSize,
        usedByLibrary: deleteResult.usedByLibrary,
      },
    }
  }

  // AI로 삭제 후보 요약 생성
  const client = getOpenAIClient()
  const model  = process.env.OPENAI_MODEL || 'gpt-4.1'

  const safeCandidates = candidates.slice(0, 50).map((v) => ({
    id:          v.id,
    filename:    v.filename,
    rating:      v.rating,
    actors:      v.actorNames.join(', '),
    tags:        v.tags,
    file_size_gb: +(v.file_size / (1024 ** 3)).toFixed(2),
    copy_count:  v.copy_count,
    watch_count: v.watch_count,
    deleteScore: v.deleteScore,
    reason:      v.reason,
  }))

  const system = `당신은 영상 라이브러리 정리 도우미입니다.
아래는 삭제 후보로 분류된 영상 목록입니다 (점수 높을수록 삭제 가치 높음).
사용자 요청을 참고해 정리 방향을 요약하고, 가장 먼저 정리할 영상 id 목록을 반환하세요.

규칙:
- 반드시 후보 목록에 있는 id만 사용하세요.
- 최대 20개를 선정하세요.
- 각 항목에 한국어로 간결한 삭제 이유를 적으세요.
- 이 응답은 볼만한 영상 추천이 아니라 지워도 될 영상 추천입니다.
- JSON만 반환하세요.

응답 형식:
{
  "summary": "정리 방향 요약 (1~2문장)",
  "reason": "이 영상들을 우선 정리 추천하는 배경",
  "items": [
    { "videoId": 1, "reason": "삭제 이유" }
  ]
}`

  let aiResult
  try {
    const resp = await client.responses.create({
      model,
      temperature: 0.3,
      instructions: system,
      input: `요청: "${userPrompt}"\n\n삭제 후보 목록:\n${JSON.stringify(safeCandidates)}`,
      text: { format: { type: 'json_object' } },
    })
    const raw = resp.output_text?.trim() ?? ''
    let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const fb = s.indexOf('{'); if (fb > 0) s = s.slice(fb)
    const lb = s.lastIndexOf('}'); if (lb !== -1 && lb < s.length - 1) s = s.slice(0, lb + 1)
    aiResult = JSON.parse(s)
  } catch {
    // AI 실패 시 로컬 결과만 반환
    aiResult = {
      summary: `삭제 후보 ${candidates.length}개를 발견했습니다.`,
      reason:  '별점 낮음, 미사용, 파일 크기 등 복합 조건으로 분류됨',
      items:   candidates.slice(0, 20).map((v) => ({ videoId: v.id, reason: v.reason.join(', ') })),
    }
  }

  // videoId 검증 + 후보 데이터 첨부
  const candidateMap = new Map(candidates.map((c) => [c.id, c]))
  const items = (aiResult.items ?? [])
    .filter((item) => candidateMap.has(Number(item.videoId)))
    .map((item) => {
      const v = candidateMap.get(Number(item.videoId))
      return {
        candidate: v,
        reason:    item.reason ?? v.reason.join(', '),
      }
    })

  return {
    success:    true,
    deleteMode: true,
    summary:    aiResult.summary ?? '',
    reason:     aiResult.reason  ?? '',
    intent,
    items,
    driveInfo: {
      drive:         deleteResult.drive,
      freeSpace:     deleteResult.freeSpace,
      totalDiskSize: deleteResult.totalDiskSize,
      usedByLibrary: deleteResult.usedByLibrary,
    },
  }
}

module.exports = { askAiChatRecommend }
