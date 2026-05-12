/**
 * src/pages/Actors/index.jsx
 * 배우 탐색 허브 — 검색·필터·통계·상세 패널 통합
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from 'antd'
import ActorToolbar     from '../../components/actors/ActorToolbar.jsx'
import ActorList        from '../../components/actors/ActorList.jsx'
import ActorDetailPanel from '../../components/actors/ActorDetailPanel.jsx'

const DEFAULT_FILTERS = {
  minRating:     0,
  agency:        '',
  tag:           '',
  minVideoCount: 0,
  sortBy:        'name_asc',
}

export default function ActorsPage() {
  const [actors,       setActors]       = useState([])
  const [loading,      setLoading]      = useState(false)
  const [query,        setQuery]        = useState('')
  const [filters,      setFilters]      = useState(DEFAULT_FILTERS)
  const [showArchived, setShowArchived] = useState(false)
  const [syncStatus,   setSyncStatus]   = useState(null)

  const [selectedActor, setSelectedActor] = useState(null)
  const [actorDetail,   setActorDetail]   = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [isCreating,    setIsCreating]    = useState(false)

  // 디바운스 타이머
  const debounceRef = useRef(null)

  // ── 배우 목록 조회 ──────────────────────────────────────────
  const fetchActors = useCallback(async (q, flt, arch) => {
    setLoading(true)
    try {
      const result = await window.api.getActors({
        query:         q.trim() || undefined,
        archived:      arch ? undefined : false,
        minRating:     flt.minRating  || undefined,
        agency:        flt.agency     || undefined,
        tag:           flt.tag        || undefined,
        minVideoCount: flt.minVideoCount || undefined,
        sortBy:        flt.sortBy,
      })
      setActors(result)
    } catch (e) {
      console.error('배우 목록 조회 실패:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // 검색어/필터 변경 시 디바운스 조회
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchActors(query, filters, showArchived)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, filters, showArchived, fetchActors])

  // ── 필터 패치 ───────────────────────────────────────────────
  const handleFiltersChange = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  // ── 배우 선택 → 상세 조회 ───────────────────────────────────
  const handleSelect = useCallback(async (actor) => {
    setIsCreating(false)
    setSelectedActor(actor)
    setActorDetail(null)
    setDetailLoading(true)
    try {
      const detail = await window.api.getActorDetail(actor.id)
      setActorDetail(detail)
    } catch (e) {
      console.error('배우 상세 조회 실패:', e)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // ── 신규 배우 생성 모드 ─────────────────────────────────────
  const handleNewActor = () => {
    setSelectedActor(null)
    setActorDetail(null)
    setIsCreating(true)
  }

  // ── 저장/생성 완료 ──────────────────────────────────────────
  const handleSaved = async (savedActor) => {
    await fetchActors(query, filters, showArchived)
    setIsCreating(false)
    setSelectedActor(savedActor)
    setDetailLoading(true)
    try {
      const detail = await window.api.getActorDetail(savedActor.id)
      setActorDetail(detail)
    } catch {
      setActorDetail({ actor: savedActor, videos: [], stats: {}, topVideos: [] })
    } finally {
      setDetailLoading(false)
    }
  }

  // ── 아카이브/복구 완료 ──────────────────────────────────────
  const handleArchived = async (updated) => {
    await fetchActors(query, filters, showArchived)
    setSelectedActor(updated)
    setActorDetail((prev) =>
      prev ? { ...prev, actor: updated } : { actor: updated, videos: [], stats: {}, topVideos: [] }
    )
  }

  // ── 배우-영상 동기화 ─────────────────────────────────────────
  const handleSync = async () => {
    setSyncStatus('동기화 중…')
    try {
      const result = await window.api.syncActorVideos()
      setSyncStatus(`완료 — ${result.synced}개 영상 동기화됨`)
      await fetchActors(query, filters, showArchived)
      if (selectedActor) {
        const detail = await window.api.getActorDetail(selectedActor.id)
        setActorDetail(detail)
      }
    } catch (e) {
      setSyncStatus('동기화 실패: ' + e.message)
    }
    setTimeout(() => setSyncStatus(null), 4000)
  }
  // ── 고아 배우 정리 ───────────────────────────────────────────
  const handleCleanupOrphans = () => {
    Modal.confirm({
      title:   '고아 배우 정리',
      content: '어떤 영상에도 연결되지 않은 배우를 삭제합니다.\n실제 영상 기록은 삭제되지 않습니다.',
      okText:     '정리',
      cancelText: '취소',
      onOk: async () => {
        try {
          const result = await window.api.cleanupOrphanActors()
          if (result.deletedCount === 0) {
            setSyncStatus('고아 배우가 없습니다.')
          } else {
            const names = result.deletedActors.slice(0, 10).join(', ')
            const extra = result.deletedActors.length > 10 ? ` 외 ${result.deletedActors.length - 10}명` : ''
            setSyncStatus(`고아 배우 ${result.deletedCount}명 정리 완료: ${names}${extra}`)
            await fetchActors(query, filters, showArchived)
          }
        } catch (e) {
          setSyncStatus('고아 배우 정리 실패: ' + e.message)
        }
        setTimeout(() => setSyncStatus(null), 6000)
      },
    })
  }
  const showPanel   = isCreating || selectedActor !== null
  const panelActor  = isCreating ? null : (actorDetail?.actor ?? selectedActor)
  const panelVideos = actorDetail?.videos   ?? []
  const panelStats  = actorDetail?.stats    ?? {}
  const panelTop    = actorDetail?.topVideos ?? []

  return (
    <div className="actors-page">
      <ActorToolbar
        query={query}
        onQueryChange={setQuery}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        showArchived={showArchived}
        onToggleArchived={setShowArchived}
        onNewActor={handleNewActor}
        onSync={handleSync}
        onCleanupOrphans={handleCleanupOrphans}
      />

      {syncStatus && (
        <div className="actors-page__sync-status">{syncStatus}</div>
      )}

      <div className="actors-page__body">
        {/* 좌측: 배우 리스트 */}
        <div className="actors-page__list-wrap">
          <div className="actors-page__list-header">
            <span className="actors-page__list-count">
              {actors.length}명
            </span>
          </div>
          <ActorList
            actors={actors}
            selectedId={selectedActor?.id ?? null}
            onSelect={handleSelect}
            loading={loading}
          />
        </div>

        {/* 우측: 상세 패널 */}
        <div className="actors-page__detail-wrap">
          {showPanel ? (
            detailLoading ? (
              <div className="actors-page__detail-loading">불러오는 중…</div>
            ) : (
              <ActorDetailPanel
                key={isCreating ? 'new' : selectedActor?.id}
                actor={panelActor}
                videos={panelVideos}
                stats={panelStats}
                topVideos={panelTop}
                onSaved={handleSaved}
                onArchived={handleArchived}
              />
            )
          ) : (
            <div className="actors-page__detail-empty">
              <div className="actors-page__detail-empty-icon">👈</div>
              <p>배우를 선택하면 상세 정보가 표시됩니다.</p>
              <p className="actors-page__detail-empty-hint">
                이름·별칭·태그·소속사로 검색 가능
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
