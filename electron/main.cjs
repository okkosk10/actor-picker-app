const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi'])

// 폴더를 재귀적으로 스캔해 영상 파일 목록 반환
function scanVideos(dir) {
  let results = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results = results.concat(scanVideos(fullPath))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (VIDEO_EXTS.has(ext)) {
        results.push({ fileName: entry.name, fullPath })
      }
    }
  }
  return results
}

// 파일명에서 배우명(괄호 안)과 품번(괄호 앞) 추출
function parseFileName(fileName) {
  const match = fileName.match(/^(.+?)\((.+?)\)/)
  if (!match) return null
  return {
    code: match[1].trim(),
    actor: match[2].trim(),
  }
}

ipcMain.handle('scan-folder', async (_event, folderPath) => {
  const videos = scanVideos(folderPath)

  // 배우별 그룹화
  const groups = {}
  for (const video of videos) {
    const parsed = parseFileName(video.fileName)
    if (!parsed) continue
    const { actor, code } = parsed
    if (!groups[actor]) groups[actor] = []
    groups[actor].push({ actor, code, fileName: video.fileName, fullPath: video.fullPath })
  }

  // 배우별 랜덤 1개 선택
  const pickedList = Object.values(groups).map((items) => {
    const idx = Math.floor(Math.random() * items.length)
    return items[idx]
  })

  const searchText = pickedList.map((p) => p.code).join(' OR ')

  return {
    totalFiles: videos.length,
    actorCount: Object.keys(groups).length,
    pickedCount: pickedList.length,
    searchText,
    pickedList,
  }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    win.loadURL('http://localhost:5173')
  }
}

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
