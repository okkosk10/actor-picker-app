'use strict'

const path = require('path')
const { getDriveStats, getDeleteCandidatesByDrive, calcDeleteScore, extractDrive } = require('../driveStatsService.cjs')
const { calcScores } = require('../themeCandidateService.cjs')

function buildActorSearchRows(db, plan) {
  const args = plan.arguments || {}
  const whereClauses = ['a.is_archived = 0']
  const params = []

  if (args.metadataMissing) {
    whereClauses.push("(COALESCE(a.tags, '') = '' OR COALESCE(a.memo, '') = '' OR COALESCE(a.agency, '') = '' OR COALESCE(a.rating, 0) = 0)")
  }

  if (args.query) {
    whereClauses.push('(a.name LIKE ? OR a.agency LIKE ? OR a.tags LIKE ? OR a.memo LIKE ?)')
    params.push(`%${args.query}%`, `%${args.query}%`, `%${args.query}%`, `%${args.query}%`)
  }

  if (args.agency) {
    whereClauses.push('a.agency LIKE ?')
    params.push(`%${args.agency}%`)
  }

  if (Number(args.minRating) > 0) {
    whereClauses.push('a.rating >= ?')
    params.push(Number(args.minRating))
  }

  if (Array.isArray(args.baseResultIds) && args.baseResultIds.length > 0) {
    const placeholders = args.baseResultIds.map(() => '?').join(',')
    whereClauses.push(`a.id IN (SELECT DISTINCT va.actor_id FROM video_actors va WHERE va.video_id IN (${placeholders}))`)
    params.push(...args.baseResultIds)
  }

  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100)

  return db.prepare(`
    SELECT
      a.id,
      a.name,
      a.rating,
      a.agency,
      a.tags,
      a.memo,
      a.tier,
      COUNT(DISTINCT va.video_id) AS video_count
    FROM actors a
    LEFT JOIN video_actors va ON va.actor_id = a.id
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY a.id
    ORDER BY a.rating DESC, video_count DESC, a.name ASC
    LIMIT ${limit}
  `).all(...params)
}

function enrichVideosFromDb(db, items) {
  const ids = items.map((item) => Number(item?.video?.id)).filter((value) => Number.isInteger(value))
  if (ids.length === 0) return items

  const rows = db.prepare(`
    SELECT
      id,
      file_path,
      folder_path,
      file_name,
      COALESCE(file_size, size, 0) AS file_size,
      play_count,
      rating,
      grade,
      recommended,
      is_new,
      favorite,
      code,
      actor_name,
      tags,
      subtitle_count
    FROM videos
    WHERE id IN (${ids.map(() => '?').join(',')})
  `).all(...ids)

  const rowMap = new Map(rows.map((row) => [Number(row.id), row]))
  return items.map((item) => {
    const row = rowMap.get(Number(item?.video?.id))
    if (!row) return item
    return {
      ...item,
      video: {
        ...item.video,
        file_path: row.file_path,
        folder_path: row.folder_path,
        file_name: row.file_name,
        file_size: row.file_size,
        play_count: row.play_count,
        rating: row.rating,
        grade: row.grade,
        recommended: row.recommended,
        is_new: row.is_new,
        favorite: row.favorite,
        code: row.code,
        actor_name: row.actor_name,
        tags: row.tags,
        subtitle_count: row.subtitle_count,
        folder_name: row.folder_path ? path.basename(row.folder_path) : '',
      },
    }
  })
}

function buildDeleteCandidateRows(db, plan) {
  const args = plan.arguments || {}
  const result = getDeleteCandidatesByDrive(db, args.drive || null)
  let candidates = Array.isArray(result.candidates) ? result.candidates.slice() : []

  if (Array.isArray(args.baseResultIds) && args.baseResultIds.length > 0) {
    const baseSet = new Set(args.baseResultIds.map((value) => Number(value)).filter((value) => Number.isInteger(value)))
    candidates = candidates.filter((candidate) => baseSet.has(Number(candidate.id)))
  }

  if (args.lowRating) {
    candidates = candidates.filter((candidate) => Number(candidate.rating) <= 2)
  }

  if (args.lowPlayCount) {
    candidates = candidates.filter((candidate) => Number(candidate.watch_count) <= 1)
  }

  if (args.onlyNotCopied) {
    candidates = candidates.filter((candidate) => Number(candidate.copy_count) === 0)
  }

  if (Number(args.minSizeBytes) > 0) {
    candidates = candidates.filter((candidate) => Number(candidate.file_size) >= Number(args.minSizeBytes))
  }

  candidates = candidates.sort((left, right) => {
    if (args.sortBy === 'size') return (Number(right.file_size) || 0) - (Number(left.file_size) || 0)
    if (args.sortBy === 'rating') return (Number(left.rating) || 0) - (Number(right.rating) || 0)
    if (args.sortBy === 'playCount') return (Number(left.watch_count) || 0) - (Number(right.watch_count) || 0)
    return (Number(right.deleteScore) || 0) - (Number(left.deleteScore) || 0)
  })

  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
  return {
    ...result,
    candidates: candidates.slice(0, limit),
  }
}

function normalizeWindowsPath(value) {
  if (typeof value !== 'string') return null
  let normalized = value.trim()
  if (!normalized) return null
  normalized = normalized.replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/\\+$/, '')
  if (/^[a-z]:/i.test(normalized)) {
    normalized = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
  }
  if (!normalized || normalized.length > 500) return null
  return normalized
}

function escapeSqlLike(value) {
  return String(value || '')
    .replace(/!/g, '!!')
    .replace(/%/g, '!%')
    .replace(/_/g, '!_')
}

function toUniquePositiveIds(value, maxItems = 500) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    const parsed = Number(item)
    if (!Number.isInteger(parsed) || parsed <= 0 || seen.has(parsed)) continue
    seen.add(parsed)
    result.push(parsed)
    if (result.length >= maxItems) break
  }
  return result
}

function applyVideoScope(whereClauses, params, args = {}) {
  const scope = String(args.scope || 'all')
  const drive = typeof args.drive === 'string' ? args.drive.trim().toUpperCase() : null
  const folder = normalizeWindowsPath(args.folder)
  const baseResultIds = toUniquePositiveIds(args.baseResultIds, 500)

  if (scope === 'current_drive' && drive) {
    whereClauses.push('UPPER(SUBSTR(v.file_path, 1, 2)) = ?')
    params.push(drive.slice(0, 2))
  }

  if (scope === 'current_folder' && folder) {
    const escapedFolder = escapeSqlLike(folder)
    const winPrefix = `${escapedFolder}\\%`
    const unixPrefix = `${escapedFolder}/%`
    whereClauses.push(`(
      REPLACE(COALESCE(v.folder_path, ''), '/', '\\') = ?
      OR REPLACE(COALESCE(v.folder_path, ''), '/', '\\') LIKE ? ESCAPE '!'
      OR REPLACE(COALESCE(v.folder_path, ''), '/', '\\') LIKE ? ESCAPE '!'
      OR REPLACE(COALESCE(v.file_path, ''), '/', '\\') LIKE ? ESCAPE '!'
      OR REPLACE(COALESCE(v.file_path, ''), '/', '\\') LIKE ? ESCAPE '!'
    )`)
    params.push(folder, winPrefix, unixPrefix, winPrefix, unixPrefix)
  }

  if (scope === 'selected_videos') {
    if (baseResultIds.length === 0) {
      whereClauses.push('1 = 0')
    } else {
      const placeholders = baseResultIds.map(() => '?').join(',')
      whereClauses.push(`v.id IN (${placeholders})`)
      params.push(...baseResultIds)
    }
  }

  return {
    scope,
    drive: scope === 'current_drive' ? drive : null,
    folder: scope === 'current_folder' ? folder : null,
    baseResultIds: scope === 'selected_videos' ? baseResultIds : [],
  }
}

function buildVideoSearchRows(db, args = {}) {
  const whereClauses = [
    "v.status = 'normal'",
    "v.status != 'duplicate'",
  ]
  const params = []
  const appliedScope = applyVideoScope(whereClauses, params, args)
  const query = String(args.query || '').trim()
  const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500)
  const fetchLimit = args.sortBy === 'themeScore'
    ? Math.min(Math.max(limit * 5, 200), 1000)
    : limit

  if (query) {
    const escaped = `%${escapeSqlLike(query)}%`
    whereClauses.push('(v.file_name LIKE ? ESCAPE \"!\" OR v.code LIKE ? ESCAPE \"!\" OR v.actor_name LIKE ? ESCAPE \"!\" OR v.memo LIKE ? ESCAPE \"!\" OR v.tags LIKE ? ESCAPE \"!\")')
    params.push(escaped, escaped, escaped, escaped, escaped)
  }

  if (Number(args.minRating) > 0) {
    whereClauses.push('COALESCE(v.rating, 0) >= ?')
    params.push(Number(args.minRating))
  }

  if (args.onlyNew) {
    whereClauses.push('COALESCE(v.is_new, 0) = 1')
  }

  if (args.onlyFavorite) {
    whereClauses.push('COALESCE(v.favorite, 0) = 1')
  }

  if (args.onlyNotCopied) {
    whereClauses.push('COALESCE(s.copy_count, 0) = 0')
  }

  const orderClause = args.sortBy === 'rating'
    ? 'COALESCE(v.rating, 0) DESC, v.updated_at DESC, v.created_at DESC'
    : args.sortBy === 'recent'
      ? 'COALESCE(v.created_at, v.updated_at) DESC, v.updated_at DESC'
      : 'v.updated_at DESC, v.created_at DESC'

  const rows = db.prepare(`
    SELECT
      v.id,
      v.file_path,
      v.folder_path,
      v.file_name,
      COALESCE(v.file_size, v.size, 0) AS file_size,
      COALESCE(v.rating, 0) AS rating,
      COALESCE(v.play_count, 0) AS play_count,
      COALESCE(v.actor_name, '') AS actor_name,
      COALESCE(v.code, '') AS code,
      COALESCE(v.grade, '') AS grade,
      COALESCE(v.recommended, 0) AS recommended,
      COALESCE(v.favorite, 0) AS favorite,
      COALESCE(v.is_new, 0) AS is_new,
      COALESCE(v.tags, '') AS tags,
      COALESCE(s.copy_count, 0) AS copy_count,
      COALESCE(v.subtitle_count, 0) AS subtitle_count,
      v.created_at,
      v.updated_at
    FROM videos v
    LEFT JOIN (
      SELECT
        video_id,
        SUM(CASE WHEN action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END) AS copy_count
      FROM video_activity_logs
      GROUP BY video_id
    ) s ON s.video_id = v.id
    WHERE ${whereClauses.join(' AND ')}
      AND NOT EXISTS (
        SELECT 1
        FROM scanned_roots sr
        WHERE COALESCE(sr.is_active, 1) = 0
          AND (
            REPLACE(COALESCE(v.folder_path, ''), '/', '\\') = REPLACE(sr.root_path, '/', '\\')
            OR REPLACE(COALESCE(v.folder_path, ''), '/', '\\') LIKE REPLACE(sr.root_path, '/', '\\') || '\\%'
            OR REPLACE(COALESCE(v.folder_path, ''), '/', '\\') LIKE REPLACE(sr.root_path, '/', '\\') || '/%'
            OR REPLACE(COALESCE(v.file_path, ''), '/', '\\') LIKE REPLACE(sr.root_path, '/', '\\') || '\\%'
            OR REPLACE(COALESCE(v.file_path, ''), '/', '\\') LIKE REPLACE(sr.root_path, '/', '\\') || '/%'
          )
      )
    ORDER BY ${orderClause}
    LIMIT ${fetchLimit}
  `).all(...params)

  const scoredRows = rows.map((row) => {
    const tags = String(row.tags || '').split(',').map((value) => value.trim()).filter(Boolean)
    const scores = calcScores({
      rating: row.rating,
      playCount: row.play_count,
      copyCount: row.copy_count,
      favorite: Boolean(row.favorite),
      recommended: Boolean(row.recommended),
      grade: row.grade,
      tags,
      actors: row.actor_name,
      folderName: row.folder_path ? path.basename(row.folder_path) : '',
    })

    return {
      ...row,
      themeScore: scores.themeScore,
    }
  })

  if (args.sortBy === 'themeScore') {
    scoredRows.sort((left, right) => right.themeScore - left.themeScore || right.rating - left.rating || String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
  }

  return {
    rows: scoredRows.slice(0, limit),
    appliedFilters: {
      ...appliedScope,
      minRating: Number(args.minRating) || 0,
      onlyNotCopied: Boolean(args.onlyNotCopied),
      onlyNew: Boolean(args.onlyNew),
      onlyFavorite: Boolean(args.onlyFavorite),
      sortBy: args.sortBy || 'themeScore',
      query,
    },
  }
}

function buildSubtitleSummaryRows(db, args = {}) {
  const whereClauses = [
    "v.status = 'normal'",
    "v.status != 'duplicate'",
    'COALESCE(v.subtitle_count, 0) = 0',
  ]
  const params = []
  const scope = String(args.scope || 'all')
  const drive = typeof args.drive === 'string' ? args.drive.trim().toUpperCase() : null
  const folder = normalizeWindowsPath(args.folder)
  const baseResultIds = toUniquePositiveIds(args.baseResultIds, 500)

  if (scope === 'current_drive' && drive) {
    whereClauses.push('UPPER(SUBSTR(v.file_path, 1, 2)) = ?')
    params.push(drive.slice(0, 2))
  }

  if (scope === 'current_folder' && folder) {
    const escapedFolder = escapeSqlLike(folder)
    const winPrefix = `${escapedFolder}\\%`
    const unixPrefix = `${escapedFolder}/%`
    whereClauses.push(`(
      REPLACE(COALESCE(v.folder_path, ''), '/', '\\') = ?
      OR REPLACE(COALESCE(v.folder_path, ''), '/', '\\') LIKE ? ESCAPE '!'
      OR REPLACE(COALESCE(v.folder_path, ''), '/', '\\') LIKE ? ESCAPE '!'
      OR REPLACE(v.file_path, '/', '\\') LIKE ? ESCAPE '!'
      OR REPLACE(v.file_path, '/', '\\') LIKE ? ESCAPE '!'
    )`)
    params.push(folder, winPrefix, unixPrefix, winPrefix, unixPrefix)
  }

  if (scope === 'selected_videos') {
    if (baseResultIds.length === 0) {
      whereClauses.push('1 = 0')
    } else {
      const placeholders = baseResultIds.map(() => '?').join(',')
      whereClauses.push(`v.id IN (${placeholders})`)
      params.push(...baseResultIds)
    }
  }

  const rows = db.prepare(`
    SELECT
      v.id,
      v.file_path,
      v.folder_path,
      v.file_name,
      COALESCE(v.file_size, v.size, 0) AS file_size,
      COALESCE(v.rating, 0) AS rating,
      COALESCE(v.play_count, 0) AS play_count,
      COALESCE(v.actor_name, '') AS actor_name,
      COALESCE(v.code, '') AS code,
      COALESCE(v.grade, '') AS grade,
      COALESCE(v.recommended, 0) AS recommended,
      COALESCE(v.is_new, 0) AS is_new,
      COALESCE(v.tags, '') AS tags,
      COALESCE(s.copy_count, 0) AS copy_count,
      COALESCE(v.subtitle_count, 0) AS subtitle_count
    FROM videos v
    LEFT JOIN (
      SELECT
        video_id,
        SUM(CASE WHEN action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END) AS copy_count
      FROM video_activity_logs
      GROUP BY video_id
    ) s ON s.video_id = v.id
    WHERE ${whereClauses.join(' AND ')}
      AND NOT EXISTS (
        SELECT 1
        FROM scanned_roots sr
        WHERE COALESCE(sr.is_active, 1) = 0
          AND (
            REPLACE(COALESCE(v.folder_path, ''), '/', '\\') = REPLACE(sr.root_path, '/', '\\')
            OR REPLACE(COALESCE(v.folder_path, ''), '/', '\\') LIKE REPLACE(sr.root_path, '/', '\\') || '\\%'
            OR REPLACE(COALESCE(v.folder_path, ''), '/', '\\') LIKE REPLACE(sr.root_path, '/', '\\') || '/%'
            OR REPLACE(COALESCE(v.file_path, ''), '/', '\\') LIKE REPLACE(sr.root_path, '/', '\\') || '\\%'
            OR REPLACE(COALESCE(v.file_path, ''), '/', '\\') LIKE REPLACE(sr.root_path, '/', '\\') || '/%'
          )
      )
    ORDER BY v.updated_at DESC, v.created_at DESC
  `).all(...params)

  return {
    rows,
    appliedFilters: {
      scope,
      drive: scope === 'current_drive' ? drive : null,
      folder: scope === 'current_folder' ? folder : null,
      baseResultIds: scope === 'selected_videos' ? baseResultIds : [],
      subtitleMissing: true,
    },
  }
}

async function executeChatPlan(db, plan, context = {}) {
  const toolName = plan?.toolName
  if (!toolName) {
    return { success: false, errorCode: 'UNKNOWN_TOOL', error: '실행할 도구가 선택되지 않았습니다.' }
  }

  if (toolName === 'search_videos') {
    const searchResult = buildVideoSearchRows(db, plan.arguments || {})
    const rows = Array.isArray(searchResult.rows) ? searchResult.rows : []

    if (rows.length === 0) {
      return { success: false, errorCode: 'EMPTY_RESULT', error: '조건에 맞는 영상이 없습니다.' }
    }

    return {
      success: true,
      resultType: 'video-list',
      summary: `${rows.length}개의 영상을 찾았습니다.`,
      reason: plan.arguments?.onlyNotCopied
        ? '복사 이력이 없는 영상만 조회했습니다.'
        : plan.arguments?.sortBy === 'rating'
          ? '별점이 높은 순으로 영상을 조회했습니다.'
          : plan.arguments?.sortBy === 'recent'
            ? '최근 추가된 순으로 영상을 조회했습니다.'
            : '조건에 맞는 영상을 조회했습니다.',
      intent: plan,
      toolCall: { name: toolName, arguments: plan.arguments || {} },
      appliedFilters: searchResult.appliedFilters,
      items: rows.map((row) => ({
        video: {
          id: row.id,
          file_name: row.file_name,
          file_path: row.file_path,
          folder_path: row.folder_path,
          code: row.code,
          actor_name: row.actor_name,
          rating: row.rating,
          grade: row.grade,
          recommended: row.recommended,
          favorite: row.favorite,
          is_new: row.is_new,
          play_count: row.play_count,
          copy_count: row.copy_count,
          subtitle_count: row.subtitle_count,
          tags: row.tags,
          file_size: row.file_size,
          themeScore: row.themeScore,
          actorsList: [],
        },
        reason: plan.arguments?.onlyNotCopied ? '미복사' : plan.arguments?.sortBy === 'rating' ? '고평점' : plan.arguments?.sortBy === 'recent' ? '최근 추가' : '조회 결과',
        scoreComment: `themeScore ${row.themeScore}`,
      })),
      actorSummaries: [],
      driveInfo: null,
      lastResultIds: rows.map((row) => Number(row.id)).filter((value) => Number.isFinite(value)),
    }
  }

  if (toolName === 'search_actors') {
    const rows = buildActorSearchRows(db, plan)
    if (rows.length === 0) {
      return { success: false, errorCode: 'EMPTY_RESULT', error: '조건에 맞는 배우가 없습니다.' }
    }

    return {
      success: true,
      resultType: 'actor-list',
      summary: `${rows.length}명의 배우를 찾았습니다.`,
      reason: plan.arguments?.metadataMissing ? '메타데이터가 부족한 배우를 우선 조회했습니다.' : '배우 메타데이터를 기준으로 검색했습니다.',
      intent: plan,
      toolCall: { name: toolName, arguments: plan.arguments || {} },
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        rating: row.rating,
        agency: row.agency,
        tags: row.tags,
        memo: row.memo,
        tier: row.tier,
        videoCount: row.video_count,
        matchedVideos: [],
      })),
      lastResultIds: rows.map((row) => row.id),
    }
  }

  if (toolName === 'get_drive_stats') {
    const drives = getDriveStats(db)
    const filtered = plan.arguments?.drive ? drives.filter((drive) => drive.drive === plan.arguments.drive) : drives
    if (filtered.length === 0) {
      return { success: false, errorCode: 'EMPTY_RESULT', error: '조건에 맞는 드라이브 통계가 없습니다.' }
    }

    return {
      success: true,
      resultType: 'drive-stats',
      summary: plan.arguments?.drive
        ? `${plan.arguments.drive} 드라이브 통계를 확인했습니다.`
        : `${filtered.length}개 드라이브의 통계를 확인했습니다.`,
      reason: '드라이브별 영상 수와 사용 용량을 집계했습니다.',
      intent: plan,
      toolCall: { name: toolName, arguments: plan.arguments || {} },
      drives: filtered,
      lastResultIds: [],
    }
  }

  if (toolName === 'get_delete_candidates') {
    const result = buildDeleteCandidateRows(db, plan)
    const candidates = result.candidates || []
    if (candidates.length === 0) {
      return { success: false, errorCode: 'EMPTY_RESULT', error: '조건에 맞는 삭제 후보가 없습니다.' }
    }

    return {
      success: true,
      resultType: 'delete-candidate-list',
      summary: `${candidates.length}개의 삭제 후보를 찾았습니다.`,
      reason: result.drive === 'all'
        ? '전체 라이브러리 기준 삭제 후보를 조회했습니다.'
        : `${result.drive} 드라이브 기준 삭제 후보를 조회했습니다.`,
      intent: plan,
      toolCall: { name: toolName, arguments: plan.arguments || {} },
      driveInfo: {
        drive: result.drive,
        freeSpace: result.freeSpace,
        totalDiskSize: result.totalDiskSize,
        usedByLibrary: result.usedByLibrary,
      },
      items: candidates.map((candidate) => ({
        video: {
          id: candidate.id,
          file_name: candidate.filename,
          file_path: candidate.file_path,
          rating: candidate.rating,
          tags: Array.isArray(candidate.tags) ? candidate.tags.join(', ') : String(candidate.tags || ''),
          copy_count: candidate.copy_count,
          play_count: candidate.watch_count,
          actor_name: Array.isArray(candidate.actorNames) ? candidate.actorNames.join(', ') : '',
          file_size: candidate.file_size,
        },
        reason: Array.isArray(candidate.reason) ? candidate.reason.join(', ') : String(candidate.reason || ''),
        scoreComment: `삭제 점수 ${candidate.deleteScore}`,
        deleteScore: candidate.deleteScore,
      })),
      lastResultIds: candidates.map((candidate) => candidate.id),
    }
  }

  if (toolName === 'get_unmapped_subtitle_summary') {
    const subtitleResult = buildSubtitleSummaryRows(db, plan.arguments || {})
    const rows = subtitleResult.rows
    if (rows.length === 0) {
      return {
        success: true,
        resultType: 'subtitle-summary',
        summary: '자막 미매핑 영상이 없습니다.',
        reason: '현재 조건에서 자막이 없는 영상이 없습니다.',
        intent: plan,
        toolCall: { name: toolName, arguments: plan.arguments || {} },
        appliedFilters: subtitleResult.appliedFilters,
        totalCount: 0,
        folderCounts: [],
        lastResultIds: [],
      }
    }

    const { folderCounts, actorCounts } = buildSubtitleBreakdown(rows)

    return {
      success: true,
      resultType: 'subtitle-summary',
      summary: `자막 미매핑 영상 ${rows.length}개를 찾았습니다.`,
      reason: '폴더별로 자막이 연결되지 않은 영상을 집계했습니다.',
      intent: plan,
      toolCall: { name: toolName, arguments: plan.arguments || {} },
      appliedFilters: subtitleResult.appliedFilters,
      totalCount: rows.length,
      folderCounts,
      actorCounts,
      lastResultIds: rows.map((row) => row.id),
    }
  }

  if (toolName === 'search_videos_without_subtitles') {
    const subtitleResult = buildSubtitleSummaryRows(db, plan.arguments || {})
    const rows = subtitleResult.rows
    const limited = rows.slice(0, Math.min(Math.max(Number(plan.arguments?.limit) || 100, 1), 500))
    if (limited.length === 0) {
      return { success: false, errorCode: 'EMPTY_RESULT', error: '자막이 없는 영상을 찾지 못했습니다.' }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.debug('[tool-applied-filters]', subtitleResult.appliedFilters)
    }

    const { folderCounts, actorCounts } = buildSubtitleBreakdown(rows)

    return {
      success: true,
      resultType: 'subtitle-video-list',
      summary: `${limited.length}개의 자막 미매핑 영상을 찾았습니다.`,
      reason: '자막 파일이 연결되지 않은 영상만 조회했습니다.',
      intent: plan,
      toolCall: { name: toolName, arguments: plan.arguments || {} },
      appliedFilters: subtitleResult.appliedFilters,
      totalCount: rows.length,
      folderCounts,
      actorCounts,
      items: limited.map((row) => ({
        video: {
          id: row.id,
          file_name: row.file_name,
          file_path: row.file_path,
          code: row.code,
          actor_name: row.actor_name,
          rating: row.rating,
          grade: row.grade,
          recommended: row.recommended,
          is_new: row.is_new,
          play_count: row.play_count,
          copy_count: row.copy_count,
          subtitle_count: row.subtitle_count,
          tags: row.tags,
          file_size: row.file_size,
          themeScore: 0,
          actorsList: [],
        },
        reason: '자막 미보유',
        scoreComment: 'subtitle_count = 0',
      })),
      lastResultIds: limited.map((row) => row.id),
    }
  }

  return { success: false, errorCode: 'UNKNOWN_TOOL', error: '지원하지 않는 도구입니다.' }
}

function buildSummaryStatsFromVideos(items = []) {
  const videos = items.map((item) => item?.video || {}).filter((video) => Number(video.id) > 0)
  const totalCount = videos.length
  const totalSize = videos.reduce((sum, video) => sum + (Number(video.file_size) || Number(video.size) || 0), 0)
  const averageRating = totalCount > 0
    ? Math.round((videos.reduce((sum, video) => sum + (Number(video.rating) || 0), 0) / totalCount) * 10) / 10
    : 0
  const notCopied = videos.filter((video) => Number(video.copy_count || 0) === 0).length
  const unplayed = videos.filter((video) => Number(video.play_count || 0) === 0).length
  const lowRating = videos.filter((video) => Number(video.rating || 0) > 0 && Number(video.rating || 0) <= 2).length
  const newCount = videos.filter((video) => Number(video.is_new || 0) === 1).length
  return { totalCount, totalSize, averageRating, notCopied, unplayed, lowRating, newCount }
}

function buildSummaryStatsFromCandidates(items = []) {
  const candidates = items.map((item) => item?.video || item?.candidate || {}).filter((candidate) => Number(candidate.id) > 0)
  const totalCount = candidates.length
  const totalSize = candidates.reduce((sum, candidate) => sum + (Number(candidate.file_size) || 0), 0)
  const notCopied = candidates.filter((candidate) => Number(candidate.copy_count || 0) === 0).length
  const unplayed = candidates.filter((candidate) => Number(candidate.play_count || candidate.watch_count || 0) === 0).length
  const lowRating = candidates.filter((candidate) => Number(candidate.rating || 0) > 0 && Number(candidate.rating || 0) <= 2).length
  return { totalCount, totalSize, notCopied, unplayed, lowRating }
}

module.exports = {
  executeChatPlan,
  buildSummaryStatsFromVideos,
  buildSummaryStatsFromCandidates,
}

function buildSubtitleBreakdown(rows = []) {
  const folderMap = new Map()
  const actorMap = new Map()

  for (const row of rows) {
    const videoId = Number(row.id)
    const folderPath = row.folder_path || '폴더 미상'
    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, { folderPath, count: 0, sampleFiles: [], videoIds: [] })
    }
    const folderEntry = folderMap.get(folderPath)
    folderEntry.count += 1
    if (folderEntry.sampleFiles.length < 3) {
      folderEntry.sampleFiles.push(row.file_name)
    }
    if (Number.isInteger(videoId) && videoId > 0 && folderEntry.videoIds.length < 500) {
      folderEntry.videoIds.push(videoId)
    }

    const actorName = String(row.actor_name || '').trim() || '배우 미상'
    if (!actorMap.has(actorName)) {
      actorMap.set(actorName, { actorName, count: 0, sampleCodes: [], videoIds: [] })
    }
    const actorEntry = actorMap.get(actorName)
    actorEntry.count += 1
    const sampleCode = String(row.code || row.file_name || '').trim()
    if (sampleCode && actorEntry.sampleCodes.length < 3) {
      actorEntry.sampleCodes.push(sampleCode)
    }
    if (Number.isInteger(videoId) && videoId > 0 && actorEntry.videoIds.length < 500) {
      actorEntry.videoIds.push(videoId)
    }
  }

  return {
    folderCounts: Array.from(folderMap.values())
      .sort((left, right) => right.count - left.count || left.folderPath.localeCompare(right.folderPath)),
    actorCounts: Array.from(actorMap.values())
      .sort((left, right) => right.count - left.count || left.actorName.localeCompare(right.actorName)),
  }
}