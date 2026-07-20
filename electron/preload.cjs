'use strict'

/**
 * electron/preload.cjs
 * Preload 스크립트: contextBridge를 통해 안전하게 API 노출
 *
 * 보안 원칙:
 *   - contextIsolation: true → window 객체 직접 접근 불가
 *   - nodeIntegration: false → Renderer에서 Node.js API 사용 불가
 *   - ipcRenderer.invoke 만 사용 (채널 명 화이트리스트 방식)
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ── 폴더 선택 다이얼로그 ───────────────────────────────────────
  selectFolder: () =>
    ipcRenderer.invoke('select-folder'),

  // ── 자막 보관소 경로/복사 ────────────────────────────────────
  getSubtitleArchivePath: () =>
    ipcRenderer.invoke('get-subtitle-archive-path'),

  selectSubtitleArchivePath: () =>
    ipcRenderer.invoke('select-subtitle-archive-path'),

  setSubtitleArchivePath: (archivePath) =>
    ipcRenderer.invoke('set-subtitle-archive-path', archivePath),

  copySubtitleFilesToArchive: (payload) =>
    ipcRenderer.invoke('copy-subtitle-files-to-archive', payload),

  restoreSubtitleFilesFromArchive: () =>
    ipcRenderer.invoke('restore-subtitle-files-from-archive'),

  previewSubtitleFilesFromArchive: () =>
    ipcRenderer.invoke('preview-subtitle-files-from-archive'),

  // ── 폴더 스캔 및 DB 저장 ─────────────────────────────────────
  // @param folderPath {string}
  // 반환: { totalFiles, missingCount, scannedFolder }
  scanFolder: (folderPath) =>
    ipcRenderer.invoke('scan-folder', folderPath),

  // ── 동영상 검색 ───────────────────────────────────────────────
  // @param query   {string}
  // @param options {{ sortBy?: string, hideMissing?: boolean, currentFolder?: string|null }}
  // 반환: Video[]
  searchVideos: (query, options) =>
    ipcRenderer.invoke('search-videos', query, options),

  // ── 동영상 메타 업데이트 ──────────────────────────────────────
  // @param id   {number}
  // @param data {{ memo, tags, rating, status, recommended }}
  // 반환: 업데이트된 Video 레코드
  updateVideoMeta: (id, data) =>
    ipcRenderer.invoke('update-video-meta', id, data),

  // ── 추천 여부 단독 토글 ───────────────────────────────────────
  // recommended 컬럼만 변경하는 가벼운 API (Switch 즉시 반영용)
  // @param id          {number} - 동영상 ID
  // @param recommended {0|1}    - 1=추천, 0=일반
  // 반환: 업데이트된 Video 레코드
  updateRecommended: (id, recommended) =>
    ipcRenderer.invoke('update-recommended', id, recommended),

  // ── 등급 즉시 변경 (별점·추천작 자동 연동) ───────────────────
  // grade / rating / recommended 를 함께 업데이트한다.
  // @param id        {number} - 동영상 ID
  // @param gradeData {object} - { grade, rating, recommended }
  // 반환: 업데이트된 Video 레코드
  updateGrade: (id, gradeData) =>
    ipcRenderer.invoke('update-grade', id, gradeData),

  // ── 파일 열기 (OS 기본 플레이어) ─────────────────────────────
  openVideo: (filePath) =>
    ipcRenderer.invoke('open-video', filePath),

  // ── 폴더 열기 (탐색기) ───────────────────────────────────────
  openFolder: (folderPath) =>
    ipcRenderer.invoke('open-folder', folderPath),

  // ── 랜덤 추천 ────────────────────────────────────────────────
  // @param query   {string}
  // @param options {{ hideMissing?: boolean, currentFolder?: string|null }}
  // 반환: { totalFiles, actorCount, pickedCount, searchText, pickedList }
  randomPick: (query, options) =>
    ipcRenderer.invoke('random-pick', query, options),

  // ── 배우별 1개 랜덤 추출 ─────────────────────────────────────
  // grade='삭제요망'/missing/deleted 및 code·actor_name 없는 항목 제외
  // @param query   {string}  - 검색어 (빈 문자열이면 전체)
  // @param options {{ hideMissing?: boolean, currentFolder?: string|null }}
  // 반환: { count, orText, items }
  pickOnePerActor: (query, options) =>
    ipcRenderer.invoke('pick-one-per-actor', query, options),

  // ── 스캔된 폴더 목록 조회 ────────────────────────────────────
  // 반환: { library: FolderStat, folders: FolderStat[] }
  //   library.total / recommended_count / delete_count : 전체 라이브러리 합계
  //   folders[i].root_path / total / recommended_count / delete_count
  getFolderList: () =>
    ipcRenderer.invoke('get-folder-list'),

  // ── 삭제요망 파일 목록 조회 ───────────────────────────────────
  // @param currentFolder {string|null} - 폴더 필터 (null이면 전체)
  // 반환: { total, totalSize, items }
  getDeleteCandidates: (currentFolder) =>
    ipcRenderer.invoke('get-delete-candidates', currentFolder),

  // ── 삭제요망 파일 일괄 삭제 ───────────────────────────────────
  // grade='삭제요망' 파일만 삭제, 결과 리포트 반환
  // @param currentFolder {string|null} - 폴더 필터 (null이면 전체)
  // 반환: { total, deleted, failed, failedItems }
  deleteGradeTargets: (currentFolder) =>
    ipcRenderer.invoke('delete-grade-targets', currentFolder),

  // ── NEW 작업 대기함 카운트 조회 ───────────────────────────────
  // is_new=1 인 파일 수를 반환한다. (탭 배지 숫자 표시용)
  // missing/deleted 상태는 제외
  // 반환: { count: number }
  getNewCount: () =>
    ipcRenderer.invoke('get-new-count'),

  // ── Windows 파일 클립보드 복사 (CF_HDROP 방식) ───────────────
  // 파일 경로 목록을 Windows 탐색기가 인식하는 파일 클립보드 형식으로 복사한다.
  // 사용자는 Ctrl+V 로 임의 위치(MTP 장치 포함)에 파일을 붙여넣기할 수 있다.
  // @param filePaths {string[]} - 복사할 파일의 절대 경로 배열
  // 반환: { success, count, totalSize, failedPaths, error? }
  copyFilesToClipboard: (filePaths) =>
    ipcRenderer.invoke('copy-files-to-clipboard', filePaths),

  // ── Shell 폴더 선택 + 직접 복사 (MTP 장치 포함) ─────────────
  // BrowseForFolder 대화상자(이 PC 루트)에서 사용자가 대상 폴더를 선택하면
  // Shell.Application.CopyHere 로 1개씩 순차 전송한다.
  // 진행 상황은 device-copy-progress IPC 이벤트로 수신한다.
  // @param filePaths {string[]} - 복사할 파일의 절대 경로 배열
  // 반환: { success, action: 'copied'|'partial'|'failed'|'aborted'|'cancelled'|'error', doneCount, failedCount, failedFiles }
  copyFilesToDevice: (filePaths) =>
    ipcRenderer.invoke('copy-files-to-device', filePaths),

  // ── MTP 안정 모드 (Windows 복사 창 위임) ─────────────────────
  // 모든 파일을 한 번에 CopyHere 로 전달하고 앱 내부 진행률은 없음.
  // @param filePaths {string[]}
  // 반환: { success, action: 'bulk-started'|'cancelled'|'error', count }
  copyFilesToDeviceBulk: (filePaths) =>
    ipcRenderer.invoke('copy-files-to-device-bulk', filePaths),

  // ── MTP 전송 진행 이벤트 구독 ────────────────────────────────
  // callback: (payload) => void
  //   payload: { status, currentIndex, total, currentFileName, fileSize, timeoutSec,
  //              doneCount, failedCount, failedFiles, message }
  // 반환: unsubscribe 함수
  onDeviceCopyProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('device-copy-progress', listener)
    return () => ipcRenderer.removeListener('device-copy-progress', listener)
  },

  removeDeviceCopyProgress: () => {
    ipcRenderer.removeAllListeners('device-copy-progress')
  },

  // ── MTP needsCheck 액션 전송 ─────────────────────────────────
  // action: 'continue' | 'retry' | 'skip' | 'abort'
  sendDeviceCopyAction: (action) =>
    ipcRenderer.send('device-copy-action', action),

  // ── MTP 안정 모드 완료 신호 ───────────────────────────────────
  // 사용자가 Windows 복사 창 완료 후 클릭하면 PS 프로세스를 종료한다.
  sendBulkCopyClose: () =>
    ipcRenderer.send('bulk-copy-close'),

  // ── 배우 목록 조회 ────────────────────────────────────────────
  // @param options {{ query?, category?, agency?, minRating?, archived?, isNew?, tierFilter?, sortBy? }}
  // 반환: Actor[]
  getActors: (options) =>
    ipcRenderer.invoke('get-actors', options),

  // ── 배우 티어 카운트 조회 ───────────────────────────────────
  // @param options {{ archived?: boolean, isNew?: boolean }}
  // 반환: { S, A, B, unranked, total, limits }
  getActorTierCounts: (options) =>
    ipcRenderer.invoke('get-actor-tier-counts', options),

  // ── 특정 티어 배우 목록 조회 ────────────────────────────────
  // @param tier {'S'|'A'|'B'}
  // @param options {{ archived?: boolean }}
  getActorsByTier: (tier, options) =>
    ipcRenderer.invoke('get-actors-by-tier', tier, options),

  // ── 새 배우 카운트 조회 (is_new=1) ───────────────────────────
  // 반환: { count: number }
  getNewActorCount: () =>
    ipcRenderer.invoke('get-new-actor-count'),

  // ── 배우 특수 뱃지 정의 조회 ────────────────────────────────
  // @param options {{ includeInactive?: boolean }}
  getActorBadgeDefinitions: (options) =>
    ipcRenderer.invoke('get-actor-badge-definitions', options),

  // ── 배우 특수 뱃지 정의 생성 ────────────────────────────────
  createActorBadgeDefinition: (data) =>
    ipcRenderer.invoke('create-actor-badge-definition', data),

  // ── 배우 특수 뱃지 정의 수정 ────────────────────────────────
  updateActorBadgeDefinition: (id, data) =>
    ipcRenderer.invoke('update-actor-badge-definition', id, data),

  // ── 배우 특수 뱃지 활성화/비활성화 ──────────────────────────
  setActorBadgeActive: (id, isActive) =>
    ipcRenderer.invoke('set-actor-badge-active', id, isActive),

  // ── 배우 특수 뱃지 삭제 ────────────────────────────────────
  deleteActorBadgeDefinition: (id) =>
    ipcRenderer.invoke('delete-actor-badge-definition', id),

  // ── 배우의 현재 특수 뱃지 조회 ──────────────────────────────
  getActorBadges: (actorId) =>
    ipcRenderer.invoke('get-actor-badges', actorId),

  // ── 배우 특수 뱃지 일괄 설정 ────────────────────────────────
  setActorBadges: (actorId, badgeIds) =>
    ipcRenderer.invoke('set-actor-badges', actorId, badgeIds),

  // ── 새 배우 New 상태 해제 ─────────────────────────────────────
  // @param actorId {number}
  // 반환: { success: true }
  clearActorNew: (actorId) =>
    ipcRenderer.invoke('clear-actor-new', actorId),

  // ── 배우 상세 조회 ────────────────────────────────────────────
  // @param id {number}
  // 반환: { actor: Actor, videos: Video[] } | null
  getActorDetail: (id) =>
    ipcRenderer.invoke('get-actor-detail', id),

  // ── 배우 생성 ─────────────────────────────────────────────────
  // @param data {{ name, image_path?, category?, agency?, tags?, rating?, memo? }}
  // 반환: 생성된 Actor 레코드
  createActor: (data) =>
    ipcRenderer.invoke('create-actor', data),

  // ── 배우 수정 ─────────────────────────────────────────────────
  // @param id   {number}
  // @param data {{ name?, image_path?, category?, agency?, tags?, rating?, memo?, tier?, is_archived? }}
  // 반환: 수정된 Actor 레코드
  updateActor: (id, data) =>
    ipcRenderer.invoke('update-actor', id, data),

  // ── 티어 교체 저장 ───────────────────────────────────────────
  // @param payload {{ targetActorId, replacedActorId, tier }}
  // 반환: { success, actor }
  replaceActorTier: (payload) =>
    ipcRenderer.invoke('replace-actor-tier', payload),

  // ── DB 백업 ───────────────────────────────────────────────────
  // 반환: { success: true, backupPath }
  backupDatabase: () =>
    ipcRenderer.invoke('backup-database'),

  // ── 배우 태그/메모 일괄 수정 ──────────────────────────────────
  // @param payload {{ updates: [{ actorId, tags, memo? }], changeSource?, sourceDetail? }}
  // 반환: { success: true, updatedCount, skippedCount }
  bulkUpdateActorTags: (payload) =>
    ipcRenderer.invoke('bulk-update-actor-tags', payload),

  // ── AVDBS 배우 검색/상세/가져오기 ───────────────────────────
  searchAvdbsActors: (query) =>
    ipcRenderer.invoke('search-avdbs-actors', query),

  getAvdbsActorDetail: (actorIdx) =>
    ipcRenderer.invoke('get-avdbs-actor-detail', actorIdx),

  getActorAvdbsProfile: (actorId) =>
    ipcRenderer.invoke('get-actor-avdbs-profile', actorId),

  importAvdbsActor: (payload) =>
    ipcRenderer.invoke('import-avdbs-actor', payload),

  // ── 배우 아카이브 (숨김 처리, 삭제 아님) ─────────────────────
  // @param id {number}
  // 반환: { success: true }
  archiveActor: (id) =>
    ipcRenderer.invoke('archive-actor', id),

  // ── 아카이브된 배우 복구 ──────────────────────────────────────
  // @param id {number}
  // 반환: { success: true }
  restoreActor: (id) =>
    ipcRenderer.invoke('restore-actor', id),

  // ── 배우 이미지 업로드 ────────────────────────────────────────
  // OS 파일 선택 다이얼로그 → userData/actors/ 에 복사
  // @param actorId {number} - 배우 ID (신규 생성 전이면 0)
  // 반환: { fileName: string } | null (취소 시)
  uploadActorImage: (actorId) =>
    ipcRenderer.invoke('upload-actor-image', actorId),

  // ── 배우 이미지 조회 (base64 data URL) ───────────────────────
  // userData/actors/{fileName} → data:image/...;base64,... 반환
  // @param fileName {string} - 파일명 (경로 아님)
  // 반환: string | null
  getActorImage: (fileName) =>
    ipcRenderer.invoke('get-actor-image', fileName),

  // ── 대시보드 통계 조회 ────────────────────────────────────────
  // 반환: { summary, topActors, recentVideos, recentActivities,
  //         ratingDistribution, tagStats }
  getDashboardStats: () =>
    ipcRenderer.invoke('get-dashboard-stats'),

  // ── AI 연결 테스트 ────────────────────────────────────────────
  // OpenAI API 연결 상태를 확인한다. API Key는 main process에서만 처리.
  // 반환: { success: true, model, message } | { success: false, error }
  testAiConnection: () =>
    ipcRenderer.invoke('ai:test-connection'),

  // ── AI 특집 폴더 - 테마 생성 ─────────────────────────────────
  // DB 영상 분석 + OpenAI 호출로 특집 테마를 제안받는다.
  // 반환: { success: true, themes[], candidateCount } | { success: false, error }
  generateAiThemeFolders: (customPrompt) =>
    ipcRenderer.invoke('ai-theme-folders:generate', customPrompt ?? ''),

  // ── AI 특집 폴더 - 실제 복사 실행 ───────────────────────────
  // @param targetRootPath {string}   - 복사할 상위 폴더 경로
  // @param selectedThemes {object[]} - 선택된 테마 (videoIds 포함)
  // 반환: { success: true, results[] } | { success: false, error }
  createAiThemeFolders: (targetRootPath, selectedThemes) =>
    ipcRenderer.invoke('ai-theme-folders:create-folders', targetRootPath, selectedThemes),

  // ── 영상 파일 정보 조회 (장치 복사용) ────────────────────────
  // @param videoIds {number[]} - 조회할 videoId 배열
  // 반환: { id, file_name, file_path, size, status }[]
  getVideoFileInfos: (videoIds) =>
    ipcRenderer.invoke('get-video-file-infos', videoIds),

  // ── AI 테마 → 장치 서브폴더 복사 ─────────────────────────────
  // 선택된 테마 배열을 받아 폰에서 폴더를 선택한 뒤
  // 테마명으로 서브폴더를 만들고 파일을 일괄 복사한다.
  // @param selectedThemes {object[]} - { folderName, videoIds }[]
  // 반환: { success, action, themeCount, fileCount, folderErrors } | { success: false, error }
  copyThemesToDevice: (selectedThemes) =>
    ipcRenderer.invoke('copy-themes-to-device', selectedThemes),

  // ── AI 테마 장치 복사 완료 신호 ───────────────────────────────
  // Windows 복사 창 완료 후 사용자가 누르면 PS 프로세스를 종료한다.
  themeCopyClose: () =>
    ipcRenderer.send('theme-copy-close'),

  // ── 가중치 기반 대시보드 추천 조회 ───────────────────────────
  // 반환: { topPicks, stalePreferences, highRatedUnderViewed,
  //         worthRevisiting, needsMetadata, ratingReview }
  getDashboardRecommendations: () =>
    ipcRenderer.invoke('get-dashboard-recommendations'),

  // ── 배우 영상 목록 조회 (빠른 필터 포함) ──────────────────────
  // @param actorId  {number}  - 배우 ID
  // @param options  {{ quickFilter?, sortBy? }}
  //   quickFilter: 'all' | 'high_rated' | 'new' | 'recommended' | 'not_copied'
  // 반환: Video[]
  getActorVideos: (actorId, options) =>
    ipcRenderer.invoke('get-actor-videos', actorId, options),

  // ── 배우-영상 동기화 (videos.actor_name → video_actors) ───────
  // 반환: { success: boolean, synced: number }
  syncActorVideos: () =>
    ipcRenderer.invoke('sync-actor-videos'),

  // ── 영상 배우명 수정 ──────────────────────────────────────────
  // videos.actor_name 갱신 + video_actors 재동기화 + is_actor_manual = 1
  // @param videoId   {number} - 동영상 ID
  // @param actorName {string} - 새 배우명 ("배우1, 배우2" 또는 빈 문자열)
  // 반환: { success: true } | { success: false, error: string }
  updateVideoActors: (videoId, actorName) =>
    ipcRenderer.invoke('update-video-actors', videoId, actorName),

  // ── 배우명 파일명 기준 다시 추출 ─────────────────────────────────
  // is_actor_manual = 0으로 되돌리고 파일명 파싱으로 actor_name 재설정
  // @param videoId {number}
  // 반환: { success: true, actor_name: string|null } | { success: false, error: string }
  resetActorManual: (videoId) =>
    ipcRenderer.invoke('reset-actor-manual', videoId),
  // ── 고아 배우 정리 ─────────────────────────────────────────────────
  // video_actors에 연결되지 않은 고아 배우를 actors 테이블에서 제거한다.
  // 반환: { success, deletedCount, deletedActors: string[] }
  cleanupOrphanActors: () =>
    ipcRenderer.invoke('cleanup-orphan-actors'),
  // ── 추천 영상 조회 ─────────────────────────────────────────────
  // @param preset {string}  - 추천 프리셋
  //   'top_actor_videos'   : 별점 높은 배우의 작품
  //   'top_rated_videos'   : 별점 높은 영상
  //   'new_top_actor'      : NEW 중 고평점 배우 포함 작품
  //   'tag_actor_videos'   : 특정 태그 배우의 작품 (params.tag 필요)
  //   'recent_copied_actor': 최근 많이 복사한 배우의 작품
  //   'recent_played_actor': 최근 많이 재생한 배우의 작품
  //   'not_copied_high_rated': 아직 복사하지 않은 고평점 작품
  //   'random_by_actor'    : 배우별 랜덤 추천
  //   'similar_tag_actor'  : 자주 복사한 배우와 비슷한 태그의 배우 작품
  // @param params {object}  - 프리셋별 추가 파라미터
  // 반환: Video[] (actorsList 포함)
  getRecommendations: (preset, params) =>
    ipcRenderer.invoke('get-recommendations', preset, params),

  // ── AI 채팅 추천 ──────────────────────────────────────────────
  // 자연어 프롬프트로 DB 후보 + AI 추천 결합
  // @param userPrompt {string}
  // 반환: { success, summary, reason, intent, items[] } | { success: false, error }
  askAiChatRecommend: (userPrompt) =>
    ipcRenderer.invoke('ai-chat-recommend:ask', userPrompt),

  // ── 드라이브별 저장소 통계 조회 ───────────────────────────────
  // 파일 경로 기준 드라이브별 영상 수 / 용량 / 평균 별점 / 삭제 후보 수 등 집계
  // 반환: { success: true, drives: DriveStats[] } | { success: false, error }
  getDriveStats: () =>
    ipcRenderer.invoke('get-drive-stats'),

  // ── 드라이브별 삭제 후보 조회 ─────────────────────────────────
  // @param drive {string|null} - "D:" 형태 또는 null(전체 라이브러리)
  // 반환: { success: true, drive, freeSpace, totalDiskSize, usedByLibrary, candidates[] }
  //        | { success: false, error }
  getDeleteCandidatesByDrive: (drive) =>
    ipcRenderer.invoke('get-delete-candidates-by-drive', drive),

  // ── 삭제 예정 표시 (실제 삭제 없음) ──────────────────────────
  // grade='삭제요망'으로만 변경. 파일 삭제는 하지 않음.
  // @param videoId {number}
  // 반환: { success: true } | { success: false, error }
  markDeleteCandidate: (videoId) =>
    ipcRenderer.invoke('mark-delete-candidate', videoId),

  // ── AI 분석 캐시 조회 ─────────────────────────────────────────
  // DB에 저장된 AI 분석 결과를 반환한다. (OpenAI 미호출)
  // @param entityType {'actor'|'video'}
  // @param entityId   {number}
  // 반환: { success: true, data: AiCache|null } | { success: false, error }
  getAiAnalysis: (entityType, entityId) =>
    ipcRenderer.invoke('get-ai-analysis', entityType, entityId),

  // ── 배우 AI 분석 트리거 ───────────────────────────────────────
  // 캐시가 있으면 바로 반환, 없으면 OpenAI 분석 후 저장.
  // @param actorId {number}
  // @param force   {boolean} - true이면 캐시 무시하고 강제 재분석
  // 반환: { success: true, data: AiCache, fromCache: boolean }
  //        | { success: false, error }
  analyzeActorAi: (actorId, force = false) =>
    ipcRenderer.invoke('analyze-actor-ai', actorId, force),

  // ── 폴더 활성화/비활성화 토글 ────────────────────────────────
  // 활성화된 폴더의 파일만 검색 결과에 포함된다.
  // @param folderPath {string} - 토글할 폴더 경로
  // 반환: { success: true, isActive: boolean } | { success: false, error }
  toggleFolderActive: (folderPath) =>
    ipcRenderer.invoke('toggle-folder-active', folderPath),

  // ── 드라이브 연결 끊김 이벤트 구독 ──────────────────────────
  // callback: (payload) => void
  //   payload: { path, timestamp }
  // 반환: unsubscribe 함수
  onDriveDisconnected: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('drive-disconnected', listener)
    return () => ipcRenderer.removeListener('drive-disconnected', listener)
  },

  // ── 드라이브 재연결 이벤트 구독 ────────────────────────────
  // callback: (payload) => void
  //   payload: { path }
  // 반환: unsubscribe 함수
  onDriveReconnected: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('drive-reconnected', listener)
    return () => ipcRenderer.removeListener('drive-reconnected', listener)
  },

  // ── 드라이브 이벤트 제거 ────────────────────────────────────
  removeDriveEvents: () => {
    ipcRenderer.removeAllListeners('drive-disconnected')
    ipcRenderer.removeAllListeners('drive-reconnected')
  },
})

