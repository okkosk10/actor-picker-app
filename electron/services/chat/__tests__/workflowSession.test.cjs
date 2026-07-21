'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildActionPreviewResponse } = require('../workflowSession.cjs')

test('workflow action preview stores proposedAction in state', () => {
  const response = buildActionPreviewResponse(
    {
      entryMode: 'quick',
      phase: 'confirming',
      workflowId: 'find_videos_without_subtitles',
      collectedSlots: { scope: 'all' },
      missingSlots: [],
      proposedAction: null,
      awaitingConfirmation: false,
      lastQuestion: null,
    },
    'find_videos_without_subtitles',
    { scope: 'all' },
    {
      currentPage: 'library',
      currentFolder: 'D:\\Videos\\ActorA',
      currentDrive: 'D:',
      selectedVideoIds: [11, 22],
      activeFilters: { drive: 'D:' },
    },
  )

  assert.equal(response.success, true)
  assert.equal(response.resultType, 'workflow-action-preview')
  assert.equal(response.state.phase, 'confirming')
  assert.equal(response.state.awaitingConfirmation, true)
  assert.ok(response.state.proposedAction)
  assert.equal(response.state.proposedAction.toolName, 'search_videos_without_subtitles')
  assert.equal(response.state.proposedAction.arguments.scope, 'all')
})
