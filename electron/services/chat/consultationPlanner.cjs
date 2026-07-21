'use strict'

const { getWorkflow, toToolAction } = require('./workflowRegistry.cjs')
const { computeMissingSlots, getNextMissingSlotQuestion } = require('./workflowSession.cjs')

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function detectDrive(text) {
  const normalized = normalizeText(text)
  const direct = normalized.match(/\b([A-Za-z]:)\b/)
  if (direct) return direct[1].toUpperCase()
  const named = normalized.match(/([A-Za-z])\s*드라이브/i)
  if (named) return `${named[1].toUpperCase()}:`
  return null
}

function detectScope(text) {
  if (/선택한|선택된|이것들|이 영상/.test(text)) return 'selected_videos'
  if (/현재\s*폴더|폴더/.test(text)) return 'current_folder'
  if (/현재\s*드라이브|드라이브|[A-Za-z]:/.test(text)) return 'current_drive'
  if (/전체|전부|모든/.test(text)) return 'all'
  return null
}

function chooseWorkflow(message) {
  const text = normalizeText(message)

  const explicitDeleteIntent = /삭제|지워|공간\s*확보|지워도\s*될|정리\s*후보/.test(text)
    || (/정리/.test(text) && /용량|공간|안\s*보|재생\s*안|별점\s*낮|복사\s*안|미복사/.test(text))

  if (explicitDeleteIntent) {
    return { workflowId: 'cleanup_storage', confidence: 0.9 }
  }

  if (/자막.*없|미매핑|매핑.*안/.test(text)) {
    if (/몇\s*개|개수|통계|현황|폴더별/.test(text)) {
      return { workflowId: 'get_unmapped_subtitle_summary', confidence: 0.93 }
    }
    return { workflowId: 'find_videos_without_subtitles', confidence: 0.95 }
  }

  if (/용량.*정리|안\s*보는.*정리/.test(text)) {
    return { workflowId: 'cleanup_storage', confidence: 0.9 }
  }

  if (/드라이브|저장소|용량|얼마나\s*있/.test(text)) {
    return { workflowId: 'get_drive_stats', confidence: 0.82 }
  }

  if (/배우/.test(text) && /영상|작품|추천|미복사/.test(text)) {
    return { workflowId: 'search_videos', confidence: 0.83 }
  }

  if (/배우|소속사|태그|메타데이터/.test(text)) {
    return { workflowId: 'search_actors', confidence: 0.82 }
  }

  if (/영상|작품|추천|미복사|별점/.test(text)) {
    return { workflowId: 'search_videos', confidence: 0.76 }
  }

  if (/정리\s*좀\s*해줘/.test(text)) {
    return { workflowId: null, confidence: 0.45 }
  }

  return { workflowId: null, confidence: 0.4 }
}

function extractSlots(workflowId, message, context = {}) {
  const text = normalizeText(message)
  const slots = {}
  const drive = detectDrive(text)
  const scope = detectScope(text)

  if (scope) slots.scope = scope
  if (drive) slots.drive = drive

  if (workflowId === 'cleanup_storage') {
    if (drive) slots.scope = slots.scope || 'specific_drive'
    if (/용량|큰\s*영상|대용량|10기가|10GB/i.test(text)) {
      slots.cleanupGoal = 'large_files'
      slots.sortBy = 'size'
      slots.minSizeBytes = 10 * 1024 ** 3
    }
    if (/안\s*보|재생\s*안|안\s*본/.test(text)) {
      slots.cleanupGoal = slots.cleanupGoal || 'unplayed'
      slots.lowPlayCount = true
    }
    if (/별점\s*낮|평점\s*낮/.test(text)) {
      slots.cleanupGoal = slots.cleanupGoal || 'low_rating'
      slots.lowRating = true
    }
    if (/복사\s*안|미복사/.test(text)) {
      slots.cleanupGoal = slots.cleanupGoal || 'not_copied'
      slots.onlyNotCopied = true
    }
  }

  if (workflowId === 'search_videos') {
    if (/별점\s*높|고평점/.test(text)) {
      slots.searchCriterion = 'high_rating'
      slots.sortBy = 'rating'
      slots.minRating = 4
    }
    if (/미복사|복사\s*안/.test(text)) {
      slots.searchCriterion = slots.searchCriterion || 'not_copied'
      slots.onlyNotCopied = true
    }
    if (/최근/.test(text)) {
      slots.searchCriterion = slots.searchCriterion || 'recent'
      slots.sortBy = 'recent'
    }
  }

  if (workflowId === 'search_actors') {
    if (/부족|누락|없는|비어/.test(text)) {
      slots.searchCriterion = 'metadata_missing'
      slots.metadataMissing = true
    }
    if (/별점\s*높|고평점/.test(text)) {
      slots.searchCriterion = slots.searchCriterion || 'high_rating'
      slots.minRating = 4
    }
  }

  if (workflowId === 'get_drive_stats' && !slots.scope) {
    slots.scope = drive ? 'specific_drive' : 'all'
  }

  if ((workflowId === 'find_videos_without_subtitles' || workflowId === 'get_unmapped_subtitle_summary') && !slots.scope) {
    slots.scope = scope || 'all'
  }

  return slots
}

function buildAmbiguousClarification() {
  return {
    message: '요청을 정확히 처리하려면 작업 종류를 먼저 선택해 주세요.',
    question: '어떤 작업을 원하시나요?',
    options: [
      {
        id: 'consult_cleanup',
        label: '저장 공간 정리 후보',
        type: 'select_workflow',
        payload: { type: 'select_workflow', workflowId: 'cleanup_storage' },
      },
      {
        id: 'consult_drive',
        label: '드라이브 현황',
        type: 'select_workflow',
        payload: { type: 'select_workflow', workflowId: 'get_drive_stats' },
      },
      {
        id: 'consult_subtitles',
        label: '자막 상태',
        type: 'select_workflow',
        payload: { type: 'select_workflow', workflowId: 'find_videos_without_subtitles' },
      },
      {
        id: 'consult_videos',
        label: '영상 목록 정리',
        type: 'select_workflow',
        payload: { type: 'select_workflow', workflowId: 'search_videos' },
      },
    ],
  }
}

function planConsultationTurn({ message, context = {}, workflowState = {} }) {
  const text = normalizeText(message)
  const preferredWorkflow = workflowState.workflowId || null

  const picked = preferredWorkflow
    ? { workflowId: preferredWorkflow, confidence: 0.9 }
    : chooseWorkflow(text)

  if (!picked.workflowId) {
    return {
      workflowId: null,
      confidence: picked.confidence,
      extractedSlots: {},
      missingSlots: [],
      needsClarification: true,
      shouldExecuteImmediately: false,
      response: buildAmbiguousClarification(),
      proposedAction: null,
      requiresConfirmation: false,
    }
  }

  const workflow = getWorkflow(picked.workflowId)
  if (!workflow) {
    return {
      workflowId: null,
      confidence: 0.2,
      extractedSlots: {},
      missingSlots: [],
      needsClarification: true,
      shouldExecuteImmediately: false,
      response: buildAmbiguousClarification(),
      proposedAction: null,
      requiresConfirmation: false,
    }
  }

  const extractedSlots = {
    ...(workflowState.collectedSlots || {}),
    ...extractSlots(picked.workflowId, text, context),
  }

  const missingSlots = computeMissingSlots(picked.workflowId, extractedSlots)
  if (missingSlots.length > 0) {
    const nextQuestion = getNextMissingSlotQuestion(picked.workflowId, extractedSlots, context)
    return {
      workflowId: picked.workflowId,
      confidence: picked.confidence,
      extractedSlots,
      missingSlots,
      needsClarification: true,
      shouldExecuteImmediately: false,
      response: {
        message: `${workflow.title} 작업으로 이해했습니다.`,
        question: nextQuestion?.question || `${missingSlots[0]} 값을 선택해 주세요.`,
        options: (nextQuestion?.options || []).map((option) => ({
          id: `${picked.workflowId}-${nextQuestion.slot}-${option.value}`,
          label: option.label,
          type: 'set_workflow_slot',
          payload: {
            type: 'set_workflow_slot',
            workflowId: picked.workflowId,
            slot: nextQuestion.slot,
            value: option.value,
          },
        })),
      },
      proposedAction: null,
      requiresConfirmation: false,
    }
  }

  let proposedAction = null
  try {
    proposedAction = toToolAction(picked.workflowId, extractedSlots, context)
  } catch (error) {
    const scopeSlot = workflow.slots?.scope || null
    const scopeOptions = typeof scopeSlot?.resolveOptions === 'function'
      ? scopeSlot.resolveOptions(context)
      : Array.isArray(scopeSlot?.options)
        ? scopeSlot.options
        : []

    return {
      workflowId: picked.workflowId,
      confidence: picked.confidence,
      extractedSlots,
      missingSlots: [],
      needsClarification: true,
      shouldExecuteImmediately: false,
      response: {
        message: String(error?.message || `${workflow.title} 조건을 확인해 주세요.`),
        question: String(error?.message || `${workflow.title} 조건을 확인해 주세요.`),
        options: scopeOptions.map((option) => ({
          id: `${picked.workflowId}-scope-${option.value}`,
          label: option.label,
          description: option.disabledReason || option.hint || undefined,
          disabled: Boolean(option.disabled),
          type: 'set_workflow_slot',
          payload: {
            type: 'set_workflow_slot',
            workflowId: picked.workflowId,
            slot: 'scope',
            value: option.value,
          },
        })),
      },
      proposedAction: null,
      requiresConfirmation: false,
    }
  }

  return {
    workflowId: picked.workflowId,
    confidence: picked.confidence,
    extractedSlots,
    missingSlots: [],
    needsClarification: false,
    shouldExecuteImmediately: false,
    response: {
      message: `${workflow.title} 조건이 모두 확인되었습니다.`,
      question: '실행 계획을 확인해 주세요.',
      options: [],
    },
    proposedAction,
    requiresConfirmation: true,
  }
}

module.exports = {
  planConsultationTurn,
  chooseWorkflow,
  extractSlots,
}