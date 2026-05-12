'use strict'

/**
 * electron/services/themeCopyService.cjs
 * 선택된 특집 테마를 실제 로컬 폴더로 복사한다.
 *
 * 원칙:
 *   - 원본 파일은 삭제하지 않는다 (fs.copyFile 사용).
 *   - 파일명 충돌 시 "파일명 (1).ext" 방식으로 처리한다.
 *   - 한 파일 복사가 실패해도 전체 작업이 중단되지 않는다.
 */

const path = require('path')
const fs   = require('fs')
const fsP  = require('fs').promises

// ─────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────

/**
 * 대상 경로에 파일이 이미 존재할 경우 "이름 (N).ext" 형식으로 번호를 붙여 반환한다.
 * @param {string} destDir  - 대상 디렉터리
 * @param {string} fileName - 원본 파일명 (확장자 포함)
 * @returns {string} 충돌 없는 전체 경로
 */
function resolveDestPath(destDir, fileName) {
  const ext  = path.extname(fileName)
  const base = path.basename(fileName, ext)
  let candidate = path.join(destDir, fileName)
  let n = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${base} (${n})${ext}`)
    n++
  }
  return candidate
}

/**
 * 디렉터리를 재귀적으로 생성한다 (이미 존재하면 무시).
 * @param {string} dirPath
 */
async function ensureDir(dirPath) {
  await fsP.mkdir(dirPath, { recursive: true })
}

// ─────────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────────

/**
 * 선택된 테마들을 targetRootPath 아래에 폴더 단위로 복사한다.
 *
 * @param {string}   targetRootPath  - 복사할 상위 디렉터리 (예: "D:\\특집")
 * @param {object[]} selectedThemes  - 선택된 테마 배열
 *   각 테마: { title, folderName, videoIds: number[], resolvedVideos: { id, filePath, fileName }[] }
 * @param {Map}      videoFileMap    - videoId → { filePath, fileName } Map (ipc에서 주입)
 * @returns {Promise<{
 *   success: true,
 *   results: Array<{
 *     themeTitle: string,
 *     folderPath: string,
 *     copiedCount: number,
 *     failedCount: number,
 *     failedItems: Array<{ videoId: number, filePath: string, reason: string }>
 *   }>
 * }>}
 */
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
        themeTitle:  theme.title,
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

      if (!info || !info.filePath) {
        failedItems.push({ videoId, filePath: '', reason: 'filePath 정보 없음' })
        continue
      }

      const src = info.filePath

      // 파일 존재 확인
      if (!fs.existsSync(src)) {
        failedItems.push({ videoId, filePath: src, reason: '원본 파일이 존재하지 않음' })
        continue
      }

      const fileName = info.fileName || path.basename(src)
      const dest     = resolveDestPath(folderPath, fileName)

      try {
        await fsP.copyFile(src, dest)
        copiedCount++
      } catch (err) {
        failedItems.push({ videoId, filePath: src, reason: `복사 실패: ${err.message}` })
      }
    }

    results.push({
      themeTitle:  theme.title,
      folderPath,
      copiedCount,
      failedCount: failedItems.length,
      failedItems,
    })
  }

  return { success: true, results }
}

module.exports = { createThemeFolders }
