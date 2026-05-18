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

  // ── 새 배우 탭 ──────────────────────────────────────────────
  const [actorTabMode,   setActorTabMode]   = useState('all')   // 'all' | 'new'
  const [newActorCount,  setNewActorCount]  = useState(0)

  const [selectedActor, setSelectedActor] = useState(null)
  const [actorDetail,   setActorDetail]   = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [isCreating,    setIsCreating]    = useState(false)

  // 디바운스 타이머
  const debounceRef = useRef(null)

  // ── 새 배우 카운트 갱신 ─────────────────────────────────────
  const refreshNewActorCount = useCallback(async () => {
    try {
      const { count } = await window.api.getNewActorCount()
      setNewActorCount(count)
    } catch { /* 조용히 무시 */ }
  }, [])

  // ── 배우 목록 조회 ──────────────────────────────────────────
  const fetchActors = useCallback(async (q, flt, arch, tabMode) => {
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
        isNew:         tabMode === 'new' ? true : undefined,
      })
      setActors(result)
    } catch (e) {
      console.error('배우 목록 조회 실패:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // 검색어/필터/탭 변경 시 디바운스 조회
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchActors(query, filters, showArchived, actorTabMode)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, filters, showArchived, actorTabMode, fetchActors])

  // 초기 + 탭 마운트 시 새 배우 카운트 조회
  useEffect(() => {
    refreshNewActorCount()
  }, [refreshNewActorCount])

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
    await fetchActors(query, filters, showArchived, actorTabMode)
    await refreshNewActorCount()
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
    await fetchActors(query, filters, showArchived, actorTabMode)
    await refreshNewActorCount()
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
      await fetchActors(query, filters, showArchived, actorTabMode)
      await refreshNewActorCount()
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
            await fetchActors(query, filters, showArchived, actorTabMode)
            await refreshNewActorCount()
          }
        } catch (e) {
          setSyncStatus('고아 배우 정리 실패: ' + e.message)
        }
        setTimeout(() => setSyncStatus(null), 6000)
      },
    })
  }

  // ── 새 배우 "확인" 액션 (is_new 해제, 목록 유지) ─────────────
  const handleConfirmNew = useCallback(async (actorId) => {
    try {
      await window.api.clearActorNew(actorId)
      await fetchActors(query, filters, showArchived, actorTabMode)
      await refreshNewActorCount()
      // 상세 패널이 열려 있으면 업데이트
      if (selectedActor?.id === actorId) {
        const detail = await window.api.getActorDetail(actorId)
        setActorDetail(detail)
        setSelectedActor((prev) => prev ? { ...prev, is_new: 0 } : prev)
      }
    } catch (e) {
      setSyncStatus('확인 처리 실패: ' + e.message)
      setTimeout(() => setSyncStatus(null), 4000)
    }
  }, [query, filters, showArchived, actorTabMode, fetchActors, refreshNewActorCount, selectedActor])

  // ── 새 배우 "무시" 액션 (is_new 해제 + 아카이브) ─────────────
  const handleDismissNew = useCallback(async (actorId) => {
    try {
      await window.api.clearActorNew(actorId)
      await window.api.archiveActor(actorId)
      await fetchActors(query, filters, showArchived, actorTabMode)
      await refreshNewActorCount()
      if (selectedActor?.id === actorId) {
        setSelectedActor(null)
        setActorDetail(null)
      }
    } catch (e) {
      setSyncStatus('무시 처리 실패: ' + e.message)
      setTimeout(() => setSyncStatus(null), 4000)
    }
  }, [query, filters, showArchived, actorTabMode, fetchActors, refreshNewActorCount, selectedActor])

  const showPanel   = isCreating || selectedActor !== null
  const panelActor  = isCreating ? null : (actorDetail?.actor ?? selectedActor)
  const panelVideos = actorDetail?.videos   ?? []
  const panelStats  = actorDetail?.stats    ?? {}
  const panelTop    = actorDetail?.topVideos ?? []

  return (
    <div className="actors-page">
      {/* ── 새 배우 탭 바 ───────────────────────────────────── */}
      <div className="actor-tab-bar" role="tablist" aria-label="배우 탭">
        {[
          { key: 'all', label: '전체 배우' },
          {
            key:   'new',
            label: newActorCount > 0 ? `새 배우 (${newActorCount})` : '새 배우',
            badge: newActorCount > 0,
          },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={actorTabMode === tab.key}
            className={[
              'tab-btn',
              actorTabMode === tab.key ? 'tab-btn--active' : '',
              tab.key === 'new' && tab.badge ? 'tab-btn--new-badge' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setActorTabMode(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
              {actorTabMode === 'new' && (
                <span className="actors-page__new-hint"> — 스캔에서 새로 발견됨</span>
              )}
            </span>
          </div>
          <ActorList
            actors={actors}
            selectedId={selectedActor?.id ?? null}
            onSelect={handleSelect}
            loading={loading}
            onConfirmNew={actorTabMode === 'new' ? handleConfirmNew : undefined}
            onDismissNew={actorTabMode === 'new' ? handleDismissNew : undefined}
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
