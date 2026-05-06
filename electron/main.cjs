'use strict'

/**
 * electron/main.cjs
 * Electron 메인 프로세스 엔트리 포인트
 *
 * 책임:
 *   - BrowserWindow 생성 및 관리
 *   - IPC 핸들러 등록 (ipc.cjs 에 위임)
 *   - DB 초기화 (db.cjs 가 최초 getDb() 호출 시 자동 처리)
 *   - 앱 종료 시 DB 연결 정리
 */

const { app, BrowserWindow } = require('electron')
const path = require('path')
const { registerIpcHandlers } = require('./ipc.cjs')
const { closeDb }             = require('./db.cjs')

/**
 * 메인 BrowserWindow를 생성한다.
 * 개발 환경: Vite dev server (http://localhost:5173) 로드
 * 배포 환경: dist/index.html 로드
 */
function createWindow() {
  const win = new BrowserWindow({
    width:  1200,
    height: 800,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,   // 보안: Renderer에서 Node.js API 직접 접근 차단
      nodeIntegration:  false,  // 보안: Renderer에서 require() 사용 불가
    },
  })

  const isDev = !app.isPackaged

  if (isDev) {
    // 개발 환경: Vite HMR dev server
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    // 배포 환경: 빌드된 정적 파일
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    win.loadFile(indexPath)
  }
}

// ── 앱 초기화 ────────────────────────────────────────────────────
app.whenReady().then(() => {
  // IPC 핸들러 등록 (DB는 첫 번째 IPC 호출 시 자동 초기화)
  registerIpcHandlers()
  createWindow()

  // macOS: Dock 클릭 시 창이 없으면 새로 생성
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ── 앱 종료 처리 ─────────────────────────────────────────────────
app.on('window-all-closed', () => {
  // DB 연결 안전하게 닫기
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

