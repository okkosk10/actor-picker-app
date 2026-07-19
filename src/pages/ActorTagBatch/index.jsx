/**
 * src/pages/ActorTagBatch/index.jsx
 * 배우 태그 일괄 관리 화면
 *
 * - 기존 배우 280명 기준으로 목록 표시
 * - 다중 선택 후 태그 일괄 추가/삭제
 * - CSV/JSON export/import
 * - 저장 전 미리보기 + DB 백업
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import TagBadge, { getActorTagBadgeVariant } from '../../components/TagBadge.jsx'
import './ActorTagBatch.css'

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
}

function splitTags(value) {
  const seen = new Set()
  const tags = []
  String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .forEach((tag) => {
      if (seen.has(tag)) return
      seen.add(tag)
      tags.push(tag)
    })
  return tags
}

function joinTags(tags) {
  return splitTags(tags).join(', ')
}

function diffTags(before, after) {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return {
    added: after.filter((tag) => !beforeSet.has(tag)),
    removed: before.filter((tag) => !afterSet.has(tag)),
  }
}

function escapeCsv(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function toCsv(rows) {
  const header = ['id', 'name', 'aliases', 'tags', 'memo']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      row.id ?? '',
      row.name ?? '',
      row.aliases ?? '',
      row.tags ?? '',
      row.memo ?? '',
    ].map(escapeCsv).join(','))
  }
  return lines.join('\n')
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }

    if (ch === ',') {
      row.push(cell)
      cell = ''
      continue
    }

    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    if (ch === '\r') continue
    cell += ch
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  if (rows.length === 0) return []

  const [header, ...dataRows] = rows
  const headerMap = header.map((col) => normalizeText(col))
  return dataRows
    .filter((cells) => cells.some((cellValue) => String(cellValue || '').trim() !== ''))
    .map((cells) => {
      const record = {}
      headerMap.forEach((key, index) => {
        record[key] = cells[index] ?? ''
      })
      return record
    })
}

function loadFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'))
    reader.readAsText(file, 'utf-8')
  })
}

function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function actorToExportRow(actor, draftTags) {
  return {
    id: actor.id,
    name: actor.name || '',
    aliases: actor.aliases || '',
    tags: joinTags(draftTags ?? actor.tags ?? ''),
    memo: actor.memo || '',
  }
}

function renderSuggestedTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '—'
  return (
    <span className="actor-batch-auto-tags">
      {tags.map((tag) => (
        <TagBadge
          key={tag}
          label={tag}
          variant={getActorTagBadgeVariant(tag)}
          className="actor-batch-auto-tag"
        />
      ))}
    </span>
  )
}

function formatAvdbsRatings(ratings) {
  if (!ratings || typeof ratings !== 'object') return []
  return Object.entries(ratings)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([label, value]) => `${label} ${Number(value).toFixed(Number.isInteger(value) ? 0 : 1)}`)
}

function toActorRatingFromAvdbs(averageRating) {
  const raw = Number(averageRating)
  if (!Number.isFinite(raw)) return 0
  const clamped = Math.max(0, Math.min(10, raw))
  return Number(clamped.toFixed(1))
}

function formatActorRatingStars(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '미적용'
  return `${n.toFixed(1)} / 10`
}

function deriveAvdbsSuggestedTags(detail, searchResult = null) {
  const tags = []
  const heightText = detail?.profile?.height || ''
  const heightMatch = heightText.match(/(\d{3})\s*cm/i)
  const height = heightMatch ? Number(heightMatch[1]) : null
  if (height != null) {
    if (height <= 155) tags.push('단신')
    else if (height >= 165) tags.push('장신')
  }

  const cupText = String(detail?.profile?.cup || '').toUpperCase()
  const cupLetter = cupText.match(/([A-Z])/i)?.[1]?.toUpperCase() || ''
  if (cupLetter) {
    if (['A', 'B', 'C'].includes(cupLetter)) tags.push('빈유')
    else if (['D', 'E', 'F'].includes(cupLetter)) tags.push('거유')
    else if (['G', 'H', 'I', 'J', 'K'].includes(cupLetter)) tags.push('폭유')
  }

  const joined = [detail?.rawText || '', detail?.profile?.intro || '', detail?.ogDescription || '', searchResult?.aliasText || '', detail?.title || ''].join(' ')
  if (/질내사\s*(?:정|[oO0ㅇ○◯●◎Ｏ])/.test(joined)) tags.push('질사해금')

  return Array.from(new Set(tags))
}

function findActorForRecord(record, actorsById, actorsByName, actorsByAlias) {
  const actorId = Number(record.actorId ?? record.id)
  if (Number.isFinite(actorId) && actorId > 0 && actorsById.has(actorId)) {
    return actorsById.get(actorId)
  }

  const name = String(record.name || record.actorName || record.actor_name || '').trim()
  if (!name) return null

  const normalized = normalizeText(name)
  return actorsByName.get(normalized) || actorsByAlias.get(normalized) || null
}

export default function ActorTagBatchPage() {
  const [actors, setActors] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [draftTagsById, setDraftTagsById] = useState({})
  const [bulkAddText, setBulkAddText] = useState('')
  const [bulkRemoveText, setBulkRemoveText] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [avdbsLoading, setAvdbsLoading] = useState(false)
  const [avdbsResults, setAvdbsResults] = useState([])
  const [avdbsSelected, setAvdbsSelected] = useState(null)
  const [avdbsDetail, setAvdbsDetail] = useState(null)
  const [activeActorId, setActiveActorId] = useState(null)
  const importInputRef = useRef(null)
  const avdbsSearchCacheRef = useRef(new Map())
  const avdbsDetailCacheRef = useRef(new Map())

  const loadActors = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api.getActors({
        query: query.trim() || undefined,
        archived: showArchived ? 'all' : false,
        sortBy: 'name_asc',
      })
      const nextActors = Array.isArray(result) ? result : []
      setActors(nextActors)

      const nextDrafts = {}
      for (const actor of nextActors) {
        nextDrafts[actor.id] = joinTags(actor.tags || '')
      }
      setDraftTagsById(nextDrafts)
      setSelectedIds(new Set())
      setActiveActorId((prev) => (nextActors.some((actor) => actor.id === prev) ? prev : null))
      setStatus(`배우 ${nextActors.length}명 로드 완료`)
    } catch (err) {
      setError(err.message || '배우 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [query, showArchived])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadActors()
    }, 250)
    return () => clearTimeout(timer)
  }, [loadActors])

  const actorsById = useMemo(() => {
    const map = new Map()
    actors.forEach((actor) => map.set(actor.id, actor))
    return map
  }, [actors])

  const actorsByName = useMemo(() => {
    const map = new Map()
    actors.forEach((actor) => {
      map.set(normalizeText(actor.name), actor)
    })
    return map
  }, [actors])

  const actorsByAlias = useMemo(() => {
    const map = new Map()
    actors.forEach((actor) => {
      String(actor.aliases || '')
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean)
        .forEach((alias) => {
          map.set(normalizeText(alias), actor)
        })
    })
    return map
  }, [actors])

  const selectedActors = useMemo(
    () => actors.filter((actor) => selectedIds.has(actor.id)),
    [actors, selectedIds],
  )

  const activeActor = useMemo(
    () => actorsById.get(activeActorId) || null,
    [actorsById, activeActorId],
  )

  const pendingChanges = useMemo(() => {
    return actors
      .map((actor) => {
        const before = splitTags(actor.tags || '')
        const after = splitTags(draftTagsById[actor.id] ?? actor.tags ?? '')
        const beforeText = before.join(', ')
        const afterText = after.join(', ')
        if (beforeText === afterText) return null
        const { added, removed } = diffTags(before, after)
        return {
          actorId: actor.id,
          name: actor.name,
          beforeText,
          afterText,
          added,
          removed,
        }
      })
      .filter(Boolean)
  }, [actors, draftTagsById])

  const selectedCount = selectedIds.size
  const pendingCount = pendingChanges.length

  const toggleSelected = useCallback((actorId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(actorId)) next.delete(actorId)
      else next.add(actorId)
      return next
    })
  }, [])

  const handleSelectAll = useCallback((checked) => {
    setSelectedIds(checked ? new Set(actors.map((actor) => actor.id)) : new Set())
  }, [actors])

  const updateDraftTags = useCallback((actorId, value) => {
    setDraftTagsById((prev) => ({ ...prev, [actorId]: joinTags(value) }))
  }, [])

  const applyBulkTransform = useCallback((mode) => {
    const tags = mode === 'add' ? splitTags(bulkAddText) : splitTags(bulkRemoveText)
    if (tags.length === 0) {
      setError(mode === 'add' ? '추가할 태그를 입력하세요' : '삭제할 태그를 입력하세요')
      return
    }
    if (selectedCount === 0) {
      setError('먼저 배우를 선택하세요')
      return
    }

    setDraftTagsById((prev) => {
      const next = { ...prev }
      for (const actor of selectedActors) {
        const current = splitTags(next[actor.id] ?? actor.tags ?? '')
        const currentSet = new Set(current)

        if (mode === 'add') {
          for (const tag of tags) currentSet.add(tag)
        } else {
          for (const tag of tags) currentSet.delete(tag)
        }

        next[actor.id] = joinTags(Array.from(currentSet))
      }
      return next
    })

    setStatus(mode === 'add' ? `선택한 ${selectedCount}명에 태그 후보를 추가했습니다` : `선택한 ${selectedCount}명에서 태그 후보를 제거했습니다`)
    setError('')
  }, [bulkAddText, bulkRemoveText, selectedActors, selectedCount])

  const handleNormalizeSelection = useCallback(() => {
    if (selectedCount === 0) {
      setError('먼저 배우를 선택하세요')
      return
    }

    setDraftTagsById((prev) => {
      const next = { ...prev }
      for (const actor of selectedActors) {
        next[actor.id] = joinTags(next[actor.id] ?? actor.tags ?? '')
      }
      return next
    })

    setStatus(`선택한 ${selectedCount}명의 태그를 정규화했습니다`)
    setError('')
  }, [selectedActors, selectedCount])

  const handleExport = useCallback((format, selectedOnly = false) => {
    const source = selectedOnly && selectedIds.size > 0
      ? actors.filter((actor) => selectedIds.has(actor.id))
      : actors

    const rows = source.map((actor) => actorToExportRow(actor, draftTagsById[actor.id]))
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

    if (format === 'json') {
      downloadText(`actor-tags-${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json;charset=utf-8')
    } else {
      downloadText(`actor-tags-${stamp}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
    }

    setStatus(`${selectedOnly && selectedIds.size > 0 ? '선택한' : '전체'} 배우 ${rows.length}명 내보내기 완료`)
  }, [actors, draftTagsById, selectedIds])

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click()
  }, [])

  const handleImportFile = useCallback(async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const text = await loadFileText(file)
      let records = []
      const trimmed = text.trim()

      if (file.name.toLowerCase().endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) {
          records = parsed
        } else if (Array.isArray(parsed?.actors)) {
          records = parsed.actors
        } else {
          records = [parsed]
        }
      } else {
        records = parseCsv(text)
      }

      const nextDrafts = { ...draftTagsById }
      let matched = 0
      let skipped = 0

      for (const record of records) {
        const actor = findActorForRecord(record, actorsById, actorsByName, actorsByAlias)
        if (!actor) {
          skipped += 1
          continue
        }

        const tags = record.tags ?? record.actorTags ?? record.actor_tags ?? ''
        nextDrafts[actor.id] = joinTags(tags)
        matched += 1
      }

      setDraftTagsById(nextDrafts)
      setStatus(`가져오기 완료: ${matched}명 반영, ${skipped}명 건너뜀`)
      setError('')
    } catch (err) {
      setError(`가져오기 실패: ${err.message || '알 수 없는 오류'}`)
    }
  }, [actorsByAlias, actorsById, actorsByName, draftTagsById])

  const handleSave = useCallback(async () => {
    if (pendingChanges.length === 0) {
      setStatus('반영할 변경사항이 없습니다')
      return
    }

    const confirmed = window.confirm(`변경사항 ${pendingChanges.length}건을 저장할까요? 저장 전에 DB 백업을 만듭니다.`)
    if (!confirmed) return

    setSaving(true)
    setError('')
    try {
      const backupResult = await window.api.backupDatabase()
      const updates = pendingChanges.map((change) => ({
        actorId: change.actorId,
        tags: draftTagsById[change.actorId] ?? '',
      }))

      const result = await window.api.bulkUpdateActorTags({
        updates,
        changeSource: 'manual',
        sourceDetail: `bulk-tag-screen:${updates.length}`,
      })

      if (!result?.success) {
        throw new Error('배치 저장 실패')
      }

      const updatesById = new Map(
        updates.map((item) => [item.actorId, joinTags(item.tags || '')]),
      )

      setActors((prev) => prev.map((actor) => {
        if (!updatesById.has(actor.id)) return actor
        return {
          ...actor,
          tags: updatesById.get(actor.id),
          updated_at: new Date().toISOString(),
        }
      }))

      setDraftTagsById((prev) => {
        const next = { ...prev }
        for (const [actorId, tags] of updatesById.entries()) {
          next[actorId] = tags
        }
        return next
      })

      setStatus(`저장 완료: ${result.updatedCount}건 반영, 백업 ${backupResult.backupPath}`)
      message.success('배우 태그가 저장됐습니다')
    } catch (err) {
      setError(err.message || '저장 실패')
      message.error(err.message || '저장 실패')
    } finally {
      setSaving(false)
    }
  }, [draftTagsById, pendingChanges])

  const handleReset = useCallback(() => {
    const nextDrafts = {}
    for (const actor of actors) {
      nextDrafts[actor.id] = joinTags(actor.tags || '')
    }
    setDraftTagsById(nextDrafts)
    setSelectedIds(new Set())
    setStatus('변경사항을 초기화했습니다')
    setError('')
  }, [actors])

  const searchAvdbsByActiveActor = useCallback(async () => {
    const actorName = String(activeActor?.name || '').trim()
    if (!actorName) {
      setError('먼저 조회할 배우를 선택하세요')
      return
    }

    const cacheKey = `v2:${normalizeText(actorName)}`
    const cached = avdbsSearchCacheRef.current.get(cacheKey)
    if (cached) {
      setAvdbsResults(cached.results)
      setAvdbsSelected(cached.selected || null)
      if (cached.selected?.actorIdx) {
        const detailCached = avdbsDetailCacheRef.current.get(cached.selected.actorIdx)
        setAvdbsDetail(detailCached || null)
      } else {
        setAvdbsDetail(null)
      }
      setStatus(`웹 검색 결과 ${cached.results.length}건 (캐시)`)
      setError('')
      return
    }

    setAvdbsLoading(true)
    setError('')
    try {
      const results = await window.api.searchAvdbsActors(actorName)
      setAvdbsResults(results || [])
      const first = results?.[0] || null
      setAvdbsSelected(first)
      if (results?.[0]?.actorIdx) {
        let detail = avdbsDetailCacheRef.current.get(results[0].actorIdx)
        if (!detail) {
          detail = await window.api.getAvdbsActorDetail(results[0].actorIdx)
          avdbsDetailCacheRef.current.set(results[0].actorIdx, detail)
        }
        setAvdbsDetail(detail)
      } else {
        setAvdbsDetail(null)
      }

      avdbsSearchCacheRef.current.set(cacheKey, {
        results: results || [],
        selected: first,
      })

      setStatus(`웹 검색 결과 ${results?.length || 0}건`)
    } catch (err) {
      setError(`웹 검색 실패: ${err.message || '알 수 없는 오류'}`)
      setAvdbsResults([])
      setAvdbsSelected(null)
      setAvdbsDetail(null)
    } finally {
      setAvdbsLoading(false)
    }
  }, [activeActor?.name])

  const selectAvdbsResult = useCallback(async (result) => {
    setAvdbsSelected(result)
    setAvdbsDetail(null)
    if (!result?.actorIdx) return

    const detailCached = avdbsDetailCacheRef.current.get(result.actorIdx)
    if (detailCached) {
      setAvdbsDetail(detailCached)
      return
    }

    setAvdbsLoading(true)
    try {
      const detail = await window.api.getAvdbsActorDetail(result.actorIdx)
      setAvdbsDetail(detail)
      avdbsDetailCacheRef.current.set(result.actorIdx, detail)
    } catch (err) {
      setError(`웹 상세 조회 실패: ${err.message || '알 수 없는 오류'}`)
    } finally {
      setAvdbsLoading(false)
    }
  }, [])

  const handleSelectActorFromList = useCallback((actorId) => {
    setActiveActorId(actorId)
    setAvdbsResults([])
    setAvdbsSelected(null)
    setAvdbsDetail(null)
  }, [])

  const handleImportAvdbs = useCallback(async () => {
    const targetActor = activeActor || selectedActors[0] || null
    if (!targetActor) {
      setError('먼저 배우를 선택하세요')
      return
    }
    if (!avdbsSelected?.actorIdx) {
      setError('먼저 웹 검색 결과에서 배우를 선택하세요')
      return
    }

    setSaving(true)
    setError('')
    try {
      const freshDetail = await window.api.getAvdbsActorDetail(avdbsSelected.actorIdx)
      if (freshDetail) {
        setAvdbsDetail(freshDetail)
        avdbsDetailCacheRef.current.set(avdbsSelected.actorIdx, freshDetail)
      }

      const res = await window.api.importAvdbsActor({
        actorId: targetActor.id,
        externalId: avdbsSelected.actorIdx,
        externalName: avdbsSelected.aliasText || avdbsSelected.name || '',
        detail: freshDetail || avdbsDetail || undefined,
      })

      if (!res?.success) {
        throw new Error('웹 정보 가져오기 실패')
      }

      const actorId = targetActor.id
      if (res.actor) {
        setDraftTagsById((prev) => ({
          ...prev,
          [actorId]: joinTags(res.actor.tags || ''),
        }))
      }

      if (Number.isFinite(Number(res.appliedRating)) && Number(res.appliedRating) > 0) {
        message.success(`별점 자동 반영: ${formatActorRatingStars(res.appliedRating)}`)
      }

      if (Array.isArray(res.warnings) && res.warnings.length > 0) {
        message.warning(`일부 항목만 반영: ${res.warnings[0]}`)
      }

      setStatus(`웹 정보 반영 완료: ${res.actor?.name || targetActor.name}`)
      await loadActors()
      message.success('웹 정보를 가져왔습니다')
    } catch (err) {
      setError(err.message || '웹 정보 가져오기 실패')
      message.error(err.message || '웹 정보 가져오기 실패')
    } finally {
      setSaving(false)
    }
  }, [activeActor, avdbsDetail, avdbsSelected, loadActors, selectedActors])

  return (
    <div className="actor-batch-page">
      <div className="actor-batch-header">
        <div>
          <h2 className="actor-batch-title">배우 태그 일괄 관리</h2>
          <p className="actor-batch-subtitle">기존 배우 ID를 기준으로 태그 후보를 빠르게 정리하고 한 번에 저장합니다.</p>
        </div>

        <div className="actor-batch-summary">
          <div className="actor-batch-summary__item">
            <span className="actor-batch-summary__label">배우</span>
            <strong>{actors.length}</strong>
          </div>
          <div className="actor-batch-summary__item">
            <span className="actor-batch-summary__label">선택</span>
            <strong>{selectedCount}</strong>
          </div>
          <div className="actor-batch-summary__item">
            <span className="actor-batch-summary__label">변경</span>
            <strong>{pendingCount}</strong>
          </div>
        </div>
      </div>

      <div className="actor-batch-toolbar">
        <input
          className="actor-batch-search"
          type="search"
          placeholder="이름·별칭·태그·메모 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <label className="actor-batch-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          아카이브 포함
        </label>

        <label className="actor-batch-toggle">
          <input
            type="checkbox"
            checked={selectedCount > 0 && selectedCount === actors.length && actors.length > 0}
            onChange={(e) => handleSelectAll(e.target.checked)}
          />
          전체 선택
        </label>

        <button type="button" className="btn-secondary" onClick={loadActors} disabled={loading}>
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
        <button type="button" className="btn-secondary" onClick={handleImportClick}>JSON/CSV 가져오기</button>
        <button type="button" className="btn-secondary" onClick={() => handleExport('json', false)}>JSON 내보내기</button>
        <button type="button" className="btn-secondary" onClick={() => handleExport('csv', false)}>CSV 내보내기</button>
        <button type="button" className="btn-secondary" onClick={() => handleExport('json', true)} disabled={selectedCount === 0}>선택 JSON</button>
        <button type="button" className="btn-secondary" onClick={() => handleExport('csv', true)} disabled={selectedCount === 0}>선택 CSV</button>
        <button type="button" className="btn-danger" onClick={handleReset} disabled={pendingCount === 0}>변경 초기화</button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || pendingCount === 0}>
          {saving ? '저장 중…' : `DB 반영 (${pendingCount})`}
        </button>
      </div>

      <div className="actor-batch-actions">
        <div className="actor-batch-action-group">
          <label>
            추가 태그
            <input
              className="actor-batch-input"
              type="text"
              value={bulkAddText}
              onChange={(e) => setBulkAddText(e.target.value)}
              placeholder="단신, 질사해금"
            />
          </label>
          <button type="button" className="btn-primary" onClick={() => applyBulkTransform('add')} disabled={selectedCount === 0}>
            선택 배우에 추가
          </button>
        </div>

        <div className="actor-batch-action-group">
          <label>
            삭제 태그
            <input
              className="actor-batch-input"
              type="text"
              value={bulkRemoveText}
              onChange={(e) => setBulkRemoveText(e.target.value)}
              placeholder="귀여움, 청순"
            />
          </label>
          <button type="button" className="btn-secondary" onClick={() => applyBulkTransform('remove')} disabled={selectedCount === 0}>
            선택 배우에서 삭제
          </button>
        </div>

        <div className="actor-batch-action-group actor-batch-action-group--plain">
          <button type="button" className="btn-secondary" onClick={handleNormalizeSelection} disabled={selectedCount === 0}>
            선택 태그 정규화
          </button>
          <button type="button" className="btn-secondary" onClick={() => importInputRef.current?.click()}>
            파일 선택 다시 열기
          </button>
        </div>
      </div>

      {error && <div className="actor-batch-banner actor-batch-banner--error">{error}</div>}
      {status && <div className="actor-batch-banner actor-batch-banner--ok">{status}</div>}

      <div className="actor-batch-layout">
        <div className="actor-batch-table-panel">
          <div className="actor-batch-table-wrap">
            <table className="actor-batch-table">
              <thead>
                <tr>
                  <th className="actor-batch-col-check">
                    <input
                      type="checkbox"
                      checked={selectedCount > 0 && selectedCount === actors.length && actors.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th>ID</th>
                  <th>배우명</th>
                  <th>별칭</th>
                  <th>기존 태그</th>
                  <th>편집 태그</th>
                </tr>
              </thead>
              <tbody>
                {actors.map((actor) => {
                  const isSelected = selectedIds.has(actor.id)
                  const currentTags = draftTagsById[actor.id] ?? actor.tags ?? ''
                  const originalTags = joinTags(actor.tags || '')
                  const changed = currentTags !== originalTags

                  return (
                    <tr
                      key={actor.id}
                      className={`${changed ? 'actor-batch-row--changed' : ''} ${activeActorId === actor.id ? 'actor-batch-row--active' : ''}`}
                      onClick={() => handleSelectActorFromList(actor.id)}
                    >
                      <td className="actor-batch-col-check">
                        <input
                          type="checkbox"
                          onClick={(e) => e.stopPropagation()}
                          checked={isSelected}
                          onChange={() => toggleSelected(actor.id)}
                        />
                      </td>
                      <td className="actor-batch-col-id">{actor.id}</td>
                      <td>
                        <div className="actor-batch-name">
                          <strong>{actor.name}</strong>
                          {actor.is_archived === 1 && <span className="actor-batch-badge">archived</span>}
                        </div>
                      </td>
                      <td className="actor-batch-col-aliases">{actor.aliases || '—'}</td>
                      <td className="actor-batch-col-tags">
                        <span title={originalTags || '태그 없음'}>{originalTags || '—'}</span>
                      </td>
                      <td>
                        <input
                          className="actor-batch-tag-input"
                          type="text"
                          value={currentTags}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateDraftTags(actor.id, e.target.value)}
                          placeholder="태그1, 태그2"
                        />
                      </td>
                    </tr>
                  )
                })}

                {!loading && actors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="actor-batch-empty">배우 데이터가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="actor-batch-preview-panel">
          <div className="actor-batch-preview-card">
            <h3>변경 미리보기</h3>
            <p className="actor-batch-preview-hint">저장되기 전에 어떤 태그가 추가/삭제되는지 확인합니다.</p>

            {pendingChanges.length === 0 ? (
              <div className="actor-batch-preview-empty">변경사항이 없습니다.</div>
            ) : (
              <div className="actor-batch-preview-list">
                {pendingChanges.slice(0, 40).map((change) => (
                  <div key={change.actorId} className="actor-batch-preview-item">
                    <div className="actor-batch-preview-name">{change.name}</div>
                    <div className="actor-batch-preview-line">
                      <span className="actor-batch-preview-label">추가</span>
                      <span className="actor-batch-preview-tags">{change.added.length > 0 ? change.added.join(', ') : '없음'}</span>
                    </div>
                    <div className="actor-batch-preview-line">
                      <span className="actor-batch-preview-label actor-batch-preview-label--remove">삭제</span>
                      <span className="actor-batch-preview-tags">{change.removed.length > 0 ? change.removed.join(', ') : '없음'}</span>
                    </div>
                    <div className="actor-batch-preview-line actor-batch-preview-line--compact">
                      <span className="actor-batch-preview-tags actor-batch-preview-tags--before">{change.beforeText || '—'}</span>
                      <span className="actor-batch-preview-arrow">→</span>
                      <span className="actor-batch-preview-tags actor-batch-preview-tags--after">{change.afterText || '—'}</span>
                    </div>
                  </div>
                ))}
                {pendingChanges.length > 40 && (
                  <div className="actor-batch-preview-more">외 {pendingChanges.length - 40}건</div>
                )}
              </div>
            )}
          </div>

          <div className="actor-batch-preview-card">
            <h3>선택 배우</h3>
            <div className="actor-batch-selected-list">
              {selectedActors.length === 0 ? (
                <div className="actor-batch-preview-empty">선택된 배우가 없습니다.</div>
              ) : (
                selectedActors.map((actor) => (
                  <div key={actor.id} className="actor-batch-selected-item">
                    <strong>{actor.name}</strong>
                    <span>{joinTags(draftTagsById[actor.id] ?? actor.tags ?? '') || '태그 없음'}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="actor-batch-preview-card">
            <h3>웹 정보 가져오기</h3>
            <p className="actor-batch-preview-hint">
              배우 리스트에서 이름을 클릭한 뒤, 버튼을 눌러 해당 배우명으로 조회합니다.
              {activeActor ? ` 현재 대상: ${activeActor.name}` : ' 아직 선택된 배우가 없습니다.'}
            </p>

            <button
              type="button"
              className="btn-secondary"
              onClick={searchAvdbsByActiveActor}
              disabled={avdbsLoading || !activeActor}
            >
              {avdbsLoading ? '조회 중…' : '선택 배우명으로 웹 조회'}
            </button>

            <div className="actor-batch-avdbs-results">
              {!activeActor ? (
                <div className="actor-batch-preview-empty">왼쪽 목록에서 배우를 클릭하세요.</div>
              ) : avdbsResults.length === 0 ? (
                <div className="actor-batch-preview-empty">웹 조회 결과가 없습니다.</div>
              ) : (
                avdbsResults.map((result) => (
                  <button
                    key={result.actorIdx}
                    type="button"
                    className={`actor-batch-avdbs-result ${avdbsSelected?.actorIdx === result.actorIdx ? 'is-active' : ''}`}
                    onClick={() => selectAvdbsResult(result)}
                  >
                    <div className="actor-batch-avdbs-result__name">{result.name}</div>
                    <div className="actor-batch-avdbs-result__alias">{result.aliasText || '—'}</div>
                    <div className="actor-batch-avdbs-result__meta">
                      <span>{result.agency || '소속사 없음'}</span>
                      <span>추천 {Number(result.recommendationCount || 0).toLocaleString()}회</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {avdbsDetail && (
              <div className="actor-batch-avdbs-detail">
                <div className="actor-batch-avdbs-detail__image-wrap">
                  {avdbsDetail.imageUrl ? (
                    <img src={avdbsDetail.imageUrl} alt={avdbsDetail.primaryName || avdbsDetail.title} className="actor-batch-avdbs-detail__image" />
                  ) : (
                    <div className="actor-batch-avdbs-detail__image actor-batch-avdbs-detail__image--empty">이미지 없음</div>
                  )}
                </div>

                <div className="actor-batch-avdbs-detail__fields">
                  <div><strong>이름</strong> {avdbsDetail.primaryName || '—'}</div>
                  <div><strong>별칭</strong> {(avdbsDetail.aliases || []).join(', ') || '—'}</div>
                  <div><strong>추천 태그</strong> {renderSuggestedTags(deriveAvdbsSuggestedTags(avdbsDetail, avdbsSelected))}</div>
                  <div><strong>웹 평점</strong> {avdbsDetail.avdbsAverageRating != null && Number.isFinite(Number(avdbsDetail.avdbsAverageRating)) ? Number(avdbsDetail.avdbsAverageRating).toFixed(1) : '—'}</div>
                  <div><strong>자동 평점(10점제)</strong> {formatActorRatingStars(toActorRatingFromAvdbs(avdbsDetail.avdbsAverageRating))}</div>
                  <div><strong>생년월일</strong> {avdbsDetail.profile?.birth || '—'}</div>
                  <div><strong>신장</strong> {avdbsDetail.profile?.height || '—'}</div>
                  <div><strong>신체사이즈</strong> {avdbsDetail.profile?.measurements || '—'}</div>
                  <div><strong>컵사이즈</strong> {avdbsDetail.profile?.cup || '—'}</div>
                  <div><strong>데뷔</strong> {avdbsDetail.profile?.debut || '—'}</div>
                  <div><strong>추천수</strong> {Number(avdbsSelected?.recommendationCount || 0).toLocaleString()}회</div>
                  <div className="actor-batch-avdbs-detail__field-wide"><strong>소개</strong> {avdbsDetail.profile?.intro || avdbsDetail.ogDescription || '—'}</div>
                </div>

                {formatAvdbsRatings(avdbsDetail.avdbsRatings).length > 0 && (
                  <div className="actor-batch-avdbs-scores">
                    {formatAvdbsRatings(avdbsDetail.avdbsRatings).map((item) => (
                      <span key={item} className="actor-batch-avdbs-score">{item}</span>
                    ))}
                  </div>
                )}

                <button type="button" className="btn-primary" onClick={handleImportAvdbs} disabled={saving || !activeActor || !avdbsSelected}>
                  선택 배우에 정보 가져오기
                </button>
              </div>
            )}
          </div>
        </aside>

      </div>

      <input
        ref={importInputRef}
        className="actor-batch-file-input"
        type="file"
        accept=".json,.csv,application/json,text/csv"
        onChange={handleImportFile}
      />
    </div>
  )
}