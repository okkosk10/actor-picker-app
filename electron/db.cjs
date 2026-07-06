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
const { runMigrations } = require('./migrations.cjs')

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
      subtitle_paths TEXT DEFAULT '[]',
      subtitle_exts  TEXT DEFAULT '',
      subtitle_count INTEGER DEFAULT 0,
      subtitle_size  INTEGER DEFAULT 0,
      subtitle_files TEXT DEFAULT '[]',
      subtitle_added_at TEXT,

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
    CREATE INDEX IF NOT EXISTS idx_videos_folder      ON videos (folder_path);

    -- 사용자가 스캔한 루트 폴더 목록 (폴더 패널용)
    CREATE TABLE IF NOT EXISTS scanned_roots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      root_path  TEXT    NOT NULL UNIQUE,
      scanned_at TEXT    DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // ── 기존 DB 마이그레이션: 새 컬럼 추가 ────────────────────────
  // better-sqlite3 는 ALTER TABLE ... IF NOT EXISTS 미지원이므로
  // PRAGMA table_info 로 컬럼 존재 여부를 먼저 확인한다.
  migrateSchema()

  // ── 버전 기반 마이그레이션 실행 ──────────────────────────────
  runMigrations(db)
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

  // is_new 컬럼 마이그레이션
  // is_new = 1 : 새로 추가되었고 아직 사용자가 작업하지 않은 파일 (NEW 대기함)
  // is_new = 0 : 사용자가 등급/추천/별점/태그/메모 중 하나 이상 작업한 파일
  if (!cols.includes('is_new')) {
    db.exec('ALTER TABLE videos ADD COLUMN is_new INTEGER DEFAULT 0')
    db.exec('CREATE INDEX IF NOT EXISTS idx_videos_is_new ON videos (is_new)')
  }

  const subtitleColumns = [
    ['subtitle_paths', "TEXT DEFAULT '[]'"],
    ['subtitle_exts', "TEXT DEFAULT ''"],
    ['subtitle_count', 'INTEGER DEFAULT 0'],
    ['subtitle_size', 'INTEGER DEFAULT 0'],
    ['subtitle_files', "TEXT DEFAULT '[]'"],
    ['subtitle_added_at', 'TEXT'],
  ]
  for (const [name, def] of subtitleColumns) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE videos ADD COLUMN ${name} ${def}`)
    }
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

// ── 활동 로그 ────────────────────────────────────────────────────

/**
 * 영상 활동을 video_activity_logs에 기록하고,
 * actionType에 따라 videos 테이블의 통계 컬럼도 함께 갱신한다.
 *
 * @param {number} videoId     - videos.id
 * @param {string} actionType  - 'open' | 'copy_to_clipboard' | 'copy_to_device' | 기타
 * @param {object|null} meta   - 추가 메타데이터 (JSON 직렬화 후 meta_json에 저장)
 */
function recordVideoActivity(videoId, actionType, meta = null) {
  if (!videoId || typeof videoId !== 'number') {
    console.warn('[recordVideoActivity] 유효하지 않은 videoId:', videoId)
    return
  }
  if (!actionType || typeof actionType !== 'string') {
    console.warn('[recordVideoActivity] 유효하지 않은 actionType:', actionType)
    return
  }

  const database = getDb()

  // 영상 존재 여부 확인
  const exists = database.prepare('SELECT id FROM videos WHERE id = ?').get(videoId)
  if (!exists) {
    console.warn('[recordVideoActivity] 존재하지 않는 videoId:', videoId)
    return
  }

  const metaJson = meta != null ? JSON.stringify(meta) : null

  const run = database.transaction(() => {
    // 1. 활동 로그 INSERT
    database
      .prepare(`
        INSERT INTO video_activity_logs (video_id, action_type, meta_json)
        VALUES (?, ?, ?)
      `)
      .run(videoId, actionType, metaJson)

    // 2. actionType에 따라 videos 통계 컬럼 갱신
    if (actionType === 'open') {
      database
        .prepare(`
          UPDATE videos
          SET play_count     = play_count + 1,
              last_played_at = CURRENT_TIMESTAMP,
              is_new         = 0
          WHERE id = ?
        `)
        .run(videoId)
    } else if (actionType === 'copy_to_clipboard' || actionType === 'copy_to_device') {
      database
        .prepare(`
          UPDATE videos
          SET play_count          = play_count + 1,
              last_requested_at   = CURRENT_TIMESTAMP,
              is_new              = 0
          WHERE id = ?
        `)
        .run(videoId)
    }
  })

  try {
    run()
  } catch (err) {
    console.error('[recordVideoActivity] 활동 기록 실패 — rollback 완료')
    console.error(err)
  }
}

// ── 대시보드 통계 ────────────────────────────────────────────────

/**
 * 대시보드 화면에 필요한 통계 데이터를 한 번에 조회해 반환한다.
 *
 * @returns {{
 *   summary:           object,
 *   topActors:         object[],
 *   recentVideos:      object[],
 *   recentActivities:  object[],
 *   ratingDistribution: object[],
 *   tagStats:          object[],
 * }}
 */
function getDashboardStats() {
  const database = getDb()
  console.time('[getDashboardStats] total')

  // ── 1. summary ──────────────────────────────────────────────
  console.time('[getDashboardStats] summary')
  const summaryRow = database.prepare(`
    SELECT
      COUNT(*)                                       AS totalVideos,
      COALESCE(SUM(size), 0)                         AS totalSize,
      ROUND(AVG(CASE WHEN rating > 0 THEN rating END), 2) AS averageRating,
      SUM(CASE WHEN is_new    = 1 THEN 1 ELSE 0 END) AS newCount,
      SUM(CASE WHEN favorite  = 1 THEN 1 ELSE 0 END) AS favoriteCount,
      SUM(CASE WHEN play_count > 0 THEN 1 ELSE 0 END) AS watchedCount
    FROM videos
    WHERE status != 'missing'
  `).get()

  const actorCountRow = database.prepare(`
    SELECT COUNT(*) AS totalActors FROM actors WHERE is_archived = 0
  `).get()

  // 활동 로그 집계 (복사/재생 총 횟수)
  let openTotal = 0, copyClipTotal = 0, copyDeviceTotal = 0
  try {
    const actSummary = database.prepare(`
      SELECT
        SUM(CASE WHEN action_type = 'open'              THEN 1 ELSE 0 END) AS open_total,
        SUM(CASE WHEN action_type = 'copy_to_clipboard' THEN 1 ELSE 0 END) AS copy_clip_total,
        SUM(CASE WHEN action_type = 'copy_to_device'    THEN 1 ELSE 0 END) AS copy_device_total
      FROM video_activity_logs
    `).get()
    openTotal      = actSummary.open_total       ?? 0
    copyClipTotal  = actSummary.copy_clip_total  ?? 0
    copyDeviceTotal= actSummary.copy_device_total ?? 0
  } catch { /* 로그 테이블 없는 구버전 */ }

  const summary = {
    totalVideos:    summaryRow.totalVideos   ?? 0,
    totalActors:    actorCountRow.totalActors ?? 0,
    totalSize:      summaryRow.totalSize     ?? 0,
    averageRating:  summaryRow.averageRating ?? 0,
    newCount:       summaryRow.newCount      ?? 0,
    favoriteCount:  summaryRow.favoriteCount ?? 0,
    watchedCount:   summaryRow.watchedCount  ?? 0,
    openTotal,
    copyClipTotal,
    copyDeviceTotal,
  }
  console.timeEnd('[getDashboardStats] summary')

  // ── 2. topActors (play_count 합계 기준 상위 20명) ────────────
  console.time('[getDashboardStats] topActors')
  const topActors = database.prepare(`
    SELECT
      a.id                                        AS actorId,
      a.name                                      AS actorName,
      a.rating                                    AS actorRating,
      COUNT(va.video_id)                          AS videoCount,
      SUM(CASE WHEN va.is_main = 1 THEN 1 ELSE 0 END) AS mainVideoCount,
      ROUND(AVG(CASE WHEN v.rating > 0 THEN v.rating END), 2) AS averageRating,
      COALESCE(SUM(v.play_count), 0)              AS playCount
    FROM actors a
    LEFT JOIN video_actors va ON va.actor_id = a.id
    LEFT JOIN videos        v  ON v.id = va.video_id AND v.status != 'missing'
    WHERE a.is_archived = 0
    GROUP BY a.id
    ORDER BY playCount DESC, videoCount DESC
    LIMIT 20
  `).all().map((r) => ({
    actorId:       r.actorId,
    actorName:     r.actorName,
    actorRating:   r.actorRating   ?? 0,
    videoCount:    r.videoCount    ?? 0,
    mainVideoCount: r.mainVideoCount ?? 0,
    averageRating: r.averageRating  ?? 0,
    playCount:     r.playCount      ?? 0,
  }))
  console.timeEnd('[getDashboardStats] topActors')

  // ── 2b. topCopyActors (복사 횟수 기준 상위 10명) ─────────────
  console.time('[getDashboardStats] topCopyActors')
  let topCopyActors = []
  try {
    topCopyActors = database.prepare(`
      SELECT
        a.id   AS actorId,
        a.name AS actorName,
        a.rating AS actorRating,
        COUNT(DISTINCT va.video_id) AS videoCount,
        COALESCE(SUM(CASE WHEN val.action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END), 0) AS copyCount,
        COALESCE(SUM(CASE WHEN val.action_type = 'open' THEN 1 ELSE 0 END), 0) AS openCount
      FROM actors a
      LEFT JOIN video_actors va ON va.actor_id = a.id
      LEFT JOIN video_activity_logs val ON val.video_id = va.video_id
      WHERE a.is_archived = 0
      GROUP BY a.id
      HAVING copyCount > 0
      ORDER BY copyCount DESC
      LIMIT 10
    `).all().map((r) => ({
      actorId:    r.actorId,
      actorName:  r.actorName,
      actorRating: r.actorRating ?? 0,
      videoCount: r.videoCount  ?? 0,
      copyCount:  r.copyCount   ?? 0,
      openCount:  r.openCount   ?? 0,
    }))
  } catch { /* 로그 테이블 없는 구버전 */ }
  console.timeEnd('[getDashboardStats] topCopyActors')

  // ── 2c. actorRatingDistribution ──────────────────────────────
  console.time('[getDashboardStats] actorRatingDist')
  const actorRatingDistribution = database.prepare(`
    SELECT rating, COUNT(*) AS count
    FROM actors WHERE is_archived = 0
    GROUP BY rating ORDER BY rating ASC
  `).all().map((r) => ({ rating: r.rating ?? 0, count: r.count }))

  console.timeEnd('[getDashboardStats] actorRatingDist')

  // ── 3. recentVideos (최근 추가/수정 10개) ───────────────────
  console.time('[getDashboardStats] recentVideos')
  const recentVideos = database.prepare(`
    SELECT id, file_name, actor_name, code, rating, grade, play_count,
           last_played_at, created_at, updated_at
    FROM videos
    WHERE status != 'missing'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 10
  `).all()
  console.timeEnd('[getDashboardStats] recentVideos')

  // ── 4. recentActivities (최근 활동 로그 20개) ───────────────
  // video_activity_logs 테이블이 없는 구버전 DB를 위해 안전하게 처리
  console.time('[getDashboardStats] recentActivities')
  let recentActivities = []
  try {
    recentActivities = database.prepare(`
      SELECT
        al.id,
        al.video_id,
        al.action_type,
        al.created_at,
        al.meta_json,
        v.file_name,
        v.actor_name,
        v.code
      FROM video_activity_logs al
      LEFT JOIN videos v ON v.id = al.video_id
      ORDER BY al.created_at DESC
      LIMIT 20
    `).all().map((r) => ({
      id:         r.id,
      videoId:    r.video_id,
      actionType: r.action_type,
      createdAt:  r.created_at,
      meta:       r.meta_json ? (() => { try { return JSON.parse(r.meta_json) } catch { return null } })() : null,
      fileName:   r.file_name   ?? null,
      actorName:  r.actor_name  ?? null,
      code:       r.code        ?? null,
    }))
  } catch {
    // video_activity_logs 미존재 시 빈 배열 반환
  }
  console.timeEnd('[getDashboardStats] recentActivities')

  // ── 5. ratingDistribution ───────────────────────────────────
  console.time('[getDashboardStats] ratingDistribution')
  const ratingDistribution = database.prepare(`
    SELECT rating, COUNT(*) AS count
    FROM videos
    WHERE status != 'missing'
    GROUP BY rating
    ORDER BY rating ASC
  `).all().map((r) => ({ rating: r.rating ?? 0, count: r.count }))
  console.timeEnd('[getDashboardStats] ratingDistribution')

  // ── 6. tagStats (JS에서 쉼표 분리 후 집계) ──────────────────
  console.time('[getDashboardStats] tagStats')
  const tagRows = database.prepare(`
    SELECT tags FROM videos
    WHERE status != 'missing' AND tags IS NOT NULL AND trim(tags) != ''
  `).all()

  const tagMap = {}
  for (const row of tagRows) {
    const parts = row.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
    for (const tag of parts) {
      tagMap[tag] = (tagMap[tag] ?? 0) + 1
    }
  }
  const tagStats = Object.entries(tagMap)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
  console.timeEnd('[getDashboardStats] tagStats')

  // ── 7. actorTagStats (배우 태그별 배우 수) ──────────────────
  console.time('[getDashboardStats] actorTagStats')
  const actorTagRows = database.prepare(`
    SELECT tags FROM actors WHERE is_archived = 0 AND tags IS NOT NULL AND trim(tags) != ''
  `).all()
  const actorTagMap = {}
  for (const row of actorTagRows) {
    const parts = row.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
    for (const tag of parts) {
      actorTagMap[tag] = (actorTagMap[tag] ?? 0) + 1
    }
  }
  const actorTagStats = Object.entries(actorTagMap)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
  console.timeEnd('[getDashboardStats] actorTagStats')

  console.timeEnd('[getDashboardStats] total')
  return {
    summary,
    topActors,
    topCopyActors,
    actorRatingDistribution,
    recentVideos,
    recentActivities,
    ratingDistribution,
    tagStats,
    actorTagStats,
  }
}

module.exports = { getDb, closeDb, recordVideoActivity, getDashboardStats }
