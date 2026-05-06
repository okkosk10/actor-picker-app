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
      status      TEXT    DEFAULT 'normal',

      created_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT    DEFAULT CURRENT_TIMESTAMP
    );

    -- 검색 성능을 위한 인덱스
    CREATE INDEX IF NOT EXISTS idx_videos_actor ON videos (actor_name);
    CREATE INDEX IF NOT EXISTS idx_videos_code  ON videos (code);
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos (status);
  `)
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
