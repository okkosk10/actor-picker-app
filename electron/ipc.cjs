'use strict'

/**
 * electron/ipc.cjs
 * IPC 채널 핸들러 등록 모듈
 *
 * 채널 목록:
 *   select-folder     : 폴더 선택 다이얼로그
 *   scan-folder       : 폴더 재귀 스캔 + DB upsert + 삭제 파일 감지
 *   search-videos     : 동영상 검색 (키워드 + 정렬 + 숨김 필터)
 *   update-video-meta : 메모/태그/별점/상태/추천 업데이트
 *   open-video        : OS 기본 플레이어로 파일 열기
 *   open-folder       : 탐색기로 폴더 열기
 *   random-pick       : DB 기반 배우별 랜덤 추천
 *
 * 보안:
 *   - Renderer에서 직접 fs/DB 접근 불가
 *   - contextIsolation: true, nodeIntegration: false 유지
 */

const path = require('path')
const fs   = require('fs')
const { ipcMain, dialog, shell } = require('electron')
const { getDb }      = require('./db.cjs')
const { scanFolder } = require('./scanner.cjs')

// ── 정렬 조건 화이트리스트 ─────────────────────────────────────
// SQL Injection 방지: ORDER BY 절에 직접 사용할 값을 사전 정의된 맵으로만 허용
const SORT_CLAUSES = {
  created_desc:  `created_at DESC`,
  updated_desc:  `updated_at DESC`,
  rating_desc:   `rating DESC, COALESCE(actor_name,'') ASC, COALESCE(code,'') ASC`,
  rating_asc:    `rating ASC,  COALESCE(actor_name,'') ASC, COALESCE(code,'') ASC`,
  recommended:   `recommended DESC, rating DESC, COALESCE(actor_name,'') ASC`,
  actor_asc:     `COALESCE(actor_name,'') ASC, COALESCE(code,'') ASC`,
  code_asc:      `COALESCE(code,'') ASC`,
  random:        `RANDOM()`,
}
/** 허용되지 않은 정렬 키가 들어오면 기본값 반환 */
function getSortClause(key) {
  return SORT_CLAUSES[key] || SORT_CLAUSES.created_desc
}

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
  // 폴더 재귀 스캔 + DB upsert + 삭제 파일 감지
  //
  // ① 스캔된 파일을 DB에 upsert (missing → normal 자동 복구)
  // ② 해당 폴더 하위 DB 레코드 중 스캔에서 누락된 파일을 fs 로 재확인
  //    → 실제로 없으면 status = 'missing' 처리
  //
  // 반환: { totalFiles, missingCount, scannedFolder }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('scan-folder', async (_event, folderPath) => {
    const db    = getDb()
    const files = await scanFolder(folderPath)

    // ① INSERT ... ON CONFLICT: 파일 시스템 컬럼만 UPDATE, 사용자 데이터 보존
    //    이미 'missing' 이었던 파일이 다시 발견되면 status → 'normal' 으로 복구
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
        -- 이전에 missing 이었으면 normal 로 복구, 그 외 상태는 보존
        status      = CASE WHEN status = 'missing' THEN 'normal' ELSE status END,
        updated_at  = CURRENT_TIMESTAMP
    `)

    // 트랜잭션으로 일괄 upsert (수천 건도 빠르게 처리)
    db.transaction((fileList) => {
      for (const file of fileList) upsert.run(file)
    })(files)

    // ② 삭제 파일 감지: 해당 폴더 하위 DB 레코드 vs 스캔 결과 비교
    const scannedPaths = new Set(files.map((f) => f.file_path))

    // DB에서 folderPath 하위 레코드 전체 조회 (Windows/Unix 경로 구분자 양쪽 처리)
    const dbRecords = db.prepare(`
      SELECT id, file_path, status FROM videos
      WHERE  folder_path = ?
          OR folder_path LIKE ?
          OR folder_path LIKE ?
    `).all(
      folderPath,
      folderPath + '\\%',
      folderPath + '/%',
    )

    // 스캔에서 누락된 레코드만 추려 실제 존재 여부 확인
    const markMissing = db.prepare(`
      UPDATE videos
      SET status = 'missing', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    let missingCount = 0
    db.transaction(() => {
      for (const rec of dbRecords) {
        if (scannedPaths.has(rec.file_path)) continue   // 스캔에서 찾은 파일 → 무시
        if (rec.status === 'missing') continue           // 이미 missing 처리됨 → 무시
        if (!fs.existsSync(rec.file_path)) {             // 실제로 없으면 missing 처리
          markMissing.run(rec.id)
          missingCount++
        }
      }
    })()

    return {
      totalFiles:    files.length,
      missingCount,
      scannedFolder: folderPath,
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 동영상 검색
  //
  // @param query  {string}  - 검색 키워드 (빈 문자열 = 전체)
  // @param options {object} - { sortBy: string, hideMissing: boolean }
  //   sortBy      : SORT_CLAUSES 키 (기본: 'created_desc')
  //   hideMissing : true 이면 status='missing' 제외 (기본: true)
  //
  // 반환: Video[]
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('search-videos', async (_event, query, options = {}) => {
    const db          = getDb()
    const orderClause = getSortClause(options.sortBy)
    const hideMissing = options.hideMissing !== false // 기본값 true

    // 삭제 파일 숨김 조건 (hideMissing=true 이면 missing 제외)
    const missingFilter = hideMissing ? `AND status != 'missing'` : ''

    if (!query || query.trim() === '') {
      return db.prepare(`
        SELECT * FROM videos
        WHERE 1=1 ${missingFilter}
        ORDER BY ${orderClause}
      `).all()
    }

    const q = `%${query.trim()}%`
    return db.prepare(`
      SELECT * FROM videos
      WHERE (
            file_name  LIKE ?
         OR code       LIKE ?
         OR actor_name LIKE ?
         OR memo       LIKE ?
         OR tags       LIKE ?
      ) ${missingFilter}
      ORDER BY ${orderClause}
    `).all(q, q, q, q, q)
  })

  // ══════════════════════════════════════════════════════════════
  // 동영상 메타 업데이트 (사용자 입력 데이터)
  //
  // 수정 가능 필드: memo, tags, rating, status, recommended
  // 파일 시스템 정보(file_name, size 등)는 변경 불가
  //
  // 반환: 업데이트된 Video 레코드
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('update-video-meta', async (_event, id, data) => {
    const db = getDb()
    const {
      memo        = '',
      tags        = '',
      rating      = 0,
      status      = 'normal',
      recommended = 0,
    } = data

    db.prepare(`
      UPDATE videos
      SET
        memo        = ?,
        tags        = ?,
        rating      = ?,
        status      = ?,
        recommended = ?,
        updated_at  = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(memo, tags, rating, status, recommended ? 1 : 0, id)

    return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id)
  })

  // ══════════════════════════════════════════════════════════════
  // 추천 여부 단독 토글
  //
  // update-video-meta 와 달리 recommended 컬럼만 변경한다.
  // UI에서 Switch 토글 시 즉각 반영을 위해 별도 채널로 분리.
  //
  // @param id          {number}  - 동영상 ID
  // @param recommended {0|1}     - 추천 여부 (1=추천, 0=일반)
  // 반환: 업데이트된 Video 레코드
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('update-recommended', async (_event, id, recommended) => {
    const db = getDb()
    db.prepare(`
      UPDATE videos
      SET recommended = ?,
          updated_at  = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(recommended ? 1 : 0, id)

    return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id)
  })

  // ══════════════════════════════════════════════════════════════
  // 파일 열기 (OS 기본 플레이어)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('open-video', async (_event, filePath) => {
    const err = await shell.openPath(filePath)
    if (err) throw new Error(`파일을 열 수 없습니다: ${err}`)
    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════
  // 폴더 열기 (탐색기)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('open-folder', async (_event, folderPath) => {
    const err = await shell.openPath(folderPath)
    if (err) throw new Error(`폴더를 열 수 없습니다: ${err}`)
    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════
  // 랜덤 추천 (DB 기반)
  //
  // - hideMissing=true 이면 missing 파일 제외
  // - 배우별 그룹화 후 각 그룹에서 랜덤 1개 선택
  //
  // 반환: { totalFiles, actorCount, pickedCount, searchText, pickedList }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('random-pick', async (_event, query, options = {}) => {
    const db          = getDb()
    const hideMissing = options.hideMissing !== false
    const missingFilter = hideMissing ? `AND status != 'missing'` : ''

    let videos
    if (!query || query.trim() === '') {
      videos = db.prepare(`
        SELECT * FROM videos WHERE 1=1 ${missingFilter}
      `).all()
    } else {
      const q = `%${query.trim()}%`
      videos = db.prepare(`
        SELECT * FROM videos
        WHERE (file_name LIKE ? OR code LIKE ? OR actor_name LIKE ? OR memo LIKE ? OR tags LIKE ?)
          ${missingFilter}
      `).all(q, q, q, q, q)
    }

    if (videos.length === 0) {
      return { pickedList: [], searchText: '', totalFiles: 0, actorCount: 0, pickedCount: 0 }
    }

    // 배우별 그룹화 (actor_name 없으면 '(미분류)')
    const groups = {}
    for (const video of videos) {
      const key = video.actor_name || '(미분류)'
      if (!groups[key]) groups[key] = []
      groups[key].push(video)
    }

    // 각 그룹에서 랜덤 1개 선택
    const pickedList = Object.values(groups).map(
      (items) => items[Math.floor(Math.random() * items.length)]
    )

    const searchText = pickedList.map((p) => p.code).filter(Boolean).join(' OR ')

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
