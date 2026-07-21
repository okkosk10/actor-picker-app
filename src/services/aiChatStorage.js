'use strict'

const STORAGE_KEY = 'actor-picker-ai-chat-state-v1'
const LEGACY_CACHE_KEY = '__aiChatCache'

function readStorage() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)

    const legacy = window.__aiChatCache
    if (legacy && typeof legacy === 'object') {
      return {
        sessions: [],
        activeSessionId: null,
        legacy,
      }
    }
  } catch {
    return null
  }

  return null
}

function normalizeState(snapshot) {
  const sessions = Array.isArray(snapshot?.sessions) ? snapshot.sessions : []
  return {
    sessions,
    activeSessionId: typeof snapshot?.activeSessionId === 'string' ? snapshot.activeSessionId : null,
  }
}

export function loadAiChatState() {
  const snapshot = normalizeState(readStorage())
  if (snapshot.sessions.length > 0) return snapshot

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const legacy = window.localStorage.getItem(LEGACY_CACHE_KEY)
      if (legacy) {
        const parsed = JSON.parse(legacy)
        if (parsed?.result || parsed?.prompt) {
          const now = new Date().toISOString()
          const sessionId = `legacy-${Date.now()}`
          return {
            activeSessionId: sessionId,
            sessions: [
              {
                id: sessionId,
                title: '기존 AI 추천 기록',
                createdAt: now,
                updatedAt: now,
                messages: [],
                lastToolCall: null,
                lastResultIds: [],
                activeFilters: {},
                pendingAction: null,
              },
            ],
          }
        }
      }
    }
  } catch {
    // 저장소 손상은 무시하고 빈 상태로 시작한다.
  }

  return snapshot
}

export function saveAiChatState(snapshot) {
  if (typeof window === 'undefined' || !window.localStorage) return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(snapshot)))
  } catch {
    // 저장소 용량 초과 등은 조용히 무시한다.
  }
}

export function clearAiChatState() {
  if (typeof window === 'undefined' || !window.localStorage) return

  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 무시
  }
}
