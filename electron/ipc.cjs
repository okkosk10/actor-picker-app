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
 *   copy-files-to-device       : MTP 전송 큐 (1개씩 순차, 진행률 IPC 이벤트)
 *
 * 보안:
 *   - Renderer에서 직접 fs/DB 접근 불가
 *   - contextIsolation: true, nodeIntegration: false 유지
 */

const path = require('path')
const fs   = require('fs')
const { ipcMain, dialog, shell, BrowserWindow, app } = require('electron')
const { getDb, recordVideoActivity, getDashboardStats } = require('./db.cjs')
const { scanFolder }          = require('./scanner.cjs')
const { parseFileName }       = require('./parser.cjs')
const { copyFilesToClipboard, createMtpSession, createMtpBulkSession, createMtpThemeBulkSession, calcTimeoutSec } = require('./clipboardHelper.cjs')
const { testOpenAIConnection }   = require('./services/openaiClient.cjs')
const { generateAiThemeFolders } = require('./services/aiThemeFolderService.cjs')
const { createThemeFolders }     = require('./services/themeCopyService.cjs')
const { askAiChatRecommend }     = require('./services/aiChatRecommendService.cjs')

// ── MTP 액션 디스패첫 (needsCheck 일시정지 중 UI가 동작을 확인해 가져옵니다) ─────
// device-copy-action IPC 메시지를 받아 대기 중인 프로미스를 해제한다.
let _resolveAction = null
const waitForAction  = () => new Promise(resolve => { _resolveAction = resolve })
const dispatchAction = (action) => {
  if (_resolveAction) { _resolveAction(action); _resolveAction = null }
}

// ── MTP 안정 모드 세션 참조 (사용자 완료 버튼으로 종료) ─────────
let _bulkSession = null
// ── bulk 복사 완료 후 활동 기록용 pending 목록 ─────────────────
let _bulkPending = []
// ── AI 테마 장치 복사 세션 참조 ────────────────────────────────
let _themeSession = null

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
 * video_id 기준으로 actors / video_actors를 동기화한다.
 *
 * - actors 테이블에 없는 배우는 자동 INSERT
 * - 해당 video_id의 video_actors 기존 매핑을 삭제 후 재삽입
 * - 첫 번째 배우: is_main = 1, 나머지: is_main = 0
 * - 트랜잭션 없음 → 호출 측에서 트랜잭션 래핑 필요
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number}  videoId
 * @param {string}  actorName  - "(배우1, 배우2)" 또는 "배우1, 배우2" 형태
 */
function syncVideoActors(db, videoId, actorName) {
  const raw   = actorName.replace(/^\(|\)$/g, '').trim()
  const names = raw.split(',').map((n) => n.trim()).filter((n) => n.length > 0)
  if (names.length === 0) return

  const insertActor  = db.prepare('INSERT INTO actors (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
  const getActor     = db.prepare('SELECT id FROM actors WHERE name = ?')
  const deleteLinks  = db.prepare('DELETE FROM video_actors WHERE video_id = ?')
  const insertLink   = db.prepare(`
    INSERT INTO video_actors (video_id, actor_id, is_main, order_index)
    VALUES (?, ?, ?, ?)
  `)

  deleteLinks.run(videoId)
  names.forEach((name, idx) => {
    insertActor.run(name)
    const actor = getActor.get(name)
    if (!actor) return
    insertLink.run(videoId, actor.id, idx === 0 ? 1 : 0, idx)
  })
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
  // 파일 동일성 판단 기준: file_identity (file_path 변경에 무관)
  //   - code가 있으면 `${code}|${size}`
  //   - code가 없으면 `${file_name}|${size}`
  //
  // ① 스캔된 파일을 DB에 반영
  //    a) file_path로 기존 row 조회 → 있으면 파일 시스템 컬럼만 갱신
  //    b) file_identity로 기존 row 조회 → 있으면 경로 갱신 (사용자 데이터 보존)
  //    c) 없으면 신규 INSERT
  // ② 같은 file_identity를 가진 row가 2개 이상이면 master 선정 후 나머지 duplicate 처리
  // ③ 해당 폴더 하위 DB 레코드 중 스캔에서 누락된 파일을 fs 로 재확인
  //    → 실제로 없으면 status = 'missing' 처리
  //
  // 반환: { totalFiles, missingCount, scannedFolder }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('scan-folder', async (_event, folderPath) => {
    const db    = getDb()
    const files = await scanFolder(folderPath)

    /** 신규 INSERT 시 기본 tags 생성 (폴더명 + 배우명) */
    function createDefaultTags(video) {
      const folderName = path.basename(video.folder_path || '')
      const actorName  = video.actor_name || ''
      return Array.from(new Set([folderName, actorName].filter(Boolean))).join(', ')
    }

    /**
     * file_identity 생성
     * code가 있으면 `${code}|${size}`, 없으면 `${file_name}|${size}`
     */
    function buildFileIdentity(file) {
      const code = file.code && file.code.trim() ? file.code.trim() : null
      const size = file.size ?? 0
      return code ? `${code}|${size}` : `${file.file_name}|${size}`
    }

    // ── Prepared statements ────────────────────────────────────
    const findByPath = db.prepare(
      `SELECT id FROM videos WHERE file_path = ?`
    )
    // file_identity로 조회: deleted/duplicate 제외, normal 우선, 최신 updated_at 순
    const findByIdentity = db.prepare(`
      SELECT id FROM videos
      WHERE file_identity = ? AND status NOT IN ('deleted', 'duplicate')
      ORDER BY
        CASE WHEN status = 'normal' THEN 0 ELSE 1 END ASC,
        CASE WHEN rating > 0 THEN 0 ELSE 1 END ASC,
        updated_at DESC
      LIMIT 1
    `)
    // 같은 경로의 기존 row 갱신 (사용자 데이터 보존)
    const updateByPath = db.prepare(`
      UPDATE videos SET
        file_name     = @file_name,
        folder_path   = @folder_path,
        extension     = @extension,
        size          = @size,
        file_size     = @size,
        modified_at   = @modified_at,
        code          = @code,
        actor_name    = CASE WHEN is_actor_manual = 1 THEN actor_name ELSE @actor_name END,
        file_identity = @file_identity,
        status        = CASE WHEN status = 'missing' THEN 'normal' ELSE status END,
        updated_at    = CURRENT_TIMESTAMP
      WHERE file_path = @file_path
    `)
    // 제자리에서 발견된 같은 파일 → 좌표 갱신 + status='normal' 복구 (사용자 데이터 보존)
    const updateByIdentity = db.prepare(`
      UPDATE videos SET
        file_path     = @file_path,
        folder_path   = @folder_path,
        file_name     = @file_name,
        extension     = @extension,
        size          = @size,
        file_size     = @size,
        modified_at   = @modified_at,
        code          = @code,
        actor_name    = CASE WHEN is_actor_manual = 1 THEN actor_name ELSE @actor_name END,
        file_identity = @file_identity,
        status        = 'normal',
        updated_at    = CURRENT_TIMESTAMP
      WHERE id = @id
    `)
    // 신규 파일 INSERT
    const insertNew = db.prepare(`
      INSERT INTO videos
        (file_name, file_path, folder_path, extension, size, file_size, modified_at,
         code, actor_name, file_identity, tags, is_new, updated_at)
      VALUES
        (@file_name, @file_path, @folder_path, @extension, @size, @size, @modified_at,
         @code, @actor_name, @file_identity, @tags, 1, CURRENT_TIMESTAMP)
    `)

    // ① 파일별 upsert (file_path → file_identity → INSERT 순)
    db.transaction((fileList) => {
      for (const file of fileList) {
        const identity = buildFileIdentity(file)

        const byPath = findByPath.get(file.file_path)
        if (byPath) {
          // 같은 경로 → 파일 시스템 컬럼만 갱신
          updateByPath.run({ ...file, file_identity: identity })
          continue
        }

        const byIdentity = findByIdentity.get(identity)
        if (byIdentity) {
          // 다른 경로에서 같은 파일 발견 → 경로 갱신, 사용자 데이터 유지
          updateByIdentity.run({ ...file, file_identity: identity, id: byIdentity.id })
          continue
        }

        // 신규 파일
        insertNew.run({ ...file, file_identity: identity, tags: createDefaultTags(file) })
      }
    })(files)

    // ② actors / video_actors 동기화
    // is_actor_manual = 1인 영상은 수동 수정된 배우명을 유지한다 → 파일명 파싱으로 덮어쓰지 않음
    const filesWithActor = files.filter((f) => f.actor_name && f.actor_name.trim())
    if (filesWithActor.length > 0) {
      const getVideoRow = db.prepare('SELECT id, is_actor_manual FROM videos WHERE file_path = ?')
      db.transaction(() => {
        for (const file of filesWithActor) {
          const row = getVideoRow.get(file.file_path)
          if (row && !row.is_actor_manual) syncVideoActors(db, row.id, file.actor_name)
        }
      })()
    }

    // ③ 중복 병합: 같은 file_identity를 가진 row가 2개 이상이면 master 선정 후 나머지 duplicate 처리
    // 등급 점수 (낮을수록 좋은 등급)
    const GRADE_SCORE = { '영구소장': 1, '재시청 추천': 2, '만족': 3, '보관': 4, '애매': 5, '삭제요망': 6 }

    const dupGroups = db.prepare(`
      SELECT file_identity FROM videos
      WHERE file_identity IS NOT NULL
        AND status NOT IN ('deleted', 'duplicate')
      GROUP BY file_identity
      HAVING COUNT(*) > 1
    `).all()

    if (dupGroups.length > 0) {
      const getGroupRows  = db.prepare(`
        SELECT * FROM videos
        WHERE file_identity = ? AND status NOT IN ('deleted', 'duplicate')
      `)
      const updateMaster  = db.prepare(`
        UPDATE videos SET
          tags        = @tags,
          memo        = @memo,
          rating      = @rating,
          grade       = @grade,
          recommended = @recommended,
          favorite    = @favorite,
          play_count  = @play_count,
          updated_at  = CURRENT_TIMESTAMP
        WHERE id = @id
      `)
      const markDuplicate = db.prepare(
        `UPDATE videos SET status = 'duplicate', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )

      db.transaction(() => {
        for (const group of dupGroups) {
          const rows = getGroupRows.all(group.file_identity)
          if (rows.length < 2) continue

          // master 선택: normal 우선 → rating > 0 우선 → 사용자 데이터 양 우선 → 최신 updated_at 순
          rows.sort((a, b) => {
            const normalDiff = (a.status === 'normal' ? 0 : 1) - (b.status === 'normal' ? 0 : 1)
            if (normalDiff !== 0) return normalDiff

            const ratingDiff = (a.rating > 0 ? 0 : 1) - (b.rating > 0 ? 0 : 1)
            if (ratingDiff !== 0) return ratingDiff

            const score = (r) =>
              (r.tags        ? 1 : 0) +
              (r.memo        ? 1 : 0) +
              (r.grade !== '보관' ? 1 : 0) +
              (r.recommended || 0) +
              (r.favorite    || 0) +
              Math.min(r.play_count || 0, 1)
            const scoreDiff = score(b) - score(a)
            if (scoreDiff !== 0) return scoreDiff

            return new Date(b.updated_at) - new Date(a.updated_at)
          })

          const master = rows[0]
          const others = rows.slice(1)

          // 사용자 데이터 병합
          const allTagSet = new Set(
            [master.tags, ...others.map((r) => r.tags)]
              .join(',')
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          )
          const mergedTags        = Array.from(allTagSet).join(', ')
          const mergedMemo        = [master.memo, ...others.map((r) => r.memo)].find(Boolean) || ''
          const mergedRating      = Math.max(master.rating || 0, ...others.map((r) => r.rating || 0))
          const mergedGrade       = [master.grade, ...others.map((r) => r.grade)].reduce((best, g) => {
            return (GRADE_SCORE[g] ?? 4) < (GRADE_SCORE[best] ?? 4) ? g : best
          })
          const mergedRecommended = [master, ...others].some((r) => r.recommended) ? 1 : 0
          const mergedFavorite    = [master, ...others].some((r) => r.favorite)    ? 1 : 0
          const mergedPlayCount   = others.reduce((sum, r) => sum + (r.play_count || 0), master.play_count || 0)

          updateMaster.run({
            id:          master.id,
            tags:        mergedTags,
            memo:        mergedMemo,
            rating:      mergedRating,
            grade:       mergedGrade,
            recommended: mergedRecommended,
            favorite:    mergedFavorite,
            play_count:  mergedPlayCount,
          })

          for (const other of others) {
            markDuplicate.run(other.id)
          }
        }
      })()
    }

    // ④ 삭제 파일 감지: duplicate/deleted 제외한 레코드 vs 스캔 결과 비교
    const scannedPaths = new Set(files.map((f) => f.file_path))

    const dbRecords = db.prepare(`
      SELECT id, file_path, status FROM videos
      WHERE status NOT IN ('duplicate', 'deleted')
        AND (folder_path = ? OR folder_path LIKE ? OR folder_path LIKE ?)
    `).all(folderPath, folderPath + '\\%', folderPath + '/%')

    const markMissing = db.prepare(
      `UPDATE videos SET status = 'missing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )

    let missingCount = 0
    db.transaction(() => {
      for (const rec of dbRecords) {
        if (scannedPaths.has(rec.file_path)) continue
        if (rec.status === 'missing') continue
        if (!fs.existsSync(rec.file_path)) {
          markMissing.run(rec.id)
          missingCount++
        }
      }
    })()

    // ⑤ 스캔한 루트 폴더를 scanned_roots 테이블에 기록 (폴더 패널용)
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
  //   total             : 해당 루트 하위 normal 영상 수
  //   recommended_count : 추천작 수 (normal만)
  //   delete_count      : 삭제요망(grade) 중 normal인 수
  //
  // 반환: { library: {...}, folders: FolderStat[] }
  //   library : 전체 라이브러리 합계 통계
  //   folders : 루트 폴더별 통계 배열 (root_path 오름차순)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-folder-list', async () => {
    const db = getDb()

    // 전체 라이브러리 통계 (status='normal'만 카운트)
    const library = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN recommended = 1 THEN 1 ELSE 0 END) AS recommended_count,
        SUM(CASE WHEN grade = '삭제요망' THEN 1 ELSE 0 END) AS delete_count
      FROM videos
      WHERE status = 'normal'
    `).get()

    // 루트 폴더 목록 (scanned_roots 테이블)
    const roots = db.prepare(`
      SELECT root_path, scanned_at FROM scanned_roots ORDER BY root_path ASC
    `).all()

    // 각 루트별 통계 (folder_path 하위 파일 집계, status='normal'만)
    const countStmt = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN recommended = 1 THEN 1 ELSE 0 END) AS recommended_count,
        SUM(CASE WHEN grade = '삭제요망' THEN 1 ELSE 0 END) AS delete_count
      FROM videos
      WHERE status = 'normal'
        AND (folder_path = ? OR folder_path LIKE ? ESCAPE '!' OR folder_path LIKE ? ESCAPE '!')
    `)

    const folders = roots
      .map((row) => {
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
      .filter((row) => row.total > 0)  // normal 영상이 0개인 폴더는 목록에서 숨김

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
    // duplicate는 모든 모드에서 기본 숨김
    const tabConditions = [`status != 'duplicate'`]
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

    // ── 단일 스캔 쿼리 (ID 중간 수집 없이 videos 직접 조회 + ORDER BY) ────
    // folderClause 는 단일 테이블이므로 접두사 없이 그대로 사용 가능
    // limit/offset: 추후 페이지네이션 대응 (0 또는 미지정 시 전체 조회)
    const limit  = (typeof options.limit  === 'number' && options.limit  > 0) ? options.limit  : null
    const offset = (typeof options.offset === 'number' && options.offset >= 0) ? options.offset : 0
    const limitClause = limit ? `LIMIT ${limit} OFFSET ${offset}` : ''
    let videos
    if (!query || query.trim() === '') {
      // 빈 검색: 조건 + 정렬을 한 번에 (두 번 스캔 제거)
      videos = db.prepare(`
        SELECT * FROM videos
        WHERE 1=1 ${tabClause} ${filterClause} ${folderClause}
        ORDER BY ${orderClause}
        ${limitClause}
      `).all(...filterParams, ...folderParams)
    } else {
      // 검색어: videos 필드 LIKE + 배우 필드는 EXISTS (DISTINCT 불필요)
      const q = `%${escapeLike(query.trim())}%`
      videos = db.prepare(`
        SELECT v.* FROM videos v
        WHERE (
              v.file_name  LIKE ? ESCAPE '!'
           OR v.code       LIKE ? ESCAPE '!'
           OR v.actor_name LIKE ? ESCAPE '!'
           OR v.memo       LIKE ? ESCAPE '!'
           OR v.tags       LIKE ? ESCAPE '!'
           OR EXISTS (
                SELECT 1 FROM video_actors va
                JOIN actors a ON a.id = va.actor_id
                WHERE va.video_id = v.id AND (
                      a.name    LIKE ? ESCAPE '!'
                   OR a.aliases LIKE ? ESCAPE '!'
                   OR a.tags    LIKE ? ESCAPE '!'
                   OR a.agency  LIKE ? ESCAPE '!'
                )
              )
        ) ${tabClause} ${filterClause} ${folderClause}
        ORDER BY ${orderClause}
        ${limitClause}
      `).all(q, q, q, q, q, q, q, q, q, ...filterParams, ...folderParams)
    }

    if (videos.length === 0) return []

    // ── 배우 정보 일괄 조회 (IN 절 999 제한 청크 처리) ────────────────
    const MAX_PARAMS = 990
    const matchedIds = videos.map((v) => v.id)
    const actorsByVideoId = {}
    for (let i = 0; i < matchedIds.length; i += MAX_PARAMS) {
      const chunk = matchedIds.slice(i, i + MAX_PARAMS)
      const rows = db.prepare(`
        SELECT va.video_id, a.id AS actor_id, a.name, a.rating, a.tags,
               a.agency, a.image_path
        FROM video_actors va
        JOIN actors a ON a.id = va.actor_id
        WHERE va.video_id IN (${chunk.map(() => '?').join(',')})
        ORDER BY va.video_id, va.order_index ASC
      `).all(...chunk)
      for (const row of rows) {
        ;(actorsByVideoId[row.video_id] ??= []).push(row)
      }
    }

    return videos.map((v) => ({ ...v, actorsList: actorsByVideoId[v.id] || [] }))
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
        AND  status NOT IN ('missing', 'deleted', 'duplicate')
    `).get()
    return { count: row.count }
  })

  // ══════════════════════════════════════════════════════════════
  // 파일 열기 (OS 기본 플레이어)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('open-video', async (_event, filePath) => {
    const err = await shell.openPath(filePath)
    if (err) throw new Error(`파일을 열 수 없습니다: ${err}`)
    try {
      const db    = getDb()
      const video = db.prepare('SELECT id, file_name FROM videos WHERE file_path = ?').get(filePath)
      if (video) {
        recordVideoActivity(video.id, 'open', {
          filePath,
          title:       video.file_name,
          requestedAt: new Date().toISOString(),
        })
      }
    } catch (e) {
      console.warn('[open-video] 활동 기록 실패:', e.message)
    }
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
      try {
        const db          = getDb()
        const requestedAt = new Date().toISOString()
        for (const fp of validPaths) {
          const video = db.prepare('SELECT id, file_name FROM videos WHERE file_path = ?').get(fp)
          if (video) {
            recordVideoActivity(video.id, 'copy_to_clipboard', {
              filePath:       fp,
              title:          video.file_name,
              copiedFileCount: count,
              requestedAt,
            })
          }
        }
      } catch (e) {
        console.warn('[copy-files-to-clipboard] 활동 기록 실패:', e.message)
      }
      return { success: true, count, totalSize, failedPaths }
    } catch (err) {
      return { success: false, error: err.message, count: 0, totalSize, failedPaths }
    }
  })

  // ── MTP 액션 수신 (needsCheck 일시정지 해제용) ───────────────
  ipcMain.on('device-copy-action', (_ev, action) => dispatchAction(action))

  // ── MTP 전송 큐 (needsCheck 일시정지 포함) ───────────────────
  ipcMain.handle('copy-files-to-device', async (event, filePaths) => {
    // ── 입력 검증 ──────────────────────────────────────────────
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: '파일 경로가 없습니다.', action: 'none' }
    }

    const fileInfos = []
    for (const fp of filePaths) {
      if (typeof fp !== 'string' || !path.isAbsolute(fp)) continue
      try {
        const stat = fs.statSync(fp)
        if (stat.isFile()) fileInfos.push({ path: fp, size: stat.size })
      } catch { /* 무시 */ }
    }
    if (fileInfos.length === 0) {
      return { success: false, error: '존재하는 파일이 없습니다.', action: 'none' }
    }

    // ── 로그 헬퍼 ────────────────────────────────────────────
    const logPath = path.join(app.getPath('userData'), 'mtp-transfer.log')
    const mtpLog  = (msg) => {
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
      try { fs.appendFileSync(logPath, `[${ts}] ${msg}\n`, 'utf8') } catch { /* 무시 */ }
    }

    // ── progress 전송 헬퍼 ────────────────────────────────────
    const total       = fileInfos.length
    const failedFiles = []
    let   doneCount   = 0
    let   failedCount = 0

    const sendProgress = (status, currentIndex, currentFileName, message = '', extra = {}) => {
      try {
        event.sender.send('device-copy-progress', {
          status, currentIndex, total, currentFileName,
          doneCount, failedCount, failedFiles: [...failedFiles], message,
          ...extra,
        })
      } catch { /* renderer 가 닫혔을 경우 무시 */ }
    }

    // ── HWND 취득 ─────────────────────────────────────────────
    const mainWin    = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const hwndBuffer = mainWin?.getNativeWindowHandle()
    const hwnd       = hwndBuffer ? hwndBuffer.readUInt32LE(0) : 0

    // ── MTP 세션 시작 (BrowseForFolder 1회) ───────────────────
    mtpLog(`SESSION_START | files: ${total}`)
    sendProgress('selecting', 0, '', '폴더를 선택해 주세요…')
    let session
    try { session = await createMtpSession(hwnd) }
    catch (err) {
      mtpLog(`SESSION_ERR | ${err.message}`)
      sendProgress('cancelled', 0, '', err.message)
      return { success: false, error: err.message, action: 'error' }
    }
    if (!session) {
      mtpLog('SESSION_CANCEL')
      sendProgress('cancelled', 0, '', '폴더 선택이 취소되었습니다.')
      return { success: false, action: 'cancelled' }
    }

    // ── 파일 1개씩 순차 전송 ──────────────────────────────────
    for (let i = 0; i < fileInfos.length; i++) {
      const { path: fp, size: fileSize } = fileInfos[i]
      const fileName   = path.basename(fp)
      const timeoutSec = calcTimeoutSec(fileSize)
      const sizeLabel  = (fileSize / (1024 ** 3)).toFixed(2) + ' GB'
      const extra      = { fileSize, timeoutSec }

      let fileResolved = false
      let useCopyHere  = true   // true=SEND(CopyHere+Poll), false=POLL only

      while (!fileResolved) {
        const startTs  = Date.now()
        const waitMin  = Math.round(timeoutSec / 60)
        const msgCopy  = useCopyHere
          ? `전송 중… (${i + 1}/${total}) · 최대 ${waitMin}분 대기`
          : `계속 대기 중… (최대 ${waitMin}분)`

        sendProgress('copying', i, fileName, msgCopy, extra)
        mtpLog(`${useCopyHere ? 'COPY' : 'POLL'}_START | [${i+1}/${total}] ${fileName} | size: ${sizeLabel} | timeout: ${waitMin}min`)

        let result
        try {
          result = useCopyHere
            ? await session.sendFile(fp, timeoutSec)
            : await session.pollFile(fp, timeoutSec)
        } catch { result = 'error' }

        const elapsedMin = Math.round((Date.now() - startTs) / 60000)

        if (result === 'ok') {
          doneCount++
          mtpLog(`OK | ${fileName} | elapsed: ${elapsedMin}min`)
          sendProgress('completed', i, fileName, `완료 (${doneCount}/${total})`, extra)
          try {
            const db    = getDb()
            const video = db.prepare('SELECT id, file_name FROM videos WHERE file_path = ?').get(fp)
            if (video) {
              recordVideoActivity(video.id, 'copy_to_device', {
                filePath:     fp,
                title:        video.file_name,
                requestedAt:  new Date().toISOString(),
              })
            }
          } catch (e) {
            console.warn('[copy-files-to-device] 활동 기록 실패:', e.message)
          }
          fileResolved = true
          if (i < fileInfos.length - 1) await new Promise(r => setTimeout(r, 3000))

        } else {
          // ── timeout / error → needsCheck 일시정지 ──────────
          const reason = result === 'timeout' ? '시간 초과' : '전송 오류'
          mtpLog(`${result.toUpperCase()} | ${fileName} | waited: ${elapsedMin}min → needsCheck`)
          sendProgress('needsCheck', i, fileName, `${reason} — 조치를 선택해 주세요`, extra)

          // 사용자 조치 루프
          actionLoop: while (true) {
            const action = await waitForAction()
            mtpLog(`USER_ACTION | ${action} | ${fileName}`)

            if (action === 'continue') {
              // CopyHere 없이 폴링만 추가 10분
              const extraSec = 10 * 60
              const xtra     = { fileSize, timeoutSec: extraSec }
              sendProgress('copying', i, fileName, '계속 대기 중… (추가 10분)', xtra)
              let pr
              try { pr = await session.pollFile(fp, extraSec) } catch { pr = 'error' }
              if (pr === 'ok') {
                doneCount++
                const em = Math.round((Date.now() - startTs) / 60000)
                mtpLog(`OK (continue) | ${fileName} | total: ${em}min`)
                sendProgress('completed', i, fileName, `완료 (${doneCount}/${total})`, xtra)
                try {
                  const db    = getDb()
                  const video = db.prepare('SELECT id, file_name FROM videos WHERE file_path = ?').get(fp)
                  if (video) {
                    recordVideoActivity(video.id, 'copy_to_device', {
                      filePath:    fp,
                      title:       video.file_name,
                      requestedAt: new Date().toISOString(),
                    })
                  }
                } catch (e) {
                  console.warn('[copy-files-to-device] 활동 기록 실패:', e.message)
                }
                fileResolved = true
                if (i < fileInfos.length - 1) await new Promise(r => setTimeout(r, 3000))
                break actionLoop
              }
              mtpLog(`STILL_TIMEOUT | ${fileName} → needsCheck again`)
              sendProgress('needsCheck', i, fileName, '여전히 확인되지 않습니다 — 조치를 선택해 주세요', xtra)

            } else if (action === 'retry') {
              useCopyHere = true
              break actionLoop  // while(!fileResolved) 재진입, CopyHere 재시도

            } else if (action === 'skip') {
              failedCount++
              failedFiles.push(fileName)
              mtpLog(`SKIP | ${fileName}`)
              sendProgress('skipped', i, fileName, `건너뜀 (${failedCount}개 누적)`, extra)
              fileResolved = true
              if (i < fileInfos.length - 1) await new Promise(r => setTimeout(r, 3000))
              break actionLoop

            } else if (action === 'abort') {
              mtpLog(`ABORT | at [${i+1}/${total}] — success: ${doneCount}, skipped: ${failedCount}`)
              session.close()
              sendProgress('cancelled', i, fileName, '전체 중단됨', extra)
              return { success: false, action: 'aborted', doneCount, failedCount, failedFiles: [...failedFiles] }
            }
          }
        }
      }
    }

    session.close()
    const finalAction = failedCount === 0 ? 'copied' : failedCount === total ? 'failed' : 'partial'
    mtpLog(`SESSION_DONE | success: ${doneCount}, skipped: ${failedCount} | ${finalAction}`)
    sendProgress('done', total - 1, '', `전체 완료 — 성공 ${doneCount}개, 건너뜀 ${failedCount}개`)
    return { success: true, action: finalAction, doneCount, failedCount, failedFiles: [...failedFiles] }
  })

  // ── MTP 안정 모드 (Windows 복사 창 위임, 일괄 전송) ──────────
  ipcMain.handle('copy-files-to-device-bulk', async (_event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: '파일 경로가 없습니다.', action: 'none' }
    }

    const validInfos = []
    for (const fp of filePaths) {
      if (typeof fp !== 'string' || !path.isAbsolute(fp)) continue
      try {
        const stat = fs.statSync(fp)
        if (stat.isFile()) validInfos.push({ path: fp, size: stat.size })
      } catch { /* 무시 */ }
    }
    if (validInfos.length === 0) {
      return { success: false, error: '존재하는 파일이 없습니다.', action: 'none' }
    }

    const logPath = path.join(app.getPath('userData'), 'mtp-transfer.log')
    const mtpLog  = (msg) => {
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
      try { fs.appendFileSync(logPath, `[${ts}] ${msg}\n`, 'utf8') } catch { /* 무시 */ }
    }

    const totalSizeGB = (validInfos.reduce((s, f) => s + f.size, 0) / (1024 ** 3)).toFixed(2)
    mtpLog(`STABLE_SESSION_START | files: ${validInfos.length} | totalSize: ${totalSizeGB}GB`)
    validInfos.forEach((f, i) => {
      mtpLog(`  [${i + 1}/${validInfos.length}] ${path.basename(f.path)} | ${(f.size / (1024 ** 3)).toFixed(2)}GB`)
    })
    mtpLog(`STABLE_COPYHEREALL_CALL | ${new Date().toISOString()}`)

    const mainWin    = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const hwndBuffer = mainWin?.getNativeWindowHandle()
    const hwnd       = hwndBuffer ? hwndBuffer.readUInt32LE(0) : 0

    // 이전 세션 정리
    if (_bulkSession) { try { _bulkSession.close() } catch { /* 무시 */ }; _bulkSession = null }

    let session
    try { session = await createMtpBulkSession(hwnd, validInfos.map(f => f.path)) }
    catch (err) {
      mtpLog(`STABLE_SESSION_ERR | ${err.message}`)
      return { success: false, error: err.message, action: 'error' }
    }

    if (!session) {
      mtpLog('STABLE_SESSION_CANCEL')
      return { success: false, action: 'cancelled' }
    }

    _bulkSession = session
    // bulk 완료 시 활동 기록을 위해 파일 목록을 저장 (중복 방지: Set 기반)
    _bulkPending = [...new Set(validInfos.map(f => f.path))].map(fp => ({ filePath: fp }))
    mtpLog(`STABLE_STARTED | CopyHere 호출 완료. COM 아파트 유지 중 (사용자 완료 버튼 대기)`)
    return { success: true, action: 'bulk-started', count: validInfos.length }
  })

  // ── MTP 안정 모드 완료 신호 (UI 완료 버튼) ────────────────────
  ipcMain.on('bulk-copy-close', (_ev) => {
    if (_bulkSession) {
      _bulkSession.close()
      _bulkSession = null
      const logPath = path.join(app.getPath('userData'), 'mtp-transfer.log')
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
      try { fs.appendFileSync(logPath, `[${ts}] STABLE_USER_DONE\n`, 'utf8') } catch { /* 무시 */ }
    }
    // bulk 복사 활동 기록
    if (_bulkPending.length > 0) {
      try {
        const db = getDb()
        const seen = new Set()
        for (const { filePath } of _bulkPending) {
          if (seen.has(filePath)) continue
          seen.add(filePath)
          const video = db.prepare('SELECT id, file_name FROM videos WHERE file_path = ?').get(filePath)
          if (video) {
            recordVideoActivity(video.id, 'copy_to_device', {
              filePath,
              title: video.file_name,
              mode: 'bulk',
              recordedAt: new Date().toISOString(),
            })
          }
        }
      } catch (e) {
        console.warn('[bulk-copy-close] 활동 기록 실패:', e.message)
      }
      _bulkPending = []
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 목록 조회 (get-actors)
  //
  // @param options {object} - {
  //   query?:    string  - name LIKE 검색
  //   category?: string  - 카테고리 필터
  //   agency?:   string  - 소속사 필터
  //   minRating?: number - 최소 별점
  //   archived?:  boolean - true면 is_archived=1만 조회 (기본: false)
  // }
  // 반환: Actor[]
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-actors', async (_event, options = {}) => {
    const db         = getDb()
    const conditions = []
    const params     = []

    // 아카이브 필터 (기본: 활성 배우만)
    const archived = options.archived === true ? 1 : 0
    conditions.push('a.is_archived = ?')
    params.push(archived)

    // 통합 검색 (이름 + 별칭 + 태그 + 메모 + 소속사)
    if (options.query && options.query.trim()) {
      const q = '%' + escapeLike(options.query.trim()) + '%'
      conditions.push(`(
        a.name    LIKE ? ESCAPE '!'
        OR a.aliases LIKE ? ESCAPE '!'
        OR a.tags    LIKE ? ESCAPE '!'
        OR a.memo    LIKE ? ESCAPE '!'
        OR a.agency  LIKE ? ESCAPE '!'
      )`)
      params.push(q, q, q, q, q)
    }

    // 카테고리 필터
    if (options.category && options.category.trim()) {
      conditions.push('a.category = ?')
      params.push(options.category.trim())
    }

    // 소속사 필터
    if (options.agency && options.agency.trim()) {
      conditions.push(`a.agency LIKE ? ESCAPE '!'`)
      params.push('%' + escapeLike(options.agency.trim()) + '%')
    }

    // 태그 필터
    if (options.tag && options.tag.trim()) {
      conditions.push(`a.tags LIKE ? ESCAPE '!'`)
      params.push('%' + escapeLike(options.tag.trim()) + '%')
    }

    // 최소 별점
    if (typeof options.minRating === 'number' && options.minRating > 0) {
      conditions.push('a.rating >= ?')
      params.push(options.minRating)
    }

    // 최소 작품 수 필터
    if (typeof options.minVideoCount === 'number' && options.minVideoCount > 0) {
      conditions.push('(SELECT COUNT(*) FROM video_actors va2 WHERE va2.actor_id = a.id) >= ?')
      params.push(options.minVideoCount)
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    // 정렬 기준 (SQL Injection 방지: 화이트리스트)
    const SORT_ACTORS = {
      name_asc:          'a.name ASC',
      name_desc:         'a.name DESC',
      rating_desc:       'a.rating DESC, a.name ASC',
      video_count_desc:  'video_count DESC, a.name ASC',
      open_count_desc:   'open_count DESC, a.name ASC',
      copy_count_desc:   'copy_count DESC, a.name ASC',
      updated_desc:      'a.updated_at DESC',
    }
    const sortClause = SORT_ACTORS[options.sortBy] || 'a.name ASC'

    return db.prepare(`
      SELECT
        a.*,
        COUNT(DISTINCT va.video_id) AS video_count,
        COALESCE(SUM(CASE WHEN val.action_type = 'open'              THEN 1 ELSE 0 END), 0) AS open_count,
        COALESCE(SUM(CASE WHEN val.action_type = 'copy_to_clipboard' THEN 1 ELSE 0 END), 0) AS copy_clipboard_count,
        COALESCE(SUM(CASE WHEN val.action_type = 'copy_to_device'    THEN 1 ELSE 0 END), 0) AS copy_device_count,
        COALESCE(SUM(CASE WHEN val.action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END), 0) AS copy_count
      FROM actors a
      LEFT JOIN video_actors va  ON va.actor_id  = a.id
      LEFT JOIN video_activity_logs val ON val.video_id = va.video_id
      ${where}
      GROUP BY a.id
      ORDER BY ${sortClause}
    `).all(...params)
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 상세 조회 (get-actor-detail)
  //
  // @param id {number} - actor id
  // 반환: { actor: Actor, videos: Video[] } | null
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-actor-detail', async (_event, id) => {
    const db    = getDb()
    const actor = db.prepare('SELECT * FROM actors WHERE id = ?').get(id)
    if (!actor) return null

    // 연결 작품 (정렬: 대표배우 우선, 별점 높은 순)
    const videos = db.prepare(`
      SELECT v.*
      FROM   videos v
      JOIN   video_actors va ON va.video_id = v.id
      WHERE  va.actor_id = ?
      ORDER  BY va.is_main DESC, v.rating DESC, va.order_index ASC, v.created_at DESC
    `).all(id)

    // 배우 활동 통계
    const stats = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN val.action_type = 'open'              THEN 1 ELSE 0 END), 0) AS open_count,
        COALESCE(SUM(CASE WHEN val.action_type = 'copy_to_clipboard' THEN 1 ELSE 0 END), 0) AS copy_clipboard_count,
        COALESCE(SUM(CASE WHEN val.action_type = 'copy_to_device'    THEN 1 ELSE 0 END), 0) AS copy_device_count
      FROM video_activity_logs val
      JOIN video_actors va ON va.video_id = val.video_id
      WHERE va.actor_id = ?
    `).get(id) || { open_count: 0, copy_clipboard_count: 0, copy_device_count: 0 }

    // 대표 작품 3개 (별점 + 추천 기준)
    const topVideos = db.prepare(`
      SELECT v.id, v.file_name, v.code, v.rating, v.recommended, v.grade
      FROM videos v
      JOIN video_actors va ON va.video_id = v.id
      WHERE va.actor_id = ? AND v.status != 'missing' AND v.status != 'deleted'
      ORDER BY v.recommended DESC, v.rating DESC
      LIMIT 3
    `).all(id)

    return { actor, videos, stats, topVideos }
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 영상 목록 조회 (배우 클릭 후 빠른 필터용)
  //
  // @param actorId {number} - 배우 ID
  // @param options {object} - {
  //   quickFilter: 'all' | 'high_rated' | 'new' | 'recommended' | 'not_copied'
  //   sortBy:      string  - 정렬 기준
  // }
  // 반환: Video[]
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-actor-videos', async (_event, actorId, options = {}) => {
    const db = getDb()
    const orderClause = getSortClause(options.sortBy)
    const qf = options.quickFilter || 'all'

    const conditions = [`va.actor_id = ?`]
    const params = [actorId]

    if (qf === 'high_rated') {
      conditions.push(`v.rating >= 4`)
    } else if (qf === 'new') {
      conditions.push(`v.is_new = 1`)
    } else if (qf === 'recommended') {
      conditions.push(`v.recommended = 1`)
    } else if (qf === 'not_copied') {
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM video_activity_logs val2
          WHERE val2.video_id = v.id
            AND val2.action_type IN ('copy_to_clipboard', 'copy_to_device')
        )
      `)
    }

    const where = 'WHERE ' + conditions.join(' AND ')
    return db.prepare(`
      SELECT v.*
      FROM videos v
      JOIN video_actors va ON va.video_id = v.id
      ${where}
        AND v.status != 'missing'
        AND v.status != 'deleted'
      ORDER BY ${orderClause}
    `).all(...params)
  })

  // ══════════════════════════════════════════════════════════════
  // 배우-영상 동기화 (sync-actor-videos)
  //
  // videos.actor_name 기반으로 video_actors 테이블을 재동기화한다.
  // 반환: { synced: number }
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // 영상 배우명 수정 (update-video-actors)
  //
  // videos.actor_name을 갱신하고 video_actors 연결을 재동기화한다.
  //
  // @param videoId   {number} - 동영상 ID
  // @param actorName {string} - 새 배우명 ("배우1, 배우2" 또는 빈 문자열)
  // 반환: { success: true } | { success: false, error: string }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('update-video-actors', async (_event, videoId, actorName) => {
    const db = getDb()

    const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(videoId)
    if (!video) return { success: false, error: 'VIDEO_NOT_FOUND' }

    const trimmed = (actorName ?? '').trim()

    db.transaction(() => {
      if (!trimmed) {
        // 배우명 비우기: actor_name NULL, video_actors 연결 삭제
        db.prepare(`
          UPDATE videos SET actor_name = NULL, is_actor_manual = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(videoId)
        db.prepare('DELETE FROM video_actors WHERE video_id = ?').run(videoId)
      } else {
        db.prepare(`
          UPDATE videos SET actor_name = ?, is_actor_manual = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(trimmed, videoId)
        syncVideoActors(db, videoId, trimmed)
      }
    })()

    return { success: true }
  })

  // ════════════════════════════════════════════════════════════
  // 배우명 파일명 기준 다시 추출 (reset-actor-manual)
  //
  // is_actor_manual = 0으로 되돌리고, 파일명에서 actor_name을 재파싱한다.
  // 주의: 실제 파일명은 변경하지 않는다.
  //
  // @param videoId {number}
  // 반환: { success: true, actor_name: string|null } | { success: false, error: string }
  // ════════════════════════════════════════════════════════════
  ipcMain.handle('reset-actor-manual', async (_event, videoId) => {
    const db = getDb()
    const video = db.prepare('SELECT id, file_name FROM videos WHERE id = ?').get(videoId)
    if (!video) return { success: false, error: 'VIDEO_NOT_FOUND' }

    const parsed       = parseFileName(video.file_name)
    const newActorName = parsed.actor_name ?? null

    db.transaction(() => {
      db.prepare(`
        UPDATE videos SET actor_name = ?, is_actor_manual = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(newActorName, videoId)
      db.prepare('DELETE FROM video_actors WHERE video_id = ?').run(videoId)
      if (newActorName) syncVideoActors(db, videoId, newActorName)
    })()

    return { success: true, actor_name: newActorName }
  })

  // ════════════════════════════════════════════════════════════
  // 고아 배우 정리 (cleanup-orphan-actors)
  //
  // video_actors에 연결이 하나도 없는 actors row를 슬라 제거한다.
  // videos.actor_name과 실제 파일은 절대 수정하지 않는다.
  //
  // 반환: { success, deletedCount, deletedActors }
  // ════════════════════════════════════════════════════════════
  ipcMain.handle('cleanup-orphan-actors', async () => {
    const db = getDb()

    const orphans = db.prepare(`
      SELECT a.id, a.name
      FROM actors a
      LEFT JOIN video_actors va ON va.actor_id = a.id
      WHERE va.actor_id IS NULL
      ORDER BY a.name ASC
    `).all()

    if (orphans.length === 0) {
      return { success: true, deletedCount: 0, deletedActors: [] }
    }

    const ids = orphans.map((r) => r.id)
    db.transaction(() => {
      const placeholders = ids.map(() => '?').join(',')
      db.prepare(`DELETE FROM actors WHERE id IN (${placeholders})`).run(...ids)
    })()

    return {
      success:       true,
      deletedCount:  orphans.length,
      deletedActors: orphans.map((r) => r.name),
    }
  })

  ipcMain.handle('sync-actor-videos', async () => {
    const db     = getDb()
    const videos = db.prepare(`
      SELECT id, actor_name FROM videos
      WHERE actor_name IS NOT NULL AND trim(actor_name) != ''
    `).all()

    let synced = 0
    db.transaction(() => {
      for (const video of videos) {
        try {
          syncVideoActors(db, video.id, video.actor_name)
          synced++
        } catch (e) {
          console.warn(`[sync-actor-videos] video ${video.id} 동기화 실패:`, e.message)
        }
      }
    })()

    return { success: true, synced }
  })

  // ══════════════════════════════════════════════════════════════
  // 추천 영상 조회 (get-recommendations)
  //
  // @param preset {string}  - 추천 프리셋 이름
  // @param params {object}  - 프리셋별 추가 파라미터 (tag 등)
  // 반환: Video[] (actorsList 포함)
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-recommendations', async (_event, preset, extraParams = {}) => {
    const db   = getDb()
    const LIMIT = extraParams.limit || 50

    const BASE_COND   = `status != 'missing' AND status != 'deleted'`
    const BASE_COND_V = `v.status != 'missing' AND v.status != 'deleted'`

    // ── 프리셋별 쿼리 ─────────────────────────────────────────
    let videoIds = []

    if (preset === 'top_actor_videos') {
      // 별점 4+ 배우의 작품
      videoIds = db.prepare(`
        SELECT DISTINCT v.id
        FROM videos v
        JOIN video_actors va ON va.video_id = v.id
        JOIN actors a ON a.id = va.actor_id AND a.rating >= 4
        WHERE ${BASE_COND_V}
        ORDER BY a.rating DESC, v.rating DESC
        LIMIT ?
      `).all(LIMIT).map((r) => r.id)

    } else if (preset === 'top_rated_videos') {
      // 별점 높은 영상
      videoIds = db.prepare(`
        SELECT id FROM videos WHERE ${BASE_COND} AND rating >= 4
        ORDER BY rating DESC, updated_at DESC
        LIMIT ?
      `).all(LIMIT).map((r) => r.id)

    } else if (preset === 'new_top_actor') {
      // NEW 파일 중 별점 3+ 배우 포함
      videoIds = db.prepare(`
        SELECT DISTINCT v.id
        FROM videos v
        JOIN video_actors va ON va.video_id = v.id
        JOIN actors a ON a.id = va.actor_id AND a.rating >= 3
        WHERE ${BASE_COND_V} AND v.is_new = 1
        ORDER BY a.rating DESC
        LIMIT ?
      `).all(LIMIT).map((r) => r.id)

    } else if (preset === 'tag_actor_videos') {
      // 특정 태그 배우의 작품
      const tag = (extraParams.tag || '').trim()
      if (!tag) return []
      const q = '%' + escapeLike(tag) + '%'
      videoIds = db.prepare(`
        SELECT DISTINCT v.id
        FROM videos v
        JOIN video_actors va ON va.video_id = v.id
        JOIN actors a ON a.id = va.actor_id AND (a.tags LIKE ? ESCAPE '!')
        WHERE ${BASE_COND_V}
        ORDER BY v.rating DESC, v.updated_at DESC
        LIMIT ?
      `).all(q, LIMIT).map((r) => r.id)

    } else if (preset === 'recent_copied_actor') {
      // 최근 많이 복사한 배우의 작품
      videoIds = db.prepare(`
        SELECT DISTINCT v.id
        FROM videos v
        JOIN video_actors va ON va.video_id = v.id
        WHERE ${BASE_COND_V} AND va.actor_id IN (
          SELECT DISTINCT va2.actor_id
          FROM video_activity_logs val
          JOIN video_actors va2 ON va2.video_id = val.video_id
          WHERE val.action_type IN ('copy_to_clipboard', 'copy_to_device')
          ORDER BY val.created_at DESC
          LIMIT 5
        )
        ORDER BY RANDOM()
        LIMIT ?
      `).all(LIMIT).map((r) => r.id)

    } else if (preset === 'recent_played_actor') {
      // 최근 많이 재생한 배우의 작품
      videoIds = db.prepare(`
        SELECT DISTINCT v.id
        FROM videos v
        JOIN video_actors va ON va.video_id = v.id
        WHERE ${BASE_COND_V} AND va.actor_id IN (
          SELECT DISTINCT va2.actor_id
          FROM video_activity_logs val
          JOIN video_actors va2 ON va2.video_id = val.video_id
          WHERE val.action_type = 'open'
          ORDER BY val.created_at DESC
          LIMIT 5
        )
        ORDER BY RANDOM()
        LIMIT ?
      `).all(LIMIT).map((r) => r.id)

    } else if (preset === 'not_copied_high_rated') {
      // 복사하지 않은 고평점 작품 (rating >= 4)
      videoIds = db.prepare(`
        SELECT v.id FROM videos v
        WHERE ${BASE_COND_V} AND v.rating >= 4
          AND NOT EXISTS (
            SELECT 1 FROM video_activity_logs val
            WHERE val.video_id = v.id
              AND val.action_type IN ('copy_to_clipboard', 'copy_to_device')
          )
        ORDER BY v.rating DESC, v.updated_at DESC
        LIMIT ?
      `).all(LIMIT).map((r) => r.id)

    } else if (preset === 'random_by_actor') {
      // 배우 기준 랜덤 — 별점 3+ 배우에서 각 1개
      const actorRows = db.prepare(`
        SELECT a.id FROM actors a
        WHERE a.rating >= 3 AND a.is_archived = 0
        ORDER BY RANDOM()
        LIMIT ?
      `).all(Math.min(LIMIT, 30))

      for (const aRow of actorRows) {
        const pick = db.prepare(`
          SELECT v.id FROM videos v
          JOIN video_actors va ON va.video_id = v.id
          WHERE va.actor_id = ? AND ${BASE_COND_V}
          ORDER BY RANDOM() LIMIT 1
        `).get(aRow.id)
        if (pick) videoIds.push(pick.id)
      }

    } else if (preset === 'similar_tag_actor') {
      // 자주 복사한 배우와 비슷한 태그의 다른 배우 작품
      const recentActors = db.prepare(`
        SELECT DISTINCT a.id, a.tags
        FROM video_activity_logs val
        JOIN video_actors va ON va.video_id = val.video_id
        JOIN actors a ON a.id = va.actor_id AND trim(a.tags) != ''
        WHERE val.action_type IN ('copy_to_clipboard', 'copy_to_device')
        ORDER BY val.created_at DESC
        LIMIT 3
      `).all()

      // 최근 배우들의 태그를 합산
      const tagSet = new Set()
      for (const ra of recentActors) {
        const tags = (ra.tags || '').split(',').map((t) => t.trim()).filter(Boolean)
        tags.forEach((t) => tagSet.add(t))
      }
      const recentActorIds = new Set(recentActors.map((r) => r.id))

      if (tagSet.size > 0) {
        // 같은 태그를 가진 다른 배우의 영상
        const tagConditions = Array.from(tagSet).map(() => `a.tags LIKE ? ESCAPE '!'`)
        const tagParams = Array.from(tagSet).map((t) => '%' + escapeLike(t) + '%')
        const excludeIds = Array.from(recentActorIds)

        videoIds = db.prepare(`
          SELECT DISTINCT v.id
          FROM videos v
          JOIN video_actors va ON va.video_id = v.id
          JOIN actors a ON a.id = va.actor_id
          WHERE ${BASE_COND_V}
            AND (${tagConditions.join(' OR ')})
            ${excludeIds.length > 0 ? `AND a.id NOT IN (${excludeIds.map(() => '?').join(',')})` : ''}
          ORDER BY v.rating DESC, RANDOM()
          LIMIT ?
        `).all(...tagParams, ...excludeIds, LIMIT).map((r) => r.id)
      }

    } else {
      return []
    }

    if (videoIds.length === 0) return []

    // 영상 데이터 + actorsList 조회
    const MAX_PARAMS = 990
    let videos = []
    for (let i = 0; i < videoIds.length; i += MAX_PARAMS) {
      const chunk = videoIds.slice(i, i + MAX_PARAMS)
      const ph = chunk.map(() => '?').join(',')
      const rows = db.prepare(`SELECT * FROM videos WHERE id IN (${ph})`).all(...chunk)
      videos = videos.concat(rows)
    }

    const actorsByVideoId = {}
    for (let i = 0; i < videoIds.length; i += MAX_PARAMS) {
      const chunk = videoIds.slice(i, i + MAX_PARAMS)
      const ph = chunk.map(() => '?').join(',')
      const actorRows = db.prepare(`
        SELECT va.video_id, a.id AS actor_id, a.name, a.rating, a.tags,
               a.agency, a.image_path, a.aliases
        FROM video_actors va
        JOIN actors a ON a.id = va.actor_id
        WHERE va.video_id IN (${ph})
        ORDER BY va.video_id, va.order_index ASC
      `).all(...chunk)
      for (const row of actorRows) {
        if (!actorsByVideoId[row.video_id]) actorsByVideoId[row.video_id] = []
        actorsByVideoId[row.video_id].push(row)
      }
    }

    const idOrder = new Map(videoIds.map((id, idx) => [id, idx]))
    videos.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0))

    return videos.map((v) => ({
      ...v,
      actorsList: actorsByVideoId[v.id] || [],
    }))
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 생성 (create-actor)
  //
  // @param data {object} - { name(필수), image_path, category, agency, tags, rating, memo }
  // 반환: 생성된 Actor 레코드
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('create-actor', async (_event, data) => {
    const db   = getDb()
    const name = (data.name || '').trim()
    if (!name) throw new Error('배우 이름은 필수입니다.')

    const existing = db.prepare('SELECT id FROM actors WHERE name = ?').get(name)
    if (existing) throw new Error(`이미 존재하는 배우입니다: ${name}`)

    const info = db.prepare(`
      INSERT INTO actors (name, image_path, category, agency, tags, rating, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      (data.image_path || '').trim(),
      (data.category   || '').trim(),
      (data.agency     || '').trim(),
      (data.tags       || '').trim(),
      typeof data.rating === 'number' ? data.rating : 0,
      (data.memo       || '').trim(),
    )

    return db.prepare('SELECT * FROM actors WHERE id = ?').get(info.lastInsertRowid)
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 수정 (update-actor)
  //
  // @param id   {number}
  // @param data {object} - { name?, image_path?, category?, agency?, tags?, rating?, memo? }
  // 반환: 수정된 Actor 레코드
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('update-actor', async (_event, id, data) => {
    const db    = getDb()
    const actor = db.prepare('SELECT * FROM actors WHERE id = ?').get(id)
    if (!actor) throw new Error(`존재하지 않는 배우 id: ${id}`)

    const name = data.name !== undefined ? (data.name || '').trim() : actor.name
    if (!name) throw new Error('배우 이름은 필수입니다.')

    // 이름 변경 시 중복 체크 (자기 자신 제외)
    if (name !== actor.name) {
      const dup = db.prepare('SELECT id FROM actors WHERE name = ? AND id != ?').get(name, id)
      if (dup) throw new Error(`이미 존재하는 배우 이름입니다: ${name}`)
    }

    db.prepare(`
      UPDATE actors
      SET name       = ?,
          image_path = ?,
          category   = ?,
          agency     = ?,
          tags       = ?,
          rating     = ?,
          memo       = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name,
      data.image_path !== undefined ? (data.image_path || '').trim() : actor.image_path,
      data.category   !== undefined ? (data.category   || '').trim() : actor.category,
      data.agency     !== undefined ? (data.agency     || '').trim() : actor.agency,
      data.tags       !== undefined ? (data.tags       || '').trim() : actor.tags,
      data.rating     !== undefined ? data.rating                    : actor.rating,
      data.memo       !== undefined ? (data.memo       || '').trim() : actor.memo,
      id,
    )

    return db.prepare('SELECT * FROM actors WHERE id = ?').get(id)
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 아카이브 (archive-actor)
  // 실제 삭제 금지 — is_archived = 1 처리
  //
  // @param id {number}
  // 반환: { success: true }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('archive-actor', async (_event, id) => {
    const db = getDb()
    const actor = db.prepare('SELECT id FROM actors WHERE id = ?').get(id)
    if (!actor) throw new Error(`존재하지 않는 배우 id: ${id}`)

    db.prepare(`
      UPDATE actors SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id)

    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 복구 (restore-actor)
  // is_archived = 0으로 복구
  //
  // @param id {number}
  // 반환: { success: true }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('restore-actor', async (_event, id) => {
    const db = getDb()
    const actor = db.prepare('SELECT id FROM actors WHERE id = ?').get(id)
    if (!actor) throw new Error(`존재하지 않는 배우 id: ${id}`)

    db.prepare(`
      UPDATE actors SET is_archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id)

    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 이미지 업로드 (upload-actor-image)
  //
  // OS 파일 선택 다이얼로그를 열어 jpg/png/webp 이미지를
  // userData/actors/ 폴더로 복사하고 파일명을 반환한다.
  //
  // @param actorId {number} - 배우 ID (신규 생성 전이면 0)
  // 반환: { fileName: string } | null (취소 시)
  //
  // 보안:
  //   - 확장자 화이트리스트 검증 (jpg/jpeg/png/webp)
  //   - 파일명에 actorId + timestamp로 충돌 방지
  //   - 경로 조작 방지: path.basename 사용
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('upload-actor-image', async (_event, actorId) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title:      '배우 이미지 선택',
      filters:    [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile'],
    })

    if (canceled || filePaths.length === 0) return null

    const src = filePaths[0]
    const rawExt = path.extname(src).toLowerCase().slice(1)  // '.jpg' → 'jpg'
    const ALLOWED = ['jpg', 'jpeg', 'png', 'webp']
    if (!ALLOWED.includes(rawExt)) throw new Error(`지원하지 않는 이미지 형식: ${rawExt}`)

    // userData/actors 폴더 자동 생성
    const actorsDir = path.join(app.getPath('userData'), 'actors')
    if (!fs.existsSync(actorsDir)) fs.mkdirSync(actorsDir, { recursive: true })

    // 파일명: actor_{id}_{timestamp}.{ext} — 충돌 방지
    const safeId   = Number.isInteger(actorId) && actorId > 0 ? actorId : 0
    const fileName = `actor_${safeId}_${Date.now()}.${rawExt}`
    const dest     = path.join(actorsDir, fileName)

    fs.copyFileSync(src, dest)

    return { fileName }
  })

  // ══════════════════════════════════════════════════════════════
  // 배우 이미지 조회 (get-actor-image)
  //
  // userData/actors/{fileName} 파일을 읽어 base64 data URL 로 반환한다.
  // Renderer에서 <img src> 에 직접 사용 가능.
  //
  // @param fileName {string} - 파일명 (경로 아님)
  // 반환: string (data URL) | null (파일 없거나 오류)
  //
  // 보안: path.basename 으로 경로 탐색 공격 방지
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-actor-image', (_event, fileName) => {
    if (!fileName) return null
    const safe     = path.basename(fileName)  // 경로 탐색 방지
    const filePath = path.join(app.getPath('userData'), 'actors', safe)
    try {
      const buf  = fs.readFileSync(filePath)
      const ext  = path.extname(safe).toLowerCase().slice(1)
      const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
      const mime = MIME[ext] || 'image/jpeg'
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 가중치 기반 대시보드 추천 (get-dashboard-recommendations)
  //
  // 반환: { topPicks, stalePreferences, highRatedUnderViewed,
  //         worthRevisiting, needsMetadata, ratingReview }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-dashboard-recommendations', async () => {
    const db  = getDb()
    const now = Date.now()

    // ── 1. 배우 선호도 맵 (최근 90일 활동 기준) ─────────────────
    const actorPrefRows = (() => {
      try {
        return db.prepare(`
          SELECT va.actor_id, val.action_type, COUNT(*) AS cnt
          FROM video_activity_logs val
          JOIN video_actors va ON va.video_id = val.video_id
          WHERE val.created_at >= datetime('now', '-90 days')
          GROUP BY va.actor_id, val.action_type
        `).all()
      } catch { return [] }
    })()

    const actorFreq = {}
    for (const row of actorPrefRows) {
      const w = row.action_type === 'copy_to_device'    ? 3
              : row.action_type === 'copy_to_clipboard' ? 2
              : 1
      actorFreq[row.actor_id] = (actorFreq[row.actor_id] ?? 0) + row.cnt * w
    }
    const maxActorFreq = Math.max(...Object.values(actorFreq), 1)

    // ── 2. 태그 선호도 맵 (최근 90일 활동 기준) ─────────────────
    const tagPrefRows = (() => {
      try {
        return db.prepare(`
          SELECT DISTINCT v.id, v.tags, val.action_type
          FROM video_activity_logs val
          JOIN videos v ON v.id = val.video_id
          WHERE val.created_at >= datetime('now', '-90 days')
            AND v.tags IS NOT NULL AND trim(v.tags) != ''
          ORDER BY val.created_at DESC
          LIMIT 600
        `).all()
      } catch { return [] }
    })()

    const tagFreq = {}
    for (const row of tagPrefRows) {
      const w = row.action_type === 'copy_to_device'    ? 3
              : row.action_type === 'copy_to_clipboard' ? 2
              : 1
      const tags = (row.tags || '').split(',').map(t => t.trim()).filter(Boolean)
      for (const tag of tags) {
        tagFreq[tag] = (tagFreq[tag] ?? 0) + w
      }
    }
    const maxTagFreq = Math.max(...Object.values(tagFreq), 1)

    // ── 3. 전체 영상 + 활동 통계 ─────────────────────────────────
    const videoRows = (() => {
      try {
        return db.prepare(`
          SELECT
            v.id, v.file_name, v.file_path, v.folder_path,
            v.actor_name, v.tags, v.rating, v.grade,
            v.recommended, v.status, v.is_new,
            v.created_at, v.updated_at,
            COALESCE(s.total_activity, 0)    AS total_activity,
            COALESCE(s.copy_device_count, 0) AS copy_device_count,
            COALESCE(s.copy_clip_count, 0)   AS copy_clip_count,
            COALESCE(s.open_count, 0)        AS open_count,
            COALESCE(s.recent_7d, 0)         AS recent_7d,
            COALESCE(s.recent_30d, 0)        AS recent_30d,
            COALESCE(s.recent_60d, 0)        AS recent_60d,
            s.last_activity_at
          FROM videos v
          LEFT JOIN (
            SELECT
              video_id,
              COUNT(*) AS total_activity,
              SUM(CASE WHEN action_type = 'copy_to_device'    THEN 1 ELSE 0 END) AS copy_device_count,
              SUM(CASE WHEN action_type = 'copy_to_clipboard' THEN 1 ELSE 0 END) AS copy_clip_count,
              SUM(CASE WHEN action_type = 'open'              THEN 1 ELSE 0 END) AS open_count,
              SUM(CASE WHEN created_at >= datetime('now', '-7 days')  THEN 1 ELSE 0 END) AS recent_7d,
              SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS recent_30d,
              SUM(CASE WHEN created_at >= datetime('now', '-60 days') THEN 1 ELSE 0 END) AS recent_60d,
              MAX(created_at) AS last_activity_at
            FROM video_activity_logs
            GROUP BY video_id
          ) s ON s.video_id = v.id
          WHERE v.status NOT IN ('missing', 'deleted')
        `).all()
      } catch { return [] }
    })()

    // ── 4. 배우 연결 맵 ──────────────────────────────────────────
    const actorsMap = {}
    try {
      const actorRows = db.prepare(`
        SELECT va.video_id, va.actor_id, a.name AS actor_name, a.rating AS actor_rating
        FROM video_actors va
        JOIN actors a ON a.id = va.actor_id
        ORDER BY va.video_id, va.order_index ASC
      `).all()
      for (const row of actorRows) {
        if (!actorsMap[row.video_id]) actorsMap[row.video_id] = []
        actorsMap[row.video_id].push({ actorId: row.actor_id, name: row.actor_name, rating: row.actor_rating })
      }
    } catch { /* actors 테이블 없는 구버전 */ }

    // ── 5. 등급별 점수 기준 ───────────────────────────────────────
    const GRADE_SCORE = {
      '영구소장':    25,
      '재시청 추천': 15,
      '만족':         8,
      '보관':         0,
      '애매':        -5,
      '삭제요망':   -15,
    }

    // ── 6. 영상별 점수 계산 ───────────────────────────────────────
    const scored = videoRows.map(v => {
      const actors  = actorsMap[v.id] ?? []
      const tags    = (v.tags || '').split(',').map(t => t.trim()).filter(Boolean)
      const lastMs  = v.last_activity_at ? new Date(v.last_activity_at).getTime() : 0
      const lastActivityDays = lastMs ? Math.floor((now - lastMs) / 86400000) : 9999

      // 1. actorPreferenceScore (0~40)
      let actorPrefRaw = 0
      for (const a of actors) {
        actorPrefRaw += (actorFreq[a.actorId] ?? 0) / maxActorFreq
      }
      const actorPreferenceScore = Math.min(Math.round(actorPrefRaw * 40), 40)

      // 2. tagPreferenceScore (0~30)
      let tagPrefRaw = 0
      for (const tag of tags) {
        tagPrefRaw += (tagFreq[tag] ?? 0) / maxTagFreq
      }
      const tagPreferenceScore = Math.min(Math.round(tagPrefRaw * 30), 30)

      // 3. ratingScore
      const rating = v.rating ?? 0
      const ratingScore = rating >= 5 ? 30
                        : rating >= 4 ? 20
                        : rating === 3 ?  5
                        : rating === 2 ? -5
                        : rating === 1 ? -15
                        : 0

      // 4. gradeScore
      const gradeScore = GRADE_SCORE[v.grade] ?? 0

      // 5. recommendedScore
      const recommendedScore = v.recommended ? 15 : 0

      // 6. underViewedBonus
      const totalAct = v.total_activity ?? 0
      const underViewedBonus = totalAct === 0 ? 20
                             : totalAct <= 1  ? 10
                             : totalAct <= 3  ?  5
                             : 0

      // 7. staleBonus (취향 있는데 방치)
      const prefScore = actorPreferenceScore + tagPreferenceScore
      const staleBonus = (prefScore > 3 && lastActivityDays > 30) ? 15 : 0

      // 8. overViewedPenalty
      const recent7d = v.recent_7d ?? 0
      const overViewedPenalty = recent7d >= 5 ? 25
                              : recent7d >= 3 ? 15
                              : recent7d >= 2 ?  5
                              : 0

      // 9. missingMetadataPenalty
      const hasActors = actors.length > 0
      const hasTags   = tags.length > 0
      const hasRating = rating > 0
      const missingMetadataPenalty = (!hasActors ? 15 : 0) + (!hasTags ? 5 : 0) + (!hasRating ? 10 : 0)

      const score = Math.round(
        actorPreferenceScore + tagPreferenceScore +
        ratingScore + gradeScore + recommendedScore +
        underViewedBonus + staleBonus -
        overViewedPenalty - missingMetadataPenalty
      )

      // 추천 이유
      const reasons = []
      if (actorPreferenceScore >= 15)      reasons.push('자주 보는 배우 출연')
      else if (actorPreferenceScore >= 5)  reasons.push('관심 배우 출연')
      if (tagPreferenceScore >= 10)        reasons.push('취향 태그 포함')
      if (rating >= 4)                     reasons.push('고평점 작품')
      if (v.grade === '영구소장')           reasons.push('영구소장 등급')
      else if (v.grade === '재시청 추천')   reasons.push('재시청 추천 등급')
      if (v.recommended)                   reasons.push('추천 표시')
      if (underViewedBonus >= 15)          reasons.push('아직 한 번도 안 본 작품')
      else if (underViewedBonus > 0)       reasons.push('덜 본 작품')
      if (staleBonus > 0)                  reasons.push('취향인데 방치됨')
      if (overViewedPenalty > 0)           reasons.push('최근 자주 본 작품')

      // 메타데이터 이슈
      const metadataIssues = []
      const actorNameFromFile = (v.actor_name || '').trim()
      if (actorNameFromFile && !hasActors) metadataIssues.push('배우 연결 필요')
      else if (!hasActors)                 metadataIssues.push('배우 없음')
      if (!hasTags)                        metadataIssues.push('태그 없음')
      if (!hasRating)                      metadataIssues.push('평점 없음')
      if (!v.recommended)                  metadataIssues.push('추천 표시 없음')

      return {
        id:                  v.id,
        fileName:            v.file_name,
        filePath:            v.file_path,
        folderPath:          v.folder_path,
        actorName:           v.actor_name || '',
        actors,
        tags,
        rating,
        grade:               v.grade || '보관',
        recommended:         v.recommended ? true : false,
        score,
        actorPreferenceScore,
        tagPreferenceScore,
        reasons,
        lastActivityAt:      v.last_activity_at ?? null,
        lastActivityDays,
        totalActivity:       totalAct,
        copyDeviceCount:     v.copy_device_count ?? 0,
        copyClipCount:       v.copy_clip_count   ?? 0,
        openCount:           v.open_count        ?? 0,
        recent7d,
        recent30d:           v.recent_30d ?? 0,
        hasActors,
        hasTags,
        hasRating,
        metadataIssues,
      }
    })

    // ── 7. 섹션 분류 ──────────────────────────────────────────────

    // 1. 오늘 추천 TOP
    const topPicks = [...scored]
      .filter(v => (v.hasActors || v.rating >= 3) && v.metadataIssues.filter(i => i !== '추천 표시 없음').length < 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    // 2. 취향은 맞는데 방치된 작품
    const stalePreferences = [...scored]
      .filter(v => (v.actorPreferenceScore + v.tagPreferenceScore) > 5 && v.lastActivityDays > 30)
      .sort((a, b) => (b.actorPreferenceScore + b.tagPreferenceScore) - (a.actorPreferenceScore + a.tagPreferenceScore))
      .slice(0, 10)

    // 3. 고평점인데 덜 본 작품
    const highRatedUnderViewed = [...scored]
      .filter(v => v.rating >= 4 && v.totalActivity <= 2)
      .sort((a, b) => b.rating - a.rating || a.totalActivity - b.totalActivity)
      .slice(0, 10)

    // 4. 다시 볼만한 작품 (과거 장치 복사 이력 있음, 최근 30일 활동 없음)
    const worthRevisiting = [...scored]
      .filter(v => v.copyDeviceCount > 0 && v.recent30d === 0 && v.lastActivityDays < 365)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    // 5. 수정 추천 (메타데이터 부족)
    const needsMetadata = [...scored]
      .filter(v => !v.hasActors || !v.hasTags || !v.hasRating)
      .sort((a, b) => {
        const sw = (x) => (!x.hasActors ? 3 : 0) + (!x.hasTags ? 1 : 0) + (!x.hasRating ? 2 : 0)
        return sw(b) - sw(a)
      })
      .slice(0, 20)

    // 6. 평점 재검토 - A. 평점 올리기 후보
    const ratingUpCandidates = [...scored]
      .filter(v => v.rating <= 3 && v.totalActivity >= 3 && v.recent30d > 0)
      .sort((a, b) => b.recent30d - a.recent30d || b.totalActivity - a.totalActivity)
      .slice(0, 10)

    // 7. 평점 재검토 - B. 평점 낮추기 후보
    const ratingDownCandidates = [...scored]
      .filter(v => v.rating >= 4 && v.totalActivity <= 1 && v.lastActivityDays >= 60)
      .sort((a, b) => b.rating - a.rating || b.lastActivityDays - a.lastActivityDays)
      .slice(0, 10)

    // 8. 추천 표시 불일치
    const ratingMismatch = [...scored]
      .filter(v => (v.recommended && v.rating <= 2) || (!v.recommended && v.rating >= 4))
      .sort((a, b) => {
        const mw = (x) => (x.recommended && x.rating <= 2 ? 2 : 0) + (!x.recommended && x.rating >= 4 ? 1 : 0)
        return mw(b) - mw(a)
      })
      .slice(0, 10)

    return {
      topPicks,
      stalePreferences,
      highRatedUnderViewed,
      worthRevisiting,
      needsMetadata,
      ratingReview: {
        upCandidates:   ratingUpCandidates,
        downCandidates: ratingDownCandidates,
        mismatch:       ratingMismatch,
      },
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 대시보드 통계 조회
  //
  // 반환: { summary, topActors, recentVideos, recentActivities,
  //         ratingDistribution, tagStats }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-dashboard-stats', async () => {
    return getDashboardStats()
  })

  // ══════════════════════════════════════════════════════════════
  // AI 연결 테스트 (ai:test-connection)
  //
  // OpenAI Responses API로 간단한 요청을 보내 연결을 확인한다.
  // API Key는 .env에서만 읽으며 Renderer에 노출하지 않는다.
  //
  // 반환: { success: true, model, message } | { success: false, error }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('ai:test-connection', async () => {
    try {
      const result = await testOpenAIConnection()
      return result
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 영상 파일 정보 조회 (get-video-file-infos)
  //
  // AI 특집 폴더 등에서 videoIds 목록을 받아 장치 복사에 필요한
  // 파일 정보(file_path, size, status 등)를 반환한다.
  //
  // @param videoIds {number[]}
  // 반환: { id, file_name, file_path, size, status }[]
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-video-file-infos', (_event, videoIds) => {
    if (!Array.isArray(videoIds) || videoIds.length === 0) return []
    const db = getDb()
    const ids = videoIds.map(Number).filter(n => Number.isFinite(n))
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    return db.prepare(
      `SELECT id, file_name, file_path, size, status FROM videos WHERE id IN (${placeholders})`
    ).all(...ids)
  })

  // ══════════════════════════════════════════════════════════════
  // AI 특집 폴더 - 테마 생성 (ai-theme-folders:generate)
  //
  // 1. DB에서 normal 영상 전체 조회 (배우/태그/활동 통계 포함)
  // 2. generateAiThemeFolders로 후보 계산 + OpenAI 호출
  //
  // 반환: { success: true, themes[], candidateCount }
  //     | { success: false, error }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('ai-theme-folders:generate', async (_event, customPrompt = '') => {
    try {
      const db = getDb()

      // 1. 영상 + 활동 통계 JOIN
      const videoRows = db.prepare(`
        SELECT
          v.id, v.file_name, v.file_path, v.folder_path,
          v.actor_name, v.tags, v.rating, v.grade,
          v.recommended, v.favorite, v.size,
          v.play_count,
          COALESCE(s.copy_count, 0) AS copy_count,
          COALESCE(s.open_count, 0) AS open_count,
          COALESCE(s.download_req,  0) AS download_request_count
        FROM videos v
        LEFT JOIN (
          SELECT
            video_id,
            SUM(CASE WHEN action_type IN ('copy_to_clipboard','copy_to_device') THEN 1 ELSE 0 END) AS copy_count,
            SUM(CASE WHEN action_type = 'open'              THEN 1 ELSE 0 END) AS open_count,
            SUM(CASE WHEN action_type = 'download_request'  THEN 1 ELSE 0 END) AS download_req
          FROM video_activity_logs
          GROUP BY video_id
        ) s ON s.video_id = v.id
        WHERE v.status = 'normal'
      `).all()

      // 2. 배우 연결 맵 (video_id → 배우 이름 목록)
      const actorsMap = {}
      try {
        const actorRows = db.prepare(`
          SELECT va.video_id, a.name
          FROM video_actors va
          JOIN actors a ON a.id = va.actor_id
          ORDER BY va.video_id, va.order_index ASC
        `).all()
        for (const r of actorRows) {
          if (!actorsMap[r.video_id]) actorsMap[r.video_id] = []
          actorsMap[r.video_id].push(r.name)
        }
      } catch { /* actors 없는 구버전 무시 */ }

      // 3. 배우별 누적 복사 횟수 집계 (actor_name → copy_count)
      const actorCopyMap = {}
      try {
        const actorCopyRows = db.prepare(`
          SELECT a.name, COUNT(*) AS cnt
          FROM video_activity_logs val
          JOIN video_actors va ON va.video_id = val.video_id
          JOIN actors a ON a.id = va.actor_id
          WHERE val.action_type IN ('copy_to_clipboard', 'copy_to_device')
          GROUP BY a.name
        `).all()
        for (const r of actorCopyRows) actorCopyMap[r.name] = r.cnt
      } catch { /* 무시 */ }

      // 4. 태그별 누적 복사 횟수 집계 (tag → copy_count)
      const tagCopyMap = {}
      for (const v of videoRows) {
        const cc = v.copy_count || 0
        if (!cc) continue
        const tags = (v.tags || '').split(',').map(t => t.trim()).filter(Boolean)
        for (const tag of tags) tagCopyMap[tag] = (tagCopyMap[tag] || 0) + cc
      }

      // 5. DTO 변환
      const videos = videoRows.map(v => {
        const actorList    = actorsMap[v.id] ?? []
        const actors       = v.actor_name || actorList.join(', ')
        const primaryActor = actorList[0] ?? (v.actor_name || '')
        const folderName   = v.folder_path ? path.basename(v.folder_path) : ''
        const tags         = (v.tags || '').split(',').map(t => t.trim()).filter(Boolean)
        // 해당 배우의 총 복사 횟수 (대표 배우 기준)
        const actorCopyCount = actorCopyMap[primaryActor] || 0
        // 해당 영상 태그 중 가장 많이 복사된 태그의 복사 횟수
        const tagCopyCount   = tags.length ? Math.max(...tags.map(t => tagCopyMap[t] || 0)) : 0
        return {
          id:                   v.id,
          fileName:             v.file_name,
          filePath:             v.file_path,
          folderName,
          folderPath:           v.folder_path,
          actors,
          primaryActor,
          tags,
          rating:               v.rating    ?? 0,
          grade:                v.grade     ?? '',
          playCount:            v.play_count ?? 0,
          downloadRequestCount: v.download_request_count ?? 0,
          copyCount:            v.copy_count ?? 0,
          actorCopyCount,
          tagCopyCount,
          favorite:             Boolean(v.favorite),
          recommended:          Boolean(v.recommended),
          fileSize:             v.size       ?? 0,
        }
      })

      // customPrompt에 언급된 배우/키워드와 일치하는 영상을 우선 후보에 강제 포함
      // → 점수가 낮아도 후보 120개 안에 반드시 들어가게 함
      const priorityIds = new Set()
      if (customPrompt) {
        // 2자 이상 한글·일본어(히라가나/가타카나/한자) 단어 추출
        const keywords = (customPrompt.match(/[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]{2,}/g) ?? [])
          .map(k => k.toLowerCase())
        if (keywords.length > 0) {
          for (const v of videos) {
            const searchStr = [v.actors, ...v.tags].join(' ').toLowerCase()
            if (keywords.some(kw => searchStr.includes(kw))) {
              priorityIds.add(v.id)
            }
          }
        }
      }

      return await generateAiThemeFolders(videos, { customPrompt: customPrompt || '', priorityIds })
    } catch (err) {
      console.error('[ai-theme-folders:generate]', err)
      return { success: false, error: err.message }
    }
  })

  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // AI 테마 → 장치 서브폴더 복사 (copy-themes-to-device)
  //
  // 선택한 테마 배열에서 videoId → filePath 맵을 구성한 뒤
  // createMtpThemeBulkSession 으로 장치에 테마명 서브폴더를 만들고 복사한다.
  //
  // @param selectedThemes {object[]} - 선택된 테마 (videoIds, folderName 포함)
  // 반환: { success, action, themeCount, fileCount, folderErrors }
  //       | { success: false, error }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('copy-themes-to-device', async (_event, selectedThemes) => {
    if (!Array.isArray(selectedThemes) || selectedThemes.length === 0) {
      return { success: false, error: '선택된 테마가 없습니다.' }
    }

    const db = getDb()
    const allIds = [...new Set(selectedThemes.flatMap(t => (t.videoIds ?? []).map(Number)))]
    const fileRows = allIds.length > 0
      ? db.prepare(
          `SELECT id, file_path, status FROM videos WHERE id IN (${allIds.map(() => '?').join(',')})`
        ).all(...allIds)
      : []

    const fileMap = new Map(fileRows.map(r => [r.id, r]))

    // 테마별 {name, files, videoIds} 목록 구성 (missing/deleted 제외)
    const themes = []
    for (const t of selectedThemes) {
      const validRows = (t.videoIds ?? [])
        .map(id => fileMap.get(Number(id)))
        .filter(r => r && r.file_path && r.status !== 'missing' && r.status !== 'deleted')
      if (validRows.length > 0) {
        themes.push({
          name:     t.folderName ?? t.title,
          files:    validRows.map(r => r.file_path),
          videoIds: validRows.map(r => r.id),
        })
      }
    }

    if (themes.length === 0) {
      return { success: false, error: '복사 가능한 파일이 없습니다.' }
    }

    const mainWin    = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const hwndBuffer = mainWin?.getNativeWindowHandle()
    const hwnd       = hwndBuffer ? hwndBuffer.readUInt32LE(0) : 0

    // 이전 세션 정리
    if (_themeSession) { try { _themeSession.close() } catch { /* 무시 */ }; _themeSession = null }

    let session
    try {
      session = await createMtpThemeBulkSession(hwnd, themes)
    } catch (err) {
      return { success: false, error: err.message }
    }

    if (!session) {
      return { success: false, action: 'cancelled' }
    }

    // ── 복사 이력 기록 ────────────────────────────────────────────
    try {
      const insertLog = db.prepare(`
        INSERT INTO video_activity_logs (video_id, action_type, meta_json)
        VALUES (?, 'copy_to_device', ?)
      `)
      const logAll = db.transaction(() => {
        for (const t of themes) {
          const meta = JSON.stringify({ theme: t.name })
          for (const vid of t.videoIds) {
            insertLog.run(vid, meta)
          }
        }
      })
      logAll()
    } catch { /* 로그 실패가 복사 동작을 막지 않도록 */ }

    _themeSession = session
    const totalFiles = themes.reduce((s, t) => s + t.files.length, 0)
    return {
      success:      true,
      action:       'theme-bulk-started',
      themeCount:   themes.length,
      fileCount:    totalFiles,
      folderErrors: session.errorCount,
    }
  })

  // ── AI 테마 장치 복사 완료 신호 ─────────────────────────────────
  ipcMain.on('theme-copy-close', () => {
    if (_themeSession) {
      _themeSession.close()
      _themeSession = null
    }
  })

  // AI 특집 폴더 - 실제 복사 실행 (ai-theme-folders:create-folders)
  //
  // @param targetRootPath {string}   - 복사 대상 상위 디렉터리
  // @param selectedThemes {object[]} - 선택된 테마 배열 (videoIds 포함)
  //
  // 반환: { success: true, results[] } | { success: false, error }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('ai-theme-folders:create-folders', async (_event, targetRootPath, selectedThemes) => {
    try {
      if (!targetRootPath) return { success: false, error: 'targetRootPath가 없습니다.' }
      if (!Array.isArray(selectedThemes) || selectedThemes.length === 0) {
        return { success: false, error: '선택된 테마가 없습니다.' }
      }

      const db = getDb()

      // videoId → { filePath, fileName } 맵 구성
      const allIds = [...new Set(selectedThemes.flatMap(t => (t.videoIds ?? []).map(Number)))]
      const placeholders = allIds.map(() => '?').join(',')
      const fileRows = allIds.length > 0
        ? db.prepare(`SELECT id, file_path, file_name FROM videos WHERE id IN (${placeholders})`).all(...allIds)
        : []

      const videoFileMap = new Map()
      for (const r of fileRows) {
        videoFileMap.set(r.id, { filePath: r.file_path, fileName: r.file_name })
      }

      return await createThemeFolders(targetRootPath, selectedThemes, videoFileMap)
    } catch (err) {
      console.error('[ai-theme-folders:create-folders]', err)
      return { success: false, error: err.message }
    }
  })

  // ══════════════════════════════════════════════════════════════
  // AI 채팅 추천 (ai-chat-recommend:ask)
  //
  // 자연어 프롬프트 → 의도 분석 → DB 후보 조회 → AI 추천
  // @param userPrompt {string}
  // 반환: { success, summary, reason, intent, items[] }
  //       | { success: false, error }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('ai-chat-recommend:ask', async (_event, userPrompt) => {
    try {
      const db = getDb()
      return await askAiChatRecommend(db, userPrompt)
    } catch (err) {
      console.error('[ai-chat-recommend:ask]', err)
      return { success: false, error: err.message }
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 드라이브별 저장소 통계 조회 (get-drive-stats)
  //
  // 모든 normal 영상을 드라이브 문자 기준으로 집계한다.
  // 반환: DriveStats[]
  //   { drive, totalVideos, totalSize, averageRating,
  //     recommendedCount, deleteCandidateCount, lowPreferenceCount }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-drive-stats', async () => {
    try {
      const db = getDb()
      const { getDriveStats } = require('./services/driveStatsService.cjs')
      return { success: true, drives: getDriveStats(db) }
    } catch (err) {
      console.error('[get-drive-stats]', err)
      return { success: false, error: err.message }
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 드라이브별 삭제 후보 조회 (get-delete-candidates-by-drive)
  //
  // @param drive {string|null} - "D:" 형태 또는 null(전체)
  // 반환:
  //   { drive, freeSpace, totalDiskSize, usedByLibrary, candidates[] }
  //   candidates[]: { id, filename, file_path, file_size, rating,
  //                   actorNames, tags, copy_count, watch_count,
  //                   deleteScore, reason[] }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('get-delete-candidates-by-drive', async (_event, drive) => {
    try {
      const db = getDb()
      const { getDeleteCandidatesByDrive } = require('./services/driveStatsService.cjs')
      return { success: true, ...getDeleteCandidatesByDrive(db, drive || null) }
    } catch (err) {
      console.error('[get-delete-candidates-by-drive]', err)
      return { success: false, error: err.message }
    }
  })

  // ══════════════════════════════════════════════════════════════
  // 삭제 예정 표시 (mark-delete-candidate)
  //
  // 실제 파일 삭제 없이 grade='삭제요망'으로만 변경한다.
  // @param videoId {number}
  // 반환: { success: true } | { success: false, error }
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('mark-delete-candidate', async (_event, videoId) => {
    try {
      const db  = getDb()
      const row = db.prepare('SELECT id, grade FROM videos WHERE id = ?').get(videoId)
      if (!row) return { success: false, error: '영상을 찾을 수 없습니다.' }
      db.prepare(
        `UPDATE videos SET grade = '삭제요망', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(videoId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerIpcHandlers }
