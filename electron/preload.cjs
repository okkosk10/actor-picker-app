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
})

