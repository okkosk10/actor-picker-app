'use strict'

const fs = require('fs')
const path = require('path')
const { hashFile, hashText } = require('./fileHashService.cjs')

const JELLYFIN_ACTOR_SYNC_VERSION = 'actor-sync-v1'
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const IMAGE_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

function detectMimeFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return ''

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png'
  }

  // WEBP: 'RIFF'....'WEBP'
  if (
    buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return 'image/webp'
  }

  return ''
}

const SYNC_STATUS = {
  NOT_SYNCED: 'not_synced',
  PENDING: 'pending',
  SYNCED: 'synced',
  CHANGED: 'changed',
  FAILED: 'failed',
  NOT_FOUND: 'not_found',
  NEEDS_REVIEW: 'needs_review',
  IMAGE_MISSING: 'image_missing',
}

function normalizeMatchText(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
}

function parseFlexibleList(value) {
  if (Array.isArray(value)) {
    return dedupeTextList(value)
  }

  const text = String(value || '').trim()
  if (!text) return []

  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return dedupeTextList(parsed)
    }
  } catch {
    // noop
  }

  return dedupeTextList(text.split(','))
}

function dedupeTextList(values) {
  const seen = new Set()
  const result = []
  for (const raw of values) {
    const value = String(raw || '').trim()
    if (!value) continue
    const key = normalizeMatchText(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function trimLongText(value, maxLength = 4000) {
  const text = String(value || '').trim()
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength)
}

function buildJellyfinPersonOverview(actor) {
  const name = String(actor?.name || '').trim()
  const aliases = parseFlexibleList(actor?.aliases).filter((alias) => normalizeMatchText(alias) !== normalizeMatchText(name))
  const tags = parseFlexibleList(actor?.tags)

  const lines = []
  if (String(actor?.agency || '').trim()) lines.push(`소속사: ${String(actor.agency).trim()}`)
  if (String(actor?.category || '').trim()) lines.push(`분류: ${String(actor.category).trim()}`)
  if (aliases.length > 0) lines.push(`별칭: ${aliases.join(', ')}`)
  if (tags.length > 0) lines.push(`태그: ${tags.join(', ')}`)

  const memo = trimLongText(actor?.memo, 12000)
  if (memo) {
    if (lines.length > 0) lines.push('')
    lines.push('액트픽커 메모:')
    lines.push(memo)
  }

  return lines.join('\n').trim()
}

function resolveImagePath(rawPath, options = {}) {
  const imagePath = String(rawPath || '').trim()
  if (!imagePath) return ''

  if (path.isAbsolute(imagePath)) return imagePath

  const baseDir = String(options.imageBaseDir || '').trim()
  if (baseDir) return path.join(baseDir, path.basename(imagePath))

  return imagePath
}

async function resolveActorImage(actor, options = {}) {
  const resolvedPath = resolveImagePath(actor?.image_path, options)
  if (!resolvedPath) {
    return { ok: false, reason: 'IMAGE_MISSING', message: '로컬 이미지 경로가 없습니다.' }
  }

  let stat
  try {
    stat = await fs.promises.stat(resolvedPath)
  } catch {
    return { ok: false, reason: 'IMAGE_MISSING', message: '로컬 이미지 파일을 찾을 수 없습니다.' }
  }

  if (!stat.isFile()) {
    return { ok: false, reason: 'IMAGE_MISSING', message: '이미지 경로가 일반 파일이 아닙니다.' }
  }

  const ext = path.extname(resolvedPath).toLowerCase()
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return { ok: false, reason: 'UNSUPPORTED_IMAGE', message: `지원하지 않는 이미지 형식입니다: ${ext || '(none)'}` }
  }

  const buffer = await fs.promises.readFile(resolvedPath)
  const detectedContentType = detectMimeFromBuffer(buffer)
  const contentType = detectedContentType || IMAGE_MIME_BY_EXT[ext]
  const sha256 = await hashFile(resolvedPath)

  return {
    ok: true,
    imagePath: resolvedPath,
    contentType,
    buffer,
    size: stat.size,
    mtimeMs: Number(stat.mtimeMs || 0),
    sha256,
  }
}

function computeActorSyncHash(actor, imageHash, version = JELLYFIN_ACTOR_SYNC_VERSION) {
  const normalized = {
    version,
    name: String(actor?.name || '').trim(),
    category: String(actor?.category || '').trim(),
    agency: String(actor?.agency || '').trim(),
    aliases: parseFlexibleList(actor?.aliases),
    tags: parseFlexibleList(actor?.tags),
    memo: String(actor?.memo || '').trim(),
    imageHash: String(imageHash || ''),
  }
  return hashText(JSON.stringify(normalized))
}

async function findPersonCandidates(actor, api, options = {}) {
  const actorName = String(actor?.name || '').trim()
  const aliases = parseFlexibleList(actor?.aliases)
  const normalize = normalizeMatchText

  if (actor.jellyfin_person_id) {
    try {
      const person = await api.getPersonById(actor.jellyfin_person_id, { signal: options.signal })
      if (person?.Id) {
        return {
          type: 'matched',
          method: 'saved_person_id',
          person,
          candidates: [person],
        }
      }
    } catch {
      // 저장된 personId가 무효하면 이름 검색으로 재시도
    }
  }

  const searchMap = new Map()

  async function collectByName(name) {
    const term = String(name || '').trim()
    if (!term) return
    const list = await api.searchPersonsByName(term, { limit: 50, signal: options.signal })
    for (const item of list) {
      if (!item?.Id) continue
      searchMap.set(item.Id, item)
    }
  }

  await collectByName(actorName)
  for (const alias of aliases) {
    await collectByName(alias)
  }

  const allCandidates = Array.from(searchMap.values())
  const actorNameKey = normalize(actorName)

  const exactNameMatches = allCandidates.filter((person) => normalize(person?.Name) === actorNameKey)
  if (exactNameMatches.length === 1) {
    return {
      type: 'matched',
      method: 'exact_name',
      person: exactNameMatches[0],
      candidates: allCandidates,
    }
  }

  if (exactNameMatches.length > 1) {
    return {
      type: 'needs_review',
      method: 'exact_name_conflict',
      candidates: exactNameMatches,
      reason: '동일한 이름의 Person이 여러 개입니다.',
    }
  }

  const aliasSet = new Set(aliases.map((alias) => normalize(alias)).filter(Boolean))
  const aliasMatches = allCandidates.filter((person) => aliasSet.has(normalize(person?.Name)))

  if (aliasMatches.length === 1) {
    return {
      type: 'needs_review',
      method: 'alias_candidate',
      candidates: aliasMatches,
      reason: '별칭 기준으로 후보가 1개입니다. 직접 확인 후 연결하세요.',
    }
  }

  if (aliasMatches.length > 1) {
    return {
      type: 'needs_review',
      method: 'alias_conflict',
      candidates: aliasMatches,
      reason: '별칭 기준 후보가 여러 개입니다.',
    }
  }

  return {
    type: 'not_found',
    method: 'not_found',
    candidates: allCandidates,
    reason: '일치하는 Person을 찾지 못했습니다. Jellyfin 라이브러리 메타데이터 새로고침(또는 작품 NFO 반영)으로 Person 항목을 먼저 생성한 뒤 다시 동기화하세요.',
  }
}

function ensureSyncColumns(db) {
  const cols = db.prepare('PRAGMA table_info(actors)').all().map((c) => c.name)
  const required = [
    'jellyfin_person_id',
    'jellyfin_sync_status',
    'jellyfin_sync_hash',
    'jellyfin_synced_at',
    'jellyfin_sync_error',
    'jellyfin_matched_name',
    'jellyfin_match_method',
    'jellyfin_image_synced_at',
  ]

  for (const col of required) {
    if (!cols.includes(col)) {
      throw new Error(`actors 테이블에 ${col} 컬럼이 없습니다. 앱을 재시작해 마이그레이션을 적용해 주세요.`)
    }
  }
}

function updateActorSyncState(db, actorId, patch = {}) {
  const current = db.prepare('SELECT * FROM actors WHERE id = ?').get(actorId)
  if (!current) throw new Error(`배우를 찾을 수 없습니다: ${actorId}`)

  db.prepare(`
    UPDATE actors
    SET jellyfin_person_id = ?,
        jellyfin_sync_status = ?,
        jellyfin_sync_hash = ?,
        jellyfin_synced_at = ?,
        jellyfin_sync_error = ?,
        jellyfin_matched_name = ?,
        jellyfin_match_method = ?,
        jellyfin_image_synced_at = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    patch.jellyfin_person_id !== undefined ? patch.jellyfin_person_id : (current.jellyfin_person_id || ''),
    patch.jellyfin_sync_status !== undefined ? patch.jellyfin_sync_status : (current.jellyfin_sync_status || SYNC_STATUS.NOT_SYNCED),
    patch.jellyfin_sync_hash !== undefined ? patch.jellyfin_sync_hash : (current.jellyfin_sync_hash || ''),
    patch.jellyfin_synced_at !== undefined ? patch.jellyfin_synced_at : current.jellyfin_synced_at,
    patch.jellyfin_sync_error !== undefined ? patch.jellyfin_sync_error : (current.jellyfin_sync_error || ''),
    patch.jellyfin_matched_name !== undefined ? patch.jellyfin_matched_name : (current.jellyfin_matched_name || ''),
    patch.jellyfin_match_method !== undefined ? patch.jellyfin_match_method : (current.jellyfin_match_method || ''),
    patch.jellyfin_image_synced_at !== undefined ? patch.jellyfin_image_synced_at : current.jellyfin_image_synced_at,
    actorId,
  )
}

function listActorSyncItems(db, options = {}) {
  ensureSyncColumns(db)

  const conditions = []
  const params = []

  if (options.includeArchived !== true) {
    conditions.push('a.is_archived = 0')
  }

  if (options.status && options.status !== 'all') {
    conditions.push('a.jellyfin_sync_status = ?')
    params.push(options.status)
  }

  if (options.query && String(options.query).trim()) {
    const q = `%${String(options.query).trim()}%`
    conditions.push('(a.name LIKE ? OR a.aliases LIKE ? OR a.jellyfin_matched_name LIKE ?)')
    params.push(q, q, q)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db.prepare(`
    SELECT
      a.*,
      COUNT(DISTINCT va.video_id) AS video_count
    FROM actors a
    LEFT JOIN video_actors va ON va.actor_id = a.id
    ${where}
    GROUP BY a.id
    ORDER BY a.name ASC
  `).all(...params)
}

async function buildCurrentSyncHash(actor, options = {}) {
  const imageResult = await resolveActorImage(actor, options)
  const imageHash = imageResult.ok ? imageResult.sha256 : ''
  return computeActorSyncHash(actor, imageHash)
}

async function detectChangedStatus(actor, options = {}) {
  if ((actor.jellyfin_sync_status || '') !== SYNC_STATUS.SYNCED) return actor.jellyfin_sync_status || SYNC_STATUS.NOT_SYNCED
  const nextHash = await buildCurrentSyncHash(actor, options)
  if (nextHash !== (actor.jellyfin_sync_hash || '')) return SYNC_STATUS.CHANGED
  return SYNC_STATUS.SYNCED
}

async function syncActor(db, api, actor, options = {}) {
  const nowIso = new Date().toISOString()
  const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  const force = Boolean(options.force)
  const includeImage = options.replacePrimaryImage !== false
  const overwriteOverview = options.overwriteOverview !== false
  const allowRename = Boolean(options.forceNameUpdate)
  const signal = options.signal

  if (signal?.aborted) {
    return { success: false, cancelled: true, actorId: actor.id, actorName: actor.name }
  }

  updateActorSyncState(db, actor.id, {
    jellyfin_sync_status: SYNC_STATUS.PENDING,
    jellyfin_sync_error: '',
  })
  progress({ actorId: actor.id, actorName: actor.name, stage: 'preparing', message: '배우 동기화 준비 중' })

  try {
    const imageResult = await resolveActorImage(actor, options)
    const syncHash = computeActorSyncHash(actor, imageResult.ok ? imageResult.sha256 : '')

    if (!force && actor.jellyfin_sync_status === SYNC_STATUS.SYNCED && actor.jellyfin_sync_hash === syncHash) {
      progress({ actorId: actor.id, actorName: actor.name, stage: 'skipped', message: '변경 사항 없음' })
      return {
        success: true,
        skipped: true,
        actorId: actor.id,
        actorName: actor.name,
        syncHash,
      }
    }

    if (signal?.aborted) throw new Error('사용자 취소')

    progress({ actorId: actor.id, actorName: actor.name, stage: 'matching', message: 'Jellyfin Person 매칭 중' })
    const match = await findPersonCandidates(actor, api, { signal })

    if (match.type === 'not_found') {
      updateActorSyncState(db, actor.id, {
        jellyfin_sync_status: SYNC_STATUS.NOT_FOUND,
        jellyfin_sync_error: match.reason || 'Person을 찾을 수 없습니다.',
        jellyfin_match_method: match.method,
      })
      return { success: false, actorId: actor.id, actorName: actor.name, status: SYNC_STATUS.NOT_FOUND, reason: match.reason }
    }

    if (match.type === 'needs_review') {
      updateActorSyncState(db, actor.id, {
        jellyfin_sync_status: SYNC_STATUS.NEEDS_REVIEW,
        jellyfin_sync_error: match.reason || '직접 매칭이 필요합니다.',
        jellyfin_match_method: match.method,
      })
      return {
        success: false,
        actorId: actor.id,
        actorName: actor.name,
        status: SYNC_STATUS.NEEDS_REVIEW,
        reason: match.reason,
        candidates: match.candidates || [],
      }
    }

    const person = match.person
    const personId = String(person?.Id || '')
    if (!personId) {
      throw new Error('매칭된 Person ID가 비어 있습니다.')
    }

    progress({ actorId: actor.id, actorName: actor.name, stage: 'updating-metadata', message: 'Person 메타데이터 업데이트 중' })
    const personDetail = await api.getPersonById(personId, { signal })

    const overview = buildJellyfinPersonOverview(actor)
    const payload = { ...personDetail }
    if (overwriteOverview) payload.Overview = overview
    if (allowRename) payload.Name = String(actor.name || '').trim()

    await api.updatePersonMetadata(personId, payload, { signal })

    let imageWarning = ''
    let imageSyncedAt = actor.jellyfin_image_synced_at || null

    if (includeImage) {
      if (imageResult.ok) {
        progress({ actorId: actor.id, actorName: actor.name, stage: 'uploading-image', message: '배우 이미지 업로드 중' })
        try {
          await api.uploadPrimaryImage(personId, {
            contentType: imageResult.contentType,
            buffer: imageResult.buffer,
          }, { signal })
          imageSyncedAt = nowIso
        } catch (error) {
          imageWarning = `이미지 업로드 실패: ${error.message || String(error)}`
        }
      } else if (imageResult.reason === 'IMAGE_MISSING') {
        imageWarning = imageResult.message
      } else if (imageResult.reason === 'UNSUPPORTED_IMAGE') {
        imageWarning = imageResult.message
      }
    }

    progress({ actorId: actor.id, actorName: actor.name, stage: 'saving', message: '동기화 결과 저장 중' })

    const finalStatus = imageWarning && imageResult.reason === 'IMAGE_MISSING'
      ? SYNC_STATUS.IMAGE_MISSING
      : SYNC_STATUS.SYNCED

    updateActorSyncState(db, actor.id, {
      jellyfin_person_id: personId,
      jellyfin_sync_status: finalStatus,
      jellyfin_sync_hash: syncHash,
      jellyfin_synced_at: nowIso,
      jellyfin_sync_error: imageWarning || '',
      jellyfin_matched_name: String(personDetail?.Name || person?.Name || ''),
      jellyfin_match_method: match.method,
      jellyfin_image_synced_at: imageSyncedAt,
    })

    progress({ actorId: actor.id, actorName: actor.name, stage: 'completed', message: '배우 동기화 완료' })

    return {
      success: true,
      actorId: actor.id,
      actorName: actor.name,
      personId,
      personName: String(personDetail?.Name || person?.Name || ''),
      syncHash,
      overviewUpdated: true,
      imageUploaded: Boolean(imageResult.ok && !imageWarning),
      warning: imageWarning || null,
      status: finalStatus,
    }
  } catch (error) {
    const isCancelled = signal?.aborted || String(error?.message || '').includes('취소')
    updateActorSyncState(db, actor.id, {
      jellyfin_sync_status: isCancelled ? SYNC_STATUS.NOT_SYNCED : SYNC_STATUS.FAILED,
      jellyfin_sync_error: String(error?.message || error),
    })

    if (isCancelled) {
      return { success: false, cancelled: true, actorId: actor.id, actorName: actor.name }
    }

    return {
      success: false,
      actorId: actor.id,
      actorName: actor.name,
      status: SYNC_STATUS.FAILED,
      error: String(error?.message || error),
    }
  }
}

async function syncActorsBatch(db, api, actorIds, options = {}) {
  ensureSyncColumns(db)

  const ids = Array.isArray(actorIds)
    ? actorIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : []
  if (ids.length === 0) {
    return { success: true, total: 0, processed: 0, results: [] }
  }

  const placeholders = ids.map(() => '?').join(',')
  const actors = db.prepare(`SELECT * FROM actors WHERE id IN (${placeholders}) ORDER BY name ASC`).all(...ids)

  const total = actors.length
  const results = []
  let processed = 0

  for (const actor of actors) {
    if (options.signal?.aborted) break

    const result = await syncActor(db, api, actor, {
      ...options,
      onProgress: (payload) => {
        options.onProgress?.({
          processed,
          total,
          ...payload,
        })
      },
    })
    processed += 1
    results.push(result)
  }

  return {
    success: true,
    total,
    processed,
    cancelled: Boolean(options.signal?.aborted),
    results,
  }
}

function linkActorToPerson(db, actorId, personId, personName = '') {
  ensureSyncColumns(db)
  updateActorSyncState(db, actorId, {
    jellyfin_person_id: String(personId || '').trim(),
    jellyfin_matched_name: String(personName || '').trim(),
    jellyfin_match_method: 'manual_link',
    jellyfin_sync_status: SYNC_STATUS.NOT_SYNCED,
    jellyfin_sync_error: '',
  })
  return db.prepare('SELECT * FROM actors WHERE id = ?').get(actorId)
}

function unlinkActorPerson(db, actorId) {
  ensureSyncColumns(db)
  updateActorSyncState(db, actorId, {
    jellyfin_person_id: '',
    jellyfin_matched_name: '',
    jellyfin_match_method: 'manual_unlink',
    jellyfin_sync_status: SYNC_STATUS.NOT_SYNCED,
    jellyfin_sync_hash: '',
    jellyfin_sync_error: '',
    jellyfin_synced_at: null,
    jellyfin_image_synced_at: null,
  })
  return db.prepare('SELECT * FROM actors WHERE id = ?').get(actorId)
}

async function getUnsyncedActorIds(db, options = {}) {
  ensureSyncColumns(db)

  const rows = db.prepare(`
    SELECT id, is_archived, jellyfin_sync_status
    FROM actors
    ORDER BY name ASC
  `).all()

  return rows
    .filter((row) => options.includeArchived === true || Number(row.is_archived || 0) === 0)
    .filter((row) => row.jellyfin_sync_status !== SYNC_STATUS.SYNCED)
    .map((row) => row.id)
}

async function getChangedActorIds(db, options = {}) {
  ensureSyncColumns(db)

  const rows = db.prepare(`
    SELECT *
    FROM actors
    ORDER BY name ASC
  `).all()

  const result = []
  for (const row of rows) {
    if (options.includeArchived !== true && Number(row.is_archived || 0) === 1) continue
    const status = await detectChangedStatus(row, options)
    if (status === SYNC_STATUS.CHANGED) result.push(row.id)
  }
  return result
}

module.exports = {
  JELLYFIN_ACTOR_SYNC_VERSION,
  SYNC_STATUS,
  normalizeMatchText,
  parseFlexibleList,
  buildJellyfinPersonOverview,
  resolveActorImage,
  computeActorSyncHash,
  findPersonCandidates,
  listActorSyncItems,
  syncActor,
  syncActorsBatch,
  linkActorToPerson,
  unlinkActorPerson,
  getUnsyncedActorIds,
  getChangedActorIds,
}
