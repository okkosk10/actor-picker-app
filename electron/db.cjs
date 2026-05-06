'use strict'

/**
 * electron/db.cjs
 * SQLite 데이터베이스 연결 및 스키마 초기화 모듈
 *
 * - better-sqlite3 를 사용 (동기 API, IPC 핸들러 내부에서 안전하게 사용 가능)
 * - app.getPath('userData') 경로에 videos.db 저장
 * - 싱글톤 패턴으로 DB 인스턴스 관리
 */

const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')

/** 싱글톤 DB 인스턴스 (최초 getDb() 호출 시 초기화) */
let db = null

/**
 * DB 인스턴스를 반환한다.
 * 최초 호출 시 userData 경로에 videos.db 파일을 생성하고 스키마를 초기화한다.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'videos.db')
    db = new Database(dbPath)
    // WAL(Write-Ahead Logging) 모드: 읽기/쓰기 동시성 향상
    db.pragma('journal_mode = WAL')
    initSchema()
  }
  return db
}

/**
 * 테이블 및 인덱스를 초기화한다.
 * CREATE TABLE IF NOT EXISTS 이므로 이미 존재하면 아무 작업도 하지 않는다.
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,

      -- 파일 시스템 정보 (스캔 시 자동 갱신)
      file_name   TEXT    NOT NULL,
      file_path   TEXT    NOT NULL UNIQUE,
      folder_path TEXT    NOT NULL,
      extension   TEXT,
      size        INTEGER,
      modified_at TEXT,

      -- 파일명에서 파싱한 정보
      code        TEXT,
      actor_name  TEXT,

      -- 사용자가 직접 입력하는 정보 (스캔 시 보존)
      memo        TEXT    DEFAULT '',
      tags        TEXT    DEFAULT '',
      rating      INTEGER DEFAULT 0,
      -- status: 시스템 관리용 (normal / hidden / missing)
      status      TEXT    DEFAULT 'normal',
      recommended INTEGER DEFAULT 0,
      -- grade: 사용자 평가 등급 (영구소장/재시청 추천/만족/보관/애매/삭제요망)
      grade       TEXT    DEFAULT '보관',

      created_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT    DEFAULT CURRENT_TIMESTAMP
    );

    -- 검색 성능을 위한 인덱스
    CREATE INDEX IF NOT EXISTS idx_videos_actor       ON videos (actor_name);
    CREATE INDEX IF NOT EXISTS idx_videos_code        ON videos (code);
    CREATE INDEX IF NOT EXISTS idx_videos_status      ON videos (status);
    CREATE INDEX IF NOT EXISTS idx_videos_recommended ON videos (recommended);
    CREATE INDEX IF NOT EXISTS idx_videos_rating      ON videos (rating);
    CREATE INDEX IF NOT EXISTS idx_videos_grade       ON videos (grade);
  `)

  // ── 기존 DB 마이그레이션: 새 컬럼 추가 ────────────────────────
  // better-sqlite3 는 ALTER TABLE ... IF NOT EXISTS 미지원이므로
  // PRAGMA table_info 로 컬럼 존재 여부를 먼저 확인한다.
  migrateSchema()
}

/**
 * 스키마 마이그레이션: 기존 DB에 없는 컬럼을 안전하게 추가한다.
 */
function migrateSchema() {
  const cols = db.prepare('PRAGMA table_info(videos)').all().map((c) => c.name)

  // recommended 컬럼 마이그레이션
  if (!cols.includes('recommended')) {
    db.exec('ALTER TABLE videos ADD COLUMN recommended INTEGER DEFAULT 0')
    db.exec('CREATE INDEX IF NOT EXISTS idx_videos_recommended ON videos (recommended)')
  }

  // grade 컬럼 마이그레이션
  if (!cols.includes('grade')) {
    db.exec("ALTER TABLE videos ADD COLUMN grade TEXT DEFAULT '보관'")
    db.exec('CREATE INDEX IF NOT EXISTS idx_videos_grade ON videos (grade)')
  }
}

/**
 * DB 연결을 닫는다. (앱 종료 시 호출)
 */
function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}

module.exports = { getDb, closeDb }
