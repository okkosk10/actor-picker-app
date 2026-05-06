'use strict'

/**
 * electron/ipc.cjs
 * IPC 채널 핸들러 등록 모듈
 *
 * Renderer(React) ↔ Main 프로세스 통신 채널:
 *
 *   select-folder     : 폴더 선택 다이얼로그
 *   scan-folder       : 폴더 재귀 스캔 + DB upsert
 *   search-videos     : 동영상 검색 (전체 또는 키워드)
 *   update-video-meta : 메모/태그/별점/상태 업데이트
 *   open-video        : OS 기본 플레이어로 파일 열기
 *   open-folder       : 탐색기로 폴더 열기
 *   random-pick       : DB 기반 배우별 랜덤 추천
 *
 * 보안:
 *   - Renderer에서 직접 fs/DB 접근 불가
 *   - contextIsolation: true, nodeIntegration: false 유지
 */

const { ipcMain, dialog, shell } = require('electron')
const { getDb }     = require('./db.cjs')
const { scanFolder } = require('./scanner.cjs')

/**
 * 모든 IPC 핸들러를 등록한다.
 * app.whenReady() 콜백 내부에서 호출해야 한다.
 */
function registerIpcHandlers() {

  // ══════════════════════════════════════════════════════════════
  // 폴더 선택 다이얼로그
  // 반환: 선택된 폴더 경로(string) 또는 null(취소 시)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title:      '동영상 폴더 선택',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ══════════════════════════════════════════════════════════════
  // 폴더 재귀 스캔 + DB upsert
  //
  // - file_path 를 UNIQUE KEY로 사용
  // - 동일 경로 파일 존재 시: 파일 시스템 정보만 업데이트
  // - memo / tags / rating / status 는 기존 값 보존
  //
  // 반환: { totalFiles: number, scannedFolder: string }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('scan-folder', async (_event, folderPath) => {
    const db    = getDb()
    const files = await scanFolder(folderPath)

    // INSERT ... ON CONFLICT: 파일 시스템 컬럼만 UPDATE, 사용자 데이터 보존
    const upsert = db.prepare(`
      INSERT INTO videos
        (file_name, file_path, folder_path, extension, size, modified_at,
         code, actor_name, updated_at)
      VALUES
        (@file_name, @file_path, @folder_path, @extension, @size, @modified_at,
         @code, @actor_name, CURRENT_TIMESTAMP)
      ON CONFLICT(file_path) DO UPDATE SET
        file_name   = excluded.file_name,
        folder_path = excluded.folder_path,
        extension   = excluded.extension,
        size        = excluded.size,
        modified_at = excluded.modified_at,
        code        = excluded.code,
        actor_name  = excluded.actor_name,
        updated_at  = CURRENT_TIMESTAMP
    `)

    // 트랜잭션으로 일괄 처리: 수백~수천 건도 빠르게 처리
    const insertMany = db.transaction((fileList) => {
      for (const file of fileList) {
        upsert.run(file)
      }
    })

    insertMany(files)

    return {
      totalFiles:    files.length,
      scannedFolder: folderPath,
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 동영상 검색
  //
  // - query 가 빈 문자열이면 전체 조회
  // - file_name / code / actor_name / memo / tags 기준 LIKE 검색
  // - 배우명 → 품번 순으로 정렬
  //
  // 반환: Video[] (DB 레코드 배열)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('search-videos', async (_event, query) => {
    const db = getDb()

    if (!query || query.trim() === '') {
      // 전체 조회 (배우명 → 품번 정렬, NULL은 뒤로)
      return db.prepare(`
        SELECT * FROM videos
        ORDER BY
          CASE WHEN actor_name IS NULL OR actor_name = '' THEN 1 ELSE 0 END,
          actor_name,
          CASE WHEN code IS NULL OR code = '' THEN 1 ELSE 0 END,
          code
      `).all()
    }

    // 키워드 LIKE 검색 (앞뒤 % 와일드카드)
    const q = `%${query.trim()}%`
    return db.prepare(`
      SELECT * FROM videos
      WHERE  file_name  LIKE ?
          OR code       LIKE ?
          OR actor_name LIKE ?
          OR memo       LIKE ?
          OR tags       LIKE ?
      ORDER BY
        CASE WHEN actor_name IS NULL OR actor_name = '' THEN 1 ELSE 0 END,
        actor_name,
        CASE WHEN code IS NULL OR code = '' THEN 1 ELSE 0 END,
        code
    `).all(q, q, q, q, q)
  })

  // ══════════════════════════════════════════════════════════════
  // 동영상 메타 업데이트 (사용자 데이터만)
  //
  // - 수정 가능 필드: memo, tags, rating, status
  // - 파일 시스템 정보(file_name, size 등)는 변경 불가
  //
  // 반환: 업데이트된 Video 레코드
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('update-video-meta', async (_event, id, data) => {
    const db = getDb()
    const {
      memo   = '',
      tags   = '',
      rating = 0,
      status = 'normal',
    } = data

    db.prepare(`
      UPDATE videos
      SET
        memo       = ?,
        tags       = ?,
        rating     = ?,
        status     = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(memo, tags, rating, status, id)

    // 업데이트된 레코드를 반환하여 Renderer 상태 동기화
    return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id)
  })

  // ══════════════════════════════════════════════════════════════
  // 파일 열기 (OS 기본 플레이어)
  // shell.openPath: 파일 연결 프로그램으로 열기
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('open-video', async (_event, filePath) => {
    const err = await shell.openPath(filePath)
    if (err) throw new Error(`파일을 열 수 없습니다: ${err}`)
    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════
  // 폴더 열기 (탐색기에서 폴더 표시)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('open-folder', async (_event, folderPath) => {
    const err = await shell.openPath(folderPath)
    if (err) throw new Error(`폴더를 열 수 없습니다: ${err}`)
    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════
  // 랜덤 추천 (DB 기반)
  //
  // - 검색 필터 적용 후 배우별로 그룹화
  // - 각 그룹에서 랜덤 1개 선택
  // - 기존 기능(파일 스캔 기반)을 DB 기반으로 대체
  //
  // 반환: { totalFiles, actorCount, pickedCount, searchText, pickedList }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('random-pick', async (_event, query) => {
    const db = getDb()

    // 대상 영상 목록 조회
    let videos
    if (!query || query.trim() === '') {
      videos = db.prepare(`SELECT * FROM videos`).all()
    } else {
      const q = `%${query.trim()}%`
      videos = db.prepare(`
        SELECT * FROM videos
        WHERE  file_name  LIKE ?
            OR code       LIKE ?
            OR actor_name LIKE ?
            OR memo       LIKE ?
            OR tags       LIKE ?
      `).all(q, q, q, q, q)
    }

    if (videos.length === 0) {
      return { pickedList: [], searchText: '', totalFiles: 0, actorCount: 0, pickedCount: 0 }
    }

    // 배우별 그룹화 (actor_name이 없으면 '(미분류)' 로 묶음)
    const groups = {}
    for (const video of videos) {
      const key = video.actor_name || '(미분류)'
      if (!groups[key]) groups[key] = []
      groups[key].push(video)
    }

    // 각 배우 그룹에서 랜덤 1개 선택
    const pickedList = Object.values(groups).map((items) => {
      return items[Math.floor(Math.random() * items.length)]
    })

    // 품번을 OR로 연결한 검색식 생성
    const searchText = pickedList
      .map((p) => p.code)
      .filter(Boolean)
      .join(' OR ')

    return {
      totalFiles:  videos.length,
      actorCount:  Object.keys(groups).length,
      pickedCount: pickedList.length,
      searchText,
      pickedList,
    }
  })
}

module.exports = { registerIpcHandlers }
