'use strict'

/**
 * electron/scanner.cjs
 * 폴더 재귀 스캔 모듈
 *
 * - fs.promises.readdir({ withFileTypes: true }) 를 사용해 async 방식으로 탐색
 * - 지원 확장자: mp4, mkv, avi, mov
 * - 접근 권한이 없는 폴더는 에러 없이 무시
 * - 각 파일에서 파일명 파싱(parser.cjs)을 통해 code, actor_name 추출
 */

const fs = require('fs')
const path = require('path')
const { parseFileName } = require('./parser.cjs')
const { findSubtitleFiles, serializeSubtitlePaths, serializeSubtitleFiles } = require('./subtitles.cjs')

/** 스캔 대상 동영상 확장자 (소문자, 점 포함) */
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov'])

/**
 * 지정된 폴더를 재귀적으로 스캔하여 동영상 파일 메타데이터 목록을 반환한다.
 *
 * @param {string} folderPath - 스캔을 시작할 루트 폴더의 절대 경로
 * @returns {Promise<VideoFileMeta[]>}
 *
 * @typedef {Object} VideoFileMeta
 * @property {string}      file_name   - 파일명 (확장자 포함)
 * @property {string}      file_path   - 파일 절대 경로
 * @property {string}      folder_path - 파일이 위치한 폴더 경로
 * @property {string}      extension   - 확장자 (점 없음, 소문자)
 * @property {number}      size        - 파일 크기 (bytes)
 * @property {string}      modified_at - 수정일시 (ISO 8601)
 * @property {string|null} code        - 품번 (파싱 성공 시)
 * @property {string|null} actor_name  - 배우명 (파싱 성공 시)
 */
async function scanFolder(folderPath) {
  const results = []
  await scanRecursive(folderPath, results)
  return results
}

/**
 * 디렉토리를 재귀적으로 순회하며 동영상 파일을 results 배열에 누적한다.
 *
 * @param {string} dirPath - 현재 탐색 중인 디렉토리 경로
 * @param {VideoFileMeta[]} results - 결과를 누적할 배열 (참조 전달)
 */
async function scanRecursive(dirPath, results) {
  let entries
  try {
    // withFileTypes: true → Dirent 객체 반환 (isDirectory/isFile 사용 가능)
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  } catch {
    // 권한 없음, 심볼릭 링크 루프 등의 에러는 무시하고 계속 진행
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      // 하위 폴더 재귀 탐색
      await scanRecursive(fullPath, results)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!VIDEO_EXTS.has(ext)) continue

      // 파일 크기와 수정일 추출
      let stat
      try {
        stat = await fs.promises.stat(fullPath)
      } catch {
        // stat 실패 시 해당 파일 건너뜀
        continue
      }

      // 파일명 파싱: 품번(code), 배우명(actor_name) 추출
      const parsed = parseFileName(entry.name)
      const subtitles = await findSubtitleFiles(dirPath, entry.name)
      const subtitleLatestMtime = subtitles.files.reduce((latest, file) => {
        if (!latest) return file.modified_at
        return file.modified_at > latest ? file.modified_at : latest
      }, null)

      results.push({
        file_name:   entry.name,
        file_path:   fullPath,
        folder_path: dirPath,
        extension:   ext.slice(1), // 점(.) 제거 → 'mp4', 'mkv' 등
        size:        stat.size,
        modified_at: stat.mtime.toISOString(),
        code:        parsed.code,
        actor_name:  parsed.actor_name,
        subtitle_paths: serializeSubtitlePaths(subtitles.paths),
        subtitle_exts:  subtitles.exts.join(','),
        subtitle_count: subtitles.paths.length,
        subtitle_size:  subtitles.totalSize,
        subtitle_files: serializeSubtitleFiles(subtitles.files),
        subtitle_added_at: subtitleLatestMtime,
      })
    }
  }
}

module.exports = { scanFolder }
