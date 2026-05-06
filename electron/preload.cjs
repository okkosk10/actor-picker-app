'use strict'

/**
 * electron/preload.cjs
 * Preload 스크립트: contextBridge를 통해 안전하게 API 노출
 *
 * 보안 원칙:
 *   - contextIsolation: true 유지 → window 객체 직접 접근 불가
 *   - nodeIntegration: false 유지 → Renderer에서 Node.js API 사용 불가
 *   - ipcRenderer.invoke 만 사용 (채널 명 화이트리스트 방식)
 *
 * Renderer 사용 방법:
 *   await window.api.scanFolder(folderPath)
 *   await window.api.searchVideos(query)
 *   await window.api.updateVideoMeta(id, data)
 *   await window.api.openVideo(filePath)
 *   await window.api.openFolder(folderPath)
 *   await window.api.randomPick(query)
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ── 폴더 선택 다이얼로그 ───────────────────────────────────────
  // 반환: 선택된 폴더 경로(string) | null
  selectFolder: () =>
    ipcRenderer.invoke('select-folder'),

  // ── 폴더 스캔 및 DB 저장 ─────────────────────────────────────
  // @param folderPath {string} - 스캔할 폴더 절대 경로
  // 반환: { totalFiles: number, scannedFolder: string }
  scanFolder: (folderPath) =>
    ipcRenderer.invoke('scan-folder', folderPath),

  // ── 동영상 검색 ───────────────────────────────────────────────
  // @param query {string} - 검색 키워드 (빈 문자열이면 전체 조회)
  // 반환: Video[] (DB 레코드 배열)
  searchVideos: (query) =>
    ipcRenderer.invoke('search-videos', query),

  // ── 동영상 메타 업데이트 ──────────────────────────────────────
  // @param id   {number} - videos.id
  // @param data {{ memo, tags, rating, status }}
  // 반환: 업데이트된 Video 레코드
  updateVideoMeta: (id, data) =>
    ipcRenderer.invoke('update-video-meta', id, data),

  // ── 파일 열기 (OS 기본 플레이어) ─────────────────────────────
  // @param filePath {string}
  openVideo: (filePath) =>
    ipcRenderer.invoke('open-video', filePath),

  // ── 폴더 열기 (탐색기) ───────────────────────────────────────
  // @param folderPath {string}
  openFolder: (folderPath) =>
    ipcRenderer.invoke('open-folder', folderPath),

  // ── 랜덤 추천 ────────────────────────────────────────────────
  // @param query {string} - 필터 키워드 (빈 문자열이면 전체 대상)
  // 반환: { totalFiles, actorCount, pickedCount, searchText, pickedList }
  randomPick: (query) =>
    ipcRenderer.invoke('random-pick', query),
})
