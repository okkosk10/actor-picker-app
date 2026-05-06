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
 *   update-recommended: 추천 여부 단독 토글
 *   update-grade      : 등급 단독 변경
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

// ── 등급 정렬용 CASE 표현식 ───────────────────────────────────
// 영구소장(1) → 재시청 추천(2) → 만족(3) → 보관(4) → 애매(5) → 삭제요망(6)
const GRADE_CASE = `CASE grade
  WHEN '영구소장'    THEN 1
  WHEN '재시청 추천' THEN 2
  WHEN '만족'        THEN 3
  WHEN '보관'        THEN 4
  WHEN '애매'        THEN 5
  WHEN '삭제요망'    THEN 6
  ELSE 7
END`

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
  // 등급 우선: 등급 순위 ASC 후 별점 DESC
  grade_asc:     `${GRADE_CASE} ASC, rating DESC`,
  // 추천 + 등급: 추천작 먼저, 그 다음 등급 순위
  rec_grade:     `recommended DESC, ${GRADE_CASE} ASC, rating DESC`,
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
  // 수정 가능 필드: memo, tags, rating, status, recommended, grade
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
      grade       = '보관',
    } = data

    db.prepare(`
      UPDATE videos
      SET
        memo        = ?,
        tags        = ?,
        rating      = ?,
        status      = ?,
        recommended = ?,
        grade       = ?,
        updated_at  = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(memo, tags, rating, status, recommended ? 1 : 0, grade, id)

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
  // 등급(grade) 단독 변경
  //
  // update-video-meta 와 달리 grade 컬럼만 변경한다.
  // DetailPanel Select 변경 즉시 반영을 위해 별도 채널로 분리.
  //
  // @param id    {number} - 동영상 ID
  // @param grade {string} - 등급값 (영구소장/재시청 추천/만족/보관/애매/삭제요망)
  // 반환: 업데이트된 Video 레코드
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('update-grade', async (_event, id, grade) => {
    const db = getDb()
    // 허용된 등급값 화이트리스트 검증 (SQL Injection 방지)
    const ALLOWED_GRADES = ['영구소장', '재시청 추천', '만족', '보관', '애매', '삭제요망']
    const safeGrade = ALLOWED_GRADES.includes(grade) ? grade : '보관'

    db.prepare(`
      UPDATE videos
      SET grade      = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(safeGrade, id)

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
  // ══════════════════════════════════════════════════════════════
  // 배우별 1개 랜덤 추출 (pick-one-per-actor)
  //
  // 현재 검색 쿼리 기반으로 actor_name 별 그룹화 후 각 배우에서
  // 랜덤 1개 영상을 선택한다.
  //
  // 제외 조건:
  //   - code가 없는 영상
  //   - actor_name이 없는 영상
  //   - grade = '삭제요망'
  //   - status = 'missing' 또는 'deleted'
  //
  // @param query   {string}  - 검색어 (빈 문자열이면 전체)
  // @param options {{ hideMissing?: boolean }} - 검색 필터 옵션
  //
  // 반환: { count, orText, items }
  //   count   : 선택된 배우 수 (= 추출된 영상 수)
  //   orText  : "SSIS-001 OR IPZZ-123 OR ..." 형태 OR 검색식
  //   items   : 선택된 Video 레코드 배열
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('pick-one-per-actor', async (_event, query, options = {}) => {
    const db = getDb()

    // 기본 제외 조건: code/actor_name 필수, 삭제요망·missing·deleted 제외
    const baseFilter = `
      code IS NOT NULL AND code != ''
      AND actor_name IS NOT NULL AND actor_name != ''
      AND grade != '삭제요망'
      AND status != 'missing'
      AND status != 'deleted'
    `

    let videos
    if (!query || query.trim() === '') {
      // 쿼리 없으면 전체 대상
      videos = db.prepare(`
        SELECT * FROM videos WHERE ${baseFilter}
      `).all()
    } else {
      // 쿼리 있으면 file_name / code / actor_name / memo / tags LIKE 검색
      const q = `%${query.trim()}%`
      videos = db.prepare(`
        SELECT * FROM videos
        WHERE ${baseFilter}
          AND (file_name LIKE ? OR code LIKE ? OR actor_name LIKE ? OR memo LIKE ? OR tags LIKE ?)
      `).all(q, q, q, q, q)
    }

    if (videos.length === 0) {
      return { count: 0, orText: '', items: [] }
    }

    // actor_name 기준 그룹화
    const groups = {}
    for (const video of videos) {
      if (!groups[video.actor_name]) groups[video.actor_name] = []
      groups[video.actor_name].push(video)
    }

    // 각 그룹에서 랜덤 1개 선택
    const items = Object.values(groups).map(
      (arr) => arr[Math.floor(Math.random() * arr.length)]
    )

    // code 기준 OR 검색식 생성
    const orText = items.map((v) => v.code).filter(Boolean).join(' OR ')

    return { count: items.length, orText, items }
  })

  // ══════════════════════════════════════════════════════════════
  // 삭제요망 파일 목록 조회 (get-delete-candidates)
  //
  // grade = '삭제요망' 이고 아직 삭제되지 않은 (status != missing/deleted)
  // 파일 목록을 반환한다.
  //
  // 반환: { total, totalSize, items }
  //   total     : 대상 파일 수
  //   totalSize : 총 파일 크기 (bytes)
  //   items     : Video 레코드 배열
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-delete-candidates', async () => {
    const db = getDb()

    const items = db.prepare(`
      SELECT * FROM videos
      WHERE grade = '삭제요망'
        AND status != 'missing'
        AND status != 'deleted'
      ORDER BY size DESC
    `).all()

    const totalSize = items.reduce((sum, r) => sum + (r.size || 0), 0)

    return { total: items.length, totalSize, items }
  })

  // ══════════════════════════════════════════════════════════════
  // 삭제요망 파일 일괄 삭제 (delete-grade-targets)
  //
  // grade = '삭제요망' 인 파일을 실제 디스크에서 삭제하고
  // DB status를 'deleted' 로 업데이트한다.
  //
  // 보안:
  //   - grade = '삭제요망' 인 파일만 대상
  //   - fs.existsSync로 파일 존재 확인 후 삭제
  //   - 파일 삭제 실패 시 전체 중단 없이 failedItems에 기록
  //   - grade != '삭제요망' 파일은 절대 삭제하지 않음
  //
  // 반환: { total, deleted, failed, failedItems }
  //   total       : 처리 시도 파일 수
  //   deleted     : 삭제 성공 수
  //   failed      : 삭제 실패 수
  //   failedItems : [{ file_path, reason }]
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('delete-grade-targets', async () => {
    const db = getDb()

    // 삭제 대상 재조회 (grade 조건 다시 검증 — 보안)
    const targets = db.prepare(`
      SELECT * FROM videos
      WHERE grade = '삭제요망'
        AND status != 'missing'
        AND status != 'deleted'
    `).all()

    let deleted = 0
    let failed  = 0
    const failedItems = []

    for (const video of targets) {
      try {
        if (fs.existsSync(video.file_path)) {
          // 파일 존재 → 삭제 시도
          fs.unlinkSync(video.file_path)

          // 삭제 성공 → DB status = 'deleted' 처리
          db.prepare(`
            UPDATE videos
            SET status     = 'deleted',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(video.id)

          deleted++
        } else {
          // 파일이 이미 없음 → missing 처리 후 실패로 기록
          db.prepare(`
            UPDATE videos
            SET status     = 'missing',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(video.id)

          failedItems.push({
            file_path: video.file_path,
            reason: '파일이 이미 존재하지 않습니다 (missing 처리됨)',
          })
          failed++
        }
      } catch (err) {
        // 삭제 실패 (권한 오류, 잠금 등) → 중단 없이 기록
        failedItems.push({
          file_path: video.file_path,
          reason: err.message,
        })
        failed++
      }
    }

    return { total: targets.length, deleted, failed, failedItems }
  })
}


module.exports = { registerIpcHandlers }
