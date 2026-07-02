'use strict'

const path = require('path')
const fs = require('fs')
const fsP = require('fs').promises

function resolveDestPath(destDir, fileName) {
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  let candidate = path.join(destDir, fileName)
  let n = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${base} (${n})${ext}`)
    n += 1
  }
  return candidate
}

async function ensureDir(dirPath) {
  await fsP.mkdir(dirPath, { recursive: true })
}

function buildCopyFiles(info) {
  return [
    { path: info.filePath, fileName: info.fileName || path.basename(info.filePath) },
    ...(info.subtitlePaths ?? []).map((subtitlePath) => ({
      path: subtitlePath,
      fileName: path.basename(subtitlePath),
    })),
  ]
}

async function createThemeFolders(targetRootPath, selectedThemes, videoFileMap) {
  if (!targetRootPath) throw new Error('targetRootPath가 지정되지 않았습니다.')
  if (!Array.isArray(selectedThemes) || selectedThemes.length === 0) {
    throw new Error('선택된 테마가 없습니다.')
  }

  const results = []

  for (const theme of selectedThemes) {
    const folderPath = path.join(targetRootPath, theme.folderName ?? theme.title)
    let copiedCount = 0
    const failedItems = []

    try {
      await ensureDir(folderPath)
    } catch (err) {
      results.push({
        themeTitle: theme.title,
        folderPath,
        copiedCount: 0,
        failedCount: (theme.videoIds ?? []).length,
        failedItems: [{ videoId: -1, filePath: '', reason: `폴더 생성 실패: ${err.message}` }],
      })
      continue
    }

    const videoIds = Array.isArray(theme.videoIds) ? theme.videoIds : []
    for (const videoId of videoIds) {
      const info = videoFileMap.get(Number(videoId))
      if (!info?.filePath) {
        failedItems.push({ videoId, filePath: '', reason: 'filePath 정보 없음' })
        continue
      }

      for (const file of buildCopyFiles(info)) {
        const src = file.path
        if (!fs.existsSync(src)) {
          failedItems.push({ videoId, filePath: src, reason: '원본 파일이 존재하지 않음' })
          continue
        }

        try {
          await fsP.copyFile(src, resolveDestPath(folderPath, file.fileName))
          copiedCount += 1
        } catch (err) {
          failedItems.push({ videoId, filePath: src, reason: `복사 실패: ${err.message}` })
        }
      }
    }

    results.push({
      themeTitle: theme.title,
      folderPath,
      copiedCount,
      failedCount: failedItems.length,
      failedItems,
    })
  }

  return { success: true, results }
}

module.exports = { createThemeFolders }
