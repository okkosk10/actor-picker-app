'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { getWorkflow, buildScopeOptions } = require('../workflowRegistry.cjs')

test('subtitle workflow builds current_folder arguments with real folder path', () => {
  const workflow = getWorkflow('find_videos_without_subtitles')
  const args = workflow.buildArguments(
    { scope: 'current_folder' },
    {
      currentFolder: 'd:/Videos/ActorA/',
      selectedVideoIds: [],
      activeFilters: {},
    },
  )

  assert.equal(args.scope, 'current_folder')
  assert.equal(args.folder, 'D:\\Videos\\ActorA')
  assert.equal(args.drive, null)
  assert.deepEqual(args.baseResultIds, [])
  assert.equal(args.limit, 100)
})

test('subtitle workflow builds current_drive arguments', () => {
  const workflow = getWorkflow('find_videos_without_subtitles')
  const args = workflow.buildArguments(
    { scope: 'current_drive' },
    {
      currentDrive: 'd:',
      selectedVideoIds: [],
    },
  )

  assert.deepEqual(args, {
    scope: 'current_drive',
    drive: 'D:',
    folder: null,
    baseResultIds: [],
    limit: 100,
  })
})

test('subtitle workflow builds selected_videos arguments', () => {
  const workflow = getWorkflow('find_videos_without_subtitles')
  const args = workflow.buildArguments(
    { scope: 'selected_videos' },
    {
      currentFolder: null,
      selectedVideoIds: [11, '22', 22, 0, -1],
    },
  )

  assert.deepEqual(args.baseResultIds, [11, 22])
  assert.equal(args.drive, null)
  assert.equal(args.folder, null)
})

test('subtitle workflow throws when current_folder context is missing', () => {
  const workflow = getWorkflow('find_videos_without_subtitles')
  assert.throws(
    () => workflow.buildArguments({ scope: 'current_folder' }, { currentFolder: null }),
    /현재 화면에서 선택된 폴더가 없습니다/,
  )
})

test('scope options disable unavailable entries with reasons', () => {
  const options = buildScopeOptions({
    currentFolder: null,
    selectedVideoIds: [],
    activeFilters: {},
  })

  const currentFolder = options.find((option) => option.value === 'current_folder')
  const selectedVideos = options.find((option) => option.value === 'selected_videos')

  assert.equal(currentFolder.disabled, true)
  assert.match(String(currentFolder.disabledReason || ''), /선택된 폴더/)
  assert.equal(selectedVideos.disabled, true)
  assert.match(String(selectedVideos.disabledReason || ''), /선택한 영상/)
})
