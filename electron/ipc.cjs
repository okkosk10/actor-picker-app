'use strict'

/**
 * electron/ipc.cjs
 * IPC 채널 핸들러 등록 모듈
 *
 * 채널 목록:
 *   select-folder              : 폴더 선택 다이얼로그
 *   scan-folder                : 폴더 재귀 스캔 + DB upsert + 삭제 파일 감지
 *   search-videos              : 동영상 검색 (키워드 + 정렬 + 숨김 필터)
 *   update-video-meta          : 메모/태그/별점/상태/추천 업데이트
 *   update-recommended         : 추천 여부 단독 토글
 *   update-grade               : 등급 단독 변경
 *   open-video                 : OS 기본 플레이어로 파일 열기
 *   open-folder                : 탐색기로 폴더 열기
 *   random-pick                : DB 기반 배우별 랜덤 추천
 *   copy-files-to-clipboard    : Windows CF_HDROP 파일 클립보드 복사
 *   copy-files-to-device       : Shell 폴더 선택 + CopyHere 직접 복사 (MTP 지원)
 *
 * 보안:
 *   - Renderer에서 직접 fs/DB 접근 불가
 *   - contextIsolation: true, nodeIntegration: false 유지
 */

const path = require('path')
const fs   = require('fs')
const { ipcMain, dialog, shell, BrowserWindow } = require('electron')
const { getDb }               = require('./db.cjs')
const { scanFolder }          = require('./scanner.cjs')
const { copyFilesToClipboard, copyFilesToDevice } = require('./clipboardHelper.cjs')

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

// ── LIKE 이스케이프 헬퍼 ───────────────────────────────────────
// SQLite LIKE 에서 특수 의미를 갖는 %, _, ! 를 '!' 로 이스케이프한다.
// Windows 경로에서 흔히 사용하는 \는 SQLite LIKE의 특수문자가 아니므로 안전하다.
function escapeLike(str) {
  return str.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')
}

/**
 * currentFolder 기반 SQL 폴더 필터 조건과 파라미터를 반환한다.
 *
 * currentFolder가 null이면 전체 조회 (빈 clause/params 반환).
 * Windows(\) 및 Unix(/) 경로 구분자를 모두 커버한다.
 *
 * @param {string|null} currentFolder - 필터링할 루트 폴더 경로
 * @returns {{ clause: string, params: string[] }}
 */
function buildFolderFilter(currentFolder) {
  if (!currentFolder) return { clause: '', params: [] }
  const safe = escapeLike(currentFolder)
  return {
    // 정확 일치(root 디렉토리 파일) + Windows 하위(\) + Unix 하위(/) 패턴
    clause: `AND (folder_path = ? OR folder_path LIKE ? ESCAPE '!' OR folder_path LIKE ? ESCAPE '!')`,
    params: [currentFolder, safe + '\\%', safe + '/%'],
  }
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
  // ① 스캔된 파일을 DB에 upsert
  //    - 신규 파일  : INSERT → tags 자동 생성 (폴더명 + 배우명)
  //    - 기존 파일  : UPDATE → 파일 시스템 컬럼만 갱신, tags 절대 덮어쓰지 않음
  //    - missing → normal 자동 복구
  // ② 해당 폴더 하위 DB 레코드 중 스캔에서 누락된 파일을 fs 로 재확인
  //    → 실제로 없으면 status = 'missing' 처리
  //
  // 반환: { totalFiles, missingCount, scannedFolder }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('scan-folder', async (_event, folderPath) => {
    const db    = getDb()
    const files = await scanFolder(folderPath)

    /**
     * 신규 파일 INSERT 시 사용할 기본 tags를 생성한다.
     *
     * 자동 태그 정책:
     *   - "최초 등록 보조 기능"으로만 사용
     *   - 폴더 마지막 세그먼트 + actor_name 으로 구성
     *   - 중복 제거, 빈 값 제외
     *
     * 기존 파일 재스캔 시에는 이 함수를 사용하지 않는다.
     * (tags는 사용자 데이터로 취급 → ON CONFLICT 시 업데이트 제외)
     *
     * @param {object} video - scanner.cjs 가 반환한 파일 메타데이터
     * @returns {string}     - 콤마 + 공백으로 구분된 태그 문자열
     */
    function createDefaultTags(video) {
      // path.basename: Windows(\) / Unix(/) 양쪽 처리
      const folderName = path.basename(video.folder_path || '')
      const actorName  = video.actor_name || ''
      return Array.from(
        new Set([folderName, actorName].filter(Boolean))
      ).join(', ')
    }

    // ① INSERT ... ON CONFLICT: 신규 vs 기존 동작 분리
    //
    //   신규 파일 (INSERT 실행):
    //     - tags = createDefaultTags(video)  ← 자동 태그 최초 설정
    //     - is_new = 1 : "작업 대기" 상태로 NEW 탭에 표시
    //     - 모든 컬럼 초기화
    //
    //   기존 파일 (ON CONFLICT DO UPDATE 실행):
    //     - 파일 시스템 컬럼만 갱신 (file_name, folder_path, extension, size, modified_at, code, actor_name)
    //     - tags 는 업데이트하지 않음 → 사용자가 수정한 태그 유지
    //     - memo / rating / recommended / grade 도 보존 (SET 절 미포함)
    //     - is_new 도 보존 → 기존 파일 재스캔 시 NEW 상태 유지/변경 없음
    //     - missing → normal 자동 복구
    const upsert = db.prepare(`
      INSERT INTO videos
        (file_name, file_path, folder_path, extension, size, modified_at,
         code, actor_name, tags, is_new, updated_at)
      VALUES
        (@file_name, @file_path, @folder_path, @extension, @size, @modified_at,
         @code, @actor_name, @tags, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(file_path) DO UPDATE SET
        file_name   = excluded.file_name,
        folder_path = excluded.folder_path,
        extension   = excluded.extension,
        size        = excluded.size,
        modified_at = excluded.modified_at,
        code        = excluded.code,
        actor_name  = excluded.actor_name,
        -- tags / is_new 컬럼은 여기에 포함하지 않음 → 사용자 데이터 보존
        -- 이전에 missing 이었으면 normal 로 복구, 그 외 상태는 보존
        status      = CASE WHEN status = 'missing' THEN 'normal' ELSE status END,
        updated_at  = CURRENT_TIMESTAMP
    `)

    // 트랜잭션으로 일괄 upsert (수천 건도 빠르게 처리)
    db.transaction((fileList) => {
      for (const file of fileList) {
        // 신규 INSERT 시 tags 자동 생성값을 파라미터로 전달한다.
        // ON CONFLICT DO UPDATE 경로에서는 이 값이 무시되므로 안전하다.
        upsert.run({ ...file, tags: createDefaultTags(file) })
      }
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

    // ③ 스캔한 루트 폴더를 scanned_roots 테이블에 기록 (폴더 패널용)
    db.prepare(`
      INSERT INTO scanned_roots (root_path, scanned_at)
      VALUES (?, CURRENT_TIMESTAMP)
      ON CONFLICT(root_path) DO UPDATE SET scanned_at = CURRENT_TIMESTAMP
    `).run(folderPath)

    return {
      totalFiles:    files.length,
      missingCount,
      scannedFolder: folderPath,
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 스캔된 폴더 목록 조회 (get-folder-list)
  //
  // scanned_roots 테이블의 루트 폴더별로 아래 통계를 반환한다.
  //   total             : 해당 루트 하위 전체 영상 수 (deleted 제외)
  //   recommended_count : 추천작 수
  //   delete_count      : 삭제요망(grade) 중 실제 파일 있는 수
  //
  // 반환: { library: {...}, folders: FolderStat[] }
  //   library : 전체 라이브러리 합계 통계
  //   folders : 루트 폴더별 통계 배열 (root_path 오름차순)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-folder-list', async () => {
    const db = getDb()

    // 전체 라이브러리 통계 (status='deleted' 제외)
    const library = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN recommended = 1 THEN 1 ELSE 0 END)                                                                           AS recommended_count,
        SUM(CASE WHEN grade = '삭제요망' AND status != 'missing' AND status != 'deleted' THEN 1 ELSE 0 END) AS delete_count
      FROM videos
      WHERE status != 'deleted'
    `).get()

    // 루트 폴더 목록 (scanned_roots 테이블)
    const roots = db.prepare(`
      SELECT root_path, scanned_at FROM scanned_roots ORDER BY root_path ASC
    `).all()

    // 각 루트별 통계 (folder_path 하위 파일 집계)
    const countStmt = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN recommended = 1 THEN 1 ELSE 0 END)                                                                           AS recommended_count,
        SUM(CASE WHEN grade = '삭제요망' AND status != 'missing' AND status != 'deleted' THEN 1 ELSE 0 END) AS delete_count
      FROM videos
      WHERE status != 'deleted'
        AND (folder_path = ? OR folder_path LIKE ? ESCAPE '!' OR folder_path LIKE ? ESCAPE '!')
    `)

    const folders = roots.map((row) => {
      const safe  = escapeLike(row.root_path)
      const stats = countStmt.get(row.root_path, safe + '\\%', safe + '/%')
      return {
        root_path:         row.root_path,
        scanned_at:        row.scanned_at,
        total:             stats.total,
        recommended_count: stats.recommended_count,
        delete_count:      stats.delete_count,
      }
    })

    return { library, folders }
  })

  // ══════════════════════════════════════════════════════════════
  // 동영상 검색
  //
  // @param query  {string}  - 검색 키워드 (빈 문자열 = 전체)
  // @param options {object} - {
  //   sortBy:        string     - SORT_CLAUSES 키 (기본: 'created_desc')
  //   currentFolder: string|null - 폴더 필터 (null이면 전체 라이브러리)
  //   tabMode:       string     - 'all' | 'new' | 'recommended'
  //                              'new' 이면 is_new=1 + missing/deleted 자동 제외
  //                              'recommended' 이면 recommended=1만
  //   filters: {
  //     recommendedOnly:    boolean  - true이면 recommended=1만
  //     excludeDeleteGrade: boolean  - true이면 grade='삭제요망' 제외
  //     excludeMissing:     boolean  - true이면 status='missing' 제외
  //     excludeDeleted:     boolean  - true이면 status='deleted' 제외
  //     grades:             string[] - 지정 시 해당 등급만 (빈 배열=전체)
  //     minRating:          number   - 지정 시 rating >= 이 값
  //   }
  // }
  //
  // 반환: Video[]
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('search-videos', async (_event, query, options = {}) => {
    const db          = getDb()
    const orderClause = getSortClause(options.sortBy)
    const filters     = options.filters || {}
    const tabMode     = options.tabMode || 'all'   // 'all' | 'new' | 'recommended'

    // 폴더 필터 (currentFolder가 null이면 전체 조회)
    const { clause: folderClause, params: folderParams } = buildFolderFilter(options.currentFolder || null)

    // ── 탭 모드별 기본 조건 ─────────────────────────────────────
    // tabMode='new': NEW 작업 대기함 — is_new=1 + missing/deleted 자동 제외
    // tabMode='recommended': 추천 탭 — recommended=1만 표시
    // tabMode='all' (기본): 필터 조건만 적용
    const tabConditions = []
    if (tabMode === 'new') {
      tabConditions.push(`is_new = 1`)
      tabConditions.push(`status != 'missing'`)
      tabConditions.push(`status != 'deleted'`)
    } else if (tabMode === 'recommended') {
      tabConditions.push(`recommended = 1`)
    }
    const tabClause = tabConditions.length > 0
      ? 'AND ' + tabConditions.join(' AND ')
      : ''

    // ── 필터 조건 빌드 ─────────────────────────────────────────
    // 각 조건을 AND로 연결. SQL Injection 방지:
    //   - 불린 조건은 리터럴 SQL 문자열(사용자 값 미포함)
    //   - grades는 허용 목록(ALLOWED_GRADES) 검증 후 ? 바인딩
    //   - minRating은 숫자 검증 후 ? 바인딩
    const filterConditions = []
    const filterParams     = []

    // 추천작만 (tabMode가 recommended가 아닐 때만 적용)
    if (filters.recommendedOnly && tabMode !== 'recommended') {
      filterConditions.push(`recommended = 1`)
    }

    // 삭제요망 등급 제외
    if (filters.excludeDeleteGrade) {
      filterConditions.push(`grade != '삭제요망'`)
    }

    // missing 상태 제외 (NEW 탭에서는 이미 tabClause에서 처리됨)
    if (filters.excludeMissing && tabMode !== 'new') {
      filterConditions.push(`status != 'missing'`)
    }

    // deleted 상태 제외 (NEW 탭에서는 이미 tabClause에서 처리됨)
    if (filters.excludeDeleted && tabMode !== 'new') {
      filterConditions.push(`status != 'deleted'`)
    }

    // 등급 화이트리스트 필터 (grades 배열이 비어있으면 전체 허용)
    if (Array.isArray(filters.grades) && filters.grades.length > 0) {
      const ALLOWED_GRADES = ['영구소장', '재시청 추천', '만족', '보관', '애매', '삭제요망']
      const safeGrades = filters.grades.filter((g) => ALLOWED_GRADES.includes(g))
      if (safeGrades.length > 0) {
        filterConditions.push(`grade IN (${safeGrades.map(() => '?').join(',')})`)
        filterParams.push(...safeGrades)
      }
    }

    // 최소 별점 필터 (0이면 필터 없음)
    const minRating = typeof filters.minRating === 'number' ? Math.floor(filters.minRating) : 0
    if (minRating > 0) {
      filterConditions.push(`rating >= ?`)
      filterParams.push(minRating)
    }

    // 필터 조건 SQL 문자열 조합
    const filterClause = filterConditions.length > 0
      ? 'AND ' + filterConditions.join(' AND ')
      : ''

    if (!query || query.trim() === '') {
      return db.prepare(`
        SELECT * FROM videos
        WHERE 1=1 ${tabClause} ${filterClause} ${folderClause}
        ORDER BY ${orderClause}
      `).all(...filterParams, ...folderParams)
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
      ) ${tabClause} ${filterClause} ${folderClause}
      ORDER BY ${orderClause}
    `).all(q, q, q, q, q, ...filterParams, ...folderParams)
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

    // 사용자가 메타 정보를 수정하면 is_new = 0 으로 해제한다.
    // (등급/추천/별점/태그/메모 중 하나라도 작업하면 NEW 상태 해제)
    db.prepare(`
      UPDATE videos
      SET
        memo        = ?,
        tags        = ?,
        rating      = ?,
        status      = ?,
        recommended = ?,
        grade       = ?,
        is_new      = 0,
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
    // 추천 체크/해제 시에도 is_new = 0 으로 해제 (사용자가 작업한 것으로 판단)
    db.prepare(`
      UPDATE videos
      SET recommended = ?,
          is_new      = 0,
          updated_at  = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(recommended ? 1 : 0, id)

    return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id)
  })

  // ══════════════════════════════════════════════════════════════
  // 등급(grade) 즉시 변경 + 별점·추천작 자동 연동
  //
  // grade, rating, recommended 를 함께 업데이트한다.
  // 등급 ↔ 별점 자동 연동 정책을 DB까지 일관되게 반영하기 위해
  // 세 컬럼을 하나의 트랜잭션으로 처리한다.
  //
  // @param id        {number} - 동영상 ID
  // @param gradeData {object} - { grade, rating, recommended }
  //   grade       : 등급값 (영구소장/재시청 추천/만족/보관/애매/삭제요망)
  //   rating      : 별점 (0~5)
  //   recommended : 추천 여부 (0|1)
  // 반환: 업데이트된 Video 레코드
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('update-grade', async (_event, id, gradeData) => {
    const db = getDb()
    // 허용된 등급값 화이트리스트 검증 (SQL Injection 방지)
    const ALLOWED_GRADES = ['영구소장', '재시청 추천', '만족', '보관', '애매', '삭제요망']

    const grade       = ALLOWED_GRADES.includes(gradeData.grade) ? gradeData.grade : '보관'
    const rating      = typeof gradeData.rating === 'number' ? Math.max(0, Math.min(5, Math.floor(gradeData.rating))) : 0
    const recommended = gradeData.recommended ? 1 : 0

    db.prepare(`
      UPDATE videos
      SET grade       = ?,
          rating      = ?,
          recommended = ?,
          is_new      = 0,
          updated_at  = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(grade, rating, recommended, id)

    return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id)
  })

  // ══════════════════════════════════════════════════════════════
  // NEW 작업 대기함 카운트 조회 (get-new-count)
  //
  // is_new = 1 인 파일 수를 반환한다. (탭 배지 숫자용)
  // missing / deleted 상태 파일은 제외한다.
  //
  // 반환: { count: number }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-new-count', async () => {
    const db = getDb()
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM   videos
      WHERE  is_new  = 1
        AND  status != 'missing'
        AND  status != 'deleted'
    `).get()
    return { count: row.count }
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
  // - currentFolder 지정 시 해당 폴더 하위만 대상
  // - 배우별 그룹화 후 각 그룹에서 랜덤 1개 선택
  //
  // 반환: { totalFiles, actorCount, pickedCount, searchText, pickedList }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('random-pick', async (_event, query, options = {}) => {
    const db          = getDb()
    const hideMissing = options.hideMissing !== false
    const missingFilter = hideMissing ? `AND status != 'missing'` : ''
    const { clause: folderClause, params: folderParams } = buildFolderFilter(options.currentFolder || null)

    let videos
    if (!query || query.trim() === '') {
      videos = db.prepare(`
        SELECT * FROM videos WHERE 1=1 ${missingFilter} ${folderClause}
      `).all(...folderParams)
    } else {
      const q = `%${query.trim()}%`
      videos = db.prepare(`
        SELECT * FROM videos
        WHERE (file_name LIKE ? OR code LIKE ? OR actor_name LIKE ? OR memo LIKE ? OR tags LIKE ?)
          ${missingFilter} ${folderClause}
      `).all(q, q, q, q, q, ...folderParams)
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
  // @param options {{ hideMissing?: boolean, currentFolder?: string|null }}
  //
  // 반환: { count, orText, items }
  //   count   : 선택된 배우 수 (= 추출된 영상 수)
  //   orText  : "SSIS-001 OR IPZZ-123 OR ..." 형태 OR 검색식
  //   items   : 선택된 Video 레코드 배열
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('pick-one-per-actor', async (_event, query, options = {}) => {
    const db = getDb()
    const { clause: folderClause, params: folderParams } = buildFolderFilter(options.currentFolder || null)

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
      // 쿼리 없으면 전체 대상 (폴더 필터 적용)
      videos = db.prepare(`
        SELECT * FROM videos WHERE ${baseFilter} ${folderClause}
      `).all(...folderParams)
    } else {
      // 쿼리 있으면 file_name / code / actor_name / memo / tags LIKE 검색
      const q = `%${query.trim()}%`
      videos = db.prepare(`
        SELECT * FROM videos
        WHERE ${baseFilter}
          AND (file_name LIKE ? OR code LIKE ? OR actor_name LIKE ? OR memo LIKE ? OR tags LIKE ?)
          ${folderClause}
      `).all(q, q, q, q, q, ...folderParams)
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
  // @param currentFolder {string|null} - 폴더 필터 (null이면 전체 라이브러리)
  //
  // 반환: { total, totalSize, items }
  //   total     : 대상 파일 수
  //   totalSize : 총 파일 크기 (bytes)
  //   items     : Video 레코드 배열
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-delete-candidates', async (_event, currentFolder) => {
    const db = getDb()
    const { clause: folderClause, params: folderParams } = buildFolderFilter(currentFolder || null)

    const items = db.prepare(`
      SELECT * FROM videos
      WHERE grade = '삭제요망'
        AND status != 'missing'
        AND status != 'deleted'
        ${folderClause}
      ORDER BY size DESC
    `).all(...folderParams)

    const totalSize = items.reduce((sum, r) => sum + (r.size || 0), 0)

    return { total: items.length, totalSize, items }
  })

  // ══════════════════════════════════════════════════════════════
  // 삭제요망 파일 일괄 삭제 (delete-grade-targets)
  //
  // grade = '삭제요망' 인 파일을 실제 디스크에서 삭제하고
  // DB status를 'deleted' 로 업데이트한다.
  //
  // @param currentFolder {string|null} - 폴더 필터 (null이면 전체 라이브러리)
  //
  // 보안:
  //   - grade = '삭제요망' 인 파일만 대상 (재검증)
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
  ipcMain.handle('delete-grade-targets', async (_event, currentFolder) => {
    const db = getDb()
    const { clause: folderClause, params: folderParams } = buildFolderFilter(currentFolder || null)

    // 삭제 대상 재조회 (grade 조건 다시 검증 — 보안) + 폴더 필터
    const targets = db.prepare(`
      SELECT * FROM videos
      WHERE grade = '삭제요망'
        AND status != 'missing'
        AND status != 'deleted'
        ${folderClause}
    `).all(...folderParams)

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

  // ══════════════════════════════════════════════════════════════
  // Windows 파일 클립보드 복사 (CF_HDROP 방식)
  //
  // 입력: filePaths {string[]} - 복사할 파일의 절대 경로 배열
  // 반환: {
  //   success:     boolean
  //   count:       number       - 실제 클립보드에 등록된 파일 수
  //   totalSize:   number       - 존재 확인된 파일들의 합산 크기 (bytes)
  //   failedPaths: string[]     - 존재하지 않거나 절대경로가 아닌 경로
  //   error?:      string       - 실패 시 오류 메시지
  // }
  //
  // 보안:
  //   - 절대 경로 검증 (path.isAbsolute)
  //   - fs.statSync 로 실제 존재 여부 확인
  //   - 배열 타입 외 입력 거부
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('copy-files-to-clipboard', async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: '파일 경로가 없습니다.', count: 0, totalSize: 0, failedPaths: [] }
    }

    const validPaths  = []
    const failedPaths = []
    let   totalSize   = 0

    for (const fp of filePaths) {
      // 보안: 문자열 + 절대 경로만 허용
      if (typeof fp !== 'string' || !path.isAbsolute(fp)) {
        failedPaths.push(fp)
        continue
      }
      try {
        const stat = fs.statSync(fp)
        if (stat.isFile()) {
          validPaths.push(fp)
          totalSize += stat.size
        } else {
          failedPaths.push(fp)
        }
      } catch {
        failedPaths.push(fp)
      }
    }

    if (validPaths.length === 0) {
      return {
        success:     false,
        error:       '존재하는 파일이 없습니다.',
        count:       0,
        totalSize:   0,
        failedPaths,
      }
    }

    try {
      const { count } = await copyFilesToClipboard(validPaths)
      return { success: true, count, totalSize, failedPaths }
    } catch (err) {
      return { success: false, error: err.message, count: 0, totalSize, failedPaths }
    }
  })

  // ── Shell 폴더 선택 + 직접 복사 (MTP 장치 지원) ──────────────
  ipcMain.handle('copy-files-to-device', async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: '파일 경로가 없습니다.', action: 'none', count: 0 }
    }

    const validPaths = []
    for (const fp of filePaths) {
      if (typeof fp !== 'string' || !path.isAbsolute(fp)) continue
      try {
        if (fs.statSync(fp).isFile()) validPaths.push(fp)
      } catch { /* 존재하지 않는 파일 무시 */ }
    }

    if (validPaths.length === 0) {
      return { success: false, error: '존재하는 파일이 없습니다.', action: 'none', count: 0 }
    }

    // Electron 창 HWND 를 BrowseForFolder 부모로 전달
    // → 대화상자가 앱 위에 표시되고 MTP 장치(휴대폰) 폴더도 목록에 포함됨
    const mainWin    = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const hwndBuffer = mainWin?.getNativeWindowHandle()
    const hwnd       = hwndBuffer ? hwndBuffer.readUInt32LE(0) : 0

    try {
      const result = await copyFilesToDevice(validPaths, hwnd)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message, action: 'error', count: 0 }
    }
  })
}


module.exports = { registerIpcHandlers }
