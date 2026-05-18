'use strict'

/**
 * electron/services/aiActorAnalysisService.cjs
 * 배우 AI 분석 서비스
 *
 * - 배우의 영상 태그·별점·활동 데이터를 OpenAI에 전달해 분석 결과를 생성한다.
 * - 결과는 ai_analysis_cache 테이블에 캐시되어 재분석 시 OpenAI 재호출을 방지한다.
 *
 * 보안:
 *   - API Key는 openaiClient.cjs에서만 관리, renderer로 전달하지 않는다.
 *   - AI는 제안만 한다. DB 저장은 이 모듈에서 직접 수행한다.
 */

const { getOpenAIClient } = require('./openaiClient.cjs')

// ─────────────────────────────────────────────────────────────
// 캐시 CRUD
// ─────────────────────────────────────────────────────────────

/**
 * ai_analysis_cache에서 단일 레코드를 조회한다.
 * @param {import('better-sqlite3').Database} db
 * @param {'actor'|'video'} entityType
 * @param {number} entityId
 * @returns {object|null}
 */
function getCache(db, entityType, entityId) {
  return db.prepare(`
    SELECT * FROM ai_analysis_cache
    WHERE entity_type = ? AND entity_id = ?
  `).get(entityType, entityId) ?? null
}

/**
 * ai_analysis_cache에 레코드를 upsert한다.
 * @param {import('better-sqlite3').Database} db
 * @param {'actor'|'video'} entityType
 * @param {number} entityId
 * @param {object} data - { ai_analysis?, ai_tags?, ai_score?, ai_summary?, ai_status, ai_updated_at? }
 */
function upsertCache(db, entityType, entityId, data) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO ai_analysis_cache
      (entity_type, entity_id, ai_analysis, ai_tags, ai_score, ai_summary, ai_status, ai_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      ai_analysis   = excluded.ai_analysis,
      ai_tags       = excluded.ai_tags,
      ai_score      = excluded.ai_score,
      ai_summary    = excluded.ai_summary,
      ai_status     = excluded.ai_status,
      ai_updated_at = excluded.ai_updated_at
  `).run(
    entityType,
    entityId,
    data.ai_analysis  ?? null,
    data.ai_tags      ?? null,
    data.ai_score     ?? 0,
    data.ai_summary   ?? null,
    data.ai_status    ?? 'pending',
    data.ai_updated_at ?? now,
  )
}

/**
 * ai_status만 업데이트한다. (processing / failed 상태 빠른 반영용)
 */
function updateStatus(db, entityType, entityId, status) {
  db.prepare(`
    UPDATE ai_analysis_cache
    SET ai_status = ?, ai_updated_at = ?
    WHERE entity_type = ? AND entity_id = ?
  `).run(status, new Date().toISOString(), entityType, entityId)
}

// ─────────────────────────────────────────────────────────────
// 배우 데이터 수집
// ─────────────────────────────────────────────────────────────

/**
 * 배우 분석에 필요한 데이터를 DB에서 수집한다.
 * @returns {{ actor, videos, tagFreq, avgRating, copyTotal }}
 */
function collectActorData(db, actorId) {
  const actor = db.prepare(`SELECT * FROM actors WHERE id = ?`).get(actorId)
  if (!actor) throw new Error(`배우 ID ${actorId}를 찾을 수 없습니다.`)

  // 이 배우의 영상 (video_actors 연결 + actor_name 폴백)
  const videos = db.prepare(`
    SELECT DISTINCT
      v.id, v.file_name, v.code, v.tags, v.rating, v.grade,
      v.play_count, v.recommended,
      COALESCE(s.copy_count, 0) AS copy_count,
      COALESCE(s.open_count,  0) AS open_count
    FROM videos v
    LEFT JOIN video_actors va ON va.video_id = v.id
    LEFT JOIN actors        a  ON a.id = va.actor_id
    LEFT JOIN (
      SELECT video_id,
        SUM(CASE WHEN action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END) AS copy_count,
        SUM(CASE WHEN action_type = 'open' THEN 1 ELSE 0 END) AS open_count
      FROM video_activity_logs GROUP BY video_id
    ) s ON s.video_id = v.id
    WHERE (a.id = ? OR v.actor_name LIKE ?)
      AND v.status = 'normal'
      AND (v.grade IS NULL OR v.grade NOT IN ('삭제요망', '삭제 요망'))
    ORDER BY (v.rating * 20 + COALESCE(s.copy_count,0) * 3) DESC
    LIMIT 50
  `).all(actorId, `%${actor.name}%`)

  // 태그 빈도 집계
  const tagFreq = {}
  for (const v of videos) {
    const tags = (v.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    for (const t of tags) tagFreq[t] = (tagFreq[t] || 0) + 1
  }

  const ratedVideos = videos.filter(v => (v.rating || 0) > 0)
  const avgRating = ratedVideos.length
    ? (ratedVideos.reduce((s, v) => s + v.rating, 0) / ratedVideos.length).toFixed(1)
    : 0
  const copyTotal = videos.reduce((s, v) => s + (v.copy_count || 0), 0)

  return { actor, videos, tagFreq, avgRating, copyTotal }
}

// ─────────────────────────────────────────────────────────────
// OpenAI 분석 호출
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 영상 라이브러리 배우 분석 전문가입니다.
배우의 영상 데이터(태그, 별점, 복사·재생 횟수)를 분석해 아래 JSON 형식으로만 반환하세요.
설명 문장이나 마크다운 없이 JSON 객체 하나만 출력하세요.

{
  "score": 75,
  "summary": "한 줄 요약 (50자 이내)",
  "agency": "소속사명 (없으면 빈 문자열)",
  "mood": ["청순", "러블리"],
  "style": ["슬렌더", "귀여운"],
  "strengths": ["연기 몰입감", "다양한 장르"],
  "recommendedTags": ["재시청 추천", "소장 가치"],
  "genreDistribution": { "여자친구": 40, "합방": 30, "학교": 30 },
  "activityLevel": "high"
}

필드 설명:
- score: 0~100 (별점·복사·재생 기반 종합 추천 점수)
- summary: 배우를 설명하는 핵심 한 줄 요약
- agency: 배우의 소속사 (데이터로 제공된 값을 우선 사용, 모를 경우 빈 문자열)
- mood: 배우 분위기/이미지 키워드 (2~4개)
- style: 외형/스타일 특징 (2~4개)
- strengths: 이 배우의 강점 (2~3개)
- recommendedTags: 이 배우 영상에 붙이면 좋을 태그 (2~4개)
- genreDistribution: 장르별 비율 (%) - 상위 3~5개
- activityLevel: "high"|"medium"|"low" (복사+재생 기준)`

async function callOpenAI(actorData) {
  const { actor, videos, tagFreq, avgRating, copyTotal } = actorData
  const client = getOpenAIClient()
  const model  = process.env.OPENAI_MODEL || 'gpt-4.1'

  // AI에게 전달할 요약 데이터 (전체 영상 목록 대신 집계 정보 전달 → 토큰 절약)
  const topTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, cnt]) => `${tag}(${cnt})`)

  const sampleVideos = videos.slice(0, 10).map(v => ({
    code:    v.code || v.file_name.slice(0, 20),
    rating:  v.rating || 0,
    copies:  v.copy_count || 0,
    plays:   v.open_count  || 0,
    tags:    (v.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 5),
  }))

  const payload = JSON.stringify({
    name:         actor.name,
    agency:       actor.agency || '',
    actorTags:    (actor.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    actorRating:  actor.rating || 0,
    totalVideos:  videos.length,
    avgRating,
    copyTotal,
    topTags,
    sampleVideos,
  })

  // json_object 포맷 사용 시 input 메시지에 'json' 단어 필수 (OpenAI API 요구사항)
  const input = `아래 배우 데이터를 분석해 JSON으로 반환해 주세요:\n\n${payload}`

  const resp = await client.responses.create({
    model,
    temperature: 0.4,
    instructions: SYSTEM_PROMPT,
    input,
    text: { format: { type: 'json_object' } },
  })

  const raw = resp.output_text?.trim() ?? ''
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const fb = s.indexOf('{'); if (fb > 0) s = s.slice(fb)
  const lb = s.lastIndexOf('}'); if (lb !== -1 && lb < s.length - 1) s = s.slice(0, lb + 1)
  return JSON.parse(s)
}

// ─────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────

/**
 * 배우 AI 분석을 실행하고 결과를 DB에 캐시한다.
 *
 * - ai_status === 'done' 이고 force=false 이면 캐시를 그대로 반환 (재호출 금지)
 * - force=true 이면 강제 재분석
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} actorId
 * @param {boolean} [force=false]
 * @returns {Promise<{ success: true, data: object, fromCache: boolean }
 *                 | { success: false, error: string }>}
 */
async function analyzeActor(db, actorId, force = false) {
  // 1. 캐시 확인 (force=false + done 이면 캐시 반환)
  const cached = getCache(db, 'actor', actorId)
  if (!force && cached?.ai_status === 'done') {
    return {
      success: true,
      fromCache: true,
      data: {
        ...cached,
        ai_tags:     cached.ai_tags     ? JSON.parse(cached.ai_tags)     : [],
        ai_analysis: cached.ai_analysis ? JSON.parse(cached.ai_analysis) : null,
      },
    }
  }

  // 2. processing 상태로 마킹
  upsertCache(db, 'actor', actorId, { ai_status: 'processing' })

  try {
    // 3. 데이터 수집
    const actorData = collectActorData(db, actorId)

    // 4. OpenAI 분석
    const analysis = await callOpenAI(actorData)

    // 5. 결과 저장
    const now = new Date().toISOString()
    const payload = {
      ai_analysis:   JSON.stringify(analysis),
      ai_tags:       JSON.stringify(analysis.recommendedTags ?? []),
      ai_score:      typeof analysis.score === 'number' ? Math.min(100, Math.max(0, analysis.score)) : 0,
      ai_summary:    analysis.summary ?? '',
      ai_status:     'done',
      ai_updated_at: now,
    }
    upsertCache(db, 'actor', actorId, payload)

    return {
      success: true,
      fromCache: false,
      data: {
        entity_type:   'actor',
        entity_id:     actorId,
        ...payload,
        ai_tags:       analysis.recommendedTags ?? [],
        ai_analysis:   analysis,
      },
    }
  } catch (err) {
    updateStatus(db, 'actor', actorId, 'failed')
    console.error('[aiActorAnalysis] 분석 실패:', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * 캐시된 AI 분석 결과를 조회한다.
 * @param {import('better-sqlite3').Database} db
 * @param {'actor'|'video'} entityType
 * @param {number} entityId
 * @returns {{ success: true, data: object|null } | { success: false, error: string }}
 */
function getAiAnalysis(db, entityType, entityId) {
  try {
    const row = getCache(db, entityType, entityId)
    if (!row) return { success: true, data: null }
    return {
      success: true,
      data: {
        ...row,
        ai_tags:     row.ai_tags     ? JSON.parse(row.ai_tags)     : [],
        ai_analysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : null,
      },
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

module.exports = { analyzeActor, getAiAnalysis, getCache, upsertCache, updateStatus }
