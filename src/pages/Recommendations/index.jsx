/**
 * src/pages/Recommendations/index.jsx
 * 배우 메타데이터 기반 추천·탐색 페이지
 *
 * 추천 프리셋:
 *   top_actor_videos    : 별점 높은 배우의 작품
 *   top_rated_videos    : 별점 높은 영상
 *   new_top_actor       : NEW 중 고평점 배우 포함 작품
 *   tag_actor_videos    : 특정 태그 배우의 작품
 *   recent_copied_actor : 최근 많이 복사한 배우의 작품
 *   recent_played_actor : 최근 많이 재생한 배우의 작품
 *   not_copied_high_rated: 아직 복사하지 않은 고평점 작품
 *   random_by_actor     : 배우별 랜덤 추천
 *   similar_tag_actor   : 자주 복사한 배우와 비슷한 태그 작품
 */
import { useState, useCallback } from 'react'

const PRESETS = [
  {
    key:   'top_actor_videos',
    label: '⭐ 고평점 배우 작품',
    desc:  '별점 4점 이상인 배우의 작품',
  },
  {
    key:   'top_rated_videos',
    label: '🏆 고평점 영상',
    desc:  '별점 4점 이상인 영상',
  },
  {
    key:   'new_top_actor',
    label: '🆕 NEW × 고평점 배우',
    desc:  'NEW 파일 중 별점 3점 이상 배우 포함 작품',
  },
  {
    key:   'tag_actor_videos',
    label: '🏷 태그 배우 작품',
    desc:  '특정 태그를 가진 배우의 작품 (아래 태그 입력)',
    needsTag: true,
  },
  {
    key:   'recent_copied_actor',
    label: '📋 최근 복사한 배우 작품',
    desc:  '최근에 복사한 배우들의 다른 작품',
  },
  {
    key:   'recent_played_actor',
    label: '▶ 최근 재생한 배우 작품',
    desc:  '최근에 재생한 배우들의 다른 작품',
  },
  {
    key:   'not_copied_high_rated',
    label: '🔍 미복사 고평점 작품',
    desc:  '아직 복사하지 않은 별점 4점 이상 작품',
  },
  {
    key:   'random_by_actor',
    label: '🎲 배우별 랜덤 추천',
    desc:  '별점 3점 이상 배우에서 각 1개씩 랜덤 선택',
  },
  {
    key:   'similar_tag_actor',
    label: '🔗 비슷한 태그 배우 작품',
    desc:  '자주 복사한 배우와 비슷한 태그를 가진 다른 배우 작품',
  },
]

function VideoCard({ video, checkedIds, onToggleCheck }) {
  const actors = video.actorsList || []
  const actorLabel = actors.length > 0
    ? actors.map((a) => a.name).join(', ')
    : (video.actor_name || '—')

  const isChecked = checkedIds?.has(video.id) ?? false

  return (
    <div
      className={`rec-video-card ${isChecked ? 'rec-video-card--checked' : ''}`}
      onClick={() => onToggleCheck?.(video.id)}
    >
      <input
        type="checkbox"
        className="rec-video-card__check"
        checked={isChecked}
        onChange={() => onToggleCheck?.(video.id)}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="rec-video-card__body">
        <div className="rec-video-card__actors">{actorLabel}</div>
        <div className="rec-video-card__code">{video.code || '—'}</div>
        <div className="rec-video-card__name" title={video.file_name}>
          {video.file_name}
        </div>
        <div className="rec-video-card__meta">
          {video.rating > 0 && (
            <span className="rec-video-card__rating">{'★'.repeat(video.rating)}</span>
          )}
          {video.recommended === 1 && (
            <span className="rec-video-card__badge rec-video-card__badge--rec">⭐ 추천</span>
          )}
          {video.is_new === 1 && (
            <span className="rec-video-card__badge rec-video-card__badge--new">NEW</span>
          )}
          {actors.length > 0 && actors[0].rating > 0 && (
            <span className="rec-video-card__actor-rating" title="배우 별점">
              배우{'★'.repeat(actors[0].rating)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function RecommendationsPage({ onCopyFiles }) {
  const [activePreset,  setActivePreset]  = useState(null)
  const [tagInput,      setTagInput]      = useState('')
  const [videos,        setVideos]        = useState([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [checkedIds,    setCheckedIds]    = useState(new Set())
  const [limit,         setLimit]         = useState(50)

  const loadPreset = useCallback(async (presetKey, extraTag) => {
    setError(null)
    setLoading(true)
    setVideos([])
    setCheckedIds(new Set())
    try {
      const params = { limit }
      if (extraTag) params.tag = extraTag.trim()
      const result = await window.api.getRecommendations(presetKey, params)
      setVideos(result)
      setActivePreset(presetKey)
    } catch (e) {
      setError('추천 조회 실패: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [limit])

  const handlePresetClick = (preset) => {
    if (preset.needsTag && !tagInput.trim()) {
      setError('태그를 입력해 주세요.')
      return
    }
    loadPreset(preset.key, preset.needsTag ? tagInput : undefined)
  }

  const handleRefresh = () => {
    if (!activePreset) return
    const preset = PRESETS.find((p) => p.key === activePreset)
    loadPreset(activePreset, preset?.needsTag ? tagInput : undefined)
  }

  const toggleCheck = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (checkedIds.size === videos.length) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(videos.map((v) => v.id)))
    }
  }

  const checkedFiles = videos
    .filter((v) => checkedIds.has(v.id))
    .map((v) => v.file_path)

  const activePresetInfo = PRESETS.find((p) => p.key === activePreset)

  return (
    <div className="rec-page">
      {/* 프리셋 사이드바 */}
      <div className="rec-sidebar">
        <h2 className="rec-sidebar__title">추천 프리셋</h2>

        {/* 태그 입력 (tag_actor_videos 전용) */}
        <div className="rec-sidebar__tag-input">
          <input
            type="text"
            placeholder="태그 배우 검색용 태그 입력"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            className="rec-sidebar__tag-field"
          />
        </div>

        {/* 결과 수 */}
        <div className="rec-sidebar__limit">
          <label>
            최대
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[20, 30, 50, 100].map((n) => (
                <option key={n} value={n}>{n}개</option>
              ))}
            </select>
          </label>
        </div>

        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className={[
              'rec-preset-btn',
              activePreset === preset.key ? 'rec-preset-btn--active' : '',
            ].join(' ')}
            onClick={() => handlePresetClick(preset)}
          >
            <span className="rec-preset-btn__label">{preset.label}</span>
            <span className="rec-preset-btn__desc">{preset.desc}</span>
          </button>
        ))}
      </div>

      {/* 결과 패널 */}
      <div className="rec-main">
        {/* 헤더 */}
        <div className="rec-main__header">
          {activePresetInfo && (
            <div className="rec-main__preset-name">
              {activePresetInfo.label}
              <span className="rec-main__count"> — {videos.length}개</span>
            </div>
          )}
          <div className="rec-main__actions">
            {videos.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={toggleAll}
                >
                  {checkedIds.size === videos.length ? '전체 해제' : '전체 선택'}
                </button>
                {checkedIds.size > 0 && onCopyFiles && (
                  <button
                    type="button"
                    className="btn-or-copy"
                    onClick={() => onCopyFiles(checkedFiles)}
                  >
                    📂 선택 복사 ({checkedIds.size}개)
                  </button>
                )}
              </>
            )}
            {activePreset && (
              <button
                type="button"
                className="btn-primary"
                onClick={handleRefresh}
                disabled={loading}
              >
                🔄 새로고침
              </button>
            )}
          </div>
        </div>

        {/* 오류 */}
        {error && <div className="rec-main__error">{error}</div>}

        {/* 로딩 */}
        {loading && <div className="rec-main__loading">추천 목록 불러오는 중…</div>}

        {/* 빈 상태 */}
        {!loading && !activePreset && (
          <div className="rec-main__empty">
            <div className="rec-main__empty-icon">🎬</div>
            <p>왼쪽에서 추천 프리셋을 선택하세요.</p>
          </div>
        )}

        {!loading && activePreset && videos.length === 0 && (
          <div className="rec-main__empty">
            <p>해당 조건의 영상이 없습니다.</p>
            <p className="rec-main__empty-hint">
              배우 별점 / 태그를 먼저 설정한 후 다시 시도해 보세요.
            </p>
          </div>
        )}

        {/* 영상 카드 그리드 */}
        {!loading && videos.length > 0 && (
          <div className="rec-main__grid">
            {videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                checkedIds={checkedIds}
                onToggleCheck={toggleCheck}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
