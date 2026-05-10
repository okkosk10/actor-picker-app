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
  // @param options {{ query?, category?, agency?, minRating?, archived? }}
  // 반환: Actor[]
  getActors: (options) =>
    ipcRenderer.invoke('get-actors', options),

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
  // @param data {{ name?, image_path?, category?, agency?, tags?, rating?, memo? }}
  // 반환: 수정된 Actor 레코드
  updateActor: (id, data) =>
    ipcRenderer.invoke('update-actor', id, data),

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
})

