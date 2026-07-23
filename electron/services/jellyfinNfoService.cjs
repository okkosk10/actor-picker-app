'use strict'

const fs = require('fs')
const path = require('path')

const GENERATED_COMMENT = '<!-- generated-by: actor-picker-app -->'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function splitCommaTags(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',')
  const seen = new Set()
  const result = []
  for (const item of source) {
    const tag = normalizeText(item)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}

function parseJsonArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean)
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => normalizeText(item)).filter(Boolean) : []
  } catch {
    return []
  }
}

function mapVideoRatingToJellyfin(rating, sourceMaxRating = 5) {
  const raw = Number(rating)
  if (!Number.isFinite(raw) || raw <= 0) return null

  const max = Number(sourceMaxRating) > 0 ? Number(sourceMaxRating) : 5
  const clamped = Math.max(0, Math.min(max, raw))
  const jellyfinRating = max === 10 ? clamped : (clamped / max) * 10
  return Math.max(1, Math.min(10, Math.round(jellyfinRating)))
}

function getVideoTitle(video) {
  const code = normalizeText(video?.code)
  if (code) return code
  return path.parse(String(video?.file_path || video?.filePath || video?.file_name || 'unknown')).name || 'unknown'
}

function buildActorNameSet(video) {
  const names = []
  if (Array.isArray(video?.actorNames)) names.push(...video.actorNames)
  if (Array.isArray(video?.actors)) {
    names.push(...video.actors.map((actor) => actor?.name))
  }
  const actorNameText = normalizeText(video?.actorNameText)
  if (actorNameText) {
    names.push(...actorNameText.split(',').map((item) => item.trim()))
  }

  return new Set(names.map((item) => normalizeText(item).toLowerCase()).filter(Boolean))
}

function buildTagList(video) {
  const tags = []
  const baseTags = Array.isArray(video?.tags) ? video.tags : splitCommaTags(video?.tags)
  tags.push(...baseTags)

  const grade = normalizeText(video?.grade)
  if (grade) tags.push(`등급: ${grade}`)

  if (Number(video?.favorite) === 1) tags.push('즐겨찾기')

  const rawRating = Number(video?.rating)
  if (Number.isFinite(rawRating) && rawRating > 0) {
    const ratingLabel = Number.isInteger(rawRating) ? rawRating : Number(rawRating.toFixed(1))
    tags.push(`액트픽커 평점: ${ratingLabel}/5`)
  }

  const aiTags = Array.isArray(video?.aiTags) ? video.aiTags : parseJsonArray(video?.ai_tags)
  tags.push(...aiTags)

  const actorNameSet = buildActorNameSet(video)

  const seen = new Set()
  return tags.filter((tag) => {
    const normalized = normalizeText(tag)
    const lower = normalized.toLowerCase()
    if (!normalized || seen.has(lower) || actorNameSet.has(lower)) return false
    seen.add(lower)
    return true
  })
}

function buildPlotText(video) {
  const plot = normalizeText(video?.aiPlot ?? video?.ai_plot)
  if (plot) return plot

  const memo = normalizeText(video?.memo)
  if (memo) return `[액트픽커 메모]\n${memo}`

  return ''
}

function buildOutlineText(video) {
  return normalizeText(video?.aiOutline ?? video?.ai_outline)
}

function buildMovieNfo(video, actors = []) {
  const orderedActors = parseActorRows(actors)
  const title = escapeXml(getVideoTitle(video))
  const outline = buildOutlineText(video)
  const plot = buildPlotText(video)
  const rating = mapVideoRatingToJellyfin(video?.rating, 5)
  const tags = buildTagList(video)

  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    GENERATED_COMMENT,
    '<movie>',
    `  <title>${title}</title>`,
    `  <originaltitle>${title}</originaltitle>`,
    `  <sorttitle>${title}</sorttitle>`,
  ]

  if (outline) {
    lines.push(`  <tagline>${escapeXml(outline)}</tagline>`)
  }
  if (plot) {
    lines.push(`  <plot>${escapeXml(plot)}</plot>`)
  }
  if (rating !== null) {
    lines.push(`  <rating>${rating}</rating>`)
  }

  for (const tag of tags) {
    lines.push(`  <tag>${escapeXml(tag)}</tag>`)
  }

  for (const actor of orderedActors) {
    const name = normalizeText(actor?.name)
    if (!name) continue
    const isMain = Boolean(actor?.isMain ?? actor?.is_main ?? actor?.is_main === 1)
    const role = isMain ? '주연' : '출연'
    lines.push('  <actor>')
    lines.push(`    <name>${escapeXml(name)}</name>`)
    lines.push(`    <role>${escapeXml(role)}</role>`)
    lines.push('  </actor>')
  }

  lines.push('</movie>')
  return lines.join('\n') + '\n'
}

function parseExistingNfoPolicy(existingPath) {
  if (!fs.existsSync(existingPath)) {
    return { action: 'write', backupPath: null, existingGenerated: false }
  }

  const content = fs.readFileSync(existingPath, 'utf8')
  return {
    action: 'exists',
    backupPath: null,
    existingGenerated: content.includes(GENERATED_COMMENT),
  }
}

function resolveBackupPath(nfoPath) {
  const baseBackup = `${nfoPath}.bak`
  if (!fs.existsSync(baseBackup)) return baseBackup

  const stamp = new Date().toISOString().replace(/[.:]/g, '-').replace('T', '_').replace('Z', '')
  let candidate = `${nfoPath}.bak.${stamp}`
  let counter = 1
  while (fs.existsSync(candidate)) {
    candidate = `${nfoPath}.bak.${stamp}-${counter}`
    counter += 1
  }
  return candidate
}

function getNfoPath(filePath) {
  const parsed = path.parse(filePath)
  return path.join(parsed.dir, `${parsed.name}.nfo`)
}

function parseActorRows(actorRows) {
  return (Array.isArray(actorRows) ? actorRows : [])
    .slice()
    .sort((a, b) => {
      const mainDiff = Number(b?.is_main ?? b?.isMain ?? 0) - Number(a?.is_main ?? a?.isMain ?? 0)
      if (mainDiff !== 0) return mainDiff
      const orderDiff = Number(a?.order_index || 0) - Number(b?.order_index || 0)
      if (orderDiff !== 0) return orderDiff
      return normalizeText(a?.name).localeCompare(normalizeText(b?.name))
    })
    .filter((actor) => normalizeText(actor?.name))
}

function buildExportSnapshot(db, options = {}) {
  const itemIds = Array.isArray(options.itemIds)
    ? options.itemIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : []
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null

  const conditions = [`v.status != 'deleted'`]
  const params = []
  if (itemIds.length > 0) {
    conditions.push(`v.id IN (${itemIds.map(() => '?').join(',')})`)
    params.push(...itemIds)
  }

  const baseSelectSql = `
    SELECT v.id
    FROM videos v
    WHERE ${conditions.join(' AND ')}
    ORDER BY v.id ASC
    ${limit ? `LIMIT ${limit}` : ''}
  `
  const selectedIds = db.prepare(baseSelectSql).all(...params).map((row) => row.id)
  if (selectedIds.length === 0) {
    const emptyStats = buildExportStats([])
    return { items: [], stats: emptyStats }
  }

  const rows = db.prepare(`
    SELECT
      v.id, v.file_name, v.file_path, v.folder_path, v.code, v.actor_name,
      v.tags, v.memo, v.rating, v.favorite, v.grade, v.status, v.size,
      v.subtitle_paths, v.subtitle_files, v.subtitle_exts, v.subtitle_count, v.subtitle_size,
      v.subtitle_added_at, v.primary_subtitle_path, v.primary_subtitle_hash, v.subtitle_status,
      v.ai_outline, v.ai_plot, v.ai_tags, v.ai_story_structure,
      v.ai_relationship, v.ai_tone, v.ai_confidence, v.ai_warnings,
      v.ai_raw_response, v.ai_model, v.ai_prompt_version, v.ai_error,
      v.ai_input_tokens, v.ai_output_tokens, v.ai_api_calls,
      v.ai_summary_status, v.ai_summary_source_path, v.ai_summary_source_hash, v.ai_summary_updated_at,
      va.is_main, va.order_index,
      a.id AS actor_id, a.name AS actor_name_joined, a.rating AS actor_rating, a.aliases
    FROM videos v
    LEFT JOIN video_actors va ON va.video_id = v.id
    LEFT JOIN actors a ON a.id = va.actor_id
    WHERE v.id IN (${selectedIds.map(() => '?').join(',')})
    ORDER BY v.id ASC, va.is_main DESC, va.order_index ASC, a.name ASC
  `).all(...selectedIds)

  const grouped = new Map()
  for (const row of rows) {
    const current = grouped.get(row.id) || {
      video: row,
      actors: [],
    }
    if (row.actor_id) {
      current.actors.push({
        id: row.actor_id,
        name: row.actor_name_joined || '',
        rating: Number(row.actor_rating) || 0,
        aliases: row.aliases || '',
        is_main: Number(row.is_main) || 0,
        order_index: Number(row.order_index) || 0,
      })
    }
    grouped.set(row.id, current)
  }

  const items = []
  for (const { video, actors } of grouped.values()) {
    const fileExists = video.file_path ? fs.existsSync(video.file_path) : false
    const nfoPath = video.file_path ? getNfoPath(video.file_path) : ''
    const nfoExists = nfoPath ? fs.existsSync(nfoPath) : false
    const primarySubtitleExists = video.primary_subtitle_path ? fs.existsSync(video.primary_subtitle_path) : false
    const subtitleCount = Number(video.subtitle_count || 0)

    let subtitleStatus = String(video.subtitle_status || 'unknown')
    if (subtitleStatus === 'available' && !primarySubtitleExists) {
      subtitleStatus = subtitleCount > 0 ? 'file_missing' : 'missing'
    } else if (subtitleStatus === 'unknown') {
      if (subtitleCount > 0 && primarySubtitleExists) subtitleStatus = 'available'
      else if (subtitleCount > 0) subtitleStatus = 'file_missing'
      else subtitleStatus = 'missing'
    }

    const effectiveAiStatus = (() => {
      const current = String(video.ai_summary_status || 'not_analyzed')
      const hasAiPayload = Boolean(
        String(video.ai_outline || '').trim()
        || String(video.ai_plot || '').trim()
        || String(video.ai_story_structure || '').trim()
        || String(video.ai_relationship || '').trim()
        || String(video.ai_tone || '').trim()
        || parseJsonArray(video.ai_tags).length > 0
        || parseJsonArray(video.ai_warnings).length > 0
        || String(video.ai_summary_source_path || '').trim()
        || String(video.ai_summary_source_hash || '').trim()
      )

      if (subtitleStatus === 'error') return 'failed'
      if (subtitleStatus === 'missing' || subtitleStatus === 'file_missing') return 'not_available'
      if (video.ai_summary_source_hash && video.primary_subtitle_hash && video.ai_summary_source_hash !== video.primary_subtitle_hash) {
        return 'stale'
      }
      if (!hasAiPayload) return 'not_analyzed'
      if (!current || current === 'unknown') return 'not_analyzed'
      return current
    })()

    const exportEligible = video.status === 'normal' && fileExists
    const exclusionReasons = []
    if (video.status !== 'normal') exclusionReasons.push(`상태: ${video.status}`)
    if (!fileExists) exclusionReasons.push('영상 파일 없음')

    const actorNames = actors.map((actor) => actor.name).filter(Boolean)
    const tags = buildTagList({ ...video, actorNames, actors })

    items.push({
      id: video.id,
      code: normalizeText(video.code),
      title: getVideoTitle(video),
      fileName: video.file_name,
      filePath: video.file_path,
      folderPath: video.folder_path,
      status: video.status,
      videoFileExists: fileExists,
      videoFileMissing: !fileExists,
      subtitleStatus,
      subtitleCount,
      subtitleExts: normalizeText(video.subtitle_exts),
      subtitleSize: Number(video.subtitle_size || 0),
      subtitleAddedAt: video.subtitle_added_at || null,
      primarySubtitlePath: video.primary_subtitle_path || '',
      primarySubtitleHash: video.primary_subtitle_hash || '',
      primarySubtitleFileName: video.primary_subtitle_path ? path.basename(video.primary_subtitle_path) : '',
      primarySubtitleExists,
      aiSummaryStatus: effectiveAiStatus,
      aiOutline: video.ai_outline || '',
      aiPlot: video.ai_plot || '',
      aiTags: parseJsonArray(video.ai_tags),
      aiStoryStructure: video.ai_story_structure || '',
      aiRelationship: parseJsonArray(video.ai_relationship),
      aiTone: parseJsonArray(video.ai_tone),
      aiConfidence: Number(video.ai_confidence || 0) || 0,
      aiWarnings: parseJsonArray(video.ai_warnings),
      aiRawResponse: video.ai_raw_response || '',
      aiModel: video.ai_model || '',
      aiPromptVersion: video.ai_prompt_version || '',
      aiError: video.ai_error || '',
      aiInputTokens: Number(video.ai_input_tokens || 0) || 0,
      aiOutputTokens: Number(video.ai_output_tokens || 0) || 0,
      aiApiCalls: Number(video.ai_api_calls || 0) || 0,
      aiSummarySourcePath: video.ai_summary_source_path || '',
      aiSummarySourceHash: video.ai_summary_source_hash || '',
      aiSummaryUpdatedAt: video.ai_summary_updated_at || null,
      rating: Number(video.rating) || 0,
      favorite: Number(video.favorite) === 1,
      grade: video.grade || '',
      memo: video.memo || '',
      tags,
      actors: parseActorRows(actors),
      actorNames,
      actorNameText: actorNames.join(', '),
      nfoPath,
      nfoExists,
      exportEligible,
      exportExclusionReasons: exclusionReasons,
      hasActorLinks: actors.length > 0,
      actorLinkCount: actors.length,
    })
  }

  const stats = buildExportStats(items)
  return { items, stats }
}

function buildExportStats(items) {
  const summary = {
    totalVideos: items.length,
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
    nfoExists: 0,
    nfoMissing: 0,
    exportEligible: 0,
    exportExcluded: 0,
    missingActorLinks: 0,
  }

  for (const item of items) {
    if (item.videoFileExists) summary.videoFileExists += 1
    else summary.videoFileMissing += 1

    if (item.subtitleStatus === 'available') summary.subtitleAvailable += 1
    else if (item.subtitleStatus === 'file_missing') summary.subtitleFileMissing += 1
    else if (item.subtitleStatus === 'error') summary.scanErrors += 1
    else summary.subtitleMissing += 1

    if (item.primarySubtitlePath) summary.primarySubtitleSelected += 1

    if (item.aiSummaryStatus === 'not_analyzed') summary.aiNotAnalyzed += 1
    else if (item.aiSummaryStatus === 'pending') summary.aiPending += 1
    else if (item.aiSummaryStatus === 'failed') summary.aiFailed += 1
    else if (item.aiSummaryStatus === 'stale') summary.aiStale += 1
    else summary.aiAnalyzed += 1

    if (item.nfoExists) summary.nfoExists += 1
    else summary.nfoMissing += 1

    if (item.exportEligible) summary.exportEligible += 1
    else summary.exportExcluded += 1

    if (!item.hasActorLinks) summary.missingActorLinks += 1
  }

  summary.filterCounts = {
    all: summary.totalVideos,
    subtitleAvailable: summary.subtitleAvailable,
    subtitleMissing: summary.subtitleMissing + summary.subtitleFileMissing,
    notAnalyzed: summary.aiNotAnalyzed,
    analyzed: summary.aiAnalyzed,
    stale: summary.aiStale,
    nfoMissing: summary.nfoMissing,
    error: summary.scanErrors + summary.videoFileMissing,
  }

  summary.exportExclusionReasons = {
    notNormal: items.filter((item) => item.status !== 'normal').length,
    missingVideo: summary.videoFileMissing,
  }

  return summary
}

async function writeNfoFile(nfoPath, xml, mode) {
  const exists = fs.existsSync(nfoPath)

  if (exists && mode === 'skip') {
    return { action: 'skipped', reason: 'existing', backupPath: null }
  }

  if (exists && mode === 'overwrite-generated-only') {
    const content = fs.readFileSync(nfoPath, 'utf8')
    if (!content.includes(GENERATED_COMMENT)) {
      return { action: 'skipped', reason: 'external', backupPath: null }
    }
  }

  let backupPath = null
  if (exists && mode === 'backup-and-overwrite') {
    backupPath = resolveBackupPath(nfoPath)
    fs.copyFileSync(nfoPath, backupPath)
  }

  await fs.promises.mkdir(path.dirname(nfoPath), { recursive: true })
  await fs.promises.writeFile(nfoPath, xml, 'utf8')
  return { action: exists ? 'overwritten' : 'created', reason: '', backupPath }
}

async function exportJellyfinNfo(db, options = {}) {
  const mode = ['skip', 'backup-and-overwrite', 'overwrite-generated-only'].includes(options.nfoMode)
    ? options.nfoMode
    : 'skip'

  const snapshot = buildExportSnapshot(db, {
    itemIds: options.itemIds,
    limit: options.limitEligibleOnly ? null : options.limit,
  })

  const itemIdSet = new Set(Array.isArray(options.itemIds) ? options.itemIds.map((value) => Number(value)) : [])
  const targets = itemIdSet.size > 0
    ? snapshot.items.filter((item) => itemIdSet.has(Number(item.id)))
    : snapshot.items

  const eligibleTargets = typeof options.limit === 'number' && options.limit > 0
    ? targets.filter((item) => item.exportEligible).slice(0, options.limit)
    : targets.filter((item) => item.exportEligible)

  const results = []
  const summary = {
    totalTargets: eligibleTargets.length,
    created: 0,
    overwritten: 0,
    skipped: 0,
    missingVideo: snapshot.stats.videoFileMissing,
    excludedMissingVideo: snapshot.stats.videoFileMissing,
    missingActorLinks: 0,
    errors: 0,
    errorItems: [],
    excluded: snapshot.stats.exportExcluded,
    excludedReasons: snapshot.stats.exportExclusionReasons,
    sampleTargets: eligibleTargets.slice(0, 10).map((item) => ({
      id: item.id,
      title: item.title,
      fileName: item.fileName,
      filePath: item.filePath,
      nfoPath: item.nfoPath,
      actorNameText: item.actorNameText,
    })),
  }

  for (let index = 0; index < eligibleTargets.length; index += 1) {
    const item = eligibleTargets[index]
    try {
      const xml = buildMovieNfo(item, item.actors)
      const writeResult = await writeNfoFile(item.nfoPath, xml, mode)
      if (writeResult.action === 'created') summary.created += 1
      else if (writeResult.action === 'overwritten') summary.overwritten += 1
      else summary.skipped += 1

      if (!item.hasActorLinks) summary.missingActorLinks += 1

      results.push({
        id: item.id,
        title: item.title,
        filePath: item.filePath,
        nfoPath: item.nfoPath,
        action: writeResult.action,
        reason: writeResult.reason,
        backupPath: writeResult.backupPath,
      })
    } catch (error) {
      summary.errors += 1
      summary.errorItems.push({
        id: item.id,
        title: item.title,
        filePath: item.filePath,
        nfoPath: item.nfoPath,
        reason: error?.message || String(error),
      })
      results.push({
        id: item.id,
        title: item.title,
        filePath: item.filePath,
        nfoPath: item.nfoPath,
        action: 'error',
        reason: error?.message || String(error),
      })
    }

    if (typeof options.onProgress === 'function') {
      options.onProgress({
        processed: index + 1,
        total: eligibleTargets.length,
        current: item,
        summary: {
          ...summary,
          errorItems: summary.errorItems.slice(-5),
          sampleTargets: summary.sampleTargets,
        },
      })
    }
  }

  return { success: true, mode, summary, results, stats: snapshot.stats, items: snapshot.items }
}

function getJellyfinExportStats(db) {
  return buildExportSnapshot(db).stats
}

function listJellyfinExportItems(db, options = {}) {
  const itemIds = Array.isArray(options.itemIds) ? options.itemIds : null
  const snapshot = buildExportSnapshot(db, {
    itemIds,
    limit: options.limit,
  })
  return { success: true, ...snapshot }
}

module.exports = {
  GENERATED_COMMENT,
  escapeXml,
  splitCommaTags,
  parseJsonArray,
  mapVideoRatingToJellyfin,
  getVideoTitle,
  buildTagList,
  buildPlotText,
  buildOutlineText,
  buildMovieNfo,
  parseExistingNfoPolicy,
  resolveBackupPath,
  getNfoPath,
  parseActorRows,
  buildExportSnapshot,
  buildExportStats,
  writeNfoFile,
  exportJellyfinNfo,
  getJellyfinExportStats,
  listJellyfinExportItems,
}