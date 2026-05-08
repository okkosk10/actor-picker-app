'use strict'

/**
 * electron/migrations.cjs
 * 버전 기반 DB 마이그레이션 유틸
 *
 * - schema_migrations 테이블로 적용 이력 관리
 * - 앱 시작 시 runMigrations(db) 호출 → 미적용 버전만 순서대로 실행
 * - 각 migration은 트랜잭션으로 실행되며 실패 시 자동 rollback
 * - 기존 videos 테이블은 절대 변경/삭제하지 않음
 */

// ── Migration 정의 목록 ─────────────────────────────────────────
// { version: string, description: string, up: (db) => void }
const MIGRATIONS = [
  {
    version: '001_create_schema_migrations',
    description: 'schema_migrations 테이블 생성',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version     TEXT NOT NULL PRIMARY KEY,
          applied_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
    },
  },

  {
    version: '002_create_actors',
    description: 'actors 테이블 생성',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS actors (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT    NOT NULL UNIQUE,
          created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_actors_name ON actors (name);
      `)
    },
  },

  {
    version: '003_create_video_actors',
    description: 'video_actors 연결 테이블 생성',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_actors (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id     INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
          actor_id     INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
          is_main      INTEGER NOT NULL DEFAULT 0,
          order_index  INTEGER NOT NULL DEFAULT 0,
          UNIQUE (video_id, actor_id)
        );

        CREATE INDEX IF NOT EXISTS idx_video_actors_video ON video_actors (video_id);
        CREATE INDEX IF NOT EXISTS idx_video_actors_actor ON video_actors (actor_id);
        CREATE INDEX IF NOT EXISTS idx_video_actors_main  ON video_actors (is_main);
      `)
    },
  },

  {
    version: '004_backfill_actors_from_videos',
    description: 'videos.actor_name 기반으로 actors / video_actors 백필',
    up(db) {
      // actor_name이 있는 모든 영상 조회
      const videos = db
        .prepare(`SELECT id, actor_name FROM videos WHERE actor_name IS NOT NULL AND trim(actor_name) != ''`)
        .all()

      const insertActor = db.prepare(`
        INSERT INTO actors (name) VALUES (?) ON CONFLICT(name) DO NOTHING
      `)
      const getActor = db.prepare(`SELECT id FROM actors WHERE name = ?`)
      const insertVideoActor = db.prepare(`
        INSERT INTO video_actors (video_id, actor_id, is_main, order_index)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(video_id, actor_id) DO NOTHING
      `)

      for (const video of videos) {
        // 다중 배우 형식: "(배우1, 배우2)" 또는 "배우1, 배우2" 모두 처리
        const raw = video.actor_name.replace(/^\(|\)$/g, '').trim()
        const names = raw
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n.length > 0)

        names.forEach((name, idx) => {
          insertActor.run(name)
          const actor = getActor.get(name)
          if (!actor) return
          // 첫 번째 배우(idx === 0)가 대표 배우
          insertVideoActor.run(video.id, actor.id, idx === 0 ? 1 : 0, idx)
        })
      }
    },
  },

  {
    version: '005_extend_actors_profile',
    description: 'actors 테이블에 프로필 관련 컬럼 추가',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(actors)').all().map((c) => c.name)

      const additions = [
        { name: 'image_path',  def: "TEXT DEFAULT ''" },
        { name: 'category',    def: "TEXT DEFAULT ''" },
        { name: 'agency',      def: "TEXT DEFAULT ''" },
        { name: 'tags',        def: "TEXT DEFAULT ''" },
        { name: 'rating',      def: 'INTEGER DEFAULT 0' },
        { name: 'memo',        def: "TEXT DEFAULT ''" },
        { name: 'is_archived', def: 'INTEGER DEFAULT 0' },
        // SQLite는 ALTER TABLE ADD COLUMN DEFAULT CURRENT_TIMESTAMP 미지원
        // → DEFAULT '' 로 추가 후 별도 UPDATE로 채운다
        { name: 'updated_at',  def: "TEXT DEFAULT ''" },
      ]

      for (const col of additions) {
        if (!cols.includes(col.name)) {
          db.exec(`ALTER TABLE actors ADD COLUMN ${col.name} ${col.def}`)
        }
      }

      // updated_at이 비어 있는 기존 row를 현재 시각으로 초기화
      db.exec(`
        UPDATE actors
        SET updated_at = CURRENT_TIMESTAMP
        WHERE updated_at IS NULL OR updated_at = ''
      `)
    },
  },
]

// ── 내부 헬퍼 ──────────────────────────────────────────────────

/**
 * schema_migrations 테이블을 부트스트랩한다.
 * 001 migration 전에 테이블 자체가 없을 수 있으므로 별도로 생성한다.
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT NOT NULL PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
}

/**
 * 이미 적용된 migration version 집합을 반환한다.
 */
function getAppliedVersions(db) {
  const rows = db.prepare('SELECT version FROM schema_migrations').all()
  return new Set(rows.map((r) => r.version))
}

// ── 공개 API ───────────────────────────────────────────────────

/**
 * 미적용 migration을 순서대로 실행한다.
 * 각 migration은 독립 트랜잭션으로 실행되며 실패 시 해당 migration만 rollback된다.
 *
 * @param {import('better-sqlite3').Database} db
 */
function runMigrations(db) {
  ensureMigrationsTable(db)
  const applied = getAppliedVersions(db)

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version))
  if (pending.length === 0) return

  console.log(`[migrations] ${pending.length}개 migration 적용 시작`)

  for (const migration of pending) {
    const run = db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version)
    })

    try {
      run()
      console.log(`[migrations] ✓ ${migration.version}: ${migration.description}`)
    } catch (err) {
      console.error(`[migrations] ✗ ${migration.version} 실패 — rollback 완료`)
      console.error(err)
      // 이후 migration이 이전 migration에 의존할 수 있으므로 중단
      throw new Error(`Migration 실패: ${migration.version}\n${err.message}`)
    }
  }

  console.log('[migrations] 모든 migration 완료')
}

module.exports = { runMigrations }
