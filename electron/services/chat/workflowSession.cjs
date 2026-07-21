'use strict'

const { getWorkflow, listWorkflowCategories, toToolAction } = require('./workflowRegistry.cjs')

const DEFAULT_WORKFLOW_STATE = Object.freeze({
  entryMode: null,
  phase: 'mode_selection',
  workflowId: null,
  collectedSlots: {},
  missingSlots: [],
  proposedAction: null,
  awaitingConfirmation: false,
  lastQuestion: null,
})

function normalizeWorkflowState(state = {}) {
  return {
    entryMode: typeof state.entryMode === 'string' ? state.entryMode : null,
    phase: typeof state.phase === 'string' ? state.phase : 'mode_selection',
    workflowId: typeof state.workflowId === 'string' ? state.workflowId : null,
    collectedSlots: state.collectedSlots && typeof state.collectedSlots === 'object' ? { ...state.collectedSlots } : {},
    missingSlots: Array.isArray(state.missingSlots) ? state.missingSlots.slice(0, 20) : [],
    proposedAction: state.proposedAction && typeof state.proposedAction === 'object' ? { ...state.proposedAction } : null,
    awaitingConfirmation: Boolean(state.awaitingConfirmation),
    lastQuestion: state.lastQuestion && typeof state.lastQuestion === 'object' ? { ...state.lastQuestion } : null,
  }
}

function resetWorkflowState(mode = null) {
  return {
    ...DEFAULT_WORKFLOW_STATE,
    entryMode: mode,
    phase: mode ? 'understanding' : 'mode_selection',
  }
}

function mergeWorkflowState(current = {}, patch = {}) {
  const normalized = normalizeWorkflowState(current)
  const next = {
    ...normalized,
    ...patch,
  }

  if (patch.collectedSlots) next.collectedSlots = { ...normalized.collectedSlots, ...patch.collectedSlots }
  if (patch.missingSlots) next.missingSlots = patch.missingSlots.slice(0, 20)
  return normalizeWorkflowState(next)
}

function computeMissingSlots(workflowId, collectedSlots = {}) {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return []
  return (workflow.requiredSlots || []).filter((slot) => {
    const value = collectedSlots[slot]
    return value === null || typeof value === 'undefined' || value === ''
  })
}

function getNextMissingSlotQuestion(workflowId, collectedSlots = {}) {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return null
  const missing = computeMissingSlots(workflowId, collectedSlots)
  if (missing.length === 0) return null
  const slotName = missing[0]
  const slotConfig = workflow.slots?.[slotName] || {}
  return {
    slot: slotName,
    question: slotConfig.question || `${slotName} 값을 선택해 주세요.`,
    options: Array.isArray(slotConfig.options) ? slotConfig.options : [],
  }
}

function buildModeSelectionResponse(state) {
  return {
    success: true,
    resultType: 'workflow-mode-selection',
    message: '원하는 방식으로 시작하세요.',
    workflow: {
      phase: 'mode_selection',
      entryMode: null,
    },
    clarification: {
      question: '원하는 방식으로 시작하세요.',
      options: [
        {
          id: 'mode_quick',
          label: '빠른 작업',
          description: '정해진 선택지를 따라 정확하게 실행합니다.',
          type: 'select_entry_mode',
          payload: { type: 'select_entry_mode', mode: 'quick' },
        },
        {
          id: 'mode_consult',
          label: 'AI에게 물어보기',
          description: '상담하듯 요청하면 필요한 조건을 함께 정리합니다.',
          type: 'select_entry_mode',
          payload: { type: 'select_entry_mode', mode: 'consult' },
        },
      ],
    },
    state,
  }
}

function buildQuickHomeResponse(state) {
  const categories = listWorkflowCategories()
  return {
    success: true,
    resultType: 'workflow-quick-home',
    message: '무엇을 도와드릴까요?',
    workflow: {
      phase: state.phase,
      entryMode: 'quick',
      categories,
    },
    clarification: {
      question: '무엇을 도와드릴까요?',
      options: categories.map((category) => ({
        id: `quick-category-${category.id}`,
        label: category.title,
        type: 'select_workflow_category',
        payload: { type: 'select_workflow_category', categoryId: category.id },
      })),
    },
    state,
  }
}

function buildWorkflowSlotQuestionResponse(state, workflowId, collectedSlots = {}) {
  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    return {
      success: false,
      errorCode: 'VALIDATION_ERROR',
      error: '유효하지 않은 워크플로우입니다.',
    }
  }

  const nextQuestion = getNextMissingSlotQuestion(workflowId, collectedSlots)
  if (!nextQuestion) {
    return null
  }

  return {
    success: true,
    resultType: 'workflow-slot-question',
    message: nextQuestion.question,
    workflow: {
      workflowId,
      workflowTitle: workflow.title,
      phase: state.phase,
      collectedSlots,
      missingSlots: computeMissingSlots(workflowId, collectedSlots),
    },
    clarification: {
      question: nextQuestion.question,
      options: (nextQuestion.options || []).map((option) => ({
        id: `${workflowId}-${nextQuestion.slot}-${option.value}`,
        label: option.label,
        type: 'set_workflow_slot',
        payload: {
          type: 'set_workflow_slot',
          workflowId,
          slot: nextQuestion.slot,
          value: option.value,
        },
      })),
    },
    state,
  }
}

function buildActionPreviewResponse(state, workflowId, slots = {}, context = {}, options = {}) {
  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    return {
      success: false,
      errorCode: 'VALIDATION_ERROR',
      error: '유효하지 않은 워크플로우입니다.',
    }
  }

  const action = toToolAction(workflowId, slots, context)
  if (!action) {
    return {
      success: false,
      errorCode: 'VALIDATION_ERROR',
      error: '실행 계획을 생성하지 못했습니다.',
    }
  }

  const isCleanup = workflowId === 'cleanup_storage'
  const confirmLabel = isCleanup ? '후보 조회' : '조회하기'

  return {
    success: true,
    resultType: 'workflow-action-preview',
    message: options.message || '실행 계획을 확인해 주세요.',
    workflow: {
      workflowId,
      workflowTitle: workflow.title,
      phase: state.phase,
      collectedSlots: slots,
      missingSlots: [],
      proposedAction: action,
      awaitingConfirmation: true,
    },
    summary: {
      title: '실행할 작업',
      description: action.summary || workflow.description,
      metrics: [
        { key: 'workflow', label: '작업', value: workflow.title },
        { key: 'scope', label: '범위', value: slots.scope || '기본값' },
        { key: 'tool', label: '도구', value: action.toolName },
      ],
    },
    clarification: {
      question: isCleanup
        ? '다음 조건으로 정리 후보를 조회합니다. 이 작업은 파일을 삭제하지 않습니다.'
        : '다음 조건으로 조회합니다.',
      options: [
        {
          id: `edit-${workflowId}`,
          label: '조건 수정',
          type: 'edit_workflow',
          payload: { type: 'edit_workflow', workflowId },
        },
        {
          id: `confirm-${workflowId}`,
          label: confirmLabel,
          type: 'confirm_workflow_execution',
          payload: { type: 'confirm_workflow_execution', workflowId },
        },
      ],
    },
    state,
  }
}

module.exports = {
  DEFAULT_WORKFLOW_STATE,
  normalizeWorkflowState,
  resetWorkflowState,
  mergeWorkflowState,
  computeMissingSlots,
  getNextMissingSlotQuestion,
  buildModeSelectionResponse,
  buildQuickHomeResponse,
  buildWorkflowSlotQuestionResponse,
  buildActionPreviewResponse,
}