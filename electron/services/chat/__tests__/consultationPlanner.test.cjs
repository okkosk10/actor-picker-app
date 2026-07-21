'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { planConsultationTurn } = require('../consultationPlanner.cjs')

const baseContext = {
  currentPage: 'library',
  currentFolder: 'D:\\Videos',
  selectedVideoIds: [11, 22],
  activeFilters: { drive: 'D:' },
}

const baseWorkflowState = {
  entryMode: 'consult',
  phase: 'understanding',
  workflowId: null,
  collectedSlots: {},
  missingSlots: [],
  proposedAction: null,
  awaitingConfirmation: false,
  lastQuestion: null,
}

const regressionCases = [
  {
    input: '자막 없는 파일들 정리해서 보여줄래',
    expected: { workflowId: 'find_videos_without_subtitles', shouldExecuteImmediately: false },
  },
  {
    input: '자막 없는 영상 목록으로 정리해줘',
    expected: { workflowId: 'find_videos_without_subtitles', shouldExecuteImmediately: false },
  },
  {
    input: '자막 미매핑 파일 보여줘',
    expected: { workflowId: 'find_videos_without_subtitles', shouldExecuteImmediately: false },
  },
  {
    input: '자막 없는 영상 몇 개인지 알려줘',
    expected: { workflowId: 'get_unmapped_subtitle_summary', shouldExecuteImmediately: false },
  },
  {
    input: '자막 없는 파일 중 지워도 될 것 찾아줘',
    expected: { workflowId: 'cleanup_storage', shouldExecuteImmediately: false },
  },
  {
    input: '용량 많이 먹는데 안 본 영상 정리해줘',
    expected: { workflowId: 'cleanup_storage', shouldExecuteImmediately: false },
  },
  {
    input: '드라이브별 용량 알려줘',
    expected: { workflowId: 'get_drive_stats', shouldExecuteImmediately: false },
  },
  {
    input: '정리 좀 해줘',
    expected: { workflowId: null, shouldExecuteImmediately: false, needsClarification: true },
  },
  {
    input: '좋은 영상 보여줘',
    expected: { workflowId: 'search_videos', shouldExecuteImmediately: false },
  },
  {
    input: '별점 높은 배우 작품 중 미복사만',
    expected: { workflowId: 'search_videos', shouldExecuteImmediately: false },
  },
]

test('consultation planner regression cases', () => {
  assert.ok(regressionCases.length >= 10)

  for (const entry of regressionCases) {
    const result = planConsultationTurn({
      message: entry.input,
      context: baseContext,
      workflowState: baseWorkflowState,
    })

    assert.equal(result.workflowId, entry.expected.workflowId, `workflowId mismatch: ${entry.input}`)
    assert.equal(result.shouldExecuteImmediately, false, `shouldExecuteImmediately must be false: ${entry.input}`)

    if (typeof entry.expected.needsClarification === 'boolean') {
      assert.equal(result.needsClarification, entry.expected.needsClarification, `needsClarification mismatch: ${entry.input}`)
    }
  }
})

test('consultation planner collects cleanup slots but still requires confirmation', () => {
  const result = planConsultationTurn({
    message: 'D드라이브에서 용량 크고 안 보는 영상 정리하고 싶어',
    context: baseContext,
    workflowState: baseWorkflowState,
  })

  assert.equal(result.workflowId, 'cleanup_storage')
  assert.equal(result.shouldExecuteImmediately, false)
  assert.ok(result.extractedSlots)
  assert.equal(result.extractedSlots.drive, 'D:')
  assert.equal(result.extractedSlots.lowPlayCount, true)
  assert.equal(result.extractedSlots.sortBy, 'size')
})
