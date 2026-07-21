'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')

const { executeChatPlan } = require('../toolExecutor.cjs')

function createDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE videos (
      id INTEGER PRIMARY KEY,
      file_path TEXT,
      folder_path TEXT,
      file_name TEXT,
      file_size INTEGER,
      size INTEGER,
      rating REAL,
      play_count INTEGER,
      actor_name TEXT,
      code TEXT,
      grade TEXT,
      recommended INTEGER,
      is_new INTEGER,
      tags TEXT,
      status TEXT,
      subtitle_count INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE video_activity_logs (
      id INTEGER PRIMARY KEY,
      video_id INTEGER,
      action_type TEXT
    );

    CREATE TABLE scanned_roots (
      root_path TEXT PRIMARY KEY,
      is_active INTEGER
    );
  `)

  const insert = db.prepare(`
    INSERT INTO videos (
      id, file_path, folder_path, file_name,
      file_size, size, rating, play_count, actor_name, code,
      grade, recommended, is_new, tags,
      status, subtitle_count, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, '2026-01-01', '2026-01-02')
  `)

  insert.run(1, 'D:\\Videos\\ActorA\\A-001.mp4', 'D:\\Videos\\ActorA', 'A-001.mp4', 1000, 1000, 4.0, 1, 'ActorA', 'A-001', '보관', 0, 0, '', 0)
  insert.run(2, 'D:\\Videos\\ActorA\\A-002.mp4', 'D:\\Videos\\ActorA', 'A-002.mp4', 1100, 1100, 3.0, 2, 'ActorA', 'A-002', '보관', 0, 0, '', 1)
  insert.run(3, 'D:\\Videos\\ActorB\\B-001.mp4', 'D:\\Videos\\ActorB', 'B-001.mp4', 1200, 1200, 2.0, 0, 'ActorB', 'B-001', '보관', 0, 0, '', 0)
  insert.run(4, 'E:\\Videos\\ActorA\\E-001.mp4', 'E:\\Videos\\ActorA', 'E-001.mp4', 1300, 1300, 5.0, 4, 'ActorA', 'E-001', '보관', 0, 0, '', 0)
  insert.run(5, 'D:\\Videos2\\Wrong-001.mp4', 'D:\\Videos2', 'Wrong-001.mp4', 1400, 1400, 1.0, 0, 'ActorC', 'W-001', '보관', 0, 0, '', 0)

  const insertRoot = db.prepare(`
    INSERT INTO scanned_roots (root_path, is_active)
    VALUES (?, ?)
  `)
  insertRoot.run('D:\\Videos', 1)
  insertRoot.run('E:\\Videos', 1)
  insertRoot.run('D:\\Videos2', 0)

  return db
}

async function runSubtitleSearch(db, argumentsPayload) {
  return executeChatPlan(db, {
    toolName: 'search_videos_without_subtitles',
    arguments: argumentsPayload,
  }, {})
}

test('subtitle scope filters produce different counts', async () => {
  const db = createDb()

  const all = await runSubtitleSearch(db, { scope: 'all', limit: 500 })
  const drive = await runSubtitleSearch(db, { scope: 'current_drive', drive: 'D:', limit: 500 })
  const folder = await runSubtitleSearch(db, { scope: 'current_folder', folder: 'D:\\Videos\\ActorA', limit: 500 })
  const selected = await runSubtitleSearch(db, { scope: 'selected_videos', baseResultIds: [1, 2], limit: 500 })

  assert.equal(all.success, true)
  assert.equal(drive.success, true)
  assert.equal(folder.success, true)
  assert.equal(selected.success, true)

  assert.equal(all.items.length, 3)
  assert.equal(drive.items.length, 2)
  assert.equal(folder.items.length, 1)
  assert.equal(selected.items.length, 1)

  assert.equal(folder.appliedFilters.scope, 'current_folder')
  assert.equal(folder.appliedFilters.folder, 'D:\\Videos\\ActorA')

  db.close()
})

test('folder boundary filter does not include D:\\Videos2 when folder is D:\\Videos', async () => {
  const db = createDb()

  const folder = await runSubtitleSearch(db, {
    scope: 'current_folder',
    folder: 'D:\\Videos',
    limit: 500,
  })

  assert.equal(folder.success, true)
  const ids = folder.items.map((item) => Number(item.video.id)).sort((a, b) => a - b)
  assert.deepEqual(ids, [1, 3])
  assert.equal(ids.includes(5), false)

  db.close()
})
