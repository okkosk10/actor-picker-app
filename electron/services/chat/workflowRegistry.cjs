'use strict'

const SCOPE_VALUES = Object.freeze({
  ALL: 'all',
  CURRENT_DRIVE: 'current_drive',
  CURRENT_FOLDER: 'current_folder',
  SELECTED_VIDEOS: 'selected_videos',
})

function normalizeWindowsPath(value) {
  if (typeof value !== 'string') return null
  let normalized = value.trim()
  if (!normalized) return null
  normalized = normalized.replace(/\//g, '\\').replace(/\\+/g, '\\')
  if (/^[a-z]:/i.test(normalized)) {
    normalized = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
  }
  normalized = normalized.replace(/\\+$/, '')
  if (!normalized || normalized.length > 500) return null
  return normalized
}

function normalizeIds(value, maxItems = 500) {
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

function resolveCurrentFolder(context = {}) {
  const direct = normalizeWindowsPath(context?.currentFolder)
  if (direct) return direct
  return normalizeWindowsPath(context?.activeFilters?.folder)
}

function resolveCurrentDrive(context = {}) {
  const direct = typeof context?.currentDrive === 'string' ? context.currentDrive : context?.activeFilters?.drive
  const match = String(direct || '').trim().match(/^([A-Za-z]):$/)
  if (match) return `${match[1].toUpperCase()}:`
  const folder = resolveCurrentFolder(context)
  const folderMatch = String(folder || '').match(/^([A-Za-z]:)/)
  return folderMatch ? folderMatch[1].toUpperCase() : null
}

function createWorkflowValidationError(code, message) {
  const error = new Error(message)
  error.name = 'WorkflowValidationError'
  error.code = code
  return error
}

function buildScopeOptions(context = {}) {
  const currentDrive = resolveCurrentDrive(context)
  const currentFolder = resolveCurrentFolder(context)
  const selectedVideoIds = normalizeIds(context?.selectedVideoIds, 500)

  return [
    {
      label: '전체 라이브러리',
      value: SCOPE_VALUES.ALL,
      disabled: false,
    },
    {
      label: '현재 드라이브',
      value: SCOPE_VALUES.CURRENT_DRIVE,
      disabled: !currentDrive,
      disabledReason: !currentDrive ? '현재 선택된 드라이브가 없습니다.' : null,
      hint: currentDrive || null,
    },
    {
      label: '현재 폴더',
      value: SCOPE_VALUES.CURRENT_FOLDER,
      disabled: !currentFolder,
      disabledReason: !currentFolder ? '현재 화면에서 선택된 폴더가 없습니다.' : null,
      hint: currentFolder || null,
    },
    {
      label: '선택한 영상',
      value: SCOPE_VALUES.SELECTED_VIDEOS,
      disabled: selectedVideoIds.length === 0,
      disabledReason: selectedVideoIds.length === 0 ? '선택한 영상이 없습니다.' : null,
      hint: selectedVideoIds.length > 0 ? `${selectedVideoIds.length}개 선택됨` : null,
    },
  ]
}

function buildScopeSlot() {
  return {
    type: 'enum',
    question: '어느 범위에서 확인할까요?',
    options: buildScopeOptions(),
    resolveOptions: (context = {}) => buildScopeOptions(context),
  }
}

function buildScopedVideoArguments(slots = {}, context = {}, defaults = {}) {
  const scope = slots.scope || SCOPE_VALUES.ALL
  const currentDrive = resolveCurrentDrive(context)
  const currentFolder = resolveCurrentFolder(context)
  const selectedVideoIds = normalizeIds(context?.selectedVideoIds, 500)
  const parsedLimit = Number(slots.limit)

  if (scope === SCOPE_VALUES.CURRENT_DRIVE && !currentDrive) {
    throw createWorkflowValidationError('CURRENT_DRIVE_NOT_AVAILABLE', '현재 선택된 드라이브가 없습니다.')
  }

  if (scope === SCOPE_VALUES.CURRENT_FOLDER && !currentFolder) {
    throw createWorkflowValidationError('CURRENT_FOLDER_NOT_AVAILABLE', '현재 화면에서 선택된 폴더가 없습니다.')
  }

  if (scope === SCOPE_VALUES.SELECTED_VIDEOS && selectedVideoIds.length === 0) {
    throw createWorkflowValidationError('SELECTED_VIDEOS_NOT_AVAILABLE', '선택한 영상이 없습니다.')
  }

  return {
    scope,
    drive: scope === SCOPE_VALUES.CURRENT_DRIVE ? currentDrive : null,
    folder: scope === SCOPE_VALUES.CURRENT_FOLDER ? currentFolder : null,
    baseResultIds: scope === SCOPE_VALUES.SELECTED_VIDEOS ? selectedVideoIds : [],
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100,
    ...defaults,
  }
}

const WORKFLOW_REGISTRY = {
  find_videos_without_subtitles: {
    id: 'find_videos_without_subtitles',
    title: '자막 없는 영상 찾기',
    description: '자막 파일이 연결되지 않은 영상을 조회합니다.',
    category: 'subtitles',
    requiredSlots: ['scope'],
    optionalSlots: ['drive', 'folder', 'limit'],
    slots: {
      scope: buildScopeSlot(),
    },
    toolName: 'search_videos_without_subtitles',
    buildArguments(slots = {}, context = {}) {
      const scope = slots.scope || SCOPE_VALUES.ALL
      const currentDrive = resolveCurrentDrive(context)
      const currentFolder = resolveCurrentFolder(context)
      const selectedVideoIds = normalizeIds(context?.selectedVideoIds, 500)
      const parsedLimit = Number(slots.limit)

      if (scope === SCOPE_VALUES.CURRENT_DRIVE && !currentDrive) {
        throw createWorkflowValidationError('CURRENT_DRIVE_NOT_AVAILABLE', '현재 선택된 드라이브가 없습니다.')
      }

      if (scope === SCOPE_VALUES.CURRENT_FOLDER && !currentFolder) {
        throw createWorkflowValidationError('CURRENT_FOLDER_NOT_AVAILABLE', '현재 화면에서 선택된 폴더가 없습니다.')
      }

      if (scope === SCOPE_VALUES.SELECTED_VIDEOS && selectedVideoIds.length === 0) {
        throw createWorkflowValidationError('SELECTED_VIDEOS_NOT_AVAILABLE', '선택한 영상이 없습니다.')
      }

      return {
        scope,
        drive: scope === SCOPE_VALUES.CURRENT_DRIVE ? currentDrive : null,
        folder: scope === SCOPE_VALUES.CURRENT_FOLDER ? currentFolder : null,
        baseResultIds: scope === SCOPE_VALUES.SELECTED_VIDEOS ? selectedVideoIds : [],
        limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100,
      }
    },
    summary(slots = {}) {
      const scopeMap = {
        all: '전체 라이브러리',
        current_drive: '현재 드라이브',
        current_folder: '현재 폴더',
        selected_videos: '선택한 영상',
      }
      return `자막이 연결되지 않은 영상을 ${scopeMap[slots.scope] || '전체 라이브러리'} 범위에서 조회합니다.`
    },
  },

  get_unmapped_subtitle_summary: {
    id: 'get_unmapped_subtitle_summary',
    title: '자막 미매핑 현황',
    description: '자막 미매핑 전체 개수와 폴더별 현황을 조회합니다.',
    category: 'subtitles',
    requiredSlots: ['scope'],
    optionalSlots: ['drive', 'folder', 'baseResultIds'],
    slots: {
      scope: buildScopeSlot(),
    },
    toolName: 'get_unmapped_subtitle_summary',
    buildArguments(slots = {}, context = {}) {
      const scope = slots.scope || SCOPE_VALUES.ALL
      const currentDrive = resolveCurrentDrive(context)
      const currentFolder = resolveCurrentFolder(context)
      const selectedVideoIds = normalizeIds(context?.selectedVideoIds, 500)

      if (scope === SCOPE_VALUES.CURRENT_DRIVE && !currentDrive) {
        throw createWorkflowValidationError('CURRENT_DRIVE_NOT_AVAILABLE', '현재 선택된 드라이브가 없습니다.')
      }

      if (scope === SCOPE_VALUES.CURRENT_FOLDER && !currentFolder) {
        throw createWorkflowValidationError('CURRENT_FOLDER_NOT_AVAILABLE', '현재 화면에서 선택된 폴더가 없습니다.')
      }

      if (scope === SCOPE_VALUES.SELECTED_VIDEOS && selectedVideoIds.length === 0) {
        throw createWorkflowValidationError('SELECTED_VIDEOS_NOT_AVAILABLE', '선택한 영상이 없습니다.')
      }

      return {
        scope,
        drive: scope === SCOPE_VALUES.CURRENT_DRIVE ? currentDrive : null,
        folder: scope === SCOPE_VALUES.CURRENT_FOLDER ? currentFolder : null,
        baseResultIds: scope === SCOPE_VALUES.SELECTED_VIDEOS ? selectedVideoIds : [],
      }
    },
    summary(slots = {}) {
      const scopeMap = {
        all: '전체 라이브러리',
        current_drive: '현재 드라이브',
        current_folder: '현재 폴더',
        selected_videos: '선택한 영상',
      }
      return `자막 미매핑 현황을 ${scopeMap[slots.scope] || '전체 라이브러리'} 기준으로 집계합니다.`
    },
  },

  find_uncopied_videos: {
    id: 'find_uncopied_videos',
    title: '미복사 영상 찾기',
    description: '복사 이력이 없는 영상을 조회합니다.',
    category: 'videos',
    requiredSlots: ['scope'],
    optionalSlots: ['drive', 'folder', 'limit'],
    slots: {
      scope: buildScopeSlot(),
    },
    toolName: 'search_videos',
    buildArguments(slots = {}, context = {}) {
      return buildScopedVideoArguments(slots, context, {
        onlyNotCopied: true,
        sortBy: 'themeScore',
      })
    },
    summary(slots = {}) {
      const scopeMap = {
        all: '전체 라이브러리',
        current_drive: '현재 드라이브',
        current_folder: '현재 폴더',
        selected_videos: '선택한 영상',
      }
      return `미복사 영상을 ${scopeMap[slots.scope] || '전체 라이브러리'} 범위에서 조회합니다.`
    },
  },

  find_high_rated_videos: {
    id: 'find_high_rated_videos',
    title: '별점 높은 영상 찾기',
    description: '별점 4점 이상 영상을 높은 순으로 조회합니다.',
    category: 'videos',
    requiredSlots: ['scope'],
    optionalSlots: ['drive', 'folder', 'limit'],
    slots: {
      scope: buildScopeSlot(),
    },
    toolName: 'search_videos',
    buildArguments(slots = {}, context = {}) {
      return buildScopedVideoArguments(slots, context, {
        minRating: 4,
        sortBy: 'rating',
      })
    },
    summary(slots = {}) {
      const scopeMap = {
        all: '전체 라이브러리',
        current_drive: '현재 드라이브',
        current_folder: '현재 폴더',
        selected_videos: '선택한 영상',
      }
      return `별점 높은 영상을 ${scopeMap[slots.scope] || '전체 라이브러리'} 범위에서 조회합니다.`
    },
  },

  find_recent_videos: {
    id: 'find_recent_videos',
    title: '최근 추가 영상 찾기',
    description: '최근 추가된 영상을 최신 순으로 조회합니다.',
    category: 'videos',
    requiredSlots: ['scope'],
    optionalSlots: ['drive', 'folder', 'limit'],
    slots: {
      scope: buildScopeSlot(),
    },
    toolName: 'search_videos',
    buildArguments(slots = {}, context = {}) {
      return buildScopedVideoArguments(slots, context, {
        sortBy: 'recent',
      })
    },
    summary(slots = {}) {
      const scopeMap = {
        all: '전체 라이브러리',
        current_drive: '현재 드라이브',
        current_folder: '현재 폴더',
        selected_videos: '선택한 영상',
      }
      return `최근 추가 영상을 ${scopeMap[slots.scope] || '전체 라이브러리'} 범위에서 조회합니다.`
    },
  },

  search_videos: {
    id: 'search_videos',
    title: '영상 검색',
    description: '조건에 맞는 영상을 조회합니다.',
    category: 'videos',
    requiredSlots: ['searchCriterion'],
    optionalSlots: ['query', 'actorName', 'minRating', 'actorMinRating', 'onlyNotCopied', 'onlyNew', 'sortBy', 'limit'],
    slots: {
      searchCriterion: {
        type: 'enum',
        question: '어떤 기준으로 찾을까요?',
        options: [
          { label: '별점 높은 영상', value: 'high_rating' },
          { label: '미복사 영상', value: 'not_copied' },
          { label: '최근 추가 영상', value: 'recent' },
          { label: '직접 검색어 입력', value: 'query' },
        ],
      },
    },
    toolName: 'search_videos',
    buildArguments(slots = {}, context = {}) {
      const criterion = slots.searchCriterion
      const args = {
        query: slots.query || '',
        actorNames: slots.actorName ? [slots.actorName] : [],
        minRating: Number(slots.minRating) || 0,
        actorMinRating: Number(slots.actorMinRating) || 0,
        onlyNotCopied: Boolean(slots.onlyNotCopied),
        onlyNew: Boolean(slots.onlyNew),
        onlyFavorite: Boolean(slots.onlyFavorite),
        sortBy: slots.sortBy || 'themeScore',
        limit: Number(slots.limit) > 0 ? Number(slots.limit) : 50,
      }

      if (criterion === 'high_rating') {
        args.sortBy = 'rating'
        args.minRating = Math.max(args.minRating, 4)
      } else if (criterion === 'not_copied') {
        args.onlyNotCopied = true
      } else if (criterion === 'recent') {
        args.sortBy = 'recent'
      }

      return args
    },
    summary(slots = {}) {
      const criterionMap = {
        high_rating: '별점 높은 영상',
        not_copied: '미복사 영상',
        recent: '최근 추가 영상',
        query: '직접 검색어 기반 영상',
      }
      return `${criterionMap[slots.searchCriterion] || '영상'}을(를) 조회합니다.`
    },
  },

  search_actors: {
    id: 'search_actors',
    title: '배우 검색',
    description: '배우 정보를 조건으로 조회합니다.',
    category: 'actors',
    requiredSlots: ['searchCriterion'],
    optionalSlots: ['query', 'agency', 'minRating', 'metadataMissing', 'limit'],
    slots: {
      searchCriterion: {
        type: 'enum',
        question: '어떤 배우를 찾을까요?',
        options: [
          { label: '메타데이터 부족 배우', value: 'metadata_missing' },
          { label: '별점 높은 배우', value: 'high_rating' },
          { label: '직접 검색', value: 'query' },
        ],
      },
    },
    toolName: 'search_actors',
    buildArguments(slots = {}) {
      const criterion = slots.searchCriterion
      const args = {
        query: slots.query || '',
        agency: slots.agency || '',
        minRating: Number(slots.minRating) || 0,
        metadataMissing: Boolean(slots.metadataMissing),
        limit: Number(slots.limit) > 0 ? Number(slots.limit) : 30,
      }
      if (criterion === 'metadata_missing') args.metadataMissing = true
      if (criterion === 'high_rating') args.minRating = Math.max(args.minRating, 4)
      return args
    },
    summary(slots = {}) {
      const criterionMap = {
        metadata_missing: '메타데이터가 부족한 배우',
        high_rating: '별점 높은 배우',
        query: '검색어 기반 배우',
      }
      return `${criterionMap[slots.searchCriterion] || '배우'}를 조회합니다.`
    },
  },

  get_drive_stats: {
    id: 'get_drive_stats',
    title: '드라이브 현황',
    description: '드라이브별 영상 수와 용량 현황을 조회합니다.',
    category: 'storage',
    requiredSlots: ['scope'],
    optionalSlots: ['drive'],
    slots: {
      scope: {
        type: 'enum',
        question: '어떤 범위를 볼까요?',
        options: [
          { label: '전체 드라이브', value: 'all' },
          { label: '현재 드라이브', value: 'current_drive' },
          { label: '직접 드라이브 선택', value: 'specific_drive' },
        ],
      },
    },
    toolName: 'get_drive_stats',
    buildArguments(slots = {}, context = {}) {
      if (slots.scope === 'current_drive') {
        return { drive: resolveCurrentDrive(context) }
      }
      if (slots.scope === 'specific_drive') {
        return { drive: slots.drive || null }
      }
      return { drive: null }
    },
    summary(slots = {}) {
      if (slots.scope === 'current_drive') return '현재 드라이브 현황을 조회합니다.'
      if (slots.scope === 'specific_drive') return `${slots.drive || '선택한'} 드라이브 현황을 조회합니다.`
      return '전체 드라이브 현황을 조회합니다.'
    },
  },

  cleanup_storage: {
    id: 'cleanup_storage',
    title: '저장 공간 정리 후보',
    description: '저장 공간 정리 후보를 조회합니다. 실제 삭제는 수행하지 않습니다.',
    category: 'storage',
    requiredSlots: ['scope', 'cleanupGoal'],
    optionalSlots: ['drive', 'minSizeBytes', 'maxRating', 'lowPlayCount', 'onlyNotCopied', 'sortBy', 'limit'],
    slots: {
      scope: {
        type: 'enum',
        question: '어느 범위에서 정리 후보를 찾을까요?',
        options: [
          { label: '전체 라이브러리', value: 'all' },
          { label: '현재 드라이브', value: 'current_drive' },
          { label: '직접 드라이브 선택', value: 'specific_drive' },
        ],
      },
      cleanupGoal: {
        type: 'enum',
        question: '어떤 기준으로 정리 후보를 찾을까요?',
        options: [
          { label: '용량이 큰 순', value: 'large_files' },
          { label: '안 본 영상 우선', value: 'unplayed' },
          { label: '별점 낮은 영상 우선', value: 'low_rating' },
          { label: '미복사 영상 우선', value: 'not_copied' },
        ],
      },
    },
    toolName: 'get_delete_candidates',
    buildArguments(slots = {}, context = {}) {
      const goal = slots.cleanupGoal
      const args = {
        drive: null,
        lowRating: Boolean(slots.lowRating),
        lowPlayCount: Boolean(slots.lowPlayCount),
        onlyNotCopied: Boolean(slots.onlyNotCopied),
        minSizeBytes: Number(slots.minSizeBytes) > 0 ? Number(slots.minSizeBytes) : 0,
        sortBy: slots.sortBy || 'deleteScore',
        limit: Number(slots.limit) > 0 ? Number(slots.limit) : 20,
      }

      if (slots.scope === 'current_drive') args.drive = resolveCurrentDrive(context)
      if (slots.scope === 'specific_drive') args.drive = slots.drive || null

      if (goal === 'large_files') {
        args.sortBy = 'size'
        args.minSizeBytes = Math.max(args.minSizeBytes, 10 * 1024 ** 3)
      }
      if (goal === 'unplayed') args.lowPlayCount = true
      if (goal === 'low_rating') args.lowRating = true
      if (goal === 'not_copied') args.onlyNotCopied = true

      if (Number(slots.maxRating) > 0 && Number(slots.maxRating) <= 5) {
        args.lowRating = true
      }

      return args
    },
    summary(slots = {}) {
      const goalMap = {
        large_files: '용량이 큰 영상',
        unplayed: '재생 횟수가 적은 영상',
        low_rating: '별점이 낮은 영상',
        not_copied: '복사 이력이 없는 영상',
      }
      return `${goalMap[slots.cleanupGoal] || '정리 우선순위가 높은 영상'}을 기준으로 정리 후보를 조회합니다.`
    },
  },
}

const QUICK_WORKFLOW_CATEGORIES = [
  {
    id: 'subtitles',
    title: '자막 관리',
    workflows: ['find_videos_without_subtitles', 'get_unmapped_subtitle_summary'],
  },
  {
    id: 'videos',
    title: '영상 찾기',
    workflows: ['find_uncopied_videos', 'find_high_rated_videos', 'find_recent_videos'],
  },
  {
    id: 'storage',
    title: '저장소',
    workflows: ['get_drive_stats', 'cleanup_storage'],
  },
]

function getWorkflow(workflowId) {
  return WORKFLOW_REGISTRY[workflowId] || null
}

function listWorkflowCategories() {
  return QUICK_WORKFLOW_CATEGORIES.map((category) => ({
    ...category,
    workflowSummaries: category.workflows
      .map((workflowId) => getWorkflow(workflowId))
      .filter(Boolean)
      .map((workflow) => ({
        id: workflow.id,
        title: workflow.title,
        description: workflow.description,
      })),
  }))
}

function listWorkflowsByCategory(categoryId) {
  const category = QUICK_WORKFLOW_CATEGORIES.find((item) => item.id === categoryId)
  if (!category) return []
  return category.workflows
    .map((workflowId) => getWorkflow(workflowId))
    .filter(Boolean)
}

function toToolAction(workflowId, slots = {}, context = {}) {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return null
  return {
    workflowId,
    toolName: workflow.toolName,
    arguments: workflow.buildArguments(slots, context),
    summary: typeof workflow.summary === 'function' ? workflow.summary(slots, context) : workflow.description,
  }
}

module.exports = {
  WORKFLOW_REGISTRY,
  QUICK_WORKFLOW_CATEGORIES,
  SCOPE_VALUES,
  normalizeWindowsPath,
  normalizeIds,
  resolveCurrentFolder,
  resolveCurrentDrive,
  buildScopeOptions,
  createWorkflowValidationError,
  getWorkflow,
  listWorkflowCategories,
  listWorkflowsByCategory,
  toToolAction,
}