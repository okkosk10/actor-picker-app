'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const cases = require('./intentPlannerCases.cjs')
const { buildFallbackPlan } = require('../intentPlanner.cjs')

const openaiClientPath = require.resolve('../../openaiClient.cjs')
const plannerPath = require.resolve('../intentPlanner.cjs')

function withMockedPlanner(outputText) {
  const originalOpenAI = require.cache[openaiClientPath]
  const originalPlanner = require.cache[plannerPath]

  delete require.cache[plannerPath]
  require.cache[openaiClientPath] = {
    id: openaiClientPath,
    filename: openaiClientPath,
    loaded: true,
    exports: {
      getOpenAIClient: () => ({
        responses: {
          create: async () => ({ output_text: outputText }),
        },
      }),
    },
  }

  const planner = require('../intentPlanner.cjs')

  return {
    planner,
    restore() {
      delete require.cache[plannerPath]
      delete require.cache[openaiClientPath]
      if (originalPlanner) require.cache[plannerPath] = originalPlanner
      if (originalOpenAI) require.cache[openaiClientPath] = originalOpenAI
    },
  }
}

test('intent planner regression cases stay populated', () => {
  assert.ok(Array.isArray(cases), 'cases must be an array')
  assert.ok(cases.length >= 40, 'expected at least 40 regression cases')

  for (const entry of cases) {
    assert.equal(typeof entry.input, 'string')
    assert.ok(entry.input.trim().length > 0)
    assert.ok(entry.expected && typeof entry.expected === 'object')
    assert.ok('toolName' in entry.expected || 'needsClarification' in entry.expected)
  }
})

test('fallback planner resolves expected toolName for cases', () => {
  const context = {
    currentPage: 'library',
    currentFolder: 'D:\\Videos',
    selectedVideoIds: [],
    activeFilters: { drive: null },
  }
  const state = { lastResultIds: [], lastToolCall: null, activeFilters: {} }

  const fallbackTargetInputs = new Map([
    ['자막 없는 파일들 정리해서 보여줄래', 'search_videos_without_subtitles'],
    ['자막 없는 영상 목록으로 정리해줘', 'search_videos_without_subtitles'],
    ['자막 없는 파일을 보기 좋게 정리해서 보여줘', 'search_videos_without_subtitles'],
    ['자막 없는 파일 중 지워도 될 것 정리해줘', 'get_delete_candidates'],
    ['자막 없는 영상 보여줘', 'search_videos_without_subtitles'],
    ['자막 미매핑 목록 알려줘', 'search_videos_without_subtitles'],
    ['자막 없는 영상 몇 개인지 알려줘', 'get_unmapped_subtitle_summary'],
    ['용량 많이 먹는데 안 본 영상 정리해줘', 'get_delete_candidates'],
  ])

  for (const [input, expectedTool] of fallbackTargetInputs.entries()) {
    const plan = buildFallbackPlan(input, context, state)
    assert.equal(plan.toolName, expectedTool, `input: ${input}`)
  }
})

test('planIntent uses mocked OpenAI JSON result', async () => {
  const mockedResponse = JSON.stringify({
    success: true,
    intent: 'search_videos_without_subtitles',
    confidence: 0.97,
    toolName: 'search_videos_without_subtitles',
    arguments: { drive: 'D:', limit: 30 },
    usePreviousResults: false,
    needsClarification: false,
    requiresConfirmation: false,
    clarification: null,
    writeIntent: false,
  })

  const mocked = withMockedPlanner(mockedResponse)
  try {
    const plan = await mocked.planner.planIntent('자막 없는 파일들 정리해서 보여줄래', {
      currentPage: 'library',
      currentFolder: 'D:\\Videos',
      selectedVideoIds: [],
      activeFilters: {},
    }, {
      lastToolCall: null,
      lastResultIds: [],
      activeFilters: {},
    })

    assert.equal(plan.toolName, 'search_videos_without_subtitles')
    assert.equal(plan.needsClarification, false)
    assert.equal(plan.arguments.limit, 30)
  } finally {
    mocked.restore()
  }
})
