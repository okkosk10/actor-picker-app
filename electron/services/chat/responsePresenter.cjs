'use strict'

const { DEFAULT_CLARIFICATION_OPTIONS } = require('./chatSchemas.cjs')
const { buildSummaryStatsFromVideos, buildSummaryStatsFromCandidates } = require('./toolExecutor.cjs')

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function metric(key, label, value) {
  return { key, label, value }
}

function describeAppliedScope(appliedFilters = {}) {
  const scope = String(appliedFilters.scope || 'all')
  if (scope === 'current_folder') {
    return {
      type: scope,
      label: '현재 폴더',
      value: appliedFilters.folder || null,
      line: appliedFilters.folder ? `${appliedFilters.folder} 폴더에서` : '현재 폴더에서',
    }
  }
  if (scope === 'current_drive') {
    return {
      type: scope,
      label: '현재 드라이브',
      value: appliedFilters.drive || null,
      line: appliedFilters.drive ? `${appliedFilters.drive} 드라이브에서` : '현재 드라이브에서',
    }
  }
  if (scope === 'selected_videos') {
    const count = Array.isArray(appliedFilters.baseResultIds) ? appliedFilters.baseResultIds.length : 0
    return {
      type: scope,
      label: '선택한 영상',
      value: `${count}개`,
      line: `선택한 영상 ${count}개 중`,
    }
  }
  return {
    type: 'all',
    label: '전체 라이브러리',
    value: null,
    line: '전체 라이브러리에서',
  }
}

function compactVideoItem(item) {
  const video = item?.video || {}
  return {
    id: Number(video.id) || 0,
    title: String(video.code || video.file_name || video.id || ''),
    subtitle: [
      video.file_name,
      video.file_size ? formatBytes(video.file_size) : '',
      video.rating ? `별점 ${video.rating}` : '',
      Number(video.play_count || 0) > 0 ? `재생 ${video.play_count}회` : '재생 0회',
      Number(video.copy_count || 0) > 0 ? `복사 ${video.copy_count}회` : '미복사',
    ].filter(Boolean).join(' · '),
    reasons: [item?.reason, item?.scoreComment].filter(Boolean),
  }
}

function compactActorItem(item) {
  return {
    id: Number(item?.id) || 0,
    title: String(item?.name || item?.id || ''),
    subtitle: [
      item?.agency || '소속사 없음',
      item?.rating ? `별점 ${item.rating}` : '별점 없음',
      Number(item?.videoCount || 0) > 0 ? `작품 ${item.videoCount}개` : '작품 없음',
    ].filter(Boolean).join(' · '),
    reasons: [item?.memo, item?.tags].filter(Boolean),
  }
}

function compactCandidateItem(item) {
  const candidate = item?.candidate || item?.video || item || {}
  return {
    id: Number(candidate.id) || 0,
    title: String(candidate.filename || candidate.file_name || candidate.code || candidate.id || ''),
    subtitle: [
      candidate.file_size ? formatBytes(candidate.file_size) : '',
      candidate.rating ? `별점 ${candidate.rating}` : '별점 없음',
      Number(candidate.watch_count || candidate.play_count || 0) > 0 ? `재생 ${candidate.watch_count || candidate.play_count}회` : '재생 0회',
      Number(candidate.copy_count || 0) > 0 ? `복사 ${candidate.copy_count}회` : '미복사',
    ].filter(Boolean).join(' · '),
    reasons: Array.isArray(candidate.reason) ? candidate.reason : [item?.reason, item?.scoreComment].filter(Boolean),
  }
}

function buildClarificationResponse(plan) {
  const clarification = plan?.clarification || {}
  const options = Array.isArray(clarification.options) && clarification.options.length > 0
    ? clarification.options
    : DEFAULT_CLARIFICATION_OPTIONS

  return {
    success: true,
    resultType: 'clarification',
    message: String(clarification.question || '어떤 기준으로 찾을까요?'),
    clarification: {
      question: String(clarification.question || '어떤 기준으로 찾을까요?'),
      options: options.map((option, index) => ({
        id: String(option.id || `option-${index + 1}`),
        label: String(option.label || option.id || `옵션 ${index + 1}`),
        payload: option.payload || {},
        type: option.type || 'refine_query',
        requiresConfirmation: Boolean(option.requiresConfirmation),
      })),
    },
    summary: {
      title: '추가 기준이 필요합니다',
      description: '아래 버튼 중 하나를 선택하면 구조화된 조건으로 다시 검색합니다.',
      metrics: [],
    },
    suggestedActions: options.map((option, index) => ({
      id: String(option.id || `option-${index + 1}`),
      type: option.type || 'refine_query',
      label: String(option.label || option.id || `옵션 ${index + 1}`),
      payload: option.payload || {},
      requiresConfirmation: Boolean(option.requiresConfirmation),
    })),
    state: {
      lastToolCall: null,
      lastResultIds: [],
      activeFilters: {},
      pendingAction: null,
    },
  }
}

function buildResultSummary(type, plan, raw) {
  if (type === 'drive-stats') {
    const drives = Array.isArray(raw.drives) ? raw.drives : []
    const top = drives[0] || null
    const totalVideos = drives.reduce((sum, drive) => sum + (Number(drive.totalVideos) || 0), 0)
    const totalSize = drives.reduce((sum, drive) => sum + (Number(drive.totalSize) || 0), 0)
    return {
      title: top ? `${top.drive} 드라이브 통계` : '드라이브 통계',
      description: top
        ? `${top.drive} 드라이브가 가장 큰 비중을 차지합니다.`
        : `${drives.length}개 드라이브를 집계했습니다.`,
      metrics: [
        metric('count', '드라이브', drives.length),
        metric('videos', '영상 수', totalVideos),
        metric('size', '총 용량', formatBytes(totalSize)),
        metric('deleteCandidates', '삭제 후보', drives.reduce((sum, drive) => sum + (Number(drive.deleteCandidateCount) || 0), 0)),
      ],
    }
  }

  if (type === 'delete-candidate-list') {
    const candidates = Array.isArray(raw.items) ? raw.items : []
    const stats = buildSummaryStatsFromCandidates(candidates)
    return {
      title: `${stats.totalCount}개 정리 후보`,
      description: `${formatBytes(stats.totalSize)} 정도를 우선 검토하면 확보할 수 있습니다.`,
      metrics: [
        metric('count', '후보', stats.totalCount),
        metric('size', '예상 확보', formatBytes(stats.totalSize)),
        metric('unplayed', '미재생', stats.unplayed),
        metric('notCopied', '미복사', stats.notCopied),
      ],
    }
  }

  if (type === 'actor-list') {
    const actors = Array.isArray(raw.items) ? raw.items : []
    const avgRating = actors.length > 0
      ? Math.round((actors.reduce((sum, actor) => sum + (Number(actor.rating) || 0), 0) / actors.length) * 10) / 10
      : 0
    return {
      title: `${actors.length}명 배우 검색 결과`,
      description: `평균 별점 ${avgRating}점 수준의 배우들을 찾았습니다.`,
      metrics: [
        metric('count', '배우', actors.length),
        metric('avgRating', '평균 별점', avgRating),
        metric('missingMeta', '메타 누락', actors.filter((actor) => !actor.agency || !actor.memo || !actor.tags || Number(actor.rating || 0) === 0).length),
      ],
    }
  }

  if (type === 'subtitle-summary') {
    const folders = Array.isArray(raw.folderCounts) ? raw.folderCounts : []
    const scopeInfo = describeAppliedScope(raw.appliedFilters || plan?.arguments || {})
    return {
      title: `${Number(raw.totalCount) || 0}개 자막 미매핑`,
      description: folders.length > 0 ? `${folders.length}개 폴더에서 미매핑이 확인되었습니다.` : '미매핑 폴더를 찾지 못했습니다.',
      metrics: [
        metric('count', '미매핑', Number(raw.totalCount) || 0),
        metric('folders', '폴더', folders.length),
        metric('scope', '범위', scopeInfo.label),
        ...(scopeInfo.value ? [metric('scopeValue', scopeInfo.label === '선택한 영상' ? '대상' : '값', scopeInfo.value)] : []),
      ],
    }
  }

  if (type === 'subtitle-video-list') {
    const folders = Array.isArray(raw.folderCounts) ? raw.folderCounts : []
    const actors = Array.isArray(raw.actorCounts) ? raw.actorCounts : []
    const totalCount = Number(raw.totalCount) || (Array.isArray(raw.items) ? raw.items.length : 0)
    const scopeInfo = describeAppliedScope(raw.appliedFilters || plan?.arguments || {})
    return {
      title: `${totalCount}개 자막 미매핑 목록`,
      description: `폴더 ${folders.length}곳, 배우 ${actors.length}명 기준으로 정리했습니다.`,
      metrics: [
        metric('count', '미매핑', totalCount),
        metric('folders', '폴더', folders.length),
        metric('actors', '배우', actors.length),
        metric('scope', '범위', scopeInfo.label),
        ...(scopeInfo.value ? [metric('scopeValue', scopeInfo.label === '선택한 영상' ? '대상' : '값', scopeInfo.value)] : []),
      ],
    }
  }

  const videos = Array.isArray(raw.items) ? raw.items : []
  const stats = buildSummaryStatsFromVideos(videos)
  const actorCount = Array.isArray(raw.actorSummaries) ? raw.actorSummaries.length : 0
  const scopeInfo = describeAppliedScope(raw.appliedFilters || plan?.arguments || {})
  return {
    title: `${stats.totalCount}개 영상 검색 결과`,
    description: `${formatBytes(stats.totalSize)} 정도의 라이브러리를 대상으로 정리했습니다.`,
    metrics: [
      metric('count', '영상', stats.totalCount),
      metric('size', '총 용량', formatBytes(stats.totalSize)),
      metric('avgRating', '평균 별점', stats.averageRating),
      metric('notCopied', '미복사', stats.notCopied),
      metric('unplayed', '미재생', stats.unplayed),
      metric('scope', '범위', scopeInfo.label),
      ...(scopeInfo.value ? [metric('scopeValue', scopeInfo.label === '선택한 영상' ? '대상' : '값', scopeInfo.value)] : []),
      ...(actorCount > 0 ? [metric('actors', '배우 요약', actorCount)] : []),
    ],
  }
}

function buildHighlights(type, raw) {
  if (type === 'actor-list') {
    return (Array.isArray(raw.items) ? raw.items.slice(0, 5) : []).map((actor) => compactActorItem(actor))
  }

  if (type === 'delete-candidate-list') {
    return (Array.isArray(raw.items) ? raw.items.slice(0, 5) : []).map((candidate) => compactCandidateItem(candidate))
  }

  if (type === 'subtitle-summary') {
    return (Array.isArray(raw.folderCounts) ? raw.folderCounts.slice(0, 5) : []).map((folder) => ({
      id: folder.folderPath,
      title: folder.folderPath,
      subtitle: `자막 미매핑 ${folder.count}개`,
      reasons: Array.isArray(folder.sampleFiles) ? folder.sampleFiles : [],
    }))
  }

  if (type === 'subtitle-video-list') {
    return (Array.isArray(raw.items) ? raw.items.slice(0, 5) : []).map((item) => compactVideoItem(item))
  }

  return (Array.isArray(raw.items) ? raw.items.slice(0, 5) : []).map((item) => compactVideoItem(item))
}

function buildInsights(type, raw, plan) {
  if (type === 'delete-candidate-list') {
    const candidates = Array.isArray(raw.items) ? raw.items : []
    const large = candidates.filter((item) => Number(item?.video?.file_size || item?.candidate?.file_size || 0) >= 10 * 1024 ** 3).length
    const notCopied = candidates.filter((item) => Number(item?.video?.copy_count || item?.candidate?.copy_count || 0) === 0).length
    const lowRating = candidates.filter((item) => Number(item?.video?.rating || item?.candidate?.rating || 0) > 0 && Number(item?.video?.rating || item?.candidate?.rating || 0) <= 2).length
    return [
      large > 0 ? `10GB 이상 대용량 영상이 ${large}개 있습니다.` : null,
      notCopied > 0 ? `복사 이력이 없는 영상이 ${notCopied}개입니다.` : null,
      lowRating > 0 ? `별점 2점 이하 영상이 ${lowRating}개입니다.` : null,
    ].filter(Boolean)
  }

  if (type === 'video-list') {
    const videos = Array.isArray(raw.items) ? raw.items : []
    const notCopied = videos.filter((item) => Number(item?.video?.copy_count || 0) === 0).length
    const lowPlay = videos.filter((item) => Number(item?.video?.play_count || 0) === 0).length
    const newCount = videos.filter((item) => Number(item?.video?.is_new || 0) === 1).length
    return [
      notCopied > 0 ? `미복사 영상이 ${notCopied}개입니다.` : null,
      lowPlay > 0 ? `재생 이력이 없는 영상이 ${lowPlay}개입니다.` : null,
      newCount > 0 ? `신규 영상이 ${newCount}개 포함되어 있습니다.` : null,
      Array.isArray(raw.actorSummaries) && raw.actorSummaries.length > 0 ? `배우 기준으로 ${raw.actorSummaries.length}개 요약을 함께 제공했습니다.` : null,
    ].filter(Boolean)
  }

  if (type === 'actor-list') {
    const actors = Array.isArray(raw.items) ? raw.items : []
    const missingAgency = actors.filter((actor) => !String(actor.agency || '').trim()).length
    const missingMemo = actors.filter((actor) => !String(actor.memo || '').trim()).length
    const missingTags = actors.filter((actor) => !String(actor.tags || '').trim()).length
    return [
      missingAgency > 0 ? `소속사 정보가 비어 있는 배우가 ${missingAgency}명입니다.` : null,
      missingMemo > 0 ? `메모가 없는 배우가 ${missingMemo}명입니다.` : null,
      missingTags > 0 ? `태그가 없는 배우가 ${missingTags}명입니다.` : null,
    ].filter(Boolean)
  }

  if (type === 'subtitle-summary') {
    const folders = Array.isArray(raw.folderCounts) ? raw.folderCounts : []
    const topFolder = folders[0]
    return [
      topFolder ? `가장 많은 미매핑은 ${topFolder.folderPath}에 ${topFolder.count}개 있습니다.` : null,
      folders.length > 1 ? `상위 ${Math.min(3, folders.length)}개 폴더를 우선 보면 전체 흐름을 빠르게 볼 수 있습니다.` : null,
    ].filter(Boolean)
  }

  if (type === 'subtitle-video-list') {
    const folders = Array.isArray(raw.folderCounts) ? raw.folderCounts : []
    const actors = Array.isArray(raw.actorCounts) ? raw.actorCounts : []
    const topFolder = folders[0]
    const topActor = actors[0]
    return [
      topFolder ? `${topFolder.folderPath} 폴더에 ${topFolder.count}개가 집중되어 있습니다.` : null,
      topActor ? `${topActor.actorName} 배우 작품이 ${topActor.count}개로 가장 많습니다.` : null,
      folders.length > 1 ? `상위 ${Math.min(5, folders.length)}개 폴더부터 확인하면 빠르게 정리할 수 있습니다.` : null,
    ].filter(Boolean)
  }

  return []
}

function buildSuggestedActions(type, plan, raw) {
  const args = plan?.arguments || {}

  if (type === 'delete-candidate-list') {
    return [
      {
        id: 'show_all',
        type: 'view_results',
        label: '전체 후보 보기',
        payload: { toolName: 'get_delete_candidates', arguments: { ...args, limit: 100 } },
      },
      {
        id: 'exclude_high_rating',
        type: 'refine_query',
        label: '별점 3점 이상 제외',
        payload: { toolName: 'get_delete_candidates', arguments: { ...args, lowRating: true } },
      },
      {
        id: 'min_10gb',
        type: 'refine_query',
        label: '10GB 이상만',
        payload: { toolName: 'get_delete_candidates', arguments: { ...args, minSizeBytes: 10 * 1024 ** 3 } },
      },
      {
        id: 'preview_plan',
        type: 'preview_action',
        label: '삭제 계획 만들기',
        payload: { toolName: 'get_delete_candidates', arguments: { ...args } },
        requiresConfirmation: true,
      },
    ]
  }

  if (type === 'video-list') {
    return [
      {
        id: 'show_all',
        type: 'view_results',
        label: '전체 보기',
        payload: { toolName: 'search_videos', arguments: { ...args, limit: 100 } },
      },
      {
        id: 'not_copied',
        type: 'refine_query',
        label: '미복사만 보기',
        payload: { toolName: 'search_videos', arguments: { ...args, onlyNotCopied: true } },
      },
      {
        id: 'rating_high',
        type: 'refine_query',
        label: '별점 높은 것만',
        payload: { toolName: 'search_videos', arguments: { ...args, sortBy: 'rating' } },
      },
      {
        id: 'recent',
        type: 'refine_query',
        label: '최근 추가한 것만',
        payload: { toolName: 'search_videos', arguments: { ...args, sortBy: 'recent' } },
      },
    ]
  }

  if (type === 'actor-list') {
    return [
      {
        id: 'show_all',
        type: 'view_results',
        label: '전체 배우 보기',
        payload: { toolName: 'search_actors', arguments: { ...args, limit: 100 } },
      },
      {
        id: 'missing_meta',
        type: 'refine_query',
        label: '메타데이터 부족만',
        payload: { toolName: 'search_actors', arguments: { ...args, metadataMissing: true } },
      },
    ]
  }

  if (type === 'drive-stats') {
    return [
      {
        id: 'all_drives',
        type: 'view_results',
        label: '전체 드라이브 보기',
        payload: { toolName: 'get_drive_stats', arguments: { drive: null } },
      },
      {
        id: 'cleanup_view',
        type: 'refine_query',
        label: '정리 후보 보기',
        payload: { toolName: 'get_delete_candidates', arguments: { drive: args.drive || null, sortBy: 'deleteScore' } },
      },
    ]
  }

  if (type === 'subtitle-summary') {
    const folders = Array.isArray(raw.folderCounts) ? raw.folderCounts : []
    return [
      {
        id: 'list_missing',
        type: 'view_results',
        label: '자막 미매핑 목록 보기',
        payload: { toolName: 'search_videos_without_subtitles', arguments: { ...args, limit: 100 } },
      },
      ...(folders[0]
        ? [{
            id: 'open_top_folder',
            type: 'refine_query',
            label: '상위 폴더 다시 보기',
            payload: { toolName: 'get_unmapped_subtitle_summary', arguments: { drive: args.drive || null } },
          }]
        : []),
    ]
  }

  if (type === 'subtitle-video-list') {
    const resultIds = Array.isArray(raw.lastResultIds) ? raw.lastResultIds : []
    return [
      {
        id: 'filter_in_library',
        type: 'client_filter_video_ids',
        label: '영상 관리에서 이 결과만 보기',
        payload: { videoIds: resultIds },
      },
      {
        id: 'clear_library_filter',
        type: 'client_filter_video_ids',
        label: '영상 관리 필터 해제',
        payload: { videoIds: [] },
      },
    ]
  }

  return []
}

function buildState(raw, plan) {
  return {
    lastToolCall: {
      name: plan?.toolName || null,
      arguments: plan?.arguments || {},
    },
    lastResultIds: Array.isArray(raw.lastResultIds) ? raw.lastResultIds : [],
    activeFilters: raw?.appliedFilters || plan?.arguments || {},
    pendingAction: null,
  }
}

function buildUserFacingMessage(resultType, raw, fallbackMessage) {
  const subtitleScopeApplied = Boolean(raw?.appliedFilters?.subtitleMissing)
  if (!subtitleScopeApplied && resultType !== 'subtitle-summary' && resultType !== 'subtitle-video-list') {
    return fallbackMessage
  }

  const scopeInfo = describeAppliedScope(raw?.appliedFilters || {})
  const totalCount = Number(raw?.totalCount) || (Array.isArray(raw?.items) ? raw.items.length : 0)
  if (resultType === 'subtitle-summary' || resultType === 'subtitle-video-list') {
    return `${scopeInfo.line} 자막이 없는 영상 ${totalCount}개를 찾았습니다.`
  }
  return `${scopeInfo.line} 자막이 없는 영상 ${totalCount}개를 찾았습니다.`
}

function presentChatResponse(plan, raw, context = {}) {
  if (raw?.success === false) {
    return raw
  }

  if (plan?.needsClarification || raw?.resultType === 'clarification') {
    return buildClarificationResponse(plan)
  }

  const resultType = raw?.resultType || 'video-list'
  const summary = buildResultSummary(resultType, plan, raw)
  const highlights = buildHighlights(resultType, raw)
  const insights = buildInsights(resultType, raw, plan)
  const suggestedActions = buildSuggestedActions(resultType, plan, raw)
  const fallbackMessage = raw?.summary || summary.description || '처리가 완료되었습니다.'
  const message = buildUserFacingMessage(resultType, raw, fallbackMessage)
  const appliedScope = describeAppliedScope(raw?.appliedFilters || plan?.arguments || {})

  return {
    success: true,
    resultType,
    message,
    summary,
    highlights,
    insights,
    suggestedActions,
    intent: {
      name: plan?.intent || plan?.toolName || 'unknown',
      confidence: Number(plan?.confidence) || 0,
      toolName: plan?.toolName || null,
      arguments: plan?.arguments || {},
    },
    items: Array.isArray(raw.items) ? raw.items : [],
    actorSummaries: Array.isArray(raw.actorSummaries) ? raw.actorSummaries : [],
    driveInfo: raw.driveInfo || null,
    folderCounts: Array.isArray(raw.folderCounts) ? raw.folderCounts : [],
    actorCounts: Array.isArray(raw.actorCounts) ? raw.actorCounts : [],
    totalCount: Number(raw.totalCount) || (Array.isArray(raw.items) ? raw.items.length : 0),
    appliedScope,
    lastResultIds: Array.isArray(raw.lastResultIds) ? raw.lastResultIds : [],
    state: buildState(raw, plan),
    currentQuery: String(plan?.arguments?.query || ''),
    currentContext: context,
  }
}

module.exports = {
  presentChatResponse,
  buildClarificationResponse,
}