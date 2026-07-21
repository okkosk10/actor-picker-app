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
      favorite INTEGER,
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
      id, file_path, folder_path, file_name, file_size, size,
      rating, play_count, actor_name, code, grade,
      recommended, favorite, is_new, tags, status, subtitle_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?)
  `)

  insert.run(1, 'D:\\Videos\\ActorA\\A-001.mp4', 'D:\\Videos\\ActorA', 'A-001.mp4', 1000, 1000, 5, 1, 'ActorA', 'A-001', '보관', 1, 0, 0, 'tag1', 1, '2026-07-20', '2026-07-21')
  insert.run(2, 'D:\\Videos\\ActorA\\A-002.mp4', 'D:\\Videos\\ActorA', 'A-002.mp4', 900, 900, 4, 0, 'ActorA', 'A-002', '보관', 0, 0, 1, 'tag2', 1, '2026-07-21', '2026-07-21')
  insert.run(3, 'E:\\Videos\\ActorB\\B-001.mp4', 'E:\\Videos\\ActorB', 'B-001.mp4', 800, 800, 4, 0, 'ActorB', 'B-001', '보관', 0, 0, 1, 'tag3', 1, '2026-07-19', '2026-07-20')
  insert.run(4, 'D:\\Videos2\\Wrong-001.mp4', 'D:\\Videos2', 'Wrong-001.mp4', 700, 700, 5, 0, 'ActorC', 'W-001', '보관', 0, 0, 1, 'tag4', 1, '2026-07-18', '2026-07-18')

  db.prepare('INSERT INTO scanned_roots (root_path, is_active) VALUES (?, ?)').run('D:\\Videos', 1)
  db.prepare('INSERT INTO scanned_roots (root_path, is_active) VALUES (?, ?)').run('E:\\Videos', 1)
  db.prepare('INSERT INTO scanned_roots (root_path, is_active) VALUES (?, ?)').run('D:\\Videos2', 0)

  db.prepare('INSERT INTO video_activity_logs (id, video_id, action_type) VALUES (?, ?, ?)').run(1, 1, 'copy_to_clipboard')

  return db
}

async function runSearch(db, args) {
  return executeChatPlan(db, {
    toolName: 'search_videos',
    arguments: args,
  }, {})
}

test('video quick workflow scopes produce different results', async () => {
  const db = createDb()

  try {
    const all = await runSearch(db, { scope: 'all', sortBy: 'rating', minRating: 4, limit: 10 })
    const drive = await runSearch(db, { scope: 'current_drive', drive: 'D:', sortBy: 'rating', minRating: 4, limit: 10 })
    const folder = await runSearch(db, { scope: 'current_folder', folder: 'D:\\Videos\\ActorA', sortBy: 'rating', minRating: 4, limit: 10 })
    const selected = await runSearch(db, { scope: 'selected_videos', baseResultIds: [2, 3], sortBy: 'rating', minRating: 4, limit: 10 })

    assert.equal(all.success, true)
    assert.equal(drive.success, true)
    assert.equal(folder.success, true)
    assert.equal(selected.success, true)

    assert.equal(all.items.length, 3)
    assert.equal(drive.items.length, 2)
    assert.equal(folder.items.length, 2)
    assert.equal(selected.items.length, 2)
    assert.equal(folder.appliedFilters.folder, 'D:\\Videos\\ActorA')
    assert.deepEqual(selected.lastResultIds.sort((a, b) => a - b), [2, 3])
  } finally {
    db.close()
  }
})