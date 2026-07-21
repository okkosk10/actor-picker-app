'use strict'

const { getOpenAIClient } = require('../openaiClient.cjs')
const {
  DEFAULT_CLARIFICATION_OPTIONS,
  PLAN_RESPONSE_SCHEMA,
} = require('./chatSchemas.cjs')
const {
  REGISTERED_TOOL_NAMES,
  buildToolManifestBlock,
  sanitizeToolArguments,
  validatePlannerResponse,
  buildStructuredError,
} = require('./toolRegistry.cjs')

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectDriveMention(text) {
  const match = normalizeText(text).match(/\b([A-Za-z]:)\b/)
  return match ? match[1].toUpperCase() : null
}

function extractPreviousResultHint(text, state) {
  const hasReference = /(그중|거기서|저 목록|방금|위 결과|그 배우들|그 영상들|이전 결과|전에 찾은|방금 것 중)/.test(String(text || ''))
  const lastResultIds = Array.isArray(state?.lastResultIds) ? state.lastResultIds.filter((value) => Number.isInteger(Number(value))) : []
  return {
    usePreviousResults: hasReference,
    baseResultIds: hasReference ? lastResultIds.map((value) => Number(value)).filter((value) => Number.isInteger(value)) : [],
    hasPreviousResults: lastResultIds.length > 0,
  }
}

function buildClarification(text) {
  const trimmed = normalizeText(text)
  if (/괜찮은|좋은 거|뭐 볼까|정리 좀 해줘|요약해줘|알아서/.test(trimmed)) {
    return {
      question: '어떤 기준으로 찾을까요?',
      options: DEFAULT_CLARIFICATION_OPTIONS,
    }
  }

  return {
    question: '어떤 기준으로 찾아볼까요?',
    options: DEFAULT_CLARIFICATION_OPTIONS,
  }
}

function buildFallbackPlan(message, context, state) {
  const text = normalizeText(message)
  const drive = detectDriveMention(text) || context?.activeFilters?.drive || null
  const previous = extractPreviousResultHint(text, state)

  if (!text) {
    return buildStructuredError('VALIDATION_ERROR', '메시지를 입력해 주세요.')
  }

  if (/삭제|지워|정리|공간 확보|삭제요망/.test(text)) {
    return {
      success: true,
      intent: 'cleanup_storage',
      confidence: 0.78,
      toolName: 'get_delete_candidates',
      arguments: {
        drive,
        lowRating: /별점|낮은 평점|안 본|안 봤|재생/.test(text),
        lowPlayCount: /안 본|안봤|재생/.test(text),
        onlyNotCopied: /복사 안|미복사/.test(text),
        sortBy: /용량|크기/.test(text) ? 'size' : 'deleteScore',
        limit: 20,
      },
      usePreviousResults: false,
      needsClarification: false,
      clarification: null,
      requiresConfirmation: /삭제|지워/.test(text),
      writeIntent: /삭제|지워/.test(text),
    }
  }

  if (/드라이브|저장소|용량|공간|통계/.test(text)) {
    return {
      success: true,
      intent: 'get_drive_stats',
      confidence: 0.8,
      toolName: 'get_drive_stats',
      arguments: { drive },
      usePreviousResults: false,
      needsClarification: false,
      clarification: null,
      requiresConfirmation: false,
      writeIntent: false,
    }
  }

  if (/배우|메타데이터|태그|소속사/.test(text)) {
    return {
      success: true,
      intent: 'search_actors',
      confidence: 0.72,
      toolName: 'search_actors',
      arguments: {
        query: text,
        agency: '',
        minRating: 0,
        metadataMissing: /부족|누락|비어|없는/.test(text),
        limit: 20,
      },
      usePreviousResults: previous.usePreviousResults,
      needsClarification: false,
      clarification: null,
      requiresConfirmation: false,
      writeIntent: false,
    }
  }

  if (/자막.*없|미매핑|매핑.*안/.test(text)) {
    if (/전체|폴더별|몇개|개수|통계/.test(text)) {
      return {
        success: true,
        intent: 'get_unmapped_subtitle_summary',
        confidence: 0.76,
        toolName: 'get_unmapped_subtitle_summary',
        arguments: { drive },
        usePreviousResults: false,
        needsClarification: false,
        clarification: null,
        requiresConfirmation: false,
        writeIntent: false,
      }
    }

    return {
      success: true,
      intent: 'search_videos_without_subtitles',
      confidence: 0.76,
      toolName: 'search_videos_without_subtitles',
      arguments: { drive, limit: 20 },
      usePreviousResults: previous.usePreviousResults,
      needsClarification: false,
      clarification: null,
      requiresConfirmation: false,
      writeIntent: false,
    }
  }

  if (previous.usePreviousResults && !previous.hasPreviousResults) {
    return {
      success: true,
      intent: 'unknown',
      confidence: 0.41,
      toolName: null,
      arguments: {},
      usePreviousResults: true,
      needsClarification: true,
      clarification: {
        question: '이전 결과가 없습니다. 먼저 검색을 실행해 주세요.',
        options: DEFAULT_CLARIFICATION_OPTIONS,
      },
      requiresConfirmation: false,
      writeIntent: false,
    }
  }

  return {
    success: true,
    intent: 'unknown',
    confidence: 0.42,
    toolName: null,
    arguments: {},
    usePreviousResults: previous.usePreviousResults,
    needsClarification: true,
    clarification: buildClarification(text),
    requiresConfirmation: false,
    writeIntent: false,
  }
}

async function planIntentWithOpenAI(message, context, state) {
  const client = getOpenAIClient()
  const model = process.env.OPENAI_MODEL || 'gpt-4.1'
  const previous = extractPreviousResultHint(message, state)

  const system = `너는 Actor Picker 내부 도구를 선택하는 Intent Planner다.

사용자의 문장을 단순 키워드 검색하지 말고 전체 의미를 해석한다.

목표:
1. 사용자가 실제로 원하는 결과를 판단한다.
2. 등록된 도구 중 가장 적절한 도구 하나를 선택한다.
3. 필요한 인자만 생성한다.
4. 사용자가 이전 검색 결과를 가리키면 baseResultIds를 사용한다.
5. 요청이 모호하면 억지로 도구를 실행하지 말고 clarification을 반환한다.
6. 현재 화면 정보는 참고만 하며, 사용자 요청보다 우선하지 않는다.
7. 존재하지 않는 도구나 인자는 생성하지 않는다.
8. 쓰기 작업은 직접 실행하지 않고 requiresConfirmation 상태를 반환한다.
9. 영상 별점과 배우 별점을 구분한다.
10. 삭제 후보 요청과 드라이브 통계 요청을 구분한다.

허용 도구:
${buildToolManifestBlock()}

반환 형식은 JSON 객체 하나만 출력한다. 설명 문장이나 마크다운 코드 블록은 금지한다.
반드시 json 객체만 출력해야 한다.

응답 스키마:
${JSON.stringify(PLAN_RESPONSE_SCHEMA, null, 2)}

clarification이 필요하면 question과 options를 포함하되, options는 간단한 구조화 payload로 제시한다.`

  const response = await client.responses.create({
    model,
    temperature: 0.1,
    instructions: system,
    input: JSON.stringify({
      message,
      currentContext: context,
      state,
      previousResultHint: previous,
      registeredToolNames: REGISTERED_TOOL_NAMES,
    }),
    text: { format: { type: 'json_object' } },
  })

  const raw = String(response.output_text || '').trim()
  let parsed
  try {
    let text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const firstBrace = text.indexOf('{')
    if (firstBrace > 0) text = text.slice(firstBrace)
    const lastBrace = text.lastIndexOf('}')
    if (lastBrace !== -1 && lastBrace < text.length - 1) text = text.slice(0, lastBrace + 1)
    parsed = JSON.parse(text)
  } catch {
    return buildStructuredError('AI_RESPONSE_PARSE_ERROR', 'Intent Planner 응답을 해석하지 못했습니다.')
  }

  if (typeof parsed.usePreviousResults === 'undefined') parsed.usePreviousResults = previous.usePreviousResults
  if (parsed.toolName && parsed.arguments) {
    parsed.arguments = sanitizeToolArguments(parsed.toolName, parsed.arguments, context, state)
  }

  const validation = validatePlannerResponse(parsed)
  if (!validation.success) return validation
  return validation.plan
}

async function planIntent(message, context = {}, state = {}, options = {}) {
  if (options.forceFallback) {
    return buildFallbackPlan(message, context, state)
  }

  try {
    const plan = await planIntentWithOpenAI(message, context, state)
    if (plan?.success === false) return plan
    if (plan?.needsClarification) return plan
    if (plan?.toolName) {
      plan.arguments = sanitizeToolArguments(plan.toolName, plan.arguments || {}, context, state)
      if (!plan.intent) plan.intent = plan.toolName
    }
    return plan
  } catch (error) {
    const fallback = buildFallbackPlan(message, context, state)
    if (fallback?.success) {
      fallback.fallbackReason = String(error?.message || 'planner_failed')
      return fallback
    }
    return buildStructuredError('AI_CONNECTION_ERROR', 'Intent Planner를 실행할 수 없습니다.')
  }
}

module.exports = {
  planIntent,
  buildFallbackPlan,
}