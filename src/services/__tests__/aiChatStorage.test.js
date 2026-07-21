import test from 'node:test'
import assert from 'node:assert/strict'

import { loadAiChatState, saveAiChatState } from '../aiChatStorage.js'

function createStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

test('saved AI chat state does not restore activeSessionId automatically', () => {
  const localStorage = createStorage()
  globalThis.window = { localStorage }

  saveAiChatState({
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        title: '자막 없는 영상 찾기',
      },
    ],
  })

  const state = loadAiChatState()
  assert.equal(state.activeSessionId, null)
  assert.equal(Array.isArray(state.sessions), true)
  assert.equal(state.sessions.length, 1)

  delete globalThis.window
})