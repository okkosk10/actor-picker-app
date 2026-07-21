'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')

const toolExecutorPath = require.resolve('../toolExecutor.cjs')
const aiRecommendPath = require.resolve('../../aiChatRecommendService.cjs')

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

  db.prepare(`
    INSERT INTO videos (
      id, file_path, folder_path, file_name, file_size, size,
      rating, play_count, actor_name, code, grade,
      recommended, favorite, is_new, tags, status, subtitle_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?)
  `).run(1, 'D:\\Videos\\ActorA\\A-001.mp4', 'D:\\Videos\\ActorA', 'A-001.mp4', 1000, 1000, 5, 1, 'ActorA', 'A-001', '보관', 1, 0, 0, 'tag1', 1, '2026-07-20', '2026-07-21')

  db.prepare(`
    INSERT INTO videos (
      id, file_path, folder_path, file_name, file_size, size,
      rating, play_count, actor_name, code, grade,
      recommended, favorite, is_new, tags, status, subtitle_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?)
  `).run(2, 'D:\\Videos\\ActorB\\B-001.mp4', 'D:\\Videos\\ActorB', 'B-001.mp4', 900, 900, 4, 0, 'ActorB', 'B-001', '보관', 0, 0, 1, 'tag2', 1, '2026-07-21', '2026-07-21')

  db.prepare('INSERT INTO scanned_roots (root_path, is_active) VALUES (?, ?)').run('D:\\Videos', 1)
  db.prepare('INSERT INTO video_activity_logs (id, video_id, action_type) VALUES (?, ?, ?)').run(1, 1, 'copy_to_clipboard')

  return db
}

test('quick workflow search_videos does not call AI recommendation service', async () => {
  const originalToolExecutor = require.cache[toolExecutorPath]
  const originalAiRecommend = require.cache[aiRecommendPath]

  delete require.cache[toolExecutorPath]
  require.cache[aiRecommendPath] = {
    id: aiRecommendPath,
    filename: aiRecommendPath,
    loaded: true,
    exports: {
      askAiChatRecommend: async () => {
        throw new Error('AI recommendation service must not be called for quick workflows')
      },
    },
  }

  const { executeChatPlan } = require('../toolExecutor.cjs')
  const db = createDb()

  try {
    const result = await executeChatPlan(db, {
      toolName: 'search_videos',
      arguments: {
        scope: 'all',
        sortBy: 'rating',
        minRating: 4,
        limit: 10,
      },
    }, {})

    assert.equal(result.success, true)
    assert.equal(result.resultType, 'video-list')
    assert.equal(result.items.length, 2)
    assert.equal(result.items[0].video.code, 'A-001')
  } finally {
    db.close()
    delete require.cache[toolExecutorPath]
    delete require.cache[aiRecommendPath]
    if (originalToolExecutor) require.cache[toolExecutorPath] = originalToolExecutor
    if (originalAiRecommend) require.cache[aiRecommendPath] = originalAiRecommend
  }
})