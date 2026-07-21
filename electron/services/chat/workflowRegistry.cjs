'use strict'

function normalizeDriveFromContext(context = {}) {
  const direct = typeof context?.activeFilters?.drive === 'string' ? context.activeFilters.drive : ''
  if (/^[A-Za-z]:$/.test(direct)) return direct.toUpperCase()
  const folder = typeof context?.currentFolder === 'string' ? context.currentFolder : ''
  const match = folder.match(/^([A-Za-z]:)/)
  return match ? match[1].toUpperCase() : null
}

function buildScopeSlot() {
  return {
    type: 'enum',
    question: '어느 범위에서 확인할까요?',
    options: [
      { label: '전체 라이브러리', value: 'all' },
      { label: '현재 드라이브', value: 'current_drive' },
      { label: '현재 폴더', value: 'current_folder' },
      { label: '선택한 영상', value: 'selected_videos' },
    ],
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
      const scope = slots.scope || 'all'
      const driveFromContext = normalizeDriveFromContext(context)
      return {
        drive: scope === 'current_drive' ? driveFromContext : (slots.drive || null),
        baseResultIds: scope === 'selected_videos' ? (context.selectedVideoIds || []) : [],
        limit: Number(slots.limit) > 0 ? Number(slots.limit) : 100,
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
    title: '자막 미매핑 현황 조회',
    description: '자막 미매핑 전체 개수와 폴더별 현황을 조회합니다.',
    category: 'subtitles',
    requiredSlots: ['scope'],
    optionalSlots: ['drive'],
    slots: {
      scope: buildScopeSlot(),
    },
    toolName: 'get_unmapped_subtitle_summary',
    buildArguments(slots = {}, context = {}) {
      const scope = slots.scope || 'all'
      const driveFromContext = normalizeDriveFromContext(context)
      return {
        drive: scope === 'current_drive' ? driveFromContext : (slots.drive || null),
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

  search_videos: {
    id: 'search_videos',
    title: '영상 검색',
    description: '조건에 맞는 영상을 조회합니다.',
    category: 'videos',
    requiredSlots: ['searchCriterion'],
    optionalSlots: ['query', 'actorName', 'minRating', 'actorMinRating', 'onlyNotCopied', 'onlyNew', 'sortBy', 'scope', 'limit'],
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
      scope: buildScopeSlot(),
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

      if (slots.scope === 'selected_videos') {
        args.baseResultIds = context.selectedVideoIds || []
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
        return { drive: normalizeDriveFromContext(context) }
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

      if (slots.scope === 'current_drive') args.drive = normalizeDriveFromContext(context)
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
    id: 'videos',
    title: '영상 찾기',
    workflows: ['search_videos'],
  },
  {
    id: 'subtitles',
    title: '자막 상태 확인',
    workflows: ['find_videos_without_subtitles', 'get_unmapped_subtitle_summary'],
  },
  {
    id: 'actors',
    title: '배우 찾기',
    workflows: ['search_actors'],
  },
  {
    id: 'storage',
    title: '저장소 현황',
    workflows: ['get_drive_stats'],
  },
  {
    id: 'cleanup',
    title: '저장 공간 정리',
    workflows: ['cleanup_storage'],
  },
  {
    id: 'recommendation',
    title: '추천 영상 찾기',
    workflows: ['search_videos'],
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
  getWorkflow,
  listWorkflowCategories,
  listWorkflowsByCategory,
  toToolAction,
}