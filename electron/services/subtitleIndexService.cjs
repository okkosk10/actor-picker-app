'use strict'

const fs = require('fs')
const path = require('path')
const { hashFile } = require('./fileHashService.cjs')

const SUPPORTED_SUBTITLE_EXTS = new Set(['.srt', '.ass', '.ssa', '.vtt'])

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
}

function normalizeToken(value) {
  return normalizeText(value).replace(/[^0-9a-z\uac00-\ud7a3]/g, '')
}

function isKoreanToken(token) {
  const normalized = normalizeToken(token)
  if (!normalized) return false
  return normalized === 'ko'
    || normalized === 'kor'
    || normalized === 'kr'
    || normalized === 'korean'
    || normalized === '한국어'
    || normalized === '한글'
    || (normalized.startsWith('ko') && normalized.includes('kr'))
}

function isJapaneseToken(token) {
  const normalized = normalizeToken(token)
  if (!normalized) return false
  return normalized === 'ja'
    || normalized === 'jpn'
    || normalized === 'jp'
    || normalized === 'japanese'
    || normalized === '일본어'
    || (normalized.startsWith('ja') && normalized.includes('jp'))
}

function splitSubtitleStem(videoBaseName, fileName) {
  const ext = path.extname(fileName || '').toLowerCase()
  if (!SUPPORTED_SUBTITLE_EXTS.has(ext)) return null

  const stem = path.basename(String(fileName || ''), ext)
  const base = normalizeText(videoBaseName)
  const normalizedStem = normalizeText(stem)
  if (!normalizedStem) return null

  if (normalizedStem === base) {
    return {
      ext,
      stem,
      suffixTokens: [],
      exact: true,
      rank: ext === '.srt' ? 1000 : 900,
    }
  }

  if (!normalizedStem.startsWith(base)) return null

  const separator = normalizedStem.slice(base.length, base.length + 1)
  if (!['.', '_', '-', ' '].includes(separator)) return null

  const suffix = normalizedStem.slice(base.length + 1)
  if (!suffix) {
    return {
      ext,
      stem,
      suffixTokens: [],
      exact: true,
      rank: ext === '.srt' ? 1000 : 900,
    }
  }

  const suffixTokens = suffix.split(/[._\-\s]+/).filter(Boolean)
  const firstToken = suffixTokens[0] || ''
  let rank = 100

  if (isKoreanToken(firstToken)) {
    if (firstToken === 'ko') rank = 950
    else if (firstToken === 'kor') rank = 940
    else if (firstToken === 'kr') rank = 935
    else rank = 930
  } else if (isJapaneseToken(firstToken)) {
    if (firstToken === 'ja') rank = 850
    else if (firstToken === 'jpn') rank = 840
    else if (firstToken === 'jp') rank = 835
    else rank = 830
  }

  if (ext !== '.srt') rank -= 50

  return {
    ext,
    stem,
    suffixTokens,
    exact: false,
    rank,
  }
}

function choosePrimarySubtitleCandidate(candidates, videoBaseName) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      ...candidate,
      match: splitSubtitleStem(videoBaseName, candidate.fileName || path.basename(candidate.filePath || '')),
    }))
    .filter((candidate) => candidate.match)
    .sort((a, b) => {
      const rankDiff = (b.match.rank || 0) - (a.match.rank || 0)
      if (rankDiff !== 0) return rankDiff
      return String(a.fileName || a.filePath || '').localeCompare(String(b.fileName || b.filePath || ''))
    })

  return ranked[0] || null
}

async function scanSubtitleFolder(videoFilePath) {
  const videoBaseName = path.parse(videoFilePath || '').name
  const folderPath = path.dirname(videoFilePath || '')

  let entries
  try {
    entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
  } catch (error) {
    return {
      status: 'error',
      error: error?.message || '자막 폴더를 읽을 수 없습니다.',
      candidates: [],
      primary: null,
      primaryHash: '',
      totalSize: 0,
      subtitleAddedAt: null,
    }
  }

  const candidates = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = splitSubtitleStem(videoBaseName, entry.name)
    if (!match) continue

    const filePath = path.join(folderPath, entry.name)
    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) continue
      candidates.push({
        filePath,
        fileName: entry.name,
        ext: match.ext,
        size: stat.size,
        mtime: stat.mtime,
        rank: match.rank,
        exact: match.exact,
        suffixTokens: match.suffixTokens,
      })
    } catch {
      // 폴더 스캔 중 사라진 파일은 무시한다.
    }
  }

  candidates.sort((a, b) => {
    const rankDiff = (b.rank || 0) - (a.rank || 0)
    if (rankDiff !== 0) return rankDiff
    return a.fileName.localeCompare(b.fileName)
  })

  const primary = candidates[0] || null
  const totalSize = candidates.reduce((sum, candidate) => sum + (candidate.size || 0), 0)
  const subtitleAddedAt = candidates.length > 0
    ? new Date(Math.max(...candidates.map((candidate) => candidate.mtime?.getTime?.() || 0)) || Date.now()).toISOString()
    : null

  let primaryHash = ''
  let hashError = ''
  if (primary) {
    try {
      primaryHash = await hashFile(primary.filePath)
    } catch (error) {
      hashError = error?.message || '자막 해시 계산 실패'
    }
  }

  return {
    status: primary ? (hashError ? 'error' : 'available') : 'missing',
    error: hashError,
    candidates,
    primary,
    primaryHash,
    totalSize,
    subtitleAddedAt,
  }
}

function parseAiTagList(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item || '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

function resolveAiSummaryStatus(videoRow, subtitleStatus, primarySubtitleHash) {
  const currentStatus = String(videoRow?.ai_summary_status || 'not_analyzed')
  if (subtitleStatus === 'error') return 'failed'
  if (subtitleStatus === 'missing' || subtitleStatus === 'file_missing') return 'not_available'
  if (currentStatus === 'not_available') return 'not_analyzed'

  if (videoRow?.ai_summary_source_hash && primarySubtitleHash && videoRow.ai_summary_source_hash !== primarySubtitleHash) {
    return 'stale'
  }

  const hasAiPayload = Boolean(
    String(videoRow?.ai_outline || '').trim()
    || String(videoRow?.ai_plot || '').trim()
    || String(videoRow?.ai_story_structure || '').trim()
    || String(videoRow?.ai_relationship || '').trim()
    || String(videoRow?.ai_tone || '').trim()
    || parseAiTagList(videoRow?.ai_tags).length > 0
    || parseAiTagList(videoRow?.ai_warnings).length > 0
    || String(videoRow?.ai_summary_source_path || '').trim()
    || String(videoRow?.ai_summary_source_hash || '').trim()
  )

  if (!hasAiPayload) return 'not_analyzed'
  if (currentStatus === 'unknown' || !currentStatus) return 'not_analyzed'
  return currentStatus
}

function buildSubtitleUpdatePayload(videoRow, scanResult) {
  if (!scanResult || scanResult.status === 'error') {
    return {
      subtitle_status: 'error',
    }
  }

  const hadPreviousSubtitleData = Number(videoRow?.subtitle_count || 0) > 0
    || String(videoRow?.primary_subtitle_path || '').trim()
    || parseAiTagList(videoRow?.subtitle_paths).length > 0

  const subtitleStatus = scanResult.status === 'available'
    ? 'available'
    : (hadPreviousSubtitleData ? 'file_missing' : 'missing')

  const subtitlePaths = scanResult.candidates.map((candidate) => candidate.filePath)
  const subtitleFiles = scanResult.candidates.map((candidate) => candidate.fileName)
  const subtitleExts = [...new Set(scanResult.candidates.map((candidate) => candidate.ext.replace(/^\./, '')))].join(', ')
  const primaryPath = scanResult.primary ? scanResult.primary.filePath : ''
  const primaryHash = scanResult.primary && scanResult.status === 'available' ? scanResult.primaryHash : ''
  const aiSummaryStatus = resolveAiSummaryStatus(videoRow, subtitleStatus, primaryHash)

  return {
    subtitle_status: subtitleStatus,
    primary_subtitle_path: primaryPath,
    primary_subtitle_hash: primaryHash,
    subtitle_paths: JSON.stringify(subtitlePaths),
    subtitle_files: JSON.stringify(subtitleFiles),
    subtitle_exts: subtitleExts,
    subtitle_count: scanResult.candidates.length,
    subtitle_size: scanResult.totalSize,
    subtitle_added_at: scanResult.subtitleAddedAt,
    ai_summary_status: aiSummaryStatus,
  }
}

async function refreshSubtitleIndex(db, options = {}) {
  const videoIds = Array.isArray(options.videoIds)
    ? options.videoIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : []

  const whereClause = videoIds.length > 0
    ? `WHERE v.id IN (${videoIds.map(() => '?').join(',')}) AND v.status != 'deleted'`
    : `WHERE v.status != 'deleted'`
  const rows = db.prepare(`
    SELECT
      v.id, v.file_name, v.file_path, v.folder_path, v.status,
      v.subtitle_paths, v.subtitle_files, v.subtitle_exts, v.subtitle_count,
      v.subtitle_size, v.subtitle_added_at, v.primary_subtitle_path,
      v.primary_subtitle_hash, v.subtitle_status,
      v.ai_outline, v.ai_plot, v.ai_tags, v.ai_story_structure,
      v.ai_relationship, v.ai_tone, v.ai_confidence, v.ai_warnings,
      v.ai_raw_response, v.ai_model, v.ai_prompt_version, v.ai_error,
      v.ai_input_tokens, v.ai_output_tokens, v.ai_api_calls,
      v.ai_summary_status, v.ai_summary_source_path, v.ai_summary_source_hash, v.ai_summary_updated_at
    FROM videos v
    ${whereClause}
    ORDER BY v.id ASC
  `).all(...videoIds)

  const updateExisting = db.prepare(`
    UPDATE videos
    SET subtitle_status = ?,
        primary_subtitle_path = ?,
        primary_subtitle_hash = ?,
        subtitle_paths = ?,
        subtitle_files = ?,
        subtitle_exts = ?,
        subtitle_count = ?,
        subtitle_size = ?,
        subtitle_added_at = ?,
        ai_summary_status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)

  const updateErrorOnly = db.prepare(`
    UPDATE videos
    SET subtitle_status = 'error',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)

  const summary = {
    totalVideos: rows.length,
    videoFileExists: 0,
    videoFileMissing: 0,
    subtitleAvailable: 0,
    subtitleMissing: 0,
    subtitleFileMissing: 0,
    scanErrors: 0,
    primarySubtitleSelected: 0,
    aiNotAnalyzed: 0,
    aiAnalyzed: 0,
    aiPending: 0,
    aiFailed: 0,
    aiStale: 0,
    updatedCount: 0,
    errorCount: 0,
    errors: [],
  }

  const results = []
  const total = rows.length

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const scanResult = await scanSubtitleFolder(row.file_path)

    if (scanResult.status === 'error') {
      updateErrorOnly.run(row.id)
      summary.scanErrors += 1
      summary.errorCount += 1
      summary.errors.push({ id: row.id, fileName: row.file_name, filePath: row.file_path, reason: scanResult.error })
      results.push({
        id: row.id,
        fileName: row.file_name,
        filePath: row.file_path,
        status: 'error',
        reason: scanResult.error,
      })
    } else {
      const payload = buildSubtitleUpdatePayload(row, scanResult)
      updateExisting.run(
        payload.subtitle_status,
        payload.primary_subtitle_path,
        payload.primary_subtitle_hash,
        payload.subtitle_paths,
        payload.subtitle_files,
        payload.subtitle_exts,
        payload.subtitle_count,
        payload.subtitle_size,
        payload.subtitle_added_at,
        payload.ai_summary_status,
        row.id,
      )
      summary.updatedCount += 1
      if (payload.subtitle_status === 'available') summary.subtitleAvailable += 1
      else if (payload.subtitle_status === 'file_missing') summary.subtitleFileMissing += 1
      else summary.subtitleMissing += 1

      if (payload.primary_subtitle_path) summary.primarySubtitleSelected += 1
      if (payload.ai_summary_status === 'stale') summary.aiStale += 1
      else if (payload.ai_summary_status === 'pending') summary.aiPending += 1
      else if (payload.ai_summary_status === 'failed') summary.aiFailed += 1
      else if (payload.ai_summary_status === 'not_analyzed') summary.aiNotAnalyzed += 1
      else summary.aiAnalyzed += 1

      results.push({
        id: row.id,
        fileName: row.file_name,
        filePath: row.file_path,
        status: payload.subtitle_status,
        primarySubtitlePath: payload.primary_subtitle_path,
        primarySubtitleHash: payload.primary_subtitle_hash,
        subtitleCount: payload.subtitle_count,
        subtitleSize: payload.subtitle_size,
        aiSummaryStatus: payload.ai_summary_status,
      })
    }

    if (typeof options.onProgress === 'function') {
      options.onProgress({
        processed: index + 1,
        total,
        current: {
          id: row.id,
          fileName: row.file_name,
          filePath: row.file_path,
        },
        summary: {
          ...summary,
          errors: summary.errors.slice(-5),
        },
      })
    }
  }

  if (summary.subtitleAvailable === 0 && summary.subtitleFileMissing === 0 && summary.subtitleMissing === 0) {
    summary.subtitleMissing = summary.totalVideos - summary.subtitleAvailable - summary.subtitleFileMissing
  }

  return { success: true, summary, results }
}

async function analyzeSubtitleForMetadata({ videoId, subtitlePath, subtitleHash }) {
  throw new Error('AI subtitle analysis is not implemented yet')
}

module.exports = {
  SUPPORTED_SUBTITLE_EXTS,
  splitSubtitleStem,
  choosePrimarySubtitleCandidate,
  scanSubtitleFolder,
  parseAiTagList,
  resolveAiSummaryStatus,
  buildSubtitleUpdatePayload,
  refreshSubtitleIndex,
  analyzeSubtitleForMetadata,
}