/**
 * src/pages/Actors/index.jsx
 * 배우 관리 페이지
 *
 * 레이아웃: ActorToolbar / [ ActorList | ActorDetailPanel ]
 */
import { useState, useEffect, useCallback } from 'react'
import ActorToolbar     from '../../components/actors/ActorToolbar.jsx'
import ActorList        from '../../components/actors/ActorList.jsx'
import ActorDetailPanel from '../../components/actors/ActorDetailPanel.jsx'

export default function ActorsPage() {
  const [actors,       setActors]       = useState([])
  const [loading,      setLoading]      = useState(false)
  const [query,        setQuery]        = useState('')
  const [showArchived, setShowArchived] = useState(false)

  // 선택된 배우 (null = 신규 생성 모드 아님, 선택 없음)
  const [selectedActor, setSelectedActor] = useState(null)
  // 상세 조회 결과 (연결 작품 포함)
  const [actorDetail,   setActorDetail]   = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // 신규 생성 모드
  const [isCreating,    setIsCreating]    = useState(false)

  // ── 배우 목록 조회 ──────────────────────────────────────────
  const fetchActors = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.getActors({
        query:    query.trim() || undefined,
        archived: showArchived ? undefined : false,
      })
      setActors(result)
    } catch (e) {
      console.error('배우 목록 조회 실패:', e)
    } finally {
      setLoading(false)
    }
  }, [query, showArchived])

  useEffect(() => { fetchActors() }, [fetchActors])

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
    await fetchActors()
    // 저장 후 해당 배우 선택 상태로 전환
    setIsCreating(false)
    setSelectedActor(savedActor)
    setDetailLoading(true)
    try {
      const detail = await window.api.getActorDetail(savedActor.id)
      setActorDetail(detail)
    } catch {
      setActorDetail({ actor: savedActor, videos: [] })
    } finally {
      setDetailLoading(false)
    }
  }

  // ── 아카이브/복구 완료 ──────────────────────────────────────
  const handleArchived = async (updated) => {
    await fetchActors()
    setSelectedActor(updated)
    setActorDetail((prev) =>
      prev ? { ...prev, actor: updated } : { actor: updated, videos: [] }
    )
  }

  // 표시할 패널 결정
  const showPanel   = isCreating || selectedActor !== null
  const panelActor  = isCreating ? null : (actorDetail?.actor ?? selectedActor)
  const panelVideos = actorDetail?.videos ?? []

  return (
    <div className="actors-page">
      <ActorToolbar
        query={query}
        onQueryChange={setQuery}
        showArchived={showArchived}
        onToggleArchived={setShowArchived}
        onNewActor={handleNewActor}
      />

      <div className="actors-page__body">
        {/* 좌측: 배우 리스트 */}
        <div className="actors-page__list-wrap">
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
                onSaved={handleSaved}
                onArchived={handleArchived}
              />
            )
          ) : (
            <div className="actors-page__detail-empty">
              <div className="actors-page__detail-empty-icon">👈</div>
              <p>배우를 선택하면 상세 정보가 표시됩니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
