/**
 * src/components/actors/ActorDetailPanel.jsx
 * 배우 상세 정보 표시 및 편집 폼
 */
import { useState, useEffect, useCallback } from 'react'
import ActorImage from '../common/ActorImage.jsx'

const EMPTY_FORM = {
  name:       '',
  image_path: '',
  tags:       '',
  rating:     0,
  memo:       '',
}

function formFromActor(actor) {
  if (!actor) return { ...EMPTY_FORM }
  return {
    name:       actor.name       || '',
    image_path: actor.image_path || '',
    tags:       actor.tags       || '',
    rating:     actor.rating     || 0,
    memo:       actor.memo       || '',
  }
}

function splitTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function joinTags(tags) {
  return Array.from(new Set(tags)).join(', ')
}

const QUICK_FILTERS = [
  { key: 'all',         label: '전체' },
  { key: 'high_rated',  label: '고평점(4+)' },
  { key: 'new',         label: 'NEW' },
  { key: 'recommended', label: '⭐추천작' },
  { key: 'not_copied',  label: '복사 안한작품' },
]

function formatAvdbsAverage(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const clamped = Math.max(0, Math.min(10, n))
  return `${clamped.toFixed(1)} / 10`
}

function formatAvdbsRadar(ratings) {
  if (!ratings || typeof ratings !== 'object') return '—'
  const chips = Object.entries(ratings)
    .map(([label, value]) => {
      const n = Number(value)
      return Number.isFinite(n) ? `${label} ${n.toFixed(1)}` : null
    })
    .filter(Boolean)
  return chips.length > 0 ? chips.join('  |  ') : '—'
}

export default function ActorDetailPanel({
  actor,
  videos = [],
  stats = {},
  topVideos = [],
  onSaved,
  onArchived,
}) {
  const [form,         setForm]         = useState(formFromActor(actor))
  const [saving,       setSaving]       = useState(false)
  const [archiving,    setArchiving]    = useState(false)
  const [uploading,    setUploading]    = useState(false)
  const [error,        setError]        = useState(null)
  const [success,      setSuccess]      = useState(null)
  const [quickFilter,  setQuickFilter]  = useState('all')
  const [filteredVids, setFilteredVids] = useState(videos)
  const [vidsLoading,  setVidsLoading]  = useState(false)
  // AI 분석 상태
  const [aiData,        setAiData]       = useState(null)   // 캐시된 분석 결과
  const [aiLoading,     setAiLoading]    = useState(false)
  const [aiError,       setAiError]      = useState(null)
  const [avdbsProfile,  setAvdbsProfile] = useState(null)
  const [avdbsLoading,  setAvdbsLoading] = useState(false)
  const tagPreviewList = splitTags(form.tags).slice(0, 8)

  useEffect(() => {
    setForm(formFromActor(actor))
    setError(null)
    setSuccess(null)
    setQuickFilter('all')
    setFilteredVids(videos)
    setAiData(null)
    setAiError(null)
    setAvdbsProfile(null)
    // 배우 전환 시 캐시된 AI 분석 결과를 조회
    if (actor?.id) {
      window.api.getAiAnalysis('actor', actor.id).then((res) => {
        if (res?.success && res.data) setAiData(res.data)
      }).catch(() => {})
    }
  }, [actor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (quickFilter === 'all') setFilteredVids(videos)
  }, [videos, quickFilter])

  useEffect(() => {
    let mounted = true
    if (!actor?.id) {
      setAvdbsProfile(null)
      return () => { mounted = false }
    }

    setAvdbsLoading(true)
    window.api.getActorAvdbsProfile(actor.id)
      .then((res) => {
        if (!mounted) return
        if (res?.success) {
          setAvdbsProfile(res)
        } else {
          setAvdbsProfile(null)
        }
      })
      .catch((err) => {
        if (!mounted) return
        setAvdbsProfile(null)
        console.warn('[ActorDetailPanel] AVDBS profile load failed:', err?.message || err)
      })
      .finally(() => {
        if (mounted) setAvdbsLoading(false)
      })

    return () => { mounted = false }
  }, [actor?.id])

  const handleQuickFilter = useCallback(async (filterKey) => {
    setQuickFilter(filterKey)
    if (!actor) return
    if (filterKey === 'all') { setFilteredVids(videos); return }
    setVidsLoading(true)
    try {
      const result = await window.api.getActorVideos(actor.id, { quickFilter: filterKey })
      setFilteredVids(result || [])
    } catch {
      setFilteredVids([])
    } finally {
      setVidsLoading(false)
    }
  }, [actor, videos])

  const handleChange = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const handleSave = async () => {
    if (!form.name.trim()) { setError('이름을 입력하세요'); return }
    setSaving(true); setError(null); setSuccess(null)
    try {
      let saved
      if (actor) {
        saved = await window.api.updateActor(actor.id, form)
      } else {
        saved = await window.api.createActor(form)
      }
      setSuccess(actor ? '저장됐습니다' : '배우가 등록됐습니다')
      onSaved?.(saved)
    } catch (e) {
      setError(e.message || '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!actor) return
    const willArchive = !actor.is_archived
    if (!window.confirm(willArchive ? '이 배우를 보관함으로 이동할까요?' : '보관함에서 복구할까요?')) return
    setArchiving(true); setError(null)
    try {
      const updated = await window.api.updateActor(actor.id, { is_archived: willArchive ? 1 : 0 })
      onArchived?.(updated)
    } catch (e) {
      setError(e.message || '처리 실패')
    } finally {
      setArchiving(false)
    }
  }

  const handleImageUpload = async () => {
    setUploading(true); setError(null)
    try {
      const result = await window.api.uploadActorImage(actor?.id ?? 0)
      if (result?.fileName) handleChange('image_path', result.fileName)
    } catch (e) {
      setError(e.message || '이미지 선택 실패')
    } finally {
      setUploading(false)
    }
  }

  const handleAiAnalyze = useCallback(async (force = false) => {
    if (!actor?.id) return
    setAiLoading(true); setAiError(null)
    try {
      const res = await window.api.analyzeActorAi(actor.id, force)
      if (res?.success) {
        setAiData(res.data)
      } else {
        setAiError(res?.error || 'AI 분석 실패')
      }
    } catch (e) {
      setAiError(e.message || 'AI 분석 실패')
    } finally {
      setAiLoading(false)
    }
  }, [actor])

  return (
    <div className="actor-detail">
      {/* 이미지 - 클릭하면 업로드 */}
      <div className="actor-detail__image-section">
        <div
          className={`actor-detail__image-wrap actor-detail__image-wrap--clickable`}
          onClick={!uploading ? handleImageUpload : undefined}
          title="클릭하여 이미지 변경"
        >
          <ActorImage
            fileName={form.image_path}
            alt={form.name}
            className="actor-detail__image"
            placeholderClass="actor-detail__image-placeholder"
          />
          <div className="actor-detail__image-overlay">
            {uploading ? '…' : '📷'}
          </div>
        </div>
      </div>

      {/* 활동 통계 */}
      {actor && (
        <div className="actor-detail__activity-stats">
          <span className="actor-detail__stat">▶ {stats.open_count ?? 0} 재생</span>
          <span className="actor-detail__stat actor-detail__stat--copy">📋 {stats.copy_clipboard_count ?? 0} 복사</span>
          <span className="actor-detail__stat actor-detail__stat--device">📱 {stats.copy_device_count ?? 0} 장치복사</span>
        </div>
      )}

      {actor && (
        <div className="actor-detail__quick-summary">
          <div className="actor-detail__quick-row">
            <span className="actor-detail__quick-label">현재 태그</span>
            <div className="actor-detail__quick-chips">
              {tagPreviewList.length === 0 ? (
                <span className="actor-detail__quick-chip actor-detail__quick-chip--empty">태그 없음</span>
              ) : (
                tagPreviewList.map((tag) => (
                  <span key={tag} className="actor-detail__quick-chip">{tag}</span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {actor && avdbsProfile?.detail && (
        <div className="actor-detail__meta-summary">
          <div className="actor-detail__meta-row">
            <span className="actor-detail__meta-label">AVDBS</span>
            <span className="actor-detail__meta-value">
              {avdbsLoading
                ? '조회 중…'
                : (avdbsProfile?.mapping?.external_name || avdbsProfile?.detail?.primaryName || '—')}
            </span>
          </div>

          {!avdbsLoading && avdbsProfile?.detail && (
            <>
              <div className="actor-detail__meta-row">
                <span className="actor-detail__meta-label">별칭</span>
                <span className="actor-detail__meta-value">{(avdbsProfile.detail.aliases || []).join(', ') || '—'}</span>
              </div>
              <div className="actor-detail__meta-row">
                <span className="actor-detail__meta-label">평점</span>
                <span className="actor-detail__meta-value">{formatAvdbsAverage(avdbsProfile.detail.avdbsAverageRating)}</span>
              </div>
              <div className="actor-detail__meta-row">
                <span className="actor-detail__meta-label">세부</span>
                <span className="actor-detail__meta-value">{formatAvdbsRadar(avdbsProfile.detail.avdbsRatings)}</span>
              </div>
              <div className="actor-detail__meta-row">
                <span className="actor-detail__meta-label">생년</span>
                <span className="actor-detail__meta-value">{avdbsProfile.detail.profile?.birth || '—'}</span>
              </div>
              <div className="actor-detail__meta-row">
                <span className="actor-detail__meta-label">신장</span>
                <span className="actor-detail__meta-value">{avdbsProfile.detail.profile?.height || '—'}</span>
              </div>
              <div className="actor-detail__meta-row">
                <span className="actor-detail__meta-label">사이즈</span>
                <span className="actor-detail__meta-value">{avdbsProfile.detail.profile?.measurements || '—'}</span>
              </div>
              <div className="actor-detail__meta-row">
                <span className="actor-detail__meta-label">컵</span>
                <span className="actor-detail__meta-value">{avdbsProfile.detail.profile?.cup || '—'}</span>
              </div>
              <div className="actor-detail__meta-row">
                <span className="actor-detail__meta-label">데뷔</span>
                <span className="actor-detail__meta-value">{avdbsProfile.detail.profile?.debut || '—'}</span>
              </div>
            </>
          )}

        </div>
      )}

      {/* 폼 필드 */}
      <div className="detail-edit actor-detail__edit-grid">
        <div className="edit-field">
          <label className="edit-label">이름 *</label>
          <input className="edit-input" value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="배우 이름" />
        </div>

        <div className="edit-field actor-detail__edit-main">
          <label className="edit-label">태그 (쉼표 구분)</label>
          <input className="edit-input" value={form.tags} onChange={(e) => handleChange('tags', e.target.value)} placeholder="태그1, 태그2" />

          <label className="edit-label">평점 (10점 만점)</label>
          <input
            className="edit-input"
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={form.rating}
            onChange={(e) => {
              const raw = Number(e.target.value)
              const safe = Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) : 0
              handleChange('rating', safe)
            }}
            placeholder="0 ~ 10"
          />

          <div className="detail-save-row actor-detail__detail-save-row--inline">
            <button className="btn-save" type="button" onClick={handleSave} disabled={saving}>
              {saving ? '저장 중…' : (actor ? '저장' : '배우 등록')}
            </button>
            {actor && (
              <button className="btn-secondary" type="button" onClick={handleArchive} disabled={archiving}>
                {archiving ? '처리 중…' : (actor.is_archived ? '📤 복구' : '📦 보관함')}
              </button>
            )}
          </div>
        </div>

        <div className="edit-field actor-detail__memo-block">
          <label className="edit-label">메모</label>
          <textarea className="edit-textarea" rows={3} value={form.memo} onChange={(e) => handleChange('memo', e.target.value)} placeholder="메모" />
        </div>
      </div>

      {/* 오류/성공 메시지 */}
      {error   && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}
      {success && <div style={{ color: '#22c55e', fontSize: 13 }}>{success}</div>}

      {/* TOP 영상 */}
      {actor && topVideos.length > 0 && (
        <div className="actor-detail__top-videos">
          <p className="actor-detail__section-title">🏆 인기 영상 TOP {topVideos.length}</p>
          <ul className="actor-detail__top-video-list">
            {topVideos.map((v) => (
              <li key={v.id} className="actor-detail__top-video">
                <span className="actor-detail__video-code">{v.code || '—'}</span>
                {v.recommended === 1 && <span className="actor-detail__badge-rec">⭐</span>}
                {v.is_new      === 1 && <span className="actor-detail__badge-new">NEW</span>}
                <span className="actor-detail__badge-rating">{'★'.repeat(v.rating || 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 퀵 필터 + 영상 목록 */}
      {actor && (
        <div className="actor-detail__videos-section">
          <div className="actor-detail__quick-filters">
            {QUICK_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`actor-detail__qf-btn${quickFilter === key ? ' actor-detail__qf-btn--active' : ''}`}
                onClick={() => handleQuickFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {vidsLoading ? (
            <div className="actor-detail__videos-loading">로딩 중…</div>
          ) : (
            <ul className="actor-detail__video-list">
              {filteredVids.map((v) => (
                <li key={v.id} className="actor-detail__video-item">
                  <span className="actor-detail__video-code">{v.code || '—'}</span>
                  {v.recommended === 1 && <span className="actor-detail__badge-rec">⭐</span>}
                  {v.is_new      === 1 && <span className="actor-detail__badge-new">NEW</span>}
                  <span className="actor-detail__video-rating">{'★'.repeat(v.rating || 0)}</span>
                  <span className="actor-detail__video-name">{v.file_name}</span>
                </li>
              ))}
              {filteredVids.length === 0 && (
                <li style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>영상 없음</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* AI 배우 분석 */}
      {actor && (
        <AiAnalysisSection
          aiData={aiData}
          aiLoading={aiLoading}
          aiError={aiError}
          onAnalyze={handleAiAnalyze}
        />
      )}
    </div>
  )
}

// ── AI 분석 섹션 서브 컴포넌트 ─────────────────────────────────

const STATUS_LABELS = {
  pending:    '미분석',
  processing: '분석 중…',
  done:       '분석 완료',
  failed:     '분석 실패',
}

const STATUS_COLORS = {
  pending:    'var(--text-muted)',
  processing: '#facc15',
  done:       '#22c55e',
  failed:     '#ef4444',
}

function AiAnalysisSection({ aiData, aiLoading, aiError, onAnalyze }) {
  const status     = aiData?.ai_status ?? 'pending'
  const isDone     = status === 'done'
  const analysis   = isDone ? aiData.ai_analysis : null
  const updatedAt  = aiData?.ai_updated_at
    ? new Date(aiData.ai_updated_at).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="actor-detail__ai-section">
      <div className="actor-detail__ai-header">
        <span className="actor-detail__section-title" style={{ marginBottom: 0 }}>🤖 AI 배우 분석</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {aiData && (
            <span style={{ fontSize: 11, color: STATUS_COLORS[status] }}>
              {STATUS_LABELS[status]}
            </span>
          )}
          <button
            className="btn-secondary"
            style={{ padding: '2px 10px', fontSize: 12 }}
            type="button"
            disabled={aiLoading}
            onClick={() => onAnalyze(false)}
          >
            {aiLoading ? '분석 중…' : (isDone ? '재분석' : 'AI 분석')}
          </button>
          {isDone && (
            <button
              className="btn-secondary"
              style={{ padding: '2px 8px', fontSize: 11, opacity: 0.7 }}
              type="button"
              disabled={aiLoading}
              title="OpenAI를 다시 호출해 강제 재분석합니다"
              onClick={() => onAnalyze(true)}
            >
              ↺
            </button>
          )}
        </div>
      </div>

      {aiError && (
        <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{aiError}</div>
      )}

      {isDone && analysis && (
        <div className="actor-detail__ai-result">
          {/* 점수 + 요약 */}
          <div className="actor-detail__ai-score-row">
            <span className="actor-detail__ai-score">{aiData.ai_score ?? 0}</span>
            <span className="actor-detail__ai-score-label">/ 100</span>
            <span className="actor-detail__ai-summary">{aiData.ai_summary}</span>
          </div>

          {/* 분위기 / 스타일 */}
          {(analysis.mood?.length > 0 || analysis.style?.length > 0) && (
            <div className="actor-detail__ai-tags-row">
              {[...(analysis.mood ?? []), ...(analysis.style ?? [])].map((t) => (
                <span key={t} className="actor-detail__ai-tag actor-detail__ai-tag--mood">{t}</span>
              ))}
            </div>
          )}

          {/* 강점 */}
          {analysis.strengths?.length > 0 && (
            <div className="actor-detail__ai-tags-row">
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>강점</span>
              {analysis.strengths.map((t) => (
                <span key={t} className="actor-detail__ai-tag actor-detail__ai-tag--strength">{t}</span>
              ))}
            </div>
          )}

          {/* 추천 태그 */}
          {analysis.recommendedTags?.length > 0 && (
            <div className="actor-detail__ai-tags-row">
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>추천태그</span>
              {analysis.recommendedTags.map((t) => (
                <span key={t} className="actor-detail__ai-tag actor-detail__ai-tag--rec">{t}</span>
              ))}
            </div>
          )}

          {/* 장르 분포 */}
          {analysis.genreDistribution && Object.keys(analysis.genreDistribution).length > 0 && (
            <div className="actor-detail__ai-genre">
              {Object.entries(analysis.genreDistribution).map(([genre, pct]) => (
                <div key={genre} className="actor-detail__ai-genre-bar">
                  <span className="actor-detail__ai-genre-label">{genre}</span>
                  <div className="actor-detail__ai-genre-track">
                    <div
                      className="actor-detail__ai-genre-fill"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span className="actor-detail__ai-genre-pct">{pct}%</span>
                </div>
              ))}
            </div>
          )}

          {updatedAt && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
              마지막 분석: {updatedAt}
            </div>
          )}
        </div>
      )}

      {!aiData && !aiLoading && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          AI 분석 버튼을 눌러 배우 데이터를 분석하세요.
        </div>
      )}
    </div>
  )
}
