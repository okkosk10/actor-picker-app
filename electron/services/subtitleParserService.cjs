'use strict'

const fs = require('fs')
const path = require('path')

const SUPPORTED_SUBTITLE_EXTS = new Set(['.srt', '.ass', '.ssa', '.vtt'])

function normalizeLineEndings(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
}

function formatCueTime(value) {
  const totalMilliseconds = Math.max(0, Math.floor(Number(value) || 0))
  const hours = Math.floor(totalMilliseconds / 3600000)
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000)
  const seconds = Math.floor((totalMilliseconds % 60000) / 1000)
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function parseTimestampToMs(value) {
  const raw = String(value ?? '').trim().replace(',', '.')
  const match = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const fraction = Number((match[4] || '0').padEnd(3, '0'))
  if (![hours, minutes, seconds, fraction].every((value) => Number.isFinite(value))) return null
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction
}

function parseAssTimestampToMs(value) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const centiseconds = Number(match[4])
  if (![hours, minutes, seconds, centiseconds].every((value) => Number.isFinite(value))) return null
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + centiseconds * 10
}

function stripMarkup(text) {
  return String(text ?? '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
}

function normalizeCueText(text) {
  const lines = normalizeLineEndings(stripMarkup(text))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.join('\n')
}

function isBoilerplateLine(line) {
  const normalized = normalizeText(line).toLowerCase()
  if (!normalized) return true
  if (/https?:\/\//i.test(normalized) || /\bwww\./i.test(normalized)) return true
  if (/\b(subtitle|sub by|translated by)\b/i.test(normalized)) return true

  const phrases = ['자막 제작', '자막제작', '번역:', '번역 :', '무단 배포', '무단전재', 'sns', 'telegram', 'discord']
  return phrases.some((phrase) => normalized.includes(phrase))
}

function isShortRepetitionCandidate(text) {
  const normalized = normalizeText(text).replace(/\s+/g, '')
  if (!normalized || normalized.length > 10) return false
  return /^[\p{L}\p{N}\.·…!?~ㅋㅎㅜㅠ]+$/u.test(normalized)
}

function parseSrtContent(content) {
  const blocks = normalizeLineEndings(content)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)

  const cues = []
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimRight())
    const timeLineIndex = lines.findIndex((line) => /-->/.test(line))
    if (timeLineIndex < 0) continue

    const timeMatch = lines[timeLineIndex].match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/)
    if (!timeMatch) continue

    const startMs = parseTimestampToMs(timeMatch[1])
    const endMs = parseTimestampToMs(timeMatch[2])
    if (startMs == null || endMs == null) continue

    cues.push({
      startMs,
      endMs,
      startTime: formatCueTime(startMs),
      endTime: formatCueTime(endMs),
      text: lines.slice(timeLineIndex + 1).join('\n'),
    })
  }

  return cues
}

function parseVttContent(content) {
  const lines = normalizeLineEndings(content).split('\n')
  const cues = []
  let index = 0

  if (lines[0] && /^WEBVTT/i.test(lines[0])) index = 1

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index += 1
    if (index >= lines.length) break

    if (!/-->/.test(lines[index]) && index + 1 < lines.length && /-->/.test(lines[index + 1])) {
      index += 1
    }

    const timeLine = lines[index]
    const timeMatch = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/)
    if (!timeMatch) {
      index += 1
      continue
    }

    const startMs = parseTimestampToMs(timeMatch[1])
    const endMs = parseTimestampToMs(timeMatch[2])
    index += 1

    const textLines = []
    while (index < lines.length && lines[index].trim()) {
      textLines.push(lines[index])
      index += 1
    }

    if (startMs == null || endMs == null) continue
    cues.push({
      startMs,
      endMs,
      startTime: formatCueTime(startMs),
      endTime: formatCueTime(endMs),
      text: textLines.join('\n'),
    })
  }

  return cues
}

function parseAssContent(content) {
  const lines = normalizeLineEndings(content).split('\n')
  const cues = []
  let inEvents = false
  let formatFields = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\[Events\]/i.test(trimmed)) {
      inEvents = true
      continue
    }
    if (!inEvents) continue
    if (/^\[/.test(trimmed) && !/^\[Events\]/i.test(trimmed)) break

    const formatMatch = trimmed.match(/^Format:\s*(.+)$/i)
    if (formatMatch) {
      formatFields = formatMatch[1].split(',').map((field) => field.trim().toLowerCase())
      continue
    }

    const dialogueMatch = trimmed.match(/^Dialogue:\s*(.+)$/i)
    if (!dialogueMatch || formatFields.length === 0) continue

    const parts = dialogueMatch[1].split(',')
    if (parts.length < formatFields.length) continue

    const startIndex = formatFields.indexOf('start')
    const endIndex = formatFields.indexOf('end')
    if (startIndex < 0 || endIndex < 0) continue

    const startMs = parseAssTimestampToMs(parts[startIndex])
    const endMs = parseAssTimestampToMs(parts[endIndex])
    if (startMs == null || endMs == null) continue

    const text = parts.slice(formatFields.length - 1).join(',')
    cues.push({
      startMs,
      endMs,
      startTime: formatCueTime(startMs),
      endTime: formatCueTime(endMs),
      text,
    })
  }

  return cues
}

function sanitizeSubtitleCues(cues) {
  const cleaned = []
  let removedAdLines = 0
  let removedDuplicateLines = 0
  let collapsedRepetitionCount = 0

  for (const cue of Array.isArray(cues) ? cues : []) {
    const rawText = normalizeCueText(cue.text)
    if (!rawText) continue

    const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean)
    const keptLines = lines.filter((line) => {
      if (isBoilerplateLine(line)) {
        removedAdLines += 1
        return false
      }
      return true
    })

    if (keptLines.length === 0) continue

    const cleanedText = keptLines.join('\n').replace(/[ \t]+/g, ' ').trim()
    if (!cleanedText) continue

    cleaned.push({ ...cue, text: cleanedText })
  }

  const collapsed = []
  for (let index = 0; index < cleaned.length; ) {
    const cue = cleaned[index]
    const normalized = normalizeText(cue.text).replace(/\s+/g, ' ')
    let runLength = 1
    while (index + runLength < cleaned.length) {
      const next = cleaned[index + runLength]
      if (normalizeText(next.text).replace(/\s+/g, ' ') !== normalized) break
      runLength += 1
    }

    if (runLength >= 3 && isShortRepetitionCandidate(normalized)) {
      collapsed.push({ ...cue, text: `[반복 감탄사 ${runLength}회]` })
      collapsedRepetitionCount += runLength
    } else {
      collapsed.push(cue)
      if (runLength > 1) removedDuplicateLines += runLength - 1
    }

    index += runLength
  }

  return {
    cues: collapsed,
    stats: {
      originalCueCount: Array.isArray(cues) ? cues.length : 0,
      processedCueCount: collapsed.length,
      removedAdLines,
      removedDuplicateLines,
      collapsedRepetitionCount,
    },
  }
}

async function readSubtitleFile(filePath) {
  return fs.promises.readFile(filePath, 'utf8')
}

function parseSubtitleContent({ filePath, content }) {
  const ext = path.extname(filePath || '').toLowerCase()
  let cues = []

  if (ext === '.srt') cues = parseSrtContent(content)
  else if (ext === '.vtt') cues = parseVttContent(content)
  else if (ext === '.ass' || ext === '.ssa') cues = parseAssContent(content)
  else throw new Error('지원하지 않는 자막 형식입니다.')

  return sanitizeSubtitleCues(cues)
}

module.exports = {
  SUPPORTED_SUBTITLE_EXTS,
  normalizeLineEndings,
  normalizeText,
  formatCueTime,
  parseTimestampToMs,
  parseAssTimestampToMs,
  stripMarkup,
  normalizeCueText,
  parseSrtContent,
  parseVttContent,
  parseAssContent,
  sanitizeSubtitleCues,
  parseSubtitleContent,
  readSubtitleFile,
}