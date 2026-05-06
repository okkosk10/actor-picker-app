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
  // @param options {{ sortBy?: string, hideMissing?: boolean }}
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

  // ── 등급 단독 변경 ────────────────────────────────────────────
  // grade 컬럼만 변경하는 가벼운 API (Select 즉시 반영용)
  // @param id    {number} - 동영상 ID
  // @param grade {string} - 등급값 (영구소장/재시청 추천/만족/보관/애매/삭제요망)
  // 반환: 업데이트된 Video 레코드
  updateGrade: (id, grade) =>
    ipcRenderer.invoke('update-grade', id, grade),

  // ── 파일 열기 (OS 기본 플레이어) ─────────────────────────────
  openVideo: (filePath) =>
    ipcRenderer.invoke('open-video', filePath),

  // ── 폴더 열기 (탐색기) ───────────────────────────────────────
  openFolder: (folderPath) =>
    ipcRenderer.invoke('open-folder', folderPath),

  // ── 랜덤 추천 ────────────────────────────────────────────────
  // @param query   {string}
  // @param options {{ hideMissing?: boolean }}
  // 반환: { totalFiles, actorCount, pickedCount, searchText, pickedList }
  randomPick: (query, options) =>
    ipcRenderer.invoke('random-pick', query, options),
})

