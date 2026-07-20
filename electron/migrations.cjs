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
  {
    version: '015_add_video_subtitle_columns',
    description: 'videos subtitle metadata columns',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(videos)').all().map((c) => c.name)
      const additions = [
        { name: 'subtitle_paths', def: "TEXT DEFAULT '[]'" },
        { name: 'subtitle_exts', def: "TEXT DEFAULT ''" },
        { name: 'subtitle_count', def: 'INTEGER DEFAULT 0' },
        { name: 'subtitle_size', def: 'INTEGER DEFAULT 0' },
        { name: 'subtitle_files', def: "TEXT DEFAULT '[]'" },
        { name: 'subtitle_added_at', def: 'TEXT' },
      ]

      for (const col of additions) {
        if (!cols.includes(col.name)) {
          db.exec(`ALTER TABLE videos ADD COLUMN ${col.name} ${col.def}`)
        }
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_videos_subtitle_count ON videos (subtitle_count)`)
      db.exec(`
        UPDATE videos
        SET subtitle_added_at = COALESCE(subtitle_added_at, created_at)
        WHERE COALESCE(subtitle_count, 0) > 0
      `)
    },
  },

  {
    version: '016_add_scanned_roots_is_active',
    description: 'scanned_roots 테이블에 is_active 컬럼 추가 (폴더 활성화/비활성화 토글)',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(scanned_roots)').all().map((c) => c.name)
      if (!cols.includes('is_active')) {
        db.exec(`ALTER TABLE scanned_roots ADD COLUMN is_active INTEGER DEFAULT 1`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_scanned_roots_is_active ON scanned_roots (is_active)`)
      }
    },
  },

  {
    version: '017_create_actor_tag_change_logs',
    description: 'actor 태그 변경 로그 테이블 생성',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS actor_tag_change_logs (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id         INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
          actor_name       TEXT    NOT NULL,
          before_tags      TEXT    DEFAULT '',
          after_tags       TEXT    DEFAULT '',
          added_tags       TEXT    DEFAULT '',
          removed_tags     TEXT    DEFAULT '',
          change_source    TEXT    DEFAULT 'manual',
          source_detail    TEXT    DEFAULT '',
          created_at       TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_actor_tag_change_logs_actor_id ON actor_tag_change_logs (actor_id);
        CREATE INDEX IF NOT EXISTS idx_actor_tag_change_logs_created_at ON actor_tag_change_logs (created_at);
      `)
    },
  },

  {
    version: '018_create_actor_external_mappings',
    description: '외부 배우 매핑 테이블 생성',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS actor_external_mappings (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id        INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
          source_name     TEXT    NOT NULL,
          external_id     TEXT    NOT NULL,
          external_url    TEXT    NOT NULL,
          external_name   TEXT    DEFAULT '',
          match_status    TEXT    DEFAULT 'pending',
          last_checked_at TEXT    DEFAULT CURRENT_TIMESTAMP,
          created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (actor_id, source_name)
        );

        CREATE INDEX IF NOT EXISTS idx_actor_external_mappings_actor ON actor_external_mappings (actor_id);
        CREATE INDEX IF NOT EXISTS idx_actor_external_mappings_source ON actor_external_mappings (source_name, external_id);
      `)
    },
  },
  {
    version: '019_create_actor_external_profiles',
    description: '배우 외부 프로필 캐시 테이블 생성 (로컬 표시용)',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS actor_external_profiles (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id            INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
          source_name         TEXT    NOT NULL,
          external_id         TEXT    NOT NULL,
          profile_json        TEXT    NOT NULL DEFAULT '{}',
          avdbs_average_rating REAL,
          fetched_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (actor_id, source_name)
        );

        CREATE INDEX IF NOT EXISTS idx_actor_external_profiles_actor
          ON actor_external_profiles (actor_id);
        CREATE INDEX IF NOT EXISTS idx_actor_external_profiles_source
          ON actor_external_profiles (source_name, external_id);
      `)
    },
  },
  {
    version: '020_migrate_actor_rating_scale_to_10',
    description: '기존 5점제 배우 평점을 10점제로 변환',
    up(db) {
      db.exec(`
        UPDATE actors
        SET rating = ROUND(rating * 2, 1),
            updated_at = CURRENT_TIMESTAMP
        WHERE rating > 0 AND rating <= 5
      `)
    },
  },
  {
    version: '021_add_actor_tier',
    description: 'actors 테이블에 tier 컬럼 및 인덱스 추가',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(actors)').all().map((c) => c.name)
      if (!cols.includes('tier')) {
        db.exec(`ALTER TABLE actors ADD COLUMN tier TEXT DEFAULT NULL`)
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_actors_tier ON actors (tier)
      `)
    },
  },

  {
    version: '022_create_actor_badges',
    description: '배우 특수 뱃지 정의 및 연결 테이블 생성',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS actor_badge_definitions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          badge_key   TEXT NOT NULL UNIQUE,
          label       TEXT NOT NULL UNIQUE,
          icon        TEXT NOT NULL DEFAULT '',
          variant     TEXT NOT NULL DEFAULT 'gray',
          description TEXT NOT NULL DEFAULT '',
          sort_order  INTEGER NOT NULL DEFAULT 0,
          is_active   INTEGER NOT NULL DEFAULT 1,
          created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS actor_badges (
          actor_id   INTEGER NOT NULL,
          badge_id   INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

          PRIMARY KEY (actor_id, badge_id),

          FOREIGN KEY (actor_id)
            REFERENCES actors(id)
            ON DELETE CASCADE,

          FOREIGN KEY (badge_id)
            REFERENCES actor_badge_definitions(id)
            ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_actor_badges_actor_id
        ON actor_badges (actor_id);

        CREATE INDEX IF NOT EXISTS idx_actor_badges_badge_id
        ON actor_badges (badge_id);

        CREATE INDEX IF NOT EXISTS idx_actor_badge_definitions_active_sort
        ON actor_badge_definitions (is_active, sort_order, label);
      `)

      const insertBadge = db.prepare(`
        INSERT OR IGNORE INTO actor_badge_definitions
          (badge_key, label, icon, variant, description, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `)

      insertBadge.run('tuned_beauty', '튜닝미인', '✨', 'purple', '세련되고 인공적인 완성미가 강하게 느껴지는 배우', 10)
      insertBadge.run('promiscuous_look', '걸레상', '💦', 'hotpink', '도발적이고 성적인 분위기가 강하게 느껴지는 배우', 20)
      insertBadge.run('pure_look', '청순상', '🌸', 'softpink', '맑고 청순한 인상이 강하게 느껴지는 배우', 30)
    },
  },
  {
    version: '023_expand_actor_badges_catalog',
    description: '배우 특수 뱃지 카탈로그 확장 및 카테고리 정규화',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(actor_badge_definitions)').all().map((c) => c.name)

      if (!cols.includes('category')) {
        db.exec(`ALTER TABLE actor_badge_definitions ADD COLUMN category TEXT NOT NULL DEFAULT 'appearance'`)
      }
      if (!cols.includes('description')) {
        db.exec(`ALTER TABLE actor_badge_definitions ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
      }
      if (!cols.includes('sort_order')) {
        db.exec(`ALTER TABLE actor_badge_definitions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_actor_badge_definitions_active_category_sort
        ON actor_badge_definitions (is_active, category, sort_order, label)
      `)

      const getByLabel = db.prepare(`
        SELECT id, badge_key, label
        FROM actor_badge_definitions
        WHERE label = ?
        LIMIT 1
      `)

      const legacyPure = getByLabel.get('청순상')
      const currentPure = getByLabel.get('청순')
      if (legacyPure && currentPure && legacyPure.id !== currentPure.id) {
        db.exec(`
          INSERT OR IGNORE INTO actor_badges (actor_id, badge_id)
          SELECT actor_id, ${currentPure.id}
          FROM actor_badges
          WHERE badge_id = ${legacyPure.id}
        `)
        db.prepare('DELETE FROM actor_badges WHERE badge_id = ?').run(legacyPure.id)
        db.prepare('DELETE FROM actor_badge_definitions WHERE id = ?').run(legacyPure.id)
      }

      const badgeCatalog = [
        {
          key: 'pure_look',
          legacyKeys: ['appearance_pure'],
          label: '청순',
          legacyLabels: ['청순상'],
          icon: '🌸',
          variant: 'softpink',
          category: 'appearance',
          description: '깨끗하고 단정하며 순수한 분위기가 돋보이는 배우',
          sortOrder: 10,
        },
        {
          key: 'promiscuous_look',
          legacyKeys: ['appearance_promiscuous_look'],
          label: '걸레상',
          legacyLabels: [],
          icon: '💦',
          variant: 'hotpink',
          category: 'appearance',
          description: '얼굴과 분위기에서 노골적이고 음란한 인상이 강하게 느껴지는 배우',
          sortOrder: 20,
        },
        {
          key: 'appearance_cutie',
          legacyKeys: [],
          label: '귀요미',
          legacyLabels: [],
          icon: '🍬',
          variant: 'softpink',
          category: 'appearance',
          description: '귀엽고 사랑스러운 인상이 특히 돋보이는 배우',
          sortOrder: 30,
        },
        {
          key: 'tuned_beauty',
          legacyKeys: ['appearance_tuned_beauty'],
          label: '튜닝미인',
          legacyLabels: [],
          icon: '✨',
          variant: 'purple',
          category: 'appearance',
          description: '성형 또는 시술을 포함해 화려하고 완성도 높은 외모가 돋보이는 배우',
          sortOrder: 40,
        },
        {
          key: 'appearance_sexy',
          legacyKeys: [],
          label: '섹녀',
          legacyLabels: [],
          icon: '🔥',
          variant: 'softpink',
          category: 'appearance',
          description: '성숙하고 노골적인 섹시함이 강하게 느껴지는 배우',
          sortOrder: 50,
        },
        {
          key: 'appearance_mature_wife',
          legacyKeys: [],
          label: '미시',
          legacyLabels: [],
          icon: '💗',
          variant: 'softpink',
          category: 'appearance',
          description: '성숙하고 기혼 여성 같은 분위기와 매력이 돋보이는 배우',
          sortOrder: 60,
        },
        {
          key: 'appearance_goddess',
          legacyKeys: [],
          label: '여신',
          legacyLabels: [],
          icon: '👑',
          variant: 'softpink',
          category: 'appearance',
          description: '외모가 압도적으로 아름답고 완성형 미인에 가까운 배우',
          sortOrder: 70,
        },
        {
          key: 'appearance_baby_face',
          legacyKeys: [],
          label: '동안',
          legacyLabels: [],
          icon: '🧸',
          variant: 'softpink',
          category: 'appearance',
          description: '실제 성인 배우이면서 나이보다 어려 보이는 인상이 강한 배우',
          sortOrder: 80,
        },

        {
          key: 'body_cute_big_bust',
          legacyKeys: [],
          label: '귀염폭유',
          legacyLabels: [],
          icon: '🍈',
          variant: 'orange',
          category: 'body',
          description: '귀엽고 아담한 인상과 대비되는 큰 가슴이 특징인 배우',
          sortOrder: 10,
        },
        {
          key: 'body_breast_goat',
          legacyKeys: [],
          label: '가슴 GOAT',
          legacyLabels: [],
          icon: '🍈',
          variant: 'orange',
          category: 'body',
          description: '가슴의 크기, 모양, 비율이 최상급이라고 평가할 만한 배우',
          sortOrder: 20,
        },
        {
          key: 'body_legs',
          legacyKeys: [],
          label: '각선미',
          legacyLabels: [],
          icon: '🦵',
          variant: 'orange',
          category: 'body',
          description: '다리의 길이, 라인, 비율이 특히 아름다운 배우',
          sortOrder: 30,
        },
        {
          key: 'body_curvy',
          legacyKeys: [],
          label: '육덕',
          legacyLabels: [],
          icon: '🔥',
          variant: 'orange',
          category: 'body',
          description: '살집과 볼륨감이 풍부한 성숙한 체형이 돋보이는 배우',
          sortOrder: 40,
        },
        {
          key: 'body_slender',
          legacyKeys: [],
          label: '슬렌더',
          legacyLabels: [],
          icon: '🖤',
          variant: 'orange',
          category: 'body',
          description: '가늘고 마른 체형과 선이 돋보이는 배우',
          sortOrder: 50,
        },
        {
          key: 'body_abs',
          legacyKeys: [],
          label: '복근미녀',
          legacyLabels: [],
          icon: '💪',
          variant: 'orange',
          category: 'body',
          description: '탄탄한 복부와 운동으로 다져진 몸매가 돋보이는 배우',
          sortOrder: 60,
        },

        {
          key: 'performance_fellatio_goat',
          legacyKeys: [],
          label: '펠라 GOAT',
          legacyLabels: [],
          icon: '👅',
          variant: 'red',
          category: 'performance',
          description: '구강 성행위 장면의 기술, 표현력, 적극성이 최상급인 배우',
          sortOrder: 10,
        },
        {
          key: 'performance_cowgirl_goat',
          legacyKeys: [],
          label: '기승위 GOAT',
          legacyLabels: [],
          icon: '🐎',
          variant: 'red',
          category: 'performance',
          description: '기승위 장면의 움직임, 리듬, 주도력이 최상급인 배우',
          sortOrder: 20,
        },
        {
          key: 'performance_toilet_role',
          legacyKeys: [],
          label: '타고난 육변기',
          legacyLabels: [],
          icon: '🚽',
          variant: 'red',
          category: 'performance',
          description: '단체 장면에서 집중적으로 상대를 받아내는 역할과 리액션을 뛰어나게 살리는 배우',
          sortOrder: 30,
        },
        {
          key: 'performance_ahegao_goat',
          legacyKeys: [],
          label: '아헤가오 GOAT',
          legacyLabels: [],
          icon: '😵‍💫',
          variant: 'red',
          category: 'performance',
          description: '쾌감에 무너지는 표정과 얼굴 연기가 특히 뛰어난 배우',
          sortOrder: 40,
        },
        {
          key: 'performance_queen_fall',
          legacyKeys: [],
          label: '여왕함락',
          legacyLabels: [],
          icon: '👑',
          variant: 'red',
          category: 'performance',
          description: '도도하고 고고하며 자존심 강한 캐릭터가 굴욕과 쾌락으로 무너지는 과정을 잘 살리는 배우',
          sortOrder: 50,
        },
        {
          key: 'performance_female_fall',
          legacyKeys: [],
          label: '암컷타락',
          legacyLabels: [],
          icon: '🐾',
          variant: 'red',
          category: 'performance',
          description: '거부, 수치, 저항에서 시작해 쾌락에 무너지고 본능적으로 변해가는 과정을 뛰어나게 연기하는 배우',
          sortOrder: 60,
        },
        {
          key: 'performance_pure_fall',
          legacyKeys: [],
          label: '청순타락',
          legacyLabels: [],
          icon: '🌸',
          variant: 'red',
          category: 'performance',
          description: '순수하고 얌전한 이미지가 성을 알아가며 점차 적극적으로 변하는 과정을 잘 살리는 배우',
          sortOrder: 70,
        },
        {
          key: 'performance_wood',
          legacyKeys: [],
          label: '목석',
          legacyLabels: [],
          icon: '🪵',
          variant: 'red',
          category: 'performance',
          description: '성인 장면에서 표정, 신음, 움직임, 적극성이 굳어 있어 장면을 잘 살리지 못하는 배우',
          sortOrder: 80,
        },
        {
          key: 'performance_natural_slut',
          legacyKeys: [],
          label: '타고난 암캐',
          legacyLabels: [],
          icon: '🐕',
          variant: 'red',
          category: 'performance',
          description: '성행위를 본능적으로 좋아하는 듯한 적극성, 자연스러운 색기, 걸레 같은 음란함과 탐욕스러운 반응을 뛰어나게 보여주는 배우',
          sortOrder: 90,
        },
      ]

      const selectByKey = db.prepare(`
        SELECT id
        FROM actor_badge_definitions
        WHERE badge_key = ?
        LIMIT 1
      `)
      const selectByLabel = db.prepare(`
        SELECT id
        FROM actor_badge_definitions
        WHERE label = ?
        LIMIT 1
      `)
      const updateById = db.prepare(`
        UPDATE actor_badge_definitions
        SET badge_key = ?,
            label = ?,
            icon = ?,
            variant = ?,
            category = ?,
            description = ?,
            sort_order = ?,
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      const insertBadge = db.prepare(`
        INSERT INTO actor_badge_definitions
          (badge_key, label, icon, variant, category, description, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `)

      const usedIds = new Set()
      for (const badge of badgeCatalog) {
        let existing = null

        for (const key of [badge.key, ...(badge.legacyKeys || [])]) {
          if (!key) continue
          const row = selectByKey.get(key)
          if (row && !usedIds.has(row.id)) {
            existing = row
            break
          }
        }

        if (!existing) {
          for (const label of [badge.label, ...(badge.legacyLabels || [])]) {
            if (!label) continue
            const row = selectByLabel.get(label)
            if (row && !usedIds.has(row.id)) {
              existing = row
              break
            }
          }
        }

        if (existing) {
          updateById.run(
            badge.key,
            badge.label,
            badge.icon,
            badge.variant,
            badge.category,
            badge.description,
            badge.sortOrder,
            existing.id,
          )
          usedIds.add(existing.id)
        } else {
          const info = insertBadge.run(
            badge.key,
            badge.label,
            badge.icon,
            badge.variant,
            badge.category,
            badge.description,
            badge.sortOrder,
          )
          usedIds.add(Number(info.lastInsertRowid))
        }
      }
    },
  },
  {
    version: '024_add_more_appearance_badges',
    description: '외모 카테고리 뱃지 3종 추가(러블리, 일반인 미인, 빻요미)',
    up(db) {
      const cols = db.prepare('PRAGMA table_info(actor_badge_definitions)').all().map((c) => c.name)
      if (!cols.includes('category')) {
        db.exec(`ALTER TABLE actor_badge_definitions ADD COLUMN category TEXT NOT NULL DEFAULT 'appearance'`)
      }

      const badgeCatalog = [
        {
          key: 'appearance_lovely',
          label: '러블리',
          icon: '💕',
          variant: 'softpink',
          category: 'appearance',
          description: '외모뿐 아니라 미소, 표정, 말투와 행동 전반에서 사랑스럽고 밝은 매력이 강하게 느껴지는 배우',
          sortOrder: 35,
        },
        {
          key: 'appearance_girl_next_door_beauty',
          label: '일반인 미인',
          icon: '🏠',
          variant: 'softpink',
          category: 'appearance',
          description: '화려하고 전형적인 배우상보다는 현실에서 마주칠 법한 자연스럽고 친근한 인상을 지녔지만 외모가 뛰어난 배우',
          sortOrder: 75,
        },
        {
          key: 'appearance_quirky_cute',
          label: '빻요미',
          icon: '🐹',
          variant: 'softpink',
          category: 'appearance',
          description: '정석적인 미인형은 아니거나 개성적인 얼굴이지만, 볼수록 귀엽고 묘하게 끌리는 매력이 있는 배우',
          sortOrder: 85,
        },
      ]

      const selectByKey = db.prepare(`
        SELECT id
        FROM actor_badge_definitions
        WHERE badge_key = ?
        LIMIT 1
      `)
      const selectByLabel = db.prepare(`
        SELECT id
        FROM actor_badge_definitions
        WHERE label = ?
        LIMIT 1
      `)
      const updateById = db.prepare(`
        UPDATE actor_badge_definitions
        SET badge_key = ?,
            label = ?,
            icon = ?,
            variant = ?,
            category = ?,
            description = ?,
            sort_order = ?,
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      const insertBadge = db.prepare(`
        INSERT INTO actor_badge_definitions
          (badge_key, label, icon, variant, category, description, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `)

      for (const badge of badgeCatalog) {
        const existing = selectByKey.get(badge.key) || selectByLabel.get(badge.label)
        if (existing) {
          updateById.run(
            badge.key,
            badge.label,
            badge.icon,
            badge.variant,
            badge.category,
            badge.description,
            badge.sortOrder,
            existing.id,
          )
        } else {
          insertBadge.run(
            badge.key,
            badge.label,
            badge.icon,
            badge.variant,
            badge.category,
            badge.description,
            badge.sortOrder,
          )
        }
      }
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
