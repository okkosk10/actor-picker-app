'use strict'

import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { clearAiChatState, loadAiChatState, saveAiChatState } from '../services/aiChatStorage.js'

const AiChatContext = createContext(null)

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function nowIso() {
  return new Date().toISOString()
}

function isDefaultTitle(title) {
  const value = String(title || '').trim()
  return !value || value === '새 채팅' || value === '기본 채팅' || value === 'New chat'
}

function buildSessionTitle(message) {
  const cleaned = String(message || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/["'“”‘’`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return '새 채팅'

  const withoutSuffix = cleaned
    .replace(/[?!.]+$/g, '')
    .replace(/^(여기서|이걸|이것|저것|그거)\s*/g, '')

  if (withoutSuffix.length <= 18) return withoutSuffix
  return `${withoutSuffix.slice(0, 18)}…`
}

function sanitizeContext(rawContext) {
  const context = rawContext && typeof rawContext === 'object' ? rawContext : {}
  const selectedVideoIds = Array.isArray(context.selectedVideoIds)
    ? context.selectedVideoIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : []

  const activeFilters = context.activeFilters && typeof context.activeFilters === 'object'
    ? JSON.parse(JSON.stringify(context.activeFilters))
    : {}

  return {
    currentPage: typeof context.currentPage === 'string' ? context.currentPage : 'library',
    currentFolder: typeof context.currentFolder === 'string' && context.currentFolder.trim()
      ? context.currentFolder.trim()
      : null,
    selectedVideoIds: selectedVideoIds.slice(0, 100),
    activeFilters,
  }
}

function compactVideoResultItem(item) {
  const video = item?.video || {}
  return {
    id: Number(video.id) || 0,
    file_name: String(video.file_name || ''),
    code: String(video.code || ''),
    actor_name: String(video.actor_name || ''),
    rating: Number(video.rating) || 0,
    grade: String(video.grade || ''),
    is_new: Number(video.is_new) || 0,
    recommended: Number(video.recommended) || 0,
    play_count: Number(video.play_count) || 0,
    copy_count: Number(video.copy_count) || 0,
    themeScore: Number(video.themeScore) || 0,
    reason: String(item?.reason || ''),
    scoreComment: String(item?.scoreComment || ''),
    tags: String(video.tags || ''),
    actorsList: Array.isArray(video.actorsList)
      ? video.actorsList.slice(0, 4).map((actor) => ({
        name: String(actor?.name || ''),
        rating: Number(actor?.rating) || 0,
      }))
      : [],
  }
}

function compactActorResultItem(actor) {
  return {
    id: Number(actor?.id) || 0,
    name: String(actor?.name || ''),
    rating: Number(actor?.rating) || 0,
    agency: String(actor?.agency || ''),
    tags: String(actor?.tags || ''),
    memo: String(actor?.memo || ''),
    tier: String(actor?.tier || ''),
    videoCount: Number(actor?.videoCount) || 0,
    matchedVideos: Array.isArray(actor?.matchedVideos) ? actor.matchedVideos.slice(0, 5) : [],
  }
}

function inferErrorCode(errorMessage) {
  const message = String(errorMessage || '')
  if (/질문을 입력|빈 문자열|validation/i.test(message)) return 'VALIDATION_ERROR'
  if (/연결|network|connection|timeout|OpenAI/i.test(message)) return 'AI_CONNECTION_ERROR'
  if (/JSON|응답 형식|parse/i.test(message)) return 'AI_RESPONSE_PARSE_ERROR'
  if (/도구|tool/i.test(message)) return 'UNKNOWN_TOOL'
  if (/argument|인자|파라미터/i.test(message)) return 'TOOL_ARGUMENT_ERROR'
  if (/실행 실패|조회 실패|처리 실패/i.test(message)) return 'TOOL_EXECUTION_ERROR'
  if (/조건에 맞는 .* 없습니다|없습니다/i.test(message)) return 'EMPTY_RESULT'
  if (/승인|확인 필요/i.test(message)) return 'USER_CONFIRMATION_REQUIRED'
  if (/취소/i.test(message)) return 'REQUEST_CANCELLED'
  return 'UNKNOWN_TOOL'
}

function buildAssistantMessage(response) {
  const success = response?.success === true
  const base = {
    id: createId(),
    role: 'assistant',
    createdAt: nowIso(),
    content: '',
    status: success ? 'done' : 'error',
  }

  if (!success) {
    const errorMessage = String(response?.error || '알 수 없는 오류가 발생했습니다.')
    return {
      ...base,
      content: errorMessage,
      errorCode: response?.errorCode || inferErrorCode(errorMessage),
    }
  }

  const resultType = response?.resultType
    || (response?.deleteMode ? 'delete-candidate-list' : 'video-list')

  const message = {
    ...base,
    content: String(response?.summary || response?.reason || '처리가 완료되었습니다.'),
    resultType,
    toolCall: response?.toolCall || null,
    data: {
      summary: String(response?.summary || ''),
      reason: String(response?.reason || ''),
      intent: response?.intent || null,
      driveInfo: response?.driveInfo || null,
      totalCount: Number(response?.totalCount) || 0,
      folderCounts: Array.isArray(response?.folderCounts) ? response.folderCounts.slice(0, 20) : [],
      actorSummaries: Array.isArray(response?.actorSummaries) ? response.actorSummaries.slice(0, 8) : [],
      previewItems: [],
      previewActors: [],
      previewStats: [],
      currentQuery: String(response?.currentQuery || ''),
    },
    lastResultIds: Array.isArray(response?.lastResultIds) ? response.lastResultIds : [],
  }

  if (resultType === 'video-list' || resultType === 'delete-candidate-list') {
    const items = Array.isArray(response?.items) ? response.items : []
    message.data.previewItems = items.slice(0, 8).map(compactVideoResultItem)
    message.data.totalCount = items.length
  } else if (resultType === 'actor-list') {
    const items = Array.isArray(response?.items) ? response.items : []
    message.data.previewActors = items.slice(0, 8).map(compactActorResultItem)
    message.data.totalCount = items.length
  } else if (resultType === 'drive-stats') {
    message.data.previewStats = Array.isArray(response?.drives) ? response.drives.slice(0, 8) : []
    message.data.totalCount = message.data.previewStats.length
  } else if (resultType === 'subtitle-summary') {
    message.data.folderCounts = Array.isArray(response?.folderCounts) ? response.folderCounts.slice(0, 20) : []
    message.data.totalCount = Number(response?.totalCount) || 0
  }

  return message
}

function buildPendingMessage(messageText, toolLabel) {
  return {
    id: createId(),
    role: 'assistant',
    createdAt: nowIso(),
    content: toolLabel || '처리 중...',
    status: 'loading',
    toolCall: null,
    data: {
      prompt: messageText,
    },
  }
}

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => {
    const left = new Date(b?.updatedAt || b?.createdAt || 0).getTime()
    const right = new Date(a?.updatedAt || a?.createdAt || 0).getTime()
    return left - right
  })
}

function updateSessionList(sessions, sessionId, updater) {
  const nextSessions = sessions.map((session) => {
    if (session.id !== sessionId) return session
    return updater(session)
  })
  return sortSessions(nextSessions)
}

function replaceMessage(session, messageId, updater) {
  return {
    ...session,
    messages: session.messages.map((message) => (message.id === messageId ? updater(message) : message)),
  }
}

export function AiChatProvider({ children, currentContext }) {
  const initialState = useMemo(() => loadAiChatState(), [])
  const [sessions, setSessions] = useState(() => sortSessions(initialState.sessions || []))
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId || null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [pendingRequest, setPendingRequest] = useState(null)

  useEffect(() => {
    saveAiChatState({ sessions, activeSessionId })
  }, [sessions, activeSessionId])

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id)
    }
  }, [activeSessionId, sessions])

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId],
  )

  const createSession = useCallback((title, seedFilters = {}) => {
    const sessionId = createId()
    const now = nowIso()
    const session = {
      id: sessionId,
      title: isDefaultTitle(title) ? '새 채팅' : String(title || '새 채팅'),
      createdAt: now,
      updatedAt: now,
      messages: [],
      lastToolCall: null,
      lastResultIds: [],
      activeFilters: seedFilters,
      pendingAction: null,
    }

    setSessions((prev) => sortSessions([session, ...prev]))
    setActiveSessionId(sessionId)
    return session
  }, [])

  const ensureActiveSession = useCallback((title, seedFilters = {}) => {
    if (activeSession) return activeSession
    return createSession(title, seedFilters)
  }, [activeSession, createSession])

  const updateSession = useCallback((sessionId, updater) => {
    setSessions((prev) => updateSessionList(prev, sessionId, updater))
  }, [])

  const selectSession = useCallback((sessionId) => {
    if (!sessionId) return
    setActiveSessionId(sessionId)
  }, [])

  const openDrawer = useCallback(() => {
    if (!activeSession && sessions.length === 0) {
      createSession('새 채팅')
    }
    setIsDrawerOpen(true)
  }, [activeSession, createSession, sessions.length])

  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])
  const openFullScreen = useCallback(() => {
    setIsDrawerOpen(false)
    setIsFullScreen(true)
  }, [])
  const closeFullScreen = useCallback(() => setIsFullScreen(false), [])

  const deleteSession = useCallback((sessionId) => {
    setSessions((prev) => {
      const next = prev.filter((session) => session.id !== sessionId)
      if (sessionId === activeSessionId) {
        setActiveSessionId(next[0]?.id || null)
      }
      return next
    })
  }, [activeSessionId])

  const clearSessions = useCallback(() => {
    setSessions([])
    setActiveSessionId(null)
    clearAiChatState()
  }, [])

  const sendMessage = useCallback(async ({ message, context: contextOverride } = {}) => {
    const text = String(message || '').trim()
    if (!text) {
      return { success: false, errorCode: 'VALIDATION_ERROR', error: '메시지를 입력해 주세요.' }
    }

    if (isSending) {
      return { success: false, errorCode: 'REQUEST_CANCELLED', error: '이전 요청을 처리하는 중입니다.' }
    }

    const requestContext = sanitizeContext(contextOverride || currentContext)
    const session = ensureActiveSession(buildSessionTitle(text), requestContext.activeFilters)
    const sessionId = session.id
    const now = nowIso()
    const requestId = createId()
    const userMessage = {
      id: createId(),
      role: 'user',
      content: text,
      createdAt: now,
    }
    const pendingMessage = buildPendingMessage(text, 'AI 도구 실행 중...')

    setIsDrawerOpen(true)
    setIsSending(true)
    setPendingRequest({ requestId, sessionId, pendingMessageId: pendingMessage.id })

    updateSession(sessionId, (prev) => ({
      ...prev,
      title: isDefaultTitle(prev.title) ? buildSessionTitle(text) : prev.title,
      updatedAt: now,
      activeFilters: requestContext.activeFilters,
      messages: [...prev.messages, userMessage, pendingMessage],
    }))

    try {
      const response = await window.api.sendAiChatMessage({
        requestId,
        sessionId,
        message: text,
        context: requestContext,
        state: {
          lastToolCall: session.lastToolCall || null,
          lastResultIds: session.lastResultIds || [],
          activeFilters: session.activeFilters || {},
        },
      })

      if (!response || response.success !== true) {
        const assistantMessage = buildAssistantMessage(response || { success: false, error: '응답이 없습니다.' })
        updateSession(sessionId, (prev) => ({
          ...replaceMessage(prev, pendingMessage.id, () => assistantMessage),
          updatedAt: nowIso(),
        }))
        return response
      }

      const assistantMessage = buildAssistantMessage(response)
      updateSession(sessionId, (prev) => ({
        ...replaceMessage(prev, pendingMessage.id, () => assistantMessage),
        updatedAt: nowIso(),
        lastToolCall: response.toolCall || prev.lastToolCall || null,
        lastResultIds: Array.isArray(response.lastResultIds)
          ? response.lastResultIds
          : prev.lastResultIds,
        activeFilters: response.intent || prev.activeFilters,
      }))

      return response
    } catch (error) {
      const assistantMessage = buildAssistantMessage({
        success: false,
        errorCode: 'AI_CONNECTION_ERROR',
        error: 'AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
      })

      updateSession(sessionId, (prev) => ({
        ...replaceMessage(prev, pendingMessage.id, () => assistantMessage),
        updatedAt: nowIso(),
      }))

      return { success: false, errorCode: 'AI_CONNECTION_ERROR', error: error?.message || 'AI 요청 실패' }
    } finally {
      setIsSending(false)
      setPendingRequest((prev) => (prev?.requestId === requestId ? null : prev))
    }
  }, [activeSession, currentContext, ensureActiveSession, isSending, updateSession])

  const value = useMemo(() => ({
    sessions,
    activeSessionId,
    activeSession,
    isDrawerOpen,
    isFullScreen,
    isSending,
    pendingRequest,
    currentContext: sanitizeContext(currentContext),
    openDrawer,
    closeDrawer,
    openFullScreen,
    closeFullScreen,
    selectSession,
    createSession,
    deleteSession,
    clearSessions,
    sendMessage,
    setIsDrawerOpen,
  }), [
    activeSession,
    activeSessionId,
    clearSessions,
    closeDrawer,
    closeFullScreen,
    currentContext,
    createSession,
    deleteSession,
    isDrawerOpen,
    isFullScreen,
    isSending,
    openDrawer,
    openFullScreen,
    pendingRequest,
    selectSession,
    sendMessage,
    sessions,
  ])

  return (
    <AiChatContext.Provider value={value}>
      {children}
    </AiChatContext.Provider>
  )
}

export { AiChatContext }
