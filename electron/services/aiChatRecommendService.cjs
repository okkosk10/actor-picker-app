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

{
  "actorTags": [],      // 배우가 가진 태그 조건 (actors.tags LIKE)
  "videoTags": [],      // 영상 태그 조건 (videos.tags LIKE)
  "actorNames": [],     // 특정 배우명 (actors.name LIKE)
  "minRating": 0,       // 최소 별점 (0~5, 기본 0)
  "excludeGrades": [],  // 제외할 등급 (예: ["삭제요망"])
  "onlyGrades": [],     // 이 등급만 포함 (빈 배열이면 무제한)
  "onlyNew": false,     // true면 is_new=1만
  "onlyNotCopied": false, // true면 복사 이력 없는 것만
  "onlyFavorite": false,  // true면 favorite=1만
  "sortHint": "themeScore", // "themeScore"|"rating"|"playCount"|"copyCount"|"recent"
  "limit": 50           // 후보 수 (20~100)
}`

  const resp = await client.responses.create({
    model,
    temperature: 0.2,
    instructions: system,
    input: userPrompt,
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
    actorTags      = [],
    videoTags      = [],
    actorNames     = [],
    minRating      = 0,
    excludeGrades  = [],
    onlyGrades     = [],
    onlyNew        = false,
    onlyNotCopied  = false,
    onlyFavorite   = false,
    limit          = 50,
  } = intent

  const bindings = []
  const whereClauses = [
    "v.status = 'normal'",
    "v.status != 'duplicate'",
  ]

  // 최소 별점
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

  // 배우 태그 / 배우명 조건이 있으면 JOIN 필요
  let needsActorJoin = actorTags.length > 0 || actorNames.length > 0

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
  let actorJoinSQL = ''
  if (needsActorJoin) {
    actorJoinSQL = `
      JOIN video_actors va2 ON va2.video_id = v.id
      JOIN actors a2        ON a2.id = va2.actor_id`

    if (actorTags.length > 0) {
      const atClauses = actorTags.map(() => "a2.tags LIKE ?").join(' OR ')
      whereClauses.push(`(${atClauses})`)
      actorTags.forEach(t => bindings.push(`%${t}%`))
    }
    if (actorNames.length > 0) {
      const anClauses = actorNames.map(() => "a2.name LIKE ?").join(' OR ')
      whereClauses.push(`(${anClauses})`)
      actorNames.forEach(n => bindings.push(`%${n}%`))
    }
  }

  const actualLimit = Math.min(Math.max(Number(limit) || 50, 10), 200)

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
    LIMIT ${actualLimit * 4}
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
// AI 최종 추천 (5단계 AI 호출)
// ─────────────────────────────────────────────────────────────

async function callAiRecommend(userPrompt, intent, candidates) {
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
- 최소 5개, 최대 30개를 추천하세요.
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

  // 2. DB 후보 조회
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

  // 3. 로컬 점수 정렬 + 상위 50개만 추출
  const candidateLimit = Math.min(Math.max(Number(intent.limit) || 50, 20), 100)
  const candidates = scoreAndSort(rows, actorsMap, actorCopyMap, tagCopyMap, intent.sortHint, 50)

  // 4. AI 추천
  let aiResult
  try {
    aiResult = await callAiRecommend(userPrompt, intent, candidates)
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

  return {
    success:   true,
    summary:   aiResult.summary ?? '',
    reason:    aiResult.reason  ?? '',
    intent,
    items,
  }
}

module.exports = { askAiChatRecommend }
