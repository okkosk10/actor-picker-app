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
 *   - 외장하드 연결 상태 모니터링
 */

const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { registerIpcHandlers } = require('./ipc.cjs')
const { closeDb, getDb }      = require('./db.cjs')

let mainWindow = null
let driveMonitorInterval = null
const disconnectedDrives = new Set() // 이전에 감지된 끊긴 드라이브 추적 (중복 알림 방지)

/**
 * 메인 BrowserWindow를 생성한다.
 * 개발 환경: Vite dev server (http://localhost:5173) 로드
 * 배포 환경: dist/index.html 로드
 */
function createWindow() {
  mainWindow = new BrowserWindow({
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
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // 배포 환경: 빌드된 정적 파일
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    mainWindow.loadFile(indexPath)
  }
}

/**
 * 스캔된 폴더의 접근 가능 여부를 확인하고, 
 * 외장하드가 연결 끊김 시 사용자에게 알림
 */
function checkDriveConnectivity() {
  try {
    const db = getDb()
    
    // scanned_roots에서 모든 폴더 조회
    const roots = db.prepare(`
      SELECT root_path FROM scanned_roots WHERE is_active = 1
    `).all()

    const currentlyDisconnected = new Set()

    for (const root of roots) {
      const rootPath = root.root_path
      // 폴더 접근 가능 여부 확인 (stat으로 빠르게 확인)
      try {
        fs.accessSync(rootPath, fs.constants.R_OK)
        // 접근 가능 - 이전에 끊김으로 표시되었다면 복구로 처리
        if (disconnectedDrives.has(rootPath)) {
          console.log(`[Drive Monitor] 폴더 복구됨: ${rootPath}`)
          disconnectedDrives.delete(rootPath)
          // 복구 알림 발송
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('drive-reconnected', { path: rootPath })
          }
        }
      } catch (err) {
        // 접근 불가능 - 처음 감지한 경우에만 알림
        if (!disconnectedDrives.has(rootPath)) {
          console.warn(`[Drive Monitor] 폴더 연결 끊김 감지: ${rootPath}`, err.message)
          disconnectedDrives.add(rootPath)
          
          // 사용자에게 알림
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('drive-disconnected', { 
              path: rootPath,
              timestamp: new Date().toISOString()
            })
          }
        }
      }
    }
  } catch (err) {
    console.error('[Drive Monitor] 드라이브 확인 중 오류:', err.message)
  }
}

/**
 * 드라이브 모니터링 시작 (주기적으로 외장하드 연결 상태 확인)
 */
function startDriveMonitoring() {
  // 30초마다 확인
  driveMonitorInterval = setInterval(checkDriveConnectivity, 30000)
  // 시작 시에도 한 번 확인
  checkDriveConnectivity()
  console.log('[Drive Monitor] 드라이브 모니터링 시작 (30초 주기)')
}

/**
 * 드라이브 모니터링 중지
 */
function stopDriveMonitoring() {
  if (driveMonitorInterval) {
    clearInterval(driveMonitorInterval)
    driveMonitorInterval = null
    console.log('[Drive Monitor] 드라이브 모니터링 중지')
  }
}

// ── 앱 초기화 ────────────────────────────────────────────────────
app.whenReady().then(() => {
  // IPC 핸들러 등록 (DB는 첫 번째 IPC 호출 시 자동 초기화)
  registerIpcHandlers()
  createWindow()

  // 드라이브 모니터링 시작
  startDriveMonitoring()

  // macOS: Dock 클릭 시 창이 없으면 새로 생성
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ── 앱 종료 처리 ─────────────────────────────────────────────────
app.on('window-all-closed', () => {
  // 드라이브 모니터링 중지
  stopDriveMonitoring()
  // DB 연결 안전하게 닫기
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})


