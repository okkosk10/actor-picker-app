'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const orchestratorPath = require.resolve('../chatOrchestrator.cjs')

test('direct consultation message is rejected when feature flag is disabled', async () => {
  const previous = process.env.ENABLE_AI_CONSULTATION
  process.env.ENABLE_AI_CONSULTATION = 'false'
  delete require.cache[orchestratorPath]

  const { handleChatRequest } = require('../chatOrchestrator.cjs')

  try {
    const result = await handleChatRequest({}, {
      requestId: 'req-1',
      sessionId: 'session-1',
      message: '자연어로 상담하고 싶어',
      context: {},
      state: { entryMode: 'quick', phase: 'quick_home' },
    })

    assert.equal(result.success, false)
    assert.equal(result.errorCode, 'FEATURE_DISABLED')
  } finally {
    delete require.cache[orchestratorPath]
    if (typeof previous === 'undefined') {
      delete process.env.ENABLE_AI_CONSULTATION
    } else {
      process.env.ENABLE_AI_CONSULTATION = previous
    }
  }
})

test('consult mode switch action is rejected when feature flag is disabled', async () => {
  const previous = process.env.ENABLE_AI_CONSULTATION
  process.env.ENABLE_AI_CONSULTATION = 'false'
  delete require.cache[orchestratorPath]

  const { handleChatRequest } = require('../chatOrchestrator.cjs')

  try {
    const result = await handleChatRequest({}, {
      requestId: 'req-2',
      sessionId: 'session-2',
      message: 'AI 상담으로 전환',
      action: {
        type: 'switch_mode',
        label: 'AI 상담으로 전환',
        payload: { type: 'switch_mode', mode: 'consult' },
      },
      context: {},
      state: { entryMode: 'quick', phase: 'quick_home' },
    })

    assert.equal(result.success, false)
    assert.equal(result.errorCode, 'FEATURE_DISABLED')
  } finally {
    delete require.cache[orchestratorPath]
    if (typeof previous === 'undefined') {
      delete process.env.ENABLE_AI_CONSULTATION
    } else {
      process.env.ENABLE_AI_CONSULTATION = previous
    }
  }
})