'use strict'

const { planIntent, buildFallbackPlan } = require('./intentPlanner.cjs')
const { sanitizeToolArguments, isRegisteredTool } = require('./toolRegistry.cjs')
const { executeChatPlan } = require('./toolExecutor.cjs')
const { presentChatResponse } = require('./responsePresenter.cjs')

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

function buildPlanFromAction(action, context, state) {
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

function buildConfirmationResponse(plan) {
  return {
    success: true,
    resultType: 'clarification',
    message: '이 작업은 확인이 필요합니다. 실제 쓰기 작업은 실행하지 않습니다.',
    clarification: {
      question: '어떻게 진행할까요?',
      options: [
        {
          id: 'preview_only',
          label: '계획만 확인하기',
          payload: {
            toolName: plan.toolName,
            arguments: plan.arguments,
          },
        },
      ],
    },
    suggestedActions: [
      {
        id: 'preview_only',
        type: 'refine_query',
        label: '계획만 확인하기',
        payload: {
          toolName: plan.toolName,
          arguments: plan.arguments,
        },
      },
    ],
  }
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

  let plan = null
  if (action) {
    plan = buildPlanFromAction(action, context, state)
  } else {
    plan = await planIntent(message, context, state)
  }

  if (!plan || plan.success === false) {
    const fallback = buildFallbackPlan(message, context, state)
    if (fallback && fallback.success !== false) {
      plan = fallback
    } else {
      return plan || fallback || { success: false, errorCode: 'UNKNOWN_TOOL', error: '의도를 해석하지 못했습니다.' }
    }
  }

  if (plan.needsClarification) {
    return presentChatResponse(plan, { success: true, resultType: 'clarification', clarification: plan.clarification, items: [], lastResultIds: [] }, context)
  }

  if (plan.requiresConfirmation && plan.writeIntent) {
    return buildConfirmationResponse(plan)
  }

  const execution = await executeChatPlan(db, plan, context)
  if (!execution || execution.success === false) {
    if (!action && typeof options.fallbackRouter === 'function') {
      const fallbackTool = options.fallbackRouter(message, context)
      if (fallbackTool && fallbackTool.name) {
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
          return presentChatResponse(fallbackPlan, fallbackExecution, context)
        }
        return fallbackExecution
      }
    }

    return execution
  }

  return presentChatResponse(plan, execution, context)
}

module.exports = {
  handleChatRequest,
  buildPlanFromAction,
}