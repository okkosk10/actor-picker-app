'use strict'

const fs = require('fs')
const { getOpenAIClient } = require('./openaiClient.cjs')
const { parseSubtitleContent, readSubtitleFile } = require('./subtitleParserService.cjs')
const { chunkSubtitleCues } = require('./subtitleChunkService.cjs')

const SUBTITLE_METADATA_PROMPT_VERSION = 'subtitle-metadata-v1'
const DEFAULT_MODEL = process.env.OPENAI_SUBTITLE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1'
const DEFAULT_MAX_CHARS_PER_CHUNK = Number(process.env.SUBTITLE_AI_MAX_CHARS_PER_CHUNK || 12000)
const DEFAULT_MIN_TAIL_CHARS = Number(process.env.SUBTITLE_AI_MIN_TAIL_CHARS || 1600)

const FINAL_DEFAULTS = {
  outline: '',
  plot: '',
  story_structure: { opening: '', middle: '', ending: '' },
  tags: [],
  relationship: [],
  tone: [],
  confidence: 0,
  warnings: [],
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim()
}

function toJsonArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean)
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => normalizeText(item)).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseMaybeJson(raw) {
  const base = normalizeText(raw)
  if (!base) return null
  const candidates = [
    base,
    base.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim(),
  ]

  for (const candidate of candidates) {
    const firstBrace = candidate.indexOf('{')
    const lastBrace = candidate.lastIndexOf('}')
    const trimmed = firstBrace > 0 ? candidate.slice(firstBrace) : candidate
    const bounded = lastBrace !== -1 && lastBrace < trimmed.length - 1 ? trimmed.slice(0, lastBrace + 1) : trimmed
    try {
      return JSON.parse(bounded)
    } catch {
      continue
    }
  }

  return null
}

function clampConfidence(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(1, raw))
}

function dedupeStrings(values, maxCount = 10) {
  const seen = new Set()
  const result = []
  for (const item of Array.isArray(values) ? values : []) {
    const text = normalizeText(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= maxCount) break
  }
  return result
}

function normalizeFinalAnalysis(raw) {
  const parsed = raw && typeof raw === 'object' ? raw : {}
  const story = parsed.story_structure && typeof parsed.story_structure === 'object' ? parsed.story_structure : {}

  return {
    outline: normalizeText(parsed.outline || FINAL_DEFAULTS.outline),
    plot: normalizeText(parsed.plot || FINAL_DEFAULTS.plot),
    story_structure: {
      opening: normalizeText(story.opening || FINAL_DEFAULTS.story_structure.opening),
      middle: normalizeText(story.middle || FINAL_DEFAULTS.story_structure.middle),
      ending: normalizeText(story.ending || FINAL_DEFAULTS.story_structure.ending),
    },
    tags: dedupeStrings(parsed.tags, 10),
    relationship: dedupeStrings(parsed.relationship, 10),
    tone: dedupeStrings(parsed.tone, 10),
    confidence: clampConfidence(parsed.confidence),
    warnings: dedupeStrings(parsed.warnings, 20),
  }
}

function normalizeChunkAnalysis(raw) {
  const parsed = raw && typeof raw === 'object' ? raw : {}
  return {
    summary: normalizeText(parsed.summary || ''),
    events: dedupeStrings(parsed.events, 8),
    relationship_clues: dedupeStrings(parsed.relationship_clues, 5),
    tone: dedupeStrings(parsed.tone, 5),
    tag_candidates: dedupeStrings(parsed.tag_candidates, 8),
    uncertain_points: dedupeStrings(parsed.uncertain_points, 8),
  }
}

function cleanTags(tags, { actorNames = [], aliases = [], code = '' } = {}) {
  const actorSet = new Set([
    ...dedupeStrings(actorNames, 50),
    ...dedupeStrings(aliases, 50),
    normalizeText(code),
  ].filter(Boolean).map((item) => item.toLowerCase()))

  const banned = ['즐겨찾기', 'favorite', 'fav', 'rating', '평점', '등급']

  const result = []
  for (const item of Array.isArray(tags) ? tags : []) {
    const text = normalizeText(item)
    if (!text) continue
    if (text.length > 30) continue
    if (/https?:\/\//i.test(text) || /\bwww\./i.test(text)) continue
    if (actorSet.has(text.toLowerCase())) continue
    if (banned.some((token) => text.toLowerCase().includes(token))) continue
    if (/^\d+[./-]\d+/.test(text)) continue
    if (/^\d+\/\d+$/.test(text)) continue
    if (/^[A-Z0-9][A-Z0-9-]{2,}$/.test(text) && text.toUpperCase() === text) continue
    result.push(text)
  }

  return dedupeStrings(result, 10)
}

function buildRulesText() {
  return [
    '- 자막에 없는 설정, 관계, 행동을 창작하지 않는다.',
    '- 자막으로 확실하지 않은 관계는 단정하지 않는다.',
    '- 외모, 장소, 의상, 촬영 방식은 자막에서 확인되지 않으면 추측하지 않는다.',
    '- 배우 이름과 품번은 DB 데이터를 사용하며 자막에서 추측하지 않는다.',
    '- 원본 대사를 길게 그대로 인용하지 않는다.',
    '- 광고, URL, 번역 안내, 자막 제작자 문구는 작품 내용에서 제외한다.',
    '- 반복 감탄사나 의미 없는 짧은 반복은 주요 줄거리로 취급하지 않는다.',
    '- 결말과 후반부 핵심 전개는 과도하게 스포일러하지 않는다.',
    '- 작품 설명은 자극적인 홍보 문구가 아니라 상황과 대화 전개를 설명하는 중립적인 메타데이터로 작성한다.',
    '- 원본보다 표현 수위를 높이지 않는다.',
    '- 자막에서 확인되지 않는 민감한 설정은 생성하지 않는다.',
    '- 나이나 관계가 불분명하면 언급하지 않는다.',
    '- 불확실한 내용은 추측하는 대신 생략하거나 warnings에 기록한다.',
  ].join('\n')
}

function buildChunkSystemPrompt() {
  return `당신은 자막에서 확인 가능한 정보만 요약하는 분석기입니다.
반드시 JSON 객체 하나만 반환하세요. 설명 문장, 마크다운, 코드 블록은 금지합니다.

${buildRulesText()}

응답 형식:
{
  "summary": "해당 구간에서 확인되는 주요 상황",
  "events": ["주요 상황 1"],
  "relationship_clues": ["확인 가능한 관계 단서"],
  "tone": ["긴장감"],
  "tag_candidates": ["면접", "직장"],
  "uncertain_points": ["관계가 명확하지 않음"]
}`
}

function buildFinalSystemPrompt() {
  return `당신은 합법적으로 제작된 성인용 영상의 자막을 바탕으로 작품 메타데이터를 정리하는 분석기입니다.
반드시 JSON 객체 하나만 반환하세요. 설명 문장, 마크다운, 코드 블록은 금지합니다.

${buildRulesText()}

최종 스키마:
{
  "outline": "Jellyfin에 표시할 한 줄 작품 설명",
  "plot": "작품의 도입과 주요 상황 전개를 설명하는 3~5문장 요약",
  "story_structure": {
    "opening": "초반 상황",
    "middle": "중반 전개",
    "ending": "후반 분위기와 마무리"
  },
  "tags": ["상황극", "대화 중심"],
  "relationship": ["직장 동료"],
  "tone": ["차분함", "긴장감"],
  "confidence": 0.85,
  "warnings": []
}`
}

function buildVideoContextPrompt(video, actors, subtitles, chunkCount) {
  return JSON.stringify({
    video: {
      id: video.id,
      code: video.code || '',
      title: video.title || video.file_name || '',
      fileName: video.file_name || '',
      folderPath: video.folder_path || '',
    },
    actors: actors.map((actor) => ({
      name: actor.name || '',
      aliases: toJsonArray(actor.aliases),
      rating: Number(actor.rating) || 0,
      isMain: Number(actor.is_main) === 1,
    })),
    subtitles: {
      chunkCount,
      totalCueCount: subtitles.stats.processedCueCount,
      removedAdLines: subtitles.stats.removedAdLines,
      removedDuplicateLines: subtitles.stats.removedDuplicateLines,
      collapsedRepetitionCount: subtitles.stats.collapsedRepetitionCount,
    },
  }, null, 2)
}

function extractUsage(response) {
  const usage = response?.usage || {}
  return {
    inputTokens: Number(usage.input_tokens || usage.inputTokens || 0) || 0,
    outputTokens: Number(usage.output_tokens || usage.outputTokens || 0) || 0,
  }
}

function isRetriableOpenAiError(error) {
  const status = Number(error?.status || error?.response?.status || 0)
  if (status === 400 || status === 401 || status === 403 || status === 404) return false
  if (status === 429 || status >= 500) return true
  const message = String(error?.message || '').toLowerCase()
  return message.includes('rate limit') || message.includes('timeout') || message.includes('temporarily') || message.includes('server error')
}

async function callOpenAIJson(client, payload) {
  const requestBody = {
    model: payload.model || DEFAULT_MODEL,
    temperature: payload.temperature ?? 0.2,
    instructions: payload.instructions,
    input: payload.input,
    text: { format: { type: 'json_object' } },
  }

  const response = payload.signal
    ? await client.responses.create(requestBody, { signal: payload.signal })
    : await client.responses.create(requestBody)

  const raw = response.output_text?.trim() ?? ''
  const parsed = parseMaybeJson(raw)
  if (!parsed) {
    const parseError = new Error('AI 응답 JSON 파싱에 실패했습니다.')
    parseError.rawResponse = raw
    throw parseError
  }

  return { response, raw, parsed }
}

async function callOpenAIJsonWithRetry(client, payload, retries = 2) {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await callOpenAIJson(client, payload)
    } catch (error) {
      lastError = error
      if (!isRetriableOpenAiError(error) || attempt >= retries) break
    }
  }
  throw lastError
}

function getVideoAnalysisRow(db, videoId) {
  const rows = db.prepare(`
    SELECT
      v.*,
      va.is_main,
      va.order_index,
      a.id AS actor_id,
      a.name AS actor_name_joined,
      a.aliases AS actor_aliases,
      a.rating AS actor_rating
    FROM videos v
    LEFT JOIN video_actors va ON va.video_id = v.id
    LEFT JOIN actors a ON a.id = va.actor_id
    WHERE v.id = ?
    ORDER BY va.is_main DESC, va.order_index ASC, a.name ASC
  `).all(videoId)

  if (rows.length === 0) return null

  const video = rows[0]
  const actors = []
  const actorNames = []
  const actorAliases = []

  for (const row of rows) {
    if (!row.actor_id) continue
    actors.push({
      id: row.actor_id,
      name: row.actor_name_joined || '',
      aliases: row.actor_aliases || '',
      rating: Number(row.actor_rating) || 0,
      is_main: Number(row.is_main) || 0,
      order_index: Number(row.order_index) || 0,
    })
    actorNames.push(row.actor_name_joined || '')
    actorAliases.push(...toJsonArray(row.actor_aliases))
  }

  return {
    video,
    actors,
    actorNames: dedupeStrings(actorNames, 50),
    actorAliases: dedupeStrings(actorAliases, 50),
  }
}

function getAnalysisStateSnapshot(video) {
  return {
    ai_outline: video.ai_outline || '',
    ai_plot: video.ai_plot || '',
    ai_tags: video.ai_tags || '[]',
    ai_story_structure: video.ai_story_structure || '',
    ai_relationship: video.ai_relationship || '[]',
    ai_tone: video.ai_tone || '[]',
    ai_confidence: video.ai_confidence ?? null,
    ai_warnings: video.ai_warnings || '[]',
    ai_raw_response: video.ai_raw_response || '',
    ai_model: video.ai_model || '',
    ai_prompt_version: video.ai_prompt_version || '',
    ai_error: video.ai_error || '',
    ai_input_tokens: Number(video.ai_input_tokens || 0) || 0,
    ai_output_tokens: Number(video.ai_output_tokens || 0) || 0,
    ai_api_calls: Number(video.ai_api_calls || 0) || 0,
    ai_summary_status: video.ai_summary_status || 'not_analyzed',
    ai_summary_source_path: video.ai_summary_source_path || '',
    ai_summary_source_hash: video.ai_summary_source_hash || '',
    ai_summary_updated_at: video.ai_summary_updated_at || null,
  }
}

function restoreAnalysisState(db, videoId, snapshot) {
  db.prepare(`
    UPDATE videos
    SET
      ai_outline = ?,
      ai_plot = ?,
      ai_tags = ?,
      ai_story_structure = ?,
      ai_relationship = ?,
      ai_tone = ?,
      ai_confidence = ?,
      ai_warnings = ?,
      ai_raw_response = ?,
      ai_model = ?,
      ai_prompt_version = ?,
      ai_error = ?,
      ai_input_tokens = ?,
      ai_output_tokens = ?,
      ai_api_calls = ?,
      ai_summary_status = ?,
      ai_summary_source_path = ?,
      ai_summary_source_hash = ?,
      ai_summary_updated_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    snapshot.ai_outline,
    snapshot.ai_plot,
    snapshot.ai_tags,
    snapshot.ai_story_structure,
    snapshot.ai_relationship,
    snapshot.ai_tone,
    snapshot.ai_confidence,
    snapshot.ai_warnings,
    snapshot.ai_raw_response,
    snapshot.ai_model,
    snapshot.ai_prompt_version,
    snapshot.ai_error,
    snapshot.ai_input_tokens,
    snapshot.ai_output_tokens,
    snapshot.ai_api_calls,
    snapshot.ai_summary_status,
    snapshot.ai_summary_source_path,
    snapshot.ai_summary_source_hash,
    snapshot.ai_summary_updated_at,
    videoId,
  )
}

function savePendingState(db, videoId) {
  db.prepare(`
    UPDATE videos
    SET ai_summary_status = 'pending',
        ai_error = '',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(videoId)
}

function saveFailedState(db, videoId, errorMessage) {
  db.prepare(`
    UPDATE videos
    SET ai_summary_status = 'failed',
        ai_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(errorMessage, videoId)
}

function saveNotAvailableState(db, videoId, errorMessage) {
  db.prepare(`
    UPDATE videos
    SET ai_summary_status = 'not_available',
        ai_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(errorMessage, videoId)
}

function saveAnalysisResult(db, videoId, payload) {
  db.prepare(`
    UPDATE videos
    SET
      ai_outline = ?,
      ai_plot = ?,
      ai_tags = ?,
      ai_story_structure = ?,
      ai_relationship = ?,
      ai_tone = ?,
      ai_confidence = ?,
      ai_warnings = ?,
      ai_raw_response = ?,
      ai_model = ?,
      ai_prompt_version = ?,
      ai_error = '',
      ai_input_tokens = ?,
      ai_output_tokens = ?,
      ai_api_calls = ?,
      ai_summary_status = ?,
      ai_summary_source_path = ?,
      ai_summary_source_hash = ?,
      ai_summary_updated_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    payload.ai_outline,
    payload.ai_plot,
    payload.ai_tags,
    payload.ai_story_structure,
    payload.ai_relationship,
    payload.ai_tone,
    payload.ai_confidence,
    payload.ai_warnings,
    payload.ai_raw_response,
    payload.ai_model,
    payload.ai_prompt_version,
    payload.ai_input_tokens,
    payload.ai_output_tokens,
    payload.ai_api_calls,
    payload.ai_summary_status,
    payload.ai_summary_source_path,
    payload.ai_summary_source_hash,
    payload.ai_summary_updated_at,
    videoId,
  )
}

async function analyzeSubtitleForMetadata({ db, videoId, force = false, onProgress, signal, client: injectedClient } = {}) {
  const analysisContext = getVideoAnalysisRow(db, videoId)
  if (!analysisContext) {
    return { success: false, error: '영상 정보 없음' }
  }

  const { video, actors, actorNames, actorAliases } = analysisContext
  const subtitlePath = String(video.primary_subtitle_path || '').trim()
  if (!subtitlePath) {
    saveNotAvailableState(db, videoId, '대표 자막 없음')
    return { success: true, status: 'not_available', reason: '대표 자막 없음' }
  }

  if (!fs.existsSync(subtitlePath)) {
    saveNotAvailableState(db, videoId, '자막 파일 없음')
    return { success: true, status: 'not_available', reason: '자막 파일 없음' }
  }

  const subtitleHash = String(video.primary_subtitle_hash || '').trim()
  const currentStatus = String(video.ai_summary_status || 'not_analyzed')
  const promptVersion = String(video.ai_prompt_version || '')

  if (
    !force
    && subtitleHash
    && subtitleHash === String(video.ai_summary_source_hash || '').trim()
    && (currentStatus === 'generated' || currentStatus === 'approved')
    && promptVersion === SUBTITLE_METADATA_PROMPT_VERSION
  ) {
    return {
      success: true,
      fromCache: true,
      status: currentStatus,
      reason: '이미 최신 분석 결과가 있음',
      data: {
        outline: video.ai_outline || '',
        plot: video.ai_plot || '',
        story_structure: parseMaybeJson(video.ai_story_structure) || FINAL_DEFAULTS.story_structure,
        tags: toJsonArray(video.ai_tags),
        relationship: toJsonArray(video.ai_relationship),
        tone: toJsonArray(video.ai_tone),
        confidence: Number(video.ai_confidence || 0) || 0,
        warnings: toJsonArray(video.ai_warnings),
        model: video.ai_model || '',
        promptVersion,
      },
    }
  }

  const previousSnapshot = getAnalysisStateSnapshot(video)
  savePendingState(db, videoId)

  const client = injectedClient || getOpenAIClient()
  const subtitleContent = await readSubtitleFile(subtitlePath)
  const parsed = parseSubtitleContent({ filePath: subtitlePath, content: subtitleContent })

  if (!parsed.cues.length) {
    saveFailedState(db, videoId, '자막 내용 없음')
    return { success: false, error: '자막 내용 없음' }
  }

  const chunked = chunkSubtitleCues(parsed.cues, {
    maxChars: DEFAULT_MAX_CHARS_PER_CHUNK,
    minTailChars: DEFAULT_MIN_TAIL_CHARS,
  })
  const chunks = chunked.chunks
  const chunkAnalyses = []
  let inputTokens = 0
  let outputTokens = 0
  let apiCalls = 0
  let lastRawResponse = ''

  try {
    if (signal?.aborted) {
      const abortError = new Error('사용자 취소')
      abortError.name = 'AbortError'
      throw abortError
    }

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      if (signal?.aborted) {
        const abortError = new Error('사용자 취소')
        abortError.name = 'AbortError'
        throw abortError
      }

      if (typeof onProgress === 'function') {
        onProgress({
          videoId,
          stage: 'chunk-analysis',
          chunkIndex: index + 1,
          chunkCount: chunks.length,
          message: `${index + 1}/${chunks.length} 구간 분석 중`,
        })
      }

      const result = await callOpenAIJsonWithRetry(client, {
        model: DEFAULT_MODEL,
        temperature: 0.2,
        instructions: buildChunkSystemPrompt(),
        input: [
          '작품 컨텍스트와 자막 구간을 분석해 JSON으로만 반환하세요.',
          '',
          '작품 컨텍스트:',
          buildVideoContextPrompt(video, actors, parsed, chunks.length),
          '',
          `구간 ${index + 1}/${chunks.length}:`,
          JSON.stringify(chunk, null, 2),
        ].join('\n'),
        signal,
      })

      chunkAnalyses.push(normalizeChunkAnalysis(result.parsed))
      lastRawResponse = result.raw
      const usage = extractUsage(result.response)
      inputTokens += usage.inputTokens
      outputTokens += usage.outputTokens
      apiCalls += 1
    }

    if (typeof onProgress === 'function') {
      onProgress({
        videoId,
        stage: 'finalizing',
        chunkIndex: chunks.length,
        chunkCount: chunks.length,
        message: '최종 통합 중',
      })
    }

    const finalResult = await callOpenAIJsonWithRetry(client, {
      model: DEFAULT_MODEL,
      temperature: 0.2,
      instructions: buildFinalSystemPrompt(),
      input: [
        '작품 컨텍스트:',
        buildVideoContextPrompt(video, actors, parsed, chunks.length),
        '',
        '구간 분석 결과(JSON):',
        JSON.stringify(chunkAnalyses, null, 2),
        '',
        '최종 JSON 출력 규칙을 지켜 하나의 작품 메타데이터로 통합하세요.',
      ].join('\n'),
      signal,
    })

    const usage = extractUsage(finalResult.response)
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    apiCalls += 1
    lastRawResponse = finalResult.raw

    const normalized = normalizeFinalAnalysis(finalResult.parsed)
    const tags = cleanTags(normalized.tags, { actorNames, aliases: actorAliases, code: video.code || '' })

    const payload = {
      ai_outline: normalized.outline,
      ai_plot: normalized.plot,
      ai_tags: JSON.stringify(tags),
      ai_story_structure: JSON.stringify(normalized.story_structure),
      ai_relationship: JSON.stringify(dedupeStrings(normalized.relationship, 10)),
      ai_tone: JSON.stringify(dedupeStrings(normalized.tone, 10)),
      ai_confidence: clampConfidence(normalized.confidence),
      ai_warnings: JSON.stringify(dedupeStrings(normalized.warnings, 20)),
      ai_raw_response: lastRawResponse,
      ai_model: DEFAULT_MODEL,
      ai_prompt_version: SUBTITLE_METADATA_PROMPT_VERSION,
      ai_input_tokens: inputTokens,
      ai_output_tokens: outputTokens,
      ai_api_calls: apiCalls,
      ai_summary_status: 'generated',
      ai_summary_source_path: subtitlePath,
      ai_summary_source_hash: subtitleHash,
      ai_summary_updated_at: new Date().toISOString(),
    }

    saveAnalysisResult(db, videoId, payload)

    if (typeof onProgress === 'function') {
      onProgress({
        videoId,
        stage: 'completed',
        chunkIndex: chunks.length,
        chunkCount: chunks.length,
        message: '분석 완료',
      })
    }

    return {
      success: true,
      status: 'generated',
      fromCache: false,
      data: {
        ...payload,
        ai_tags: tags,
        ai_relationship: dedupeStrings(normalized.relationship, 10),
        ai_tone: dedupeStrings(normalized.tone, 10),
        ai_warnings: dedupeStrings(normalized.warnings, 20),
      },
      stats: parsed.stats,
      chunkCount: chunks.length,
    }
  } catch (error) {
    if (error?.name === 'AbortError' || String(error?.message || '').includes('사용자 취소')) {
      restoreAnalysisState(db, videoId, previousSnapshot)
      if (typeof onProgress === 'function') {
        onProgress({
          videoId,
          stage: 'cancelled',
          chunkIndex: 0,
          chunkCount: chunks.length,
          message: '사용자 취소',
        })
      }
      return { success: false, cancelled: true, error: '사용자 취소' }
    }

    const errorMessage = error?.message || '알 수 없는 오류'
    saveFailedState(db, videoId, errorMessage)
    if (typeof onProgress === 'function') {
      onProgress({
        videoId,
        stage: 'failed',
        chunkIndex: 0,
        chunkCount: chunks.length,
        message: errorMessage,
      })
    }
    return { success: false, error: errorMessage }
  }
}

async function analyzeSubtitleBatch(db, options = {}) {
  const videoIds = Array.isArray(options.videoIds)
    ? options.videoIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : []

  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null
  const force = Boolean(options.force)
  const selectedIds = videoIds.length > 0 ? videoIds : db.prepare(`
    SELECT id
    FROM videos
    WHERE status != 'deleted'
    ORDER BY id ASC
    ${limit ? `LIMIT ${limit}` : ''}
  `).all().map((row) => row.id)

  const targets = limit ? selectedIds.slice(0, limit) : selectedIds
  const results = []
  const summary = {
    totalTargets: targets.length,
    processed: 0,
    generated: 0,
    approved: 0,
    notAvailable: 0,
    failed: 0,
    cancelled: 0,
    latest: [],
  }

  for (let index = 0; index < targets.length; index += 1) {
    if (options.signal?.aborted) {
      summary.cancelled += 1
      break
    }

    const videoId = targets[index]
    const result = await analyzeSubtitleForMetadata({
      db,
      videoId,
      force,
      onProgress: options.onProgress,
      signal: options.signal,
      client: options.client,
    })

    summary.processed += 1
    if (result?.status === 'generated' || result?.success) summary.generated += 1
    else if (result?.status === 'not_available') summary.notAvailable += 1
    else if (result?.cancelled) summary.cancelled += 1
    else summary.failed += 1

    results.push({ videoId, result })
    summary.latest.push({ videoId, status: result?.status || (result?.cancelled ? 'cancelled' : result?.success ? 'generated' : 'failed') })
    if (summary.latest.length > 5) summary.latest.shift()
  }

  return { success: true, summary, results }
}

function getSubtitleAnalysisRecord(db, videoId) {
  const row = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(videoId)
  if (!row) return null

  return {
    id: row.id,
    code: row.code || '',
    fileName: row.file_name || '',
    filePath: row.file_path || '',
    folderPath: row.folder_path || '',
    primarySubtitlePath: row.primary_subtitle_path || '',
    primarySubtitleHash: row.primary_subtitle_hash || '',
    subtitleStatus: row.subtitle_status || 'unknown',
    aiSummaryStatus: row.ai_summary_status || 'not_analyzed',
    aiOutline: row.ai_outline || '',
    aiPlot: row.ai_plot || '',
    aiTags: toJsonArray(row.ai_tags),
    aiStoryStructure: parseMaybeJson(row.ai_story_structure) || FINAL_DEFAULTS.story_structure,
    aiRelationship: toJsonArray(row.ai_relationship),
    aiTone: toJsonArray(row.ai_tone),
    aiConfidence: Number(row.ai_confidence || 0) || 0,
    aiWarnings: toJsonArray(row.ai_warnings),
    aiRawResponse: row.ai_raw_response || '',
    aiModel: row.ai_model || '',
    aiPromptVersion: row.ai_prompt_version || '',
    aiError: row.ai_error || '',
    aiInputTokens: Number(row.ai_input_tokens || 0) || 0,
    aiOutputTokens: Number(row.ai_output_tokens || 0) || 0,
    aiApiCalls: Number(row.ai_api_calls || 0) || 0,
    aiSummarySourcePath: row.ai_summary_source_path || '',
    aiSummarySourceHash: row.ai_summary_source_hash || '',
    aiSummaryUpdatedAt: row.ai_summary_updated_at || null,
  }
}

function updateSubtitleAnalysis(db, videoId, patch = {}) {
  const current = getSubtitleAnalysisRecord(db, videoId)
  if (!current) return { success: false, error: '영상 정보 없음' }

  const outline = normalizeText(patch.outline ?? current.aiOutline)
  const plot = normalizeText(patch.plot ?? current.aiPlot)
  const storyStructure = patch.story_structure || patch.storyStructure || current.aiStoryStructure
  const tags = cleanTags(patch.tags ?? current.aiTags, { actorNames: [], aliases: [], code: current.code })
  const relationship = dedupeStrings(patch.relationship ?? current.aiRelationship, 10)
  const tone = dedupeStrings(patch.tone ?? current.aiTone, 10)
  const warnings = dedupeStrings(patch.warnings ?? current.aiWarnings, 20)
  const confidence = clampConfidence(patch.confidence ?? current.aiConfidence)
  const status = patch.approved ? 'approved' : (patch.status || current.aiSummaryStatus || 'generated')

  db.prepare(`
    UPDATE videos
    SET
      ai_outline = ?,
      ai_plot = ?,
      ai_tags = ?,
      ai_story_structure = ?,
      ai_relationship = ?,
      ai_tone = ?,
      ai_confidence = ?,
      ai_warnings = ?,
      ai_summary_status = ?,
      ai_error = '',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    outline,
    plot,
    JSON.stringify(tags),
    typeof storyStructure === 'string' ? storyStructure : JSON.stringify(storyStructure || FINAL_DEFAULTS.story_structure),
    JSON.stringify(relationship),
    JSON.stringify(tone),
    confidence,
    JSON.stringify(warnings),
    status,
    videoId,
  )

  return { success: true, status }
}

function approveSubtitleAnalysis(db, videoId) {
  return updateSubtitleAnalysis(db, videoId, { approved: true })
}

function unapproveSubtitleAnalysis(db, videoId) {
  const record = getSubtitleAnalysisRecord(db, videoId)
  if (!record) return { success: false, error: '영상 정보 없음' }
  const nextStatus = record.aiOutline || record.aiPlot || record.aiTags.length > 0 ? 'generated' : 'not_analyzed'
  return updateSubtitleAnalysis(db, videoId, { status: nextStatus })
}

function getSubtitleAnalysisStats(db) {
  const rows = db.prepare(`SELECT id, ai_summary_status FROM videos WHERE status != 'deleted'`).all()
  const summary = {
    totalVideos: rows.length,
    notAnalyzed: 0,
    generated: 0,
    approved: 0,
    failed: 0,
    stale: 0,
    notAvailable: 0,
    pending: 0,
  }

  for (const row of rows) {
    const status = String(row.ai_summary_status || 'not_analyzed')
    if (status === 'not_analyzed') summary.notAnalyzed += 1
    else if (status === 'generated') summary.generated += 1
    else if (status === 'approved') summary.approved += 1
    else if (status === 'failed') summary.failed += 1
    else if (status === 'stale') summary.stale += 1
    else if (status === 'not_available') summary.notAvailable += 1
    else if (status === 'pending') summary.pending += 1
  }

  return summary
}

module.exports = {
  SUBTITLE_METADATA_PROMPT_VERSION,
  FINAL_DEFAULTS,
  normalizeFinalAnalysis,
  normalizeChunkAnalysis,
  cleanTags,
  parseMaybeJson,
  callOpenAIJsonWithRetry,
  getSubtitleAnalysisRecord,
  analyzeSubtitleForMetadata,
  analyzeSubtitleBatch,
  updateSubtitleAnalysis,
  approveSubtitleAnalysis,
  unapproveSubtitleAnalysis,
  getSubtitleAnalysisStats,
  saveAnalysisResult,
  saveFailedState,
  saveNotAvailableState,
  savePendingState,
  restoreAnalysisState,
  getAnalysisStateSnapshot,
}