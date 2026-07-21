'use strict'

const { buildFallbackPlan } = require('./intentPlanner.cjs')
const { sanitizeToolArguments, isRegisteredTool, validateSubtitleSearchScope } = require('./toolRegistry.cjs')
const { executeChatPlan } = require('./toolExecutor.cjs')
const { presentChatResponse } = require('./responsePresenter.cjs')
const {
  resetWorkflowState,
  normalizeWorkflowState,
  mergeWorkflowState,
  computeMissingSlots,
  getNextMissingSlotQuestion,
  buildModeSelectionResponse,
  buildQuickHomeResponse,
  buildWorkflowSlotQuestionResponse,
  buildActionPreviewResponse,
} = require('./workflowSession.cjs')
const { listWorkflowsByCategory, getWorkflow, toToolAction } = require('./workflowRegistry.cjs')
const { planConsultationTurn } = require('./consultationPlanner.cjs')

function sanitizeAction(action) {
  if (!action || typeof action !== 'object') return null
  const payload = action.payload && typeof action.payload === 'object' ? action.payload : {}
  return {
    id: String(action.id || action.type || 'action'),
    type: String(action.type || 'refine_query'),
    label: String(action.label || action.type || '실행'),
    payload,
    requiresConfirmation: Boolean(action.requiresConfirmation),
  }
}

function buildPlanFromLegacyAction(action, context, state) {
  const sanitized = sanitizeAction(action)
  if (!sanitized) return null

  const currentToolName = String(sanitized.payload.toolName || state?.lastToolCall?.name || '')
  const baseArguments = state?.lastToolCall?.arguments && typeof state.lastToolCall.arguments === 'object'
    ? state.lastToolCall.arguments
    : {}
  const overrideArguments = sanitized.payload.arguments && typeof sanitized.payload.arguments === 'object'
    ? sanitized.payload.arguments
    : sanitized.payload

  if (sanitized.type === 'preview_action') {
    return {
      success: true,
      intent: currentToolName || 'preview_action',
      confidence: 1,
      toolName: currentToolName || null,
      arguments: currentToolName ? sanitizeToolArguments(currentToolName, { ...baseArguments, ...overrideArguments }, context, state) : {},
      usePreviousResults: true,
      needsClarification: false,
      clarification: null,
      requiresConfirmation: true,
      writeIntent: true,
      pendingAction: sanitized,
    }
  }

  if (!currentToolName || !isRegisteredTool(currentToolName)) {
    return {
      success: true,
      intent: 'unknown',
      confidence: 0.48,
      toolName: null,
      arguments: {},
      usePreviousResults: false,
      needsClarification: true,
      clarification: {
        question: '이 작업을 적용할 대상이 없습니다. 먼저 검색을 실행해 주세요.',
        options: [],
      },
      requiresConfirmation: false,
      writeIntent: false,
      pendingAction: null,
    }
  }

  const argumentsPayload = sanitizeToolArguments(currentToolName, { ...baseArguments, ...overrideArguments }, context, state)
  return {
    success: true,
    intent: currentToolName,
    confidence: 1,
    toolName: currentToolName,
    arguments: argumentsPayload,
    usePreviousResults: Array.isArray(argumentsPayload.baseResultIds) && argumentsPayload.baseResultIds.length > 0,
    needsClarification: false,
    clarification: null,
    requiresConfirmation: false,
    writeIntent: false,
    pendingAction: sanitized,
  }
}

function buildConfirmationResponse(plan, workflowState) {
  return {
    success: true,
    resultType: 'workflow-action-preview',
    message: '실행 전 계획을 확인해 주세요.',
    summary: {
      title: '실행 계획',
      description: '조건을 확인한 뒤 조회를 실행합니다.',
      metrics: [
        { key: 'tool', label: '도구', value: plan.toolName || '-' },
      ],
    },
    clarification: {
      question: '어떻게 진행할까요?',
      options: [
        {
          id: 'edit_plan',
          label: '조건 수정',
          type: 'edit_workflow',
          payload: { type: 'edit_workflow', workflowId: workflowState.workflowId },
        },
        {
          id: 'confirm_plan',
          label: '조회하기',
          type: 'confirm_workflow_execution',
          payload: { type: 'confirm_workflow_execution', workflowId: workflowState.workflowId },
        },
      ],
    },
    state: workflowState,
  }
}

function resolveWorkflowStateFromRequest(state = {}) {
  const rawWorkflowState = {
    entryMode: state.entryMode,
    phase: state.phase,
    workflowId: state.workflowId,
    collectedSlots: state.collectedSlots,
    missingSlots: state.missingSlots,
    proposedAction: state.proposedAction,
    awaitingConfirmation: state.awaitingConfirmation,
    lastQuestion: state.lastQuestion,
  }
  return normalizeWorkflowState(rawWorkflowState)
}

function getModeSwitchWarning(workflowState) {
  const active = ['collecting_slots', 'confirming', 'executing'].includes(workflowState.phase)
  if (!active || !workflowState.workflowId) return null
  return {
    success: true,
    resultType: 'clarification',
    message: '진행 중인 작업이 있습니다. 현재 작업을 초기화하고 모드를 전환할까요?',
    clarification: {
      question: '진행 중인 작업이 있습니다. 현재 작업을 초기화하고 모드를 전환할까요?',
      options: [
        {
          id: 'cancel_switch',
          label: '취소',
          type: 'cancel',
          payload: { type: 'cancel_mode_switch' },
        },
        {
          id: 'confirm_switch',
          label: '전환',
          type: 'confirm_mode_switch',
          payload: { type: 'confirm_mode_switch' },
        },
      ],
    },
    state: workflowState,
  }
}

function buildWorkflowPlan(toolName, argumentsPayload, workflowState) {
  return {
    success: true,
    intent: workflowState.workflowId || toolName,
    confidence: 1,
    toolName,
    arguments: argumentsPayload,
    usePreviousResults: Array.isArray(argumentsPayload?.baseResultIds) && argumentsPayload.baseResultIds.length > 0,
    needsClarification: false,
    clarification: null,
    requiresConfirmation: false,
    writeIntent: false,
  }
}

function appendWorkflowState(response, workflowState) {
  if (!response || typeof response !== 'object') return response
  return {
    ...response,
    state: {
      ...(response.state || {}),
      ...workflowState,
      lastToolCall: response.state?.lastToolCall || null,
      lastResultIds: response.state?.lastResultIds || response.lastResultIds || [],
      activeFilters: response.state?.activeFilters || response.intent?.arguments || {},
    },
  }
}

function withExecutionState(workflowState, patch = {}) {
  return mergeWorkflowState(workflowState, patch)
}

function debugLog(label, payload) {
  if (process.env.NODE_ENV === 'production') return
  console.debug(label, payload)
}

async function executeWorkflowAction(db, workflowState, context = {}) {
  const proposedAction = workflowState.proposedAction || null
  if (!proposedAction?.toolName) {
    return {
      success: false,
      errorCode: 'VALIDATION_ERROR',
      error: '실행할 계획이 없습니다. 조건을 먼저 확인해 주세요.',
    }
  }

  const plan = buildWorkflowPlan(
    proposedAction.toolName,
    sanitizeToolArguments(proposedAction.toolName, proposedAction.arguments || {}, context, {}),
    workflowState,
  )

  const validation = validateSubtitleSearchScope(plan.toolName, plan.arguments)
  if (validation.success === false) {
    return validation
  }

  debugLog('[workflow-arguments]', {
    workflowId: workflowState.workflowId,
    toolName: plan.toolName,
    arguments: plan.arguments,
  })

  const execution = await executeChatPlan(db, plan, context)
  if (!execution || execution.success === false) return execution

  const presented = presentChatResponse(plan, execution, context)
  const completedState = withExecutionState(workflowState, {
    phase: 'completed',
    awaitingConfirmation: false,
    proposedAction: null,
  })

  return appendWorkflowState(presented, {
    ...completedState,
    lastToolCall: { name: plan.toolName, arguments: plan.arguments },
    lastResultIds: execution.lastResultIds || [],
    activeFilters: plan.arguments || {},
  })
}

function parseStructuredAction(rawAction, workflowState) {
  const action = sanitizeAction(rawAction)
  if (!action) return null

  const payload = action.payload && typeof action.payload === 'object' ? action.payload : {}
  const actionType = payload.type || action.type || 'refine_query'

  if (['select_entry_mode', 'select_workflow', 'select_workflow_category', 'set_workflow_slot', 'confirm_workflow_execution', 'edit_workflow', 'switch_mode', 'confirm_mode_switch', 'cancel_mode_switch', 'start_new_workflow'].includes(actionType)) {
    return { ...action, actionType, payload }
  }

  return { ...action, actionType: 'legacy_refine', payload }
}

async function handleChatRequest(db, payload, options = {}) {
  const normalized = payload && typeof payload === 'object' ? payload : null
  if (!normalized) {
    return { success: false, errorCode: 'VALIDATION_ERROR', error: '잘못된 요청입니다.' }
  }

  const message = typeof normalized.message === 'string' ? normalized.message.trim() : ''
  const context = normalized.context && typeof normalized.context === 'object' ? normalized.context : {}
  const state = normalized.state && typeof normalized.state === 'object' ? normalized.state : {}
  const action = normalized.action && typeof normalized.action === 'object' ? normalized.action : null

  let workflowState = resolveWorkflowStateFromRequest(state)
  const parsedAction = parseStructuredAction(action, workflowState)

  debugLog('[ai-chat-context]', context)

  if (!workflowState.entryMode && !parsedAction && !message) {
    const next = resetWorkflowState(null)
    return buildModeSelectionResponse(next)
  }

  if (!workflowState.entryMode && !parsedAction && message) {
    const next = resetWorkflowState('consult')
    workflowState = next
  }

  if (parsedAction?.actionType === 'switch_mode') {
    const warning = getModeSwitchWarning(workflowState)
    if (warning) {
      return warning
    }
    const targetMode = parsedAction.payload.mode === 'quick' ? 'quick' : 'consult'
    const next = resetWorkflowState(targetMode)
    if (targetMode === 'quick') {
      return buildQuickHomeResponse(next)
    }
    return appendWorkflowState({
      success: true,
      resultType: 'clarification',
      message: 'AI 상담 모드로 전환했습니다. 요청을 말씀해 주세요.',
      clarification: {
        question: '무엇을 도와드릴까요?',
        options: [],
      },
    }, next)
  }

  if (parsedAction?.actionType === 'confirm_mode_switch') {
    const targetMode = parsedAction.payload.mode === 'quick' ? 'quick' : 'consult'
    const next = resetWorkflowState(targetMode)
    if (targetMode === 'quick') return buildQuickHomeResponse(next)
    return appendWorkflowState({
      success: true,
      resultType: 'clarification',
      message: 'AI 상담 모드로 전환했습니다. 요청을 말씀해 주세요.',
      clarification: { question: '무엇을 도와드릴까요?', options: [] },
    }, next)
  }

  if (parsedAction?.actionType === 'select_entry_mode') {
    const mode = parsedAction.payload.mode === 'quick' ? 'quick' : 'consult'
    const next = resetWorkflowState(mode)
    if (mode === 'quick') return buildQuickHomeResponse(next)
    return appendWorkflowState({
      success: true,
      resultType: 'clarification',
      message: 'AI 상담 모드로 시작합니다. 요청을 말씀해 주세요.',
      clarification: { question: '무엇을 도와드릴까요?', options: [] },
    }, next)
  }

  if (!workflowState.entryMode) {
    const next = resetWorkflowState(null)
    return buildModeSelectionResponse(next)
  }

  if (parsedAction?.actionType === 'start_new_workflow') {
    const next = mergeWorkflowState(workflowState, {
      phase: workflowState.entryMode === 'quick' ? 'quick_home' : 'understanding',
      workflowId: null,
      collectedSlots: {},
      missingSlots: [],
      proposedAction: null,
      awaitingConfirmation: false,
      lastQuestion: null,
    })
    if (workflowState.entryMode === 'quick') return buildQuickHomeResponse(next)
    return appendWorkflowState({
      success: true,
      resultType: 'clarification',
      message: '새 작업을 시작합니다. 요청을 말씀해 주세요.',
      clarification: { question: '무엇을 도와드릴까요?', options: [] },
    }, next)
  }

  if (workflowState.entryMode === 'quick') {
    if (!parsedAction && message) {
      return appendWorkflowState({
        success: true,
        resultType: 'clarification',
        message: '빠른 작업 모드에서는 버튼 선택으로 진행합니다.',
        clarification: {
          question: '아래에서 작업을 선택해 주세요.',
          options: listWorkflowsByCategory('subtitles').map((workflow) => ({
            id: `quick-${workflow.id}`,
            label: workflow.title,
            type: 'select_workflow',
            payload: { type: 'select_workflow', workflowId: workflow.id },
          })),
        },
      }, workflowState)
    }

    if (parsedAction?.actionType === 'select_workflow_category') {
      const workflows = listWorkflowsByCategory(parsedAction.payload.categoryId)
      return appendWorkflowState({
        success: true,
        resultType: 'clarification',
        message: '어떤 작업을 진행할까요?',
        clarification: {
          question: '세부 작업을 선택해 주세요.',
          options: workflows.map((workflow) => ({
            id: `wf-${workflow.id}`,
            label: workflow.title,
            type: 'select_workflow',
            payload: { type: 'select_workflow', workflowId: workflow.id },
          })),
        },
      }, workflowState)
    }

    if (parsedAction?.actionType === 'select_workflow') {
      const workflow = getWorkflow(parsedAction.payload.workflowId)
      if (!workflow) {
        return { success: false, errorCode: 'VALIDATION_ERROR', error: '유효하지 않은 작업입니다.' }
      }
      const next = mergeWorkflowState(workflowState, {
        phase: 'collecting_slots',
        workflowId: workflow.id,
        collectedSlots: {},
        missingSlots: workflow.requiredSlots || [],
        proposedAction: null,
        awaitingConfirmation: false,
      })
      return buildWorkflowSlotQuestionResponse(next, workflow.id, next.collectedSlots, context)
    }

    if (parsedAction?.actionType === 'set_workflow_slot') {
      const workflowId = parsedAction.payload.workflowId || workflowState.workflowId
      const workflow = getWorkflow(workflowId)
      if (!workflow) return { success: false, errorCode: 'VALIDATION_ERROR', error: '유효하지 않은 작업입니다.' }

      const nextSlots = {
        ...(workflowState.collectedSlots || {}),
        [parsedAction.payload.slot]: parsedAction.payload.value,
      }
      const missing = computeMissingSlots(workflowId, nextSlots)
      debugLog('[workflow-slots]', { workflowId, collectedSlots: nextSlots, missingSlots: missing })
      const next = mergeWorkflowState(workflowState, {
        phase: missing.length > 0 ? 'collecting_slots' : 'confirming',
        workflowId,
        collectedSlots: nextSlots,
        missingSlots: missing,
      })

      if (missing.length > 0) {
        const questionResponse = buildWorkflowSlotQuestionResponse(next, workflowId, nextSlots, context)
        return questionResponse
      }

      const preview = buildActionPreviewResponse(next, workflowId, nextSlots, context)
      return preview
    }

    if (parsedAction?.actionType === 'edit_workflow') {
      const workflowId = parsedAction.payload.workflowId || workflowState.workflowId
      const next = mergeWorkflowState(workflowState, {
        phase: 'collecting_slots',
        workflowId,
        proposedAction: null,
        awaitingConfirmation: false,
      })
      return buildWorkflowSlotQuestionResponse(next, workflowId, next.collectedSlots, context)
    }

    if (parsedAction?.actionType === 'confirm_workflow_execution') {
      const executing = mergeWorkflowState(workflowState, { phase: 'executing', awaitingConfirmation: false })
      const execution = await executeWorkflowAction(db, executing, context)
      return execution
    }

    if (parsedAction?.actionType === 'legacy_refine') {
      const legacyPlan = buildPlanFromLegacyAction(parsedAction, context, state)
      if (legacyPlan?.success === false) return legacyPlan
      if (legacyPlan?.needsClarification) {
        return appendWorkflowState(presentChatResponse(legacyPlan, {
          success: true,
          resultType: 'clarification',
          clarification: legacyPlan.clarification,
          items: [],
          lastResultIds: [],
        }, context), workflowState)
      }
      if (!legacyPlan?.requiresConfirmation) {
        const execution = await executeChatPlan(db, legacyPlan, context)
        if (!execution || execution.success === false) return execution
        const presented = presentChatResponse(legacyPlan, execution, context)
        return appendWorkflowState(presented, {
          ...workflowState,
          phase: 'completed',
          awaitingConfirmation: false,
          proposedAction: null,
          lastToolCall: { name: legacyPlan.toolName, arguments: legacyPlan.arguments || {} },
          lastResultIds: execution.lastResultIds || [],
          activeFilters: legacyPlan.arguments || {},
        })
      }
      return buildConfirmationResponse(legacyPlan, workflowState)
    }

    return buildQuickHomeResponse(workflowState)
  }

  if (workflowState.entryMode === 'consult') {
    if (parsedAction?.actionType === 'select_workflow') {
      const workflowId = parsedAction.payload.workflowId
      const workflow = getWorkflow(workflowId)
      if (!workflow) return { success: false, errorCode: 'VALIDATION_ERROR', error: '유효하지 않은 작업입니다.' }
      const next = mergeWorkflowState(workflowState, {
        phase: 'collecting_slots',
        workflowId,
        collectedSlots: {},
        missingSlots: workflow.requiredSlots || [],
        proposedAction: null,
        awaitingConfirmation: false,
      })
      return buildWorkflowSlotQuestionResponse(next, workflowId, next.collectedSlots, context)
    }

    if (parsedAction?.actionType === 'set_workflow_slot') {
      const workflowId = parsedAction.payload.workflowId || workflowState.workflowId
      const workflow = getWorkflow(workflowId)
      if (!workflow) return { success: false, errorCode: 'VALIDATION_ERROR', error: '유효하지 않은 작업입니다.' }

      const nextSlots = {
        ...(workflowState.collectedSlots || {}),
        [parsedAction.payload.slot]: parsedAction.payload.value,
      }
      const missing = computeMissingSlots(workflowId, nextSlots)
      debugLog('[workflow-slots]', { workflowId, collectedSlots: nextSlots, missingSlots: missing })
      const next = mergeWorkflowState(workflowState, {
        workflowId,
        collectedSlots: nextSlots,
        missingSlots: missing,
        phase: missing.length > 0 ? 'collecting_slots' : 'confirming',
      })

      if (missing.length > 0) {
        return buildWorkflowSlotQuestionResponse(next, workflowId, nextSlots, context)
      }

      const preview = buildActionPreviewResponse(next, workflowId, nextSlots, context)
      return preview
    }

    if (parsedAction?.actionType === 'edit_workflow') {
      const workflowId = parsedAction.payload.workflowId || workflowState.workflowId
      const next = mergeWorkflowState(workflowState, {
        phase: 'collecting_slots',
        workflowId,
        proposedAction: null,
      })
      return buildWorkflowSlotQuestionResponse(next, workflowId, next.collectedSlots, context)
    }

    if (parsedAction?.actionType === 'confirm_workflow_execution') {
      const executing = mergeWorkflowState(workflowState, { phase: 'executing', awaitingConfirmation: false })
      return executeWorkflowAction(db, executing, context)
    }

    if (parsedAction?.actionType === 'legacy_refine') {
      const legacyPlan = buildPlanFromLegacyAction(parsedAction, context, state)
      if (legacyPlan?.success === false) return legacyPlan
      if (legacyPlan?.needsClarification) {
        return appendWorkflowState(presentChatResponse(legacyPlan, {
          success: true,
          resultType: 'clarification',
          clarification: legacyPlan.clarification,
          items: [],
          lastResultIds: [],
        }, context), workflowState)
      }
      if (!legacyPlan?.requiresConfirmation) {
        const execution = await executeChatPlan(db, legacyPlan, context)
        if (!execution || execution.success === false) return execution
        const presented = presentChatResponse(legacyPlan, execution, context)
        return appendWorkflowState(presented, {
          ...workflowState,
          phase: 'completed',
          awaitingConfirmation: false,
          proposedAction: null,
          lastToolCall: { name: legacyPlan.toolName, arguments: legacyPlan.arguments || {} },
          lastResultIds: execution.lastResultIds || [],
          activeFilters: legacyPlan.arguments || {},
        })
      }
      return buildConfirmationResponse(legacyPlan, workflowState)
    }

    if (message) {
      const consultation = planConsultationTurn({
        message,
        context,
        workflowState,
      })

      if (!consultation.workflowId) {
        const next = mergeWorkflowState(workflowState, {
          phase: 'understanding',
          workflowId: null,
          collectedSlots: {},
          missingSlots: [],
          proposedAction: null,
          awaitingConfirmation: false,
          lastQuestion: {
            question: consultation.response.question,
            options: consultation.response.options,
          },
        })
        return appendWorkflowState({
          success: true,
          resultType: 'clarification',
          message: consultation.response.message,
          clarification: {
            question: consultation.response.question,
            options: consultation.response.options,
          },
          consultation: {
            workflowId: null,
            extractedSlots: {},
            missingSlots: [],
            shouldExecuteImmediately: false,
          },
        }, next)
      }

      const nextState = mergeWorkflowState(workflowState, {
        workflowId: consultation.workflowId,
        collectedSlots: consultation.extractedSlots,
        missingSlots: consultation.missingSlots,
        phase: consultation.missingSlots.length > 0 ? 'collecting_slots' : 'confirming',
        proposedAction: consultation.proposedAction,
        awaitingConfirmation: Boolean(consultation.requiresConfirmation),
        lastQuestion: {
          question: consultation.response.question,
          options: consultation.response.options,
        },
      })

      if (consultation.needsClarification) {
        return appendWorkflowState({
          success: true,
          resultType: 'clarification',
          message: consultation.response.message,
          clarification: {
            question: consultation.response.question,
            options: consultation.response.options,
          },
          consultation: {
            workflowId: consultation.workflowId,
            extractedSlots: consultation.extractedSlots,
            missingSlots: consultation.missingSlots,
            shouldExecuteImmediately: false,
          },
        }, nextState)
      }

      const preview = buildActionPreviewResponse(nextState, consultation.workflowId, consultation.extractedSlots, context, {
        message: consultation.response.message,
      })
      return appendWorkflowState({
        ...preview,
        consultation: {
          workflowId: consultation.workflowId,
          extractedSlots: consultation.extractedSlots,
          missingSlots: consultation.missingSlots,
          shouldExecuteImmediately: false,
        },
      }, nextState)
    }

    return appendWorkflowState({
      success: true,
      resultType: 'clarification',
      message: '요청을 입력하면 필요한 조건부터 함께 정리합니다.',
      clarification: {
        question: '무엇을 도와드릴까요?',
        options: [],
      },
    }, workflowState)
  }

  if (typeof options.fallbackRouter === 'function' && message) {
    const fallbackTool = options.fallbackRouter(message, context)
    if (fallbackTool?.name) {
      const fallbackPlan = {
        success: true,
        intent: fallbackTool.name,
        confidence: 0.5,
        toolName: fallbackTool.name,
        arguments: sanitizeToolArguments(fallbackTool.name, fallbackTool.arguments || {}, context, state),
        usePreviousResults: false,
        needsClarification: false,
        clarification: null,
        requiresConfirmation: false,
        writeIntent: false,
      }
      const fallbackExecution = await executeChatPlan(db, fallbackPlan, context)
      if (fallbackExecution && fallbackExecution.success !== false) {
        const presented = presentChatResponse(fallbackPlan, fallbackExecution, context)
        return appendWorkflowState(presented, workflowState)
      }
      return fallbackExecution
    }
  }

  const fallback = buildFallbackPlan(message, context, state)
  if (fallback && fallback.success !== false) {
    if (fallback.needsClarification) {
      return appendWorkflowState(presentChatResponse(fallback, {
        success: true,
        resultType: 'clarification',
        clarification: fallback.clarification,
        items: [],
        lastResultIds: [],
      }, context), workflowState)
    }
    return buildConfirmationResponse(fallback, workflowState)
  }

  return { success: false, errorCode: 'UNKNOWN_TOOL', error: '의도를 해석하지 못했습니다.' }
}

module.exports = {
  handleChatRequest,
  buildPlanFromAction: buildPlanFromLegacyAction,
}