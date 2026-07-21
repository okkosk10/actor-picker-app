'use strict'

const { TOOL_SCHEMAS, ERROR_CODES } = require('./chatSchemas.cjs')

const REGISTERED_TOOL_NAMES = Object.keys(TOOL_SCHEMAS)

function isRegisteredTool(toolName) {
  return typeof toolName === 'string' && Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, toolName)
}

function clampNumber(value, min, max, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeStringArray(value, maxItems = 20) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const item of value) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function normalizeIntegerArray(value, maxItems = 200) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const item of value) {
    const parsed = Number(item)
    if (!Number.isInteger(parsed) || parsed <= 0 || seen.has(parsed)) continue
    seen.add(parsed)
    result.push(parsed)
    if (result.length >= maxItems) break
  }
  return result
}

function normalizeDrive(value) {
  if (value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toUpperCase()
  if (!trimmed) return null
  const match = trimmed.match(/^([A-Z]:)/)
  return match ? match[1] : null
}

function normalizeFolderPath(value) {
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

function normalizeScope(value, fallback = 'all') {
  const allowed = new Set(['all', 'current_drive', 'current_folder', 'selected_videos'])
  return allowed.has(value) ? value : fallback
}

function inferSubtitleScope(raw = {}) {
  if (raw && typeof raw === 'object' && typeof raw.scope === 'string') {
    return normalizeScope(raw.scope, 'all')
  }
  if (normalizeFolderPath(raw?.folder)) return 'current_folder'
  if (normalizeDrive(raw?.drive)) return 'current_drive'
  if (Array.isArray(raw?.baseResultIds) && raw.baseResultIds.length > 0) return 'selected_videos'
  return 'all'
}

function validateSubtitleSearchScope(toolName, args = {}) {
  if (toolName !== 'search_videos_without_subtitles' && toolName !== 'get_unmapped_subtitle_summary') {
    return { success: true }
  }

  if (args.scope === 'current_drive' && !args.drive) {
    return buildStructuredError('TOOL_ARGUMENT_ERROR', '현재 드라이브 범위를 사용하려면 drive 값이 필요합니다.')
  }

  if (args.scope === 'current_folder' && !args.folder) {
    return buildStructuredError('TOOL_ARGUMENT_ERROR', '현재 폴더 범위를 사용하려면 folder 값이 필요합니다.')
  }

  if (args.scope === 'selected_videos' && (!Array.isArray(args.baseResultIds) || args.baseResultIds.length === 0)) {
    return buildStructuredError('TOOL_ARGUMENT_ERROR', '선택한 영상 범위를 사용하려면 baseResultIds가 1개 이상 필요합니다.')
  }

  return { success: true }
}

function sanitizeToolArguments(toolName, input = {}, context = {}, state = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const currentDrive = normalizeDrive(context?.currentDrive)
    || normalizeDrive(context?.activeFilters?.drive)
    || normalizeDrive(context?.currentFolder?.slice?.(0, 2))
  const currentFolder = normalizeFolderPath(context?.currentFolder) || normalizeFolderPath(context?.activeFilters?.folder)
  const lastResultIds = normalizeIntegerArray(state?.lastResultIds || [], 200)
  const selectedVideoIds = normalizeIntegerArray(context?.selectedVideoIds || [], 500)
  const baseResultIds = normalizeIntegerArray(raw.baseResultIds || [], 500)
  const inheritedBaseIds = baseResultIds.length > 0 ? baseResultIds : (lastResultIds.length > 0 ? lastResultIds : selectedVideoIds)

  switch (toolName) {
    case 'search_videos':
      return {
        query: String(raw.query || '').trim(),
        actorNames: normalizeStringArray(raw.actorNames || []),
        minRating: clampNumber(raw.minRating, 0, 5, 0),
        actorMinRating: clampNumber(raw.actorMinRating, 0, 10, 0),
        onlyNotCopied: Boolean(raw.onlyNotCopied),
        onlyNew: Boolean(raw.onlyNew),
        onlyFavorite: Boolean(raw.onlyFavorite),
        sortBy: ['rating', 'size', 'recent', 'playCount', 'copyCount', 'themeScore'].includes(raw.sortBy) ? raw.sortBy : 'themeScore',
        limit: clampNumber(raw.limit, 1, 100, 20),
        baseResultIds: normalizeIntegerArray(raw.baseResultIds || inheritedBaseIds, 200),
        drive: normalizeDrive(raw.drive) || currentDrive,
      }
    case 'search_actors':
      return {
        query: String(raw.query || '').trim(),
        agency: String(raw.agency || '').trim(),
        minRating: clampNumber(raw.minRating, 0, 10, 0),
        metadataMissing: Boolean(raw.metadataMissing),
        limit: clampNumber(raw.limit, 1, 100, 20),
        baseResultIds: normalizeIntegerArray(raw.baseResultIds || inheritedBaseIds, 200),
      }
    case 'get_drive_stats':
      return {
        drive: normalizeDrive(raw.drive) || currentDrive,
      }
    case 'get_delete_candidates':
      return {
        drive: normalizeDrive(raw.drive) || currentDrive,
        lowRating: Boolean(raw.lowRating),
        lowPlayCount: Boolean(raw.lowPlayCount),
        onlyNotCopied: Boolean(raw.onlyNotCopied),
        minSizeBytes: Number.isFinite(Number(raw.minSizeBytes)) ? Math.max(0, Number(raw.minSizeBytes)) : 0,
        sortBy: ['deleteScore', 'size', 'rating', 'playCount'].includes(raw.sortBy) ? raw.sortBy : 'deleteScore',
        limit: clampNumber(raw.limit, 1, 100, 20),
        baseResultIds: normalizeIntegerArray(raw.baseResultIds || inheritedBaseIds, 200),
      }
    case 'get_unmapped_subtitle_summary':
      {
        const scope = inferSubtitleScope(raw)
      return {
        scope,
        drive: normalizeDrive(raw.drive) || (scope === 'current_drive' ? currentDrive : null),
        folder: normalizeFolderPath(raw.folder) || (scope === 'current_folder' ? currentFolder : null),
        baseResultIds: normalizeIntegerArray(raw.baseResultIds || (scope === 'selected_videos' ? inheritedBaseIds : []), 500),
      }
      }
    case 'search_videos_without_subtitles':
      {
        const scope = inferSubtitleScope(raw)
      return {
        scope,
        drive: normalizeDrive(raw.drive) || (scope === 'current_drive' ? currentDrive : null),
        folder: normalizeFolderPath(raw.folder) || (scope === 'current_folder' ? currentFolder : null),
        limit: clampNumber(raw.limit, 1, 500, 100),
        baseResultIds: normalizeIntegerArray(raw.baseResultIds || (scope === 'selected_videos' ? inheritedBaseIds : []), 500),
      }
      }
    default:
      return {}
  }
}

function validatePlannerResponse(plan) {
  if (!plan || typeof plan !== 'object') {
    return { success: false, errorCode: 'AI_RESPONSE_PARSE_ERROR', error: 'Intent Planner 응답이 올바르지 않습니다.' }
  }

  if (typeof plan.needsClarification === 'boolean' && plan.needsClarification) {
    return { success: true, plan }
  }

  if (!isRegisteredTool(plan.toolName)) {
    return { success: false, errorCode: 'UNKNOWN_TOOL', error: '등록되지 않은 도구가 선택되었습니다.' }
  }

  return { success: true, plan }
}

function buildToolManifestBlock() {
  return REGISTERED_TOOL_NAMES.map((name) => `- ${name}: ${TOOL_SCHEMAS[name].description}`).join('\n')
}

function buildToolRegistryObject() {
  return { ...TOOL_SCHEMAS }
}

function buildStructuredError(errorCode, error) {
  return {
    success: false,
    errorCode: ERROR_CODES.includes(errorCode) ? errorCode : 'UNKNOWN_TOOL',
    error,
  }
}

module.exports = {
  TOOL_SCHEMAS,
  REGISTERED_TOOL_NAMES,
  isRegisteredTool,
  sanitizeToolArguments,
  validatePlannerResponse,
  validateSubtitleSearchScope,
  buildToolManifestBlock,
  buildToolRegistryObject,
  buildStructuredError,
}