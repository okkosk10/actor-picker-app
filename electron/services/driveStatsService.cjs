'use strict'

/**
 * electron/services/driveStatsService.cjs
 * 드라이브별 저장소 통계 수집 및 삭제 후보 점수 계산
 *
 * - 파일 경로에서 드라이브 문자 추출 (Windows: "D:\..." → "D:")
 * - 드라이브별 영상 수 / 용량 / 평균 별점 / 추천 수 / 삭제 후보 수 집계
 * - 삭제 후보 점수: 별점 낮음 + 미사용 + 등급 + 배우 평점 + 파일 크기 + 경과 일수
 * - 실제 파일 삭제 없음 — grade='삭제요망' 또는 status='delete_candidate' 표시만
 */

const { execSync } = require('child_process')

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────

/**
 * 파일 절대 경로에서 드라이브 문자를 추출한다. (Windows 전용)
 * "D:\Videos\..." → "D:"
 * 드라이브 경로가 없으면 "기타" 반환
 */
function extractDrive(filePath) {
  if (!filePath) return '기타'
  const m = filePath.match(/^([A-Za-z]:)/i)
  return m ? m[1].toUpperCase() : '기타'
}

const GB = 1024 * 1024 * 1024

const DELETE_GRADES = new Set(['삭제요망', '삭제 요망', 'delete_candidate'])

// ─────────────────────────────────────────────────────────────
// 삭제 후보 점수 계산
// ─────────────────────────────────────────────────────────────

/**
 * 영상 row를 받아 삭제 후보 점수와 이유를 반환한다.
 * 점수가 높을수록 삭제 가치가 높다.
 *
 * @param {object} video - DB row (+ copy_count, actor_rating 포함)
 * @returns {{ score: number, reasons: string[] }}
 */
function calcDeleteScore(video) {
  let score = 0
  const reasons = []

  const rating      = Number(video.rating)      || 0
  const copyCount   = Number(video.copy_count)  || 0
  const playCount   = Number(video.play_count)  || 0
  const fileSize    = Number(video.file_size) || Number(video.size) || 0
  const actorRating = Number(video.actor_rating) || 0
  const grade       = video.grade || ''

  const daysSince = video.modified_at
    ? Math.floor((Date.now() - new Date(video.modified_at).getTime()) / 86400000)
    : 0

  // ── 별점 ──────────────────────────────────────────────────
  if (rating === 0) {
    score += 15; reasons.push('별점 없음')
  } else if (rating === 1) {
    score += 40; reasons.push('별점 1점')
  } else if (rating === 2) {
    score += 25; reasons.push('별점 낮음 (2점)')
  }

  // ── 사용 이력 ─────────────────────────────────────────────
  if (copyCount === 0 && playCount === 0) {
    score += 20; reasons.push('사용 기록 없음')
  } else if (copyCount === 0) {
    score += 8; reasons.push('복사 기록 없음')
  }

  // ── 추천 안됨 ─────────────────────────────────────────────
  if (!video.recommended) score += 5

  // ── 등급/태그 ─────────────────────────────────────────────
  if (DELETE_GRADES.has(grade)) {
    score += 30; reasons.push('삭제요망 등급')
  }

  // ── 파일 크기 (공간 절약 가치) ────────────────────────────
  if (fileSize >= 10 * GB) {
    score += 20; reasons.push('파일 크기 매우 큼 (10GB+)')
  } else if (fileSize >= 5 * GB) {
    score += 12; reasons.push('파일 크기 큼 (5GB+)')
  } else if (fileSize >= 3 * GB) {
    score += 6; reasons.push('파일 크기 보통 (3GB+)')
  }

  // ── 배우 평점 ─────────────────────────────────────────────
  if (actorRating > 0 && actorRating <= 2) {
    score += 15; reasons.push('배우 평점 낮음')
  }

  // ── 오래된 파일 ───────────────────────────────────────────
  if (daysSince > 730) {
    score += 8; reasons.push('2년 이상 된 파일')
  } else if (daysSince > 365) {
    score += 4; reasons.push('1년 이상 된 파일')
  }

  return { score, reasons }
}

// ─────────────────────────────────────────────────────────────
// OS 디스크 여유 공간 조회 (Windows PowerShell)
// ─────────────────────────────────────────────────────────────

/**
 * 드라이브 문자를 기반으로 OS 수준의 디스크 통계를 반환한다.
 * 실패 시 { freeSpace: 0, totalDiskSize: 0 } 반환 (조용히 무시)
 */
function getDiskInfo(drive) {
  try {
    const driveLetter = drive.replace(':', '')
    const cmd = `powershell -NoProfile -Command "Get-PSDrive -Name ${driveLetter} | Select-Object -ExpandProperty Free; Get-PSDrive -Name ${driveLetter} | ForEach-Object { $_.Used + $_.Free }"`
    const out = execSync(cmd, { timeout: 5000, encoding: 'utf8' }).trim().split('\n')
    return {
      freeSpace:     parseInt(out[0]) || 0,
      totalDiskSize: parseInt(out[1]) || 0,
    }
  } catch {
    return { freeSpace: 0, totalDiskSize: 0 }
  }
}

// ─────────────────────────────────────────────────────────────
// 드라이브별 통계 수집
// ─────────────────────────────────────────────────────────────

/**
 * DB의 normal 영상을 드라이브별로 집계해 통계 배열을 반환한다.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {DriveStats[]}
 *
 * @typedef {Object} DriveStats
 * @property {string} drive
 * @property {number} totalVideos
 * @property {number} totalSize
 * @property {number} averageRating
 * @property {number} recommendedCount
 * @property {number} deleteCandidateCount
 * @property {number} lowPreferenceCount
 */
function getDriveStats(db) {
  const rows = db.prepare(`
    SELECT
      v.id,
      v.file_path,
      v.rating,
      v.grade,
      v.recommended,
      v.play_count,
      v.modified_at,
      COALESCE(v.file_size, v.size, 0) AS file_size,
      COALESCE(s.copy_count, 0)        AS copy_count,
      COALESCE(ar.min_rating, 0)       AS actor_rating
    FROM videos v
    LEFT JOIN (
      SELECT video_id,
        SUM(CASE WHEN action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END) AS copy_count
      FROM video_activity_logs
      GROUP BY video_id
    ) s ON s.video_id = v.id
    LEFT JOIN (
      SELECT va.video_id, MIN(a2.rating) AS min_rating
      FROM video_actors va
      JOIN actors a2 ON a2.id = va.actor_id
      WHERE a2.rating > 0
      GROUP BY va.video_id
    ) ar ON ar.video_id = v.id
    WHERE v.status = 'normal'
  `).all()

  /** @type {Map<string, object>} */
  const driveMap = new Map()

  for (const row of rows) {
    const drive = extractDrive(row.file_path)

    if (!driveMap.has(drive)) {
      driveMap.set(drive, {
        drive,
        totalVideos:          0,
        totalSize:            0,
        ratingSum:            0,
        ratingCount:          0,
        recommendedCount:     0,
        deleteCandidateCount: 0,
        lowPreferenceCount:   0,
      })
    }

    const stat = driveMap.get(drive)
    stat.totalVideos++
    stat.totalSize += row.file_size

    if (row.rating > 0) {
      stat.ratingSum   += row.rating
      stat.ratingCount += 1
    }
    if (row.recommended) stat.recommendedCount++
    if (row.rating > 0 && row.rating <= 2) stat.lowPreferenceCount++

    const { score } = calcDeleteScore(row)
    if (score >= 35) stat.deleteCandidateCount++
  }

  return Array.from(driveMap.values())
    .map((s) => ({
      drive:                s.drive,
      totalVideos:          s.totalVideos,
      totalSize:            s.totalSize,
      averageRating:        s.ratingCount > 0
        ? Math.round((s.ratingSum / s.ratingCount) * 10) / 10
        : 0,
      recommendedCount:     s.recommendedCount,
      deleteCandidateCount: s.deleteCandidateCount,
      lowPreferenceCount:   s.lowPreferenceCount,
    }))
    .sort((a, b) => a.drive.localeCompare(b.drive))
}

// ─────────────────────────────────────────────────────────────
// 드라이브별 삭제 후보 조회
// ─────────────────────────────────────────────────────────────

/**
 * 특정 드라이브(또는 전체)의 삭제 후보 목록을 반환한다.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string|null} drive - "D:" 형태 또는 null(전체)
 * @returns {{ drive: string, freeSpace: number, totalDiskSize: number,
 *             usedByLibrary: number, candidates: DeleteCandidate[] }}
 */
function getDeleteCandidatesByDrive(db, drive) {
  // 드라이브 필터 SQL
  let driveWhere = ''
  let driveParams = []
  if (drive) {
    // UPPER(SUBSTR(file_path,1,2)) = 'D:' 방식 (SQL Injection 방지: 드라이브 문자만 허용)
    const safe = drive.replace(/[^A-Za-z:]/g, '').toUpperCase().slice(0, 2)
    driveWhere  = `AND UPPER(SUBSTR(v.file_path, 1, 2)) = ?`
    driveParams = [safe]
  }

  const rows = db.prepare(`
    SELECT
      v.id,
      v.file_name,
      v.file_path,
      v.actor_name,
      v.tags,
      v.rating,
      v.grade,
      v.recommended,
      v.play_count,
      v.modified_at,
      COALESCE(v.file_size, v.size, 0) AS file_size,
      COALESCE(s.copy_count, 0)        AS copy_count
    FROM videos v
    LEFT JOIN (
      SELECT video_id,
        SUM(CASE WHEN action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END) AS copy_count
      FROM video_activity_logs
      GROUP BY video_id
    ) s ON s.video_id = v.id
    WHERE v.status = 'normal'
      ${driveWhere}
  `).all(...driveParams)

  if (rows.length === 0) {
    const diskInfo = drive ? getDiskInfo(drive) : { freeSpace: 0, totalDiskSize: 0 }
    return { drive: drive || 'all', ...diskInfo, usedByLibrary: 0, candidates: [] }
  }

  // 배우 정보 JOIN (별도 쿼리)
  const videoIds = rows.map((r) => r.id)
  const idPH     = videoIds.map(() => '?').join(',')
  const actorRows = db.prepare(`
    SELECT va.video_id, a.name, a.rating AS actor_rating
    FROM video_actors va
    JOIN actors a ON a.id = va.actor_id
    WHERE va.video_id IN (${idPH})
    ORDER BY va.order_index ASC
  `).all(...videoIds)

  /** @type {Map<number, Array<{name:string, rating:number}>>} */
  const actorMap = new Map()
  for (const ar of actorRows) {
    if (!actorMap.has(ar.video_id)) actorMap.set(ar.video_id, [])
    actorMap.get(ar.video_id).push({ name: ar.name, rating: ar.actor_rating || 0 })
  }

  // 점수 계산
  const scored = rows.map((row) => {
    const actors      = actorMap.get(row.id) ?? []
    const actorRating = actors.length > 0
      ? Math.min(...actors.filter((a) => a.rating > 0).map((a) => a.rating), 99)
      : 0
    const { score, reasons } = calcDeleteScore({ ...row, actor_rating: actorRating === 99 ? 0 : actorRating })

    return {
      id:          row.id,
      filename:    row.file_name,
      file_path:   row.file_path,
      file_size:   row.file_size,
      rating:      row.rating,
      actorNames:  actors.map((a) => a.name),
      tags:        (row.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      copy_count:  row.copy_count,
      watch_count: row.play_count || 0,
      deleteScore: score,
      reason:      reasons,
    }
  })

  // 점수 25 이상만 반환, 내림차순 정렬, 최대 150개
  const candidates = scored
    .filter((v) => v.deleteScore >= 25)
    .sort((a, b) => b.deleteScore - a.deleteScore)
    .slice(0, 150)

  const usedByLibrary = rows.reduce((s, r) => s + r.file_size, 0)
  const diskInfo      = drive ? getDiskInfo(drive) : { freeSpace: 0, totalDiskSize: 0 }

  return {
    drive:         drive || 'all',
    freeSpace:     diskInfo.freeSpace,
    totalDiskSize: diskInfo.totalDiskSize,
    usedByLibrary,
    candidates,
  }
}

module.exports = { getDriveStats, getDeleteCandidatesByDrive, extractDrive, calcDeleteScore }
