/**
 * src/components/actors/ActorDetailPanel.jsx
 * 배우 상세 정보 표시 및 편집 폼
 */
import { useState, useEffect, useCallback } from 'react'
import StarRating from '../common/StarRating.jsx'
import ActorImage from '../common/ActorImage.jsx'

const EMPTY_FORM = {
  name:       '',
  image_path: '',
  agency:     '',
  tags:       '',
  rating:     0,
  memo:       '',
}

function formFromActor(actor) {
  if (!actor) return { ...EMPTY_FORM }
  return {
    name:       actor.name       || '',
    image_path: actor.image_path || '',
    agency:     actor.agency     || '',
    tags:       actor.tags       || '',
    rating:     actor.rating     || 0,
    memo:       actor.memo       || '',
  }
}

const QUICK_FILTERS = [
  { key: 'all',         label: '전체' },
  { key: 'high_rated',  label: '고평점(4+)' },
  { key: 'new',         label: 'NEW' },
  { key: 'recommended', label: '⭐추천작' },
  { key: 'not_copied',  label: '복사 안한작품' },
]

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

  useEffect(() => {
    setForm(formFromActor(actor))
    setError(null)
    setSuccess(null)
    setQuickFilter('all')
    setFilteredVids(videos)
  }, [actor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (quickFilter === 'all') setFilteredVids(videos)
  }, [videos, quickFilter])

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

      {/* 폼 필드 */}
      <div className="detail-edit">
        <div className="edit-field">
          <label className="edit-label">이름 *</label>
          <input className="edit-input" value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="배우 이름" />
        </div>
        <div className="edit-field">
          <label className="edit-label">소속사</label>
          <input className="edit-input" value={form.agency} onChange={(e) => handleChange('agency', e.target.value)} placeholder="소속사명" />
        </div>
        <div className="edit-field">
          <label className="edit-label">태그 (쉼표 구분)</label>
          <input className="edit-input" value={form.tags} onChange={(e) => handleChange('tags', e.target.value)} placeholder="태그1, 태그2" />
        </div>
        <div className="edit-field">
          <label className="edit-label">별점</label>
          <StarRating value={form.rating} onChange={(v) => handleChange('rating', v)} />
        </div>
        <div className="edit-field">
          <label className="edit-label">메모</label>
          <textarea className="edit-textarea" rows={3} value={form.memo} onChange={(e) => handleChange('memo', e.target.value)} placeholder="메모" />
        </div>
      </div>

      {/* 오류/성공 메시지 */}
      {error   && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}
      {success && <div style={{ color: '#22c55e', fontSize: 13 }}>{success}</div>}

      {/* 저장/보관 버튼 */}
      <div className="detail-save-row">
        <button className="btn-save" type="button" onClick={handleSave} disabled={saving}>
          {saving ? '저장 중…' : (actor ? '저장' : '배우 등록')}
        </button>
        {actor && (
          <button className="btn-secondary" type="button" onClick={handleArchive} disabled={archiving}>
            {archiving ? '처리 중…' : (actor.is_archived ? '📤 복구' : '📦 보관함')}
          </button>
        )}
      </div>

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
    </div>
  )
}
