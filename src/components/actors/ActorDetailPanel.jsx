/**
 * src/components/actors/ActorDetailPanel.jsx
 * 배우 상세 정보 표시 및 편집 패널 (우측)
 *
 * Props:
 *   actor      {Actor|null} - 선택된 배우 레코드. null이면 신규 생성 모드
 *   videos     {Video[]}    - 해당 배우의 연결 작품 목록
 *   onSaved    {Function}   - 저장/생성 완료 콜백 (savedActor)
 *   onArchived {Function}   - 아카이브/복구 완료 콜백 (updatedActor)
 */
import { useState, useEffect } from 'react'
import StarRating from '../common/StarRating.jsx'

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

export default function ActorDetailPanel({ actor, videos = [], onSaved, onArchived }) {
  const [form,    setForm]    = useState(formFromActor(actor))
  const [saving,  setSaving]  = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error,   setError]   = useState(null)
  const [success, setSuccess] = useState(null)

  // 선택 배우 변경 시 폼 초기화
  useEffect(() => {
    setForm(formFromActor(actor))
    setError(null)
    setSuccess(null)
  }, [actor?.id])

  const isNew     = !actor
  const isDirty   = isNew
    ? Object.values(form).some((v) => v !== '' && v !== 0)
    : Object.keys(EMPTY_FORM).some((k) => String(form[k]) !== String(actor[k] ?? ''))

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const handleSave = async () => {
    setError(null)
    setSuccess(null)
    const name = form.name.trim()
    if (!name) { setError('배우 이름은 필수입니다.'); return }

    setSaving(true)
    try {
      const data = {
        ...form,
        name,
        rating: Number(form.rating) || 0,
      }
      const saved = isNew
        ? await window.api.createActor(data)
        : await window.api.updateActor(actor.id, data)

      setSuccess(isNew ? '배우가 추가됐습니다.' : '저장했습니다.')
      onSaved(saved)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!actor) return
    setArchiving(true)
    setError(null)
    try {
      if (actor.is_archived) {
        await window.api.restoreActor(actor.id)
        onArchived({ ...actor, is_archived: 0 })
      } else {
        await window.api.archiveActor(actor.id)
        onArchived({ ...actor, is_archived: 1 })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="actor-detail">
      {/* 이미지 영역 */}
      <div className="actor-detail__image-wrap">
        {form.image_path ? (
          <img
            src={form.image_path}
            alt={form.name || '배우'}
            className="actor-detail__image"
          />
        ) : (
          <div className="actor-detail__image-placeholder">👤</div>
        )}
      </div>

      {/* 폼 */}
      <div className="actor-detail__form">
        <label className="actor-detail__field">
          <span className="actor-detail__label">이름 <span className="actor-detail__required">*</span></span>
          <input
            className="actor-detail__input"
            type="text"
            value={form.name}
            onChange={set('name')}
            placeholder="배우 이름"
          />
        </label>

        <label className="actor-detail__field">
          <span className="actor-detail__label">이미지 경로</span>
          <input
            className="actor-detail__input"
            type="text"
            value={form.image_path}
            onChange={set('image_path')}
            placeholder="이미지 파일 경로 (추후 업로드 지원 예정)"
          />
        </label>

        <label className="actor-detail__field">
          <span className="actor-detail__label">소속사</span>
          <input
            className="actor-detail__input"
            type="text"
            value={form.agency}
            onChange={set('agency')}
            placeholder="소속사명"
          />
        </label>

        <label className="actor-detail__field">
          <span className="actor-detail__label">태그</span>
          <input
            className="actor-detail__input"
            type="text"
            value={form.tags}
            onChange={set('tags')}
            placeholder="예: 슬랜더, 장신, 프리 (쉼표로 구분)"
          />
        </label>

        <label className="actor-detail__field">
          <span className="actor-detail__label">별점</span>
          <StarRating
            value={form.rating}
            onChange={(n) => setForm((p) => ({ ...p, rating: n }))}
            size="md"
          />
        </label>

        <label className="actor-detail__field">
          <span className="actor-detail__label">메모</span>
          <textarea
            className="actor-detail__textarea"
            rows={3}
            value={form.memo}
            onChange={set('memo')}
            placeholder="자유 메모"
          />
        </label>
      </div>

      {/* 피드백 */}
      {error   && <p className="actor-detail__error">{error}</p>}
      {success && <p className="actor-detail__success">{success}</p>}

      {/* 액션 버튼 */}
      <div className="actor-detail__actions">
        <button
          className="btn-primary"
          type="button"
          onClick={handleSave}
          disabled={saving || (!isNew && !isDirty)}
        >
          {saving ? '저장 중…' : (isNew ? '배우 추가' : '저장')}
        </button>

        {!isNew && (
          <button
            className={actor.is_archived ? 'btn-secondary' : 'btn-secondary'}
            type="button"
            onClick={handleArchive}
            disabled={archiving}
            title={actor.is_archived ? '아카이브 해제' : '아카이브 (숨김 처리)'}
          >
            {archiving ? '처리 중…' : (actor.is_archived ? '복구' : '아카이브')}
          </button>
        )}
      </div>

      {/* 연결 작품 */}
      {!isNew && (
        <div className="actor-detail__videos">
          <h3 className="actor-detail__videos-title">
            연결 작품 <span className="actor-detail__videos-count">{videos.length}</span>
          </h3>
          {videos.length === 0 ? (
            <p className="actor-detail__videos-empty">연결된 작품이 없습니다.</p>
          ) : (
            <ul className="actor-detail__video-list">
              {videos.map((v) => (
                <li key={v.id} className="actor-detail__video-item">
                  <span className="actor-detail__video-code">{v.code || '—'}</span>
                  <span className="actor-detail__video-name" title={v.file_name}>
                    {v.file_name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
