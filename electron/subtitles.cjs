'use strict'

const fs = require('fs')
const path = require('path')

const SUBTITLE_EXTS = new Set(['.srt', '.smi', '.ass'])

function serializeSubtitlePaths(paths) {
  return JSON.stringify(paths)
}

function parseSubtitlePaths(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((p) => typeof p === 'string' && p)
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string' && p) : []
  } catch {
    return []
  }
}

function serializeSubtitleFiles(files) {
  return JSON.stringify(files)
}

function parseSubtitleFiles(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.filter((file) => file && typeof file === 'object')
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((file) => file && typeof file === 'object') : []
  } catch {
    return []
  }
}

async function findSubtitleFiles(folderPath, videoFileName) {
  const baseName = path.basename(videoFileName, path.extname(videoFileName)).toLowerCase()
  let entries
  try {
    entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
  } catch {
    return { paths: [], exts: [], totalSize: 0 }
  }

  const subtitles = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const rawExt = path.extname(entry.name)
    const ext = rawExt.toLowerCase()
    if (!SUBTITLE_EXTS.has(ext)) continue
    const stem = entry.name.slice(0, -rawExt.length).toLowerCase()
    if (stem !== baseName) continue

    const fullPath = path.join(folderPath, entry.name)
    try {
      const stat = await fs.promises.stat(fullPath)
      if (stat.isFile()) {
        subtitles.push({
          path: fullPath,
          ext: ext.slice(1),
          size: stat.size,
          modified_at: stat.mtime.toISOString(),
        })
      }
    } catch {
      // Ignore stale entries.
    }
  }

  subtitles.sort((a, b) => a.path.localeCompare(b.path))
  return {
    paths: subtitles.map((s) => s.path),
    exts: [...new Set(subtitles.map((s) => s.ext))],
    totalSize: subtitles.reduce((sum, s) => sum + s.size, 0),
    files: subtitles,
  }
}

function expandWithSubtitlePaths(videos) {
  const paths = []
  const seen = new Set()
  for (const video of videos) {
    for (const fp of [video.file_path, ...parseSubtitlePaths(video.subtitle_paths)]) {
      if (typeof fp !== 'string' || !fp || seen.has(fp)) continue
      seen.add(fp)
      paths.push(fp)
    }
  }
  return paths
}

module.exports = {
  SUBTITLE_EXTS,
  serializeSubtitlePaths,
  parseSubtitlePaths,
  serializeSubtitleFiles,
  parseSubtitleFiles,
  findSubtitleFiles,
  expandWithSubtitlePaths,
}
