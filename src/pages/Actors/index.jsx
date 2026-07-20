/**
 * src/pages/Actors/index.jsx
 * 배우 탐색 허브 — 검색·필터·통계·상세 패널 통합
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from 'antd'
import ActorToolbar     from '../../components/actors/ActorToolbar.jsx'
import ActorList        from '../../components/actors/ActorList.jsx'
import ActorDetailPanel from '../../components/actors/ActorDetailPanel.jsx'
import { ACTOR_BADGE_VARIANT_OPTIONS } from '../../utils/format.js'

const BADGE_CATEGORY_LABELS = {
  appearance: '외모',
  body: '몸매',
  performance: '행위·연기·캐릭터',
}

const DEFAULT_FILTERS = {
  minRating:     0,
  tag:           '',
  minVideoCount: 0,
  sortBy:        'name_asc',
  badgeFilter:   'all',
}

export default function ActorsPage() {
  const [actors,       setActors]       = useState([])
  const [loading,      setLoading]      = useState(false)
  const [query,        setQuery]        = useState('')
  const [filters,      setFilters]      = useState(DEFAULT_FILTERS)
  const [showArchived, setShowArchived] = useState(false)
  const [syncStatus,   setSyncStatus]   = useState(null)
  const [tierFilter,   setTierFilter]   = useState('all')
  const [tierCounts,   setTierCounts]   = useState({ S: 0, A: 0, B: 0, unranked: 0, total: 0, limits: { S: 10, A: 20, B: 30 } })
  const [tierModalOpen, setTierModalOpen] = useState(false)
  const [tierManageData, setTierManageData] = useState({ S: [], A: [], B: [] })
  const [tierManageQuery, setTierManageQuery] = useState('')
  const [tierManageBusy, setTierManageBusy] = useState(false)
  const [badgeDefinitions, setBadgeDefinitions] = useState([])
  const [badgeModalOpen, setBadgeModalOpen] = useState(false)
  const [badgeManageQuery, setBadgeManageQuery] = useState('')
  const [badgeManageBusy, setBadgeManageBusy] = useState(false)
  const [badgeFormOpen, setBadgeFormOpen] = useState(false)
  const [badgeFormMode, setBadgeFormMode] = useState('create')
  const [badgeFormId, setBadgeFormId] = useState(null)
  const [badgeForm, setBadgeForm] = useState({
    label: '',
    icon: '',
    variant: 'gray',
    category: 'appearance',
    description: '',
    sort_order: 0,
    is_active: 1,
  })
  const [badgeSaving, setBadgeSaving] = useState(false)
  const [badgeError, setBadgeError] = useState(null)
  const [badgeSuccess, setBadgeSuccess] = useState(null)

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

  const refreshTierCounts = useCallback(async () => {
    try {
      const counts = await window.api.getActorTierCounts({
        archived: false,
        isNew: actorTabMode === 'new',
      })
      setTierCounts(counts)
    } catch {
      // ignore
    }
  }, [actorTabMode])

  const refreshBadgeDefinitions = useCallback(async () => {
    try {
      const rows = await window.api.getActorBadgeDefinitions({ includeInactive: true })
      setBadgeDefinitions(rows || [])
    } catch {
      setBadgeDefinitions([])
    }
  }, [])

  // ── 배우 목록 조회 ──────────────────────────────────────────
  const fetchActors = useCallback(async (q, flt, arch, tabMode) => {
    setLoading(true)
    try {
      const result = await window.api.getActors({
        query:         q.trim() || undefined,
        archived:      arch ? undefined : false,
        minRating:     flt.minRating  || undefined,
        tag:           flt.tag        || undefined,
        minVideoCount: flt.minVideoCount || undefined,
        sortBy:        flt.sortBy,
        isNew:         tabMode === 'new' ? true : undefined,
        tierFilter:    tierFilter,
        badgeFilter:   flt.badgeFilter || 'all',
      })
      setActors(result)
    } catch (e) {
      console.error('배우 목록 조회 실패:', e)
    } finally {
      setLoading(false)
    }
  }, [tierFilter])

  // 검색어/필터/탭 변경 시 디바운스 조회
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchActors(query, filters, showArchived, actorTabMode)
      refreshTierCounts()
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, filters, showArchived, actorTabMode, fetchActors, refreshTierCounts])

  // 초기 + 탭 마운트 시 새 배우 카운트 조회
  useEffect(() => {
    refreshNewActorCount()
    refreshTierCounts()
    refreshBadgeDefinitions()
  }, [refreshNewActorCount, refreshTierCounts, refreshBadgeDefinitions])

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
    await refreshTierCounts()
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
    await refreshTierCounts()
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
      await refreshTierCounts()
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
            await refreshTierCounts()
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
      await refreshTierCounts()
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
  }, [query, filters, showArchived, actorTabMode, fetchActors, refreshNewActorCount, refreshTierCounts, selectedActor])

  // ── 새 배우 "무시" 액션 (is_new 해제 + 아카이브) ─────────────
  const handleDismissNew = useCallback(async (actorId) => {
    try {
      await window.api.clearActorNew(actorId)
      await window.api.archiveActor(actorId)
      await fetchActors(query, filters, showArchived, actorTabMode)
      await refreshNewActorCount()
      await refreshTierCounts()
      if (selectedActor?.id === actorId) {
        setSelectedActor(null)
        setActorDetail(null)
      }
    } catch (e) {
      setSyncStatus('무시 처리 실패: ' + e.message)
      setTimeout(() => setSyncStatus(null), 4000)
    }
  }, [query, filters, showArchived, actorTabMode, fetchActors, refreshNewActorCount, refreshTierCounts, selectedActor])

  const loadTierManageData = useCallback(async () => {
    const [sList, aList, bList] = await Promise.all([
      window.api.getActorsByTier('S', { archived: false }),
      window.api.getActorsByTier('A', { archived: false }),
      window.api.getActorsByTier('B', { archived: false }),
    ])
    setTierManageData({ S: sList || [], A: aList || [], B: bList || [] })
  }, [])

  const handleOpenTierManager = useCallback(async () => {
    setTierModalOpen(true)
    setTierManageBusy(true)
    try {
      await loadTierManageData()
    } finally {
      setTierManageBusy(false)
    }
  }, [loadTierManageData])

  const handleDemoteTierActor = useCallback(async (actorId) => {
    await window.api.updateActor(actorId, { tier: null })
    await Promise.all([
      fetchActors(query, filters, showArchived, actorTabMode),
      refreshTierCounts(),
      loadTierManageData(),
    ])
  }, [actorTabMode, fetchActors, filters, loadTierManageData, query, refreshTierCounts, showArchived])

  const handleTierUpdated = useCallback((updatedActor, prevTier = null) => {
    const nextTier = updatedActor?.tier ?? null

    setActors((prev) => {
      const normalized = prev.map((item) =>
        item.id === updatedActor.id ? { ...item, tier: nextTier } : item
      )

      if (tierFilter === 'all') return normalized
      if (tierFilter === 'unranked') return normalized.filter((item) => (item.tier ?? null) === null)
      return normalized.filter((item) => (item.tier ?? null) === tierFilter)
    })

    setSelectedActor((prev) => (prev && prev.id === updatedActor.id ? { ...prev, tier: nextTier } : prev))
    setActorDetail((prev) => {
      if (!prev?.actor || prev.actor.id !== updatedActor.id) return prev
      return { ...prev, actor: { ...prev.actor, tier: nextTier } }
    })

    setTierCounts((prev) => {
      const before = prevTier ?? null
      if (before === nextTier) return prev
      const next = {
        ...prev,
        S: Number(prev.S || 0),
        A: Number(prev.A || 0),
        B: Number(prev.B || 0),
        unranked: Number(prev.unranked || 0),
      }
      if (before === 'S') next.S = Math.max(0, next.S - 1)
      if (before === 'A') next.A = Math.max(0, next.A - 1)
      if (before === 'B') next.B = Math.max(0, next.B - 1)
      if (before === null) next.unranked = Math.max(0, next.unranked - 1)

      if (nextTier === 'S') next.S += 1
      if (nextTier === 'A') next.A += 1
      if (nextTier === 'B') next.B += 1
      if (nextTier === null) next.unranked += 1
      return next
    })
  }, [tierFilter])

  const refreshAfterBadgeChange = useCallback(async (actorId) => {
    await Promise.all([
      fetchActors(query, filters, showArchived, actorTabMode),
      refreshNewActorCount(),
      refreshTierCounts(),
      refreshBadgeDefinitions(),
    ])
    if (selectedActor?.id === actorId) {
      const detail = await window.api.getActorDetail(actorId)
      setActorDetail(detail)
      setSelectedActor((prev) => (prev ? { ...prev, badges: detail?.actor?.badges || [] } : prev))
    }
  }, [actorTabMode, fetchActors, filters, query, refreshBadgeDefinitions, refreshNewActorCount, refreshTierCounts, selectedActor, showArchived])

  const handleBadgesUpdated = useCallback((actorId, badges) => {
    setActors((prev) => prev.map((item) => (item.id === actorId ? { ...item, badges } : item)))
    setSelectedActor((prev) => (prev && prev.id === actorId ? { ...prev, badges } : prev))
    setActorDetail((prev) => {
      if (!prev?.actor || prev.actor.id !== actorId) return prev
      return { ...prev, actor: { ...prev.actor, badges } }
    })
  }, [])

  const openBadgeManager = useCallback(() => {
    setBadgeManageQuery('')
    setBadgeError(null)
    setBadgeSuccess(null)
    setBadgeModalOpen(true)
  }, [])

  const resetBadgeForm = useCallback((badge = null) => {
    setBadgeFormMode(badge ? 'edit' : 'create')
    setBadgeFormId(badge?.id ?? null)
    setBadgeForm({
      label: badge?.label ?? '',
      icon: badge?.icon ?? '',
      variant: badge?.variant ?? 'gray',
      category: badge?.category ?? 'appearance',
      description: badge?.description ?? '',
      sort_order: badge?.sort_order ?? 0,
      is_active: badge?.is_active ?? 1,
    })
    setBadgeError(null)
    setBadgeSuccess(null)
    setBadgeFormOpen(true)
  }, [])

  const handleSaveBadge = async () => {
    setBadgeSaving(true)
    setBadgeError(null)
    setBadgeSuccess(null)
    try {
      const payload = {
        label: badgeForm.label,
        icon: badgeForm.icon,
        variant: badgeForm.variant,
        category: badgeForm.category,
        description: badgeForm.description,
        sort_order: badgeForm.sort_order,
        is_active: badgeForm.is_active,
      }
      if (badgeFormMode === 'edit' && badgeFormId) {
        await window.api.updateActorBadgeDefinition(badgeFormId, payload)
      } else {
        await window.api.createActorBadgeDefinition(payload)
      }
      await refreshBadgeDefinitions()
      await refreshAfterBadgeChange(selectedActor?.id)
      setBadgeFormOpen(false)
      setBadgeFormId(null)
      setBadgeFormMode('create')
      setBadgeSuccess('뱃지를 저장했습니다.')
    } catch (e) {
      setBadgeError(e.message || '뱃지 저장 실패')
    } finally {
      setBadgeSaving(false)
    }
  }

  const handleToggleBadgeActive = async (badge) => {
    setBadgeManageBusy(true)
    try {
      await window.api.setActorBadgeActive(badge.id, badge.is_active ? 0 : 1)
      await refreshAfterBadgeChange(selectedActor?.id)
      setBadgeSuccess(badge.is_active ? '뱃지를 비활성화했습니다.' : '뱃지를 활성화했습니다.')
    } catch (e) {
      setBadgeError(e.message || '상태 변경 실패')
    } finally {
      setBadgeManageBusy(false)
    }
  }

  const handleDeleteBadge = (badge) => {
    Modal.confirm({
      title: '뱃지 삭제',
      content: `${badge.label} 뱃지를 삭제할까요? 사용 중인 배우가 있으면 삭제할 수 없습니다.`,
      okText: '삭제',
      cancelText: '취소',
      onOk: async () => {
        setBadgeManageBusy(true)
        try {
          await window.api.deleteActorBadgeDefinition(badge.id)
          await refreshAfterBadgeChange(selectedActor?.id)
          setBadgeSuccess('뱃지를 삭제했습니다.')
        } catch (e) {
          setBadgeError(e.message || '뱃지 삭제 실패')
        } finally {
          setBadgeManageBusy(false)
        }
      },
    })
  }

  const handleBadgesForActor = useCallback(async (actorId, nextBadges) => {
    try {
      const result = await window.api.setActorBadges(actorId, nextBadges.map((badge) => badge.id))
      const badges = result?.badges || []
      handleBadgesUpdated(actorId, badges)
      await refreshBadgeDefinitions()
      await refreshTierCounts()
      setBadgeSuccess('특수 뱃지가 저장됐습니다.')
    } catch (e) {
      setBadgeError(e.message || '뱃지 저장 실패')
    }
  }, [handleBadgesUpdated, refreshBadgeDefinitions, refreshTierCounts])

  const showPanel   = isCreating || selectedActor !== null
  const panelActor  = isCreating ? null : (actorDetail?.actor ?? selectedActor)
  const panelVideos = actorDetail?.videos   ?? []
  const panelStats  = actorDetail?.stats    ?? {}
  const panelTop    = actorDetail?.topVideos ?? []
  const activeBadgeDefinitions = badgeDefinitions.filter((badge) => badge.is_active === 1)
  const badgeManageList = badgeDefinitions.filter((badge) => {
    const q = badgeManageQuery.trim().toLowerCase()
    if (!q) return true
    return [badge.label, badge.icon, badge.description, badge.badge_key, badge.category, BADGE_CATEGORY_LABELS[badge.category]]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q))
  })
  const badgeManageGroups = ['appearance', 'body', 'performance'].map((categoryKey) => ({
    key: categoryKey,
    label: BADGE_CATEGORY_LABELS[categoryKey] || categoryKey,
    items: badgeManageList.filter((badge) => badge.category === categoryKey),
  })).filter((group) => group.items.length > 0)
  const uncategorizedBadges = badgeManageList.filter((badge) => !BADGE_CATEGORY_LABELS[badge.category])

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
        tierCounts={tierCounts}
        tierFilter={tierFilter}
        onTierFilterChange={setTierFilter}
        onOpenTierManager={handleOpenTierManager}
        badgeDefinitions={activeBadgeDefinitions}
        badgeFilter={filters.badgeFilter || 'all'}
        onBadgeFilterChange={(value) => handleFiltersChange({ badgeFilter: value })}
        onOpenBadgeManager={openBadgeManager}
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
                tierCounts={tierCounts}
                    badgeDefinitions={activeBadgeDefinitions}
                onSaved={handleSaved}
                onTierUpdated={handleTierUpdated}
                    onBadgesUpdated={handleBadgesForActor}
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

      <Modal
        open={tierModalOpen}
        onCancel={() => setTierModalOpen(false)}
        footer={null}
        width={860}
        title="티어 관리"
      >
        <div className="actor-tier-manage__toolbar">
          <input
            type="search"
            className="actor-toolbar__search"
            placeholder="이름 검색"
            value={tierManageQuery}
            onChange={(e) => setTierManageQuery(e.target.value)}
          />
          <button className="btn-secondary" type="button" onClick={loadTierManageData} disabled={tierManageBusy}>
            새로고침
          </button>
        </div>
        {['S', 'A', 'B'].map((tier) => {
          const list = (tierManageData[tier] || []).filter((actor) => {
            const q = tierManageQuery.trim().toLowerCase()
            if (!q) return true
            return String(actor.name || '').toLowerCase().includes(q)
          })
          const limit = tierCounts?.limits?.[tier] || { S: 10, A: 20, B: 30 }[tier]
          return (
            <section key={tier} className="actor-tier-manage__section">
              <h3 className="actor-tier-manage__title">{tier}급 ({tierCounts?.[tier] ?? 0}/{limit})</h3>
              <ul className="actor-tier-manage__list">
                {list.map((tierActor) => (
                  <li key={tierActor.id} className="actor-tier-manage__item">
                    <span className="actor-tier-manage__name">{tierActor.name}</span>
                    <span className="actor-tier-manage__meta">평점 {Number(tierActor.rating || 0).toFixed(1)} · 작품 {tierActor.video_count || 0}</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleDemoteTierActor(tierActor.id)}
                    >
                      무등급으로 내리기
                    </button>
                  </li>
                ))}
                {list.length === 0 && <li className="actor-tier-manage__empty">표시할 배우가 없습니다.</li>}
              </ul>
            </section>
          )
        })}

        <Modal
          open={badgeModalOpen}
          onCancel={() => setBadgeModalOpen(false)}
          footer={null}
          width={920}
          title="특수 뱃지 관리"
          destroyOnClose={false}
        >
          <div className="actor-tier-manage__toolbar">
            <input
              type="search"
              className="actor-toolbar__search"
              placeholder="이름·아이콘·설명 검색"
              value={badgeManageQuery}
              onChange={(e) => setBadgeManageQuery(e.target.value)}
            />
            <button className="btn-secondary" type="button" onClick={refreshBadgeDefinitions} disabled={badgeManageBusy}>
              새로고침
            </button>
            <button
              className="btn-primary"
              type="button"
              onClick={() => resetBadgeForm(null)}
            >
              ＋ 새 뱃지
            </button>
          </div>

          {badgeError && <div className="actor-detail__error">{badgeError}</div>}
          {badgeSuccess && <div className="actor-detail__success">{badgeSuccess}</div>}

          {badgeManageGroups.map((group) => (
            <section key={group.key} className="actor-badge-manage__group">
              <h3 className="actor-badge-manage__group-title">{group.label}</h3>
              <ul className="actor-badge-manage__list">
                {group.items.map((badge) => (
                  <li key={badge.id} className={`actor-badge-manage__item${badge.is_active === 0 ? ' actor-badge-manage__item--inactive' : ''}`}>
                    <div className="actor-badge-manage__preview-row">
                      <span className="actor-badge-manage__preview">
                        {badge.icon ? `${badge.icon} ` : ''}{badge.label}
                      </span>
                      <span className="actor-badge-manage__meta">{BADGE_CATEGORY_LABELS[badge.category] || badge.category || '기타'} · {badge.variant} · {badge.actor_count ?? 0}명 사용 · {badge.is_active ? '활성' : '비활성'}</span>
                    </div>
                    <div className="actor-badge-manage__desc">{badge.description || '설명 없음'}</div>
                    <div className="actor-badge-manage__actions">
                      <button type="button" className="btn-secondary" onClick={() => resetBadgeForm(badge)} disabled={badgeManageBusy}>수정</button>
                      <button type="button" className="btn-secondary" onClick={() => handleToggleBadgeActive(badge)} disabled={badgeManageBusy}>
                        {badge.is_active ? '비활성화' : '활성화'}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => handleDeleteBadge(badge)} disabled={badgeManageBusy}>삭제</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {uncategorizedBadges.length > 0 && (
            <section className="actor-badge-manage__group">
              <h3 className="actor-badge-manage__group-title">기타</h3>
              <ul className="actor-badge-manage__list">
                {uncategorizedBadges.map((badge) => (
                  <li key={badge.id} className={`actor-badge-manage__item${badge.is_active === 0 ? ' actor-badge-manage__item--inactive' : ''}`}>
                    <div className="actor-badge-manage__preview-row">
                      <span className="actor-badge-manage__preview">
                        {badge.icon ? `${badge.icon} ` : ''}{badge.label}
                      </span>
                      <span className="actor-badge-manage__meta">{badge.variant} · {badge.actor_count ?? 0}명 사용 · {badge.is_active ? '활성' : '비활성'}</span>
                    </div>
                    <div className="actor-badge-manage__desc">{badge.description || '설명 없음'}</div>
                    <div className="actor-badge-manage__actions">
                      <button type="button" className="btn-secondary" onClick={() => resetBadgeForm(badge)} disabled={badgeManageBusy}>수정</button>
                      <button type="button" className="btn-secondary" onClick={() => handleToggleBadgeActive(badge)} disabled={badgeManageBusy}>
                        {badge.is_active ? '비활성화' : '활성화'}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => handleDeleteBadge(badge)} disabled={badgeManageBusy}>삭제</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {badgeManageList.length === 0 && <div className="actor-badge-manage__empty">표시할 뱃지가 없습니다.</div>}
        </Modal>

        <Modal
          open={badgeFormOpen}
          onCancel={() => {
            if (badgeSaving) return
            setBadgeFormOpen(false)
          }}
          onOk={handleSaveBadge}
          okText="저장"
          cancelText="취소"
          confirmLoading={badgeSaving}
          title={badgeFormMode === 'edit' ? '뱃지 수정' : '새 뱃지'}
          destroyOnClose={false}
        >
          <div className="actor-badge-form">
            <label className="edit-label">뱃지 이름</label>
            <input className="edit-input" value={badgeForm.label} onChange={(e) => setBadgeForm((prev) => ({ ...prev, label: e.target.value }))} maxLength={30} />

            <label className="edit-label">아이콘</label>
            <input className="edit-input" value={badgeForm.icon} onChange={(e) => setBadgeForm((prev) => ({ ...prev, icon: e.target.value }))} maxLength={8} placeholder="✨" />

            <label className="edit-label">색상</label>
            <select className="edit-input" value={badgeForm.variant} onChange={(e) => setBadgeForm((prev) => ({ ...prev, variant: e.target.value }))}>
              {ACTOR_BADGE_VARIANT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <label className="edit-label">카테고리</label>
            <select className="edit-input" value={badgeForm.category} onChange={(e) => setBadgeForm((prev) => ({ ...prev, category: e.target.value }))}>
              <option value="appearance">외모</option>
              <option value="body">몸매</option>
              <option value="performance">행위·연기·캐릭터</option>
            </select>

            <label className="edit-label">설명</label>
            <textarea className="edit-textarea" rows={3} value={badgeForm.description} onChange={(e) => setBadgeForm((prev) => ({ ...prev, description: e.target.value }))} maxLength={200} />

            <label className="edit-label">정렬 순서</label>
            <input className="edit-input" type="number" value={badgeForm.sort_order} onChange={(e) => setBadgeForm((prev) => ({ ...prev, sort_order: Number(e.target.value) || 0 }))} />

            <label className="actor-badge-form__active">
              <input type="checkbox" checked={badgeForm.is_active === 1} onChange={(e) => setBadgeForm((prev) => ({ ...prev, is_active: e.target.checked ? 1 : 0 }))} />
              활성 상태
            </label>

            <div className="actor-badge-form__preview">
              미리보기
              <div>
                {badgeForm.label ? `${badgeForm.icon || ''}${badgeForm.icon ? ' ' : ''}${badgeForm.label}` : '—'}
              </div>
            </div>

            {badgeError && <div className="actor-detail__error">{badgeError}</div>}
          </div>
        </Modal>
      </Modal>
    </div>
  )
}
