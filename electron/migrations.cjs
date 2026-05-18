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

  {
    version: '006_add_video_activity_columns',
    description: 'videos 테이블에 대시보드/사용 기록용 컬럼 추가',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(videos)').all().map((c) => c.name)

      const additions = [
        { name: 'play_count',        def: 'INTEGER DEFAULT 0' },
        { name: 'last_played_at',    def: 'TEXT' },
        { name: 'last_requested_at', def: 'TEXT' },
        { name: 'favorite',          def: 'INTEGER DEFAULT 0' },
      ]

      for (const col of additions) {
        if (!cols.includes(col.name)) {
          db.exec(`ALTER TABLE videos ADD COLUMN ${col.name} ${col.def}`)
        }
      }

      // 인덱스는 IF NOT EXISTS로 중복 생성 방지
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_videos_play_count        ON videos (play_count);
        CREATE INDEX IF NOT EXISTS idx_videos_last_played_at    ON videos (last_played_at);
        CREATE INDEX IF NOT EXISTS idx_videos_last_requested_at ON videos (last_requested_at);
        CREATE INDEX IF NOT EXISTS idx_videos_favorite          ON videos (favorite);
      `)
    },
  },

  {
    version: '007_create_video_activity_logs',
    description: 'video_activity_logs 테이블 생성',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_activity_logs (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
          action_type TEXT    NOT NULL,
          created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
          meta_json   TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_val_video_id    ON video_activity_logs (video_id);
        CREATE INDEX IF NOT EXISTS idx_val_action_type ON video_activity_logs (action_type);
        CREATE INDEX IF NOT EXISTS idx_val_created_at  ON video_activity_logs (created_at);
      `)
    },
  },

  {
    version: '008_add_actor_aliases',
    description: 'actors 테이블에 aliases 컬럼 추가 (별칭/다른 이름으로 배우 검색 지원)',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(actors)').all().map((c) => c.name)
      if (!cols.includes('aliases')) {
        db.exec(`ALTER TABLE actors ADD COLUMN aliases TEXT DEFAULT ''`)
      }
      // video_activity_logs에 actor_id 컬럼 추가 (배우별 통계 고속 집계용)
      const logCols = db.prepare('PRAGMA table_info(video_activity_logs)').all().map((c) => c.name)
      if (!logCols.includes('actor_id')) {
        db.exec(`ALTER TABLE video_activity_logs ADD COLUMN actor_id INTEGER`)
      }
    },
  },

  {
    version: '009_add_sort_indexes',
    description: '정렬 성능 인덱스 추가 (created_at, updated_at, is_new+status 복합)',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_videos_updated_at ON videos (updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_videos_is_new_status ON videos (is_new, status);
      `)
    },
  },

  {
    version: '010_add_file_identity',
    description: 'file_identity 컬럼 추가 및 백필 (파일 동일성 식별자)',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(videos)').all().map((c) => c.name)

      // 1. file_identity 컬럼 추가
      if (!cols.includes('file_identity')) {
        db.exec(`ALTER TABLE videos ADD COLUMN file_identity TEXT`)
      }

      // 2. 기존 데이터 백필: code가 있으면 `${code}|${size}`, 없으면 `${file_name}|${size}`
      db.exec(`
        UPDATE videos
        SET file_identity = CASE
          WHEN code IS NOT NULL AND trim(code) != ''
            THEN trim(code) || '|' || CAST(COALESCE(size, 0) AS TEXT)
          ELSE
            file_name || '|' || CAST(COALESCE(size, 0) AS TEXT)
        END
        WHERE file_identity IS NULL
      `)

      // 3. file_identity 인덱스 추가
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_videos_file_identity ON videos (file_identity);
      `)
    },
  },

  {
    version: '011_add_is_actor_manual',
    description: 'videos에 is_actor_manual 컬럼 추가 (사용자 수동 배우명 수정 여부)',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(videos)').all().map((c) => c.name)
      if (!cols.includes('is_actor_manual')) {
        db.exec(`ALTER TABLE videos ADD COLUMN is_actor_manual INTEGER DEFAULT 0`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_videos_is_actor_manual ON videos (is_actor_manual)`)
      }
    },
  },

  {
    version: '012_add_file_size',
    description: 'videos에 file_size 컬럼 추가 및 기존 size 값으로 백필 (드라이브 저장소 관리용)',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(videos)').all().map((c) => c.name)
      if (!cols.includes('file_size')) {
        db.exec(`ALTER TABLE videos ADD COLUMN file_size INTEGER DEFAULT 0`)
        // 기존 size 컬럼 값으로 백필
        db.exec(`UPDATE videos SET file_size = COALESCE(size, 0) WHERE file_size IS NULL OR file_size = 0`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_videos_file_size ON videos (file_size)`)
      }
    },
  },

  {
    version: '013_create_ai_analysis_cache',
    description: 'AI 분석 결과 캐시 테이블 생성 (배우/영상 공용)',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_analysis_cache (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type   TEXT    NOT NULL,                   -- 'actor' | 'video'
          entity_id     INTEGER NOT NULL,
          ai_analysis   TEXT,                               -- 전체 AI 분석 JSON 원문
          ai_tags       TEXT,                               -- AI 추천 태그 배열 (JSON string)
          ai_score      INTEGER DEFAULT 0,                  -- AI 추천 점수 0~100
          ai_summary    TEXT,                               -- 사용자 표시용 요약
          ai_status     TEXT    NOT NULL DEFAULT 'pending', -- pending|processing|done|failed
          ai_updated_at TEXT,
          UNIQUE (entity_type, entity_id)
        );

        CREATE INDEX IF NOT EXISTS idx_ai_cache_entity
          ON ai_analysis_cache (entity_type, entity_id);

        CREATE INDEX IF NOT EXISTS idx_ai_cache_status
          ON ai_analysis_cache (ai_status);
      `)
    },
  },

  {
    version: '014_add_actor_is_new',
    description: 'actors에 is_new, first_seen_scan_id, last_seen_scan_id 컬럼 추가 (New Actors 흐름)',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(actors)').all().map((c) => c.name)

      const additions = [
        { name: 'is_new',             def: 'INTEGER DEFAULT 0' },
        { name: 'first_seen_scan_id', def: "TEXT DEFAULT ''" },
        { name: 'last_seen_scan_id',  def: "TEXT DEFAULT ''" },
      ]

      for (const col of additions) {
        if (!cols.includes(col.name)) {
          db.exec(`ALTER TABLE actors ADD COLUMN ${col.name} ${col.def}`)
        }
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_actors_is_new ON actors (is_new);
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
