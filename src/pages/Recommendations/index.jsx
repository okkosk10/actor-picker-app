/**
 * src/pages/Recommendations/index.jsx
 * 배우 메타데이터 기반 추천·탐색 페이지
 */
import { useState, useCallback, useRef, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────
// 추천 프리셋 정의
// ─────────────────────────────────────────────────────────────
const PRESETS = [
  { key: 'top_actor_videos',     label: '⭐ 고평점 배우 작품',    desc: '별점 4점 이상인 배우의 작품' },
  { key: 'top_rated_videos',     label: '🏆 고평점 영상',         desc: '별점 4점 이상인 영상' },
  { key: 'new_top_actor',        label: '🆕 NEW × 고평점 배우',   desc: 'NEW 파일 중 별점 3점 이상 배우 포함 작품' },
  { key: 'tag_actor_videos',     label: '🏷 태그 배우 작품',      desc: '특정 태그를 가진 배우의 작품 (아래 태그 입력)', needsTag: true },
  { key: 'recent_copied_actor',  label: '📋 최근 복사한 배우 작품', desc: '최근에 복사한 배우들의 다른 작품' },
  { key: 'recent_played_actor',  label: '▶ 최근 재생한 배우 작품', desc: '최근에 재생한 배우들의 다른 작품' },
  { key: 'not_copied_high_rated',label: '🔍 미복사 고평점 작품',  desc: '아직 복사하지 않은 별점 4점 이상 작품' },
  { key: 'random_by_actor',      label: '🎲 배우별 랜덤 추천',    desc: '별점 3점 이상 배우에서 각 1개씩 랜덤 선택' },
  { key: 'similar_tag_actor',    label: '🔗 비슷한 태그 배우 작품', desc: '자주 복사한 배우와 비슷한 태그를 가진 다른 배우 작품' },
]

// AI 채팅 예시 프롬프트
const EXAMPLE_PROMPTS = [
  '별점 높은데 아직 안 복사한 거 추천해줘',
  '최근 복사한 배우랑 비슷한 태그 작품 추천해줘',
  '삭제요망은 빼고 재시청 추천 작품 보여줘',
  '즐겨찾기 중에서 골라줘',
]

// ─────────────────────────────────────────────────────────────
// VideoCard (프리셋용)
// ─────────────────────────────────────────────────────────────
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
        <div className="rec-video-card__name" title={video.file_name}>{video.file_name}</div>
        <div className="rec-video-card__meta">
          {video.rating > 0 && <span className="rec-video-card__rating">{'★'.repeat(video.rating)}</span>}
          {video.recommended === 1 && <span className="rec-video-card__badge rec-video-card__badge--rec">⭐ 추천</span>}
          {video.is_new === 1 && <span className="rec-video-card__badge rec-video-card__badge--new">NEW</span>}
          {actors.length > 0 && actors[0].rating > 0 && (
            <span className="rec-video-card__actor-rating" title="배우 별점">배우{'★'.repeat(actors[0].rating)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// AiChatCard (AI 추천 결과 카드)
// ─────────────────────────────────────────────────────────────
function AiChatCard({ item, intent, checkedIds, onToggleCheck }) {
  const { video, reason, scoreComment } = item
  const actors = video.actorsList || []

  // 배우 별점 기준 쿼리일 때 qualifying 배우(조건 충족)와 공동출연자 구분
  const actorRatingFilter = (intent?.actorRatingExact ?? 0) > 0
    ? intent.actorRatingExact
    : (intent?.actorMinRating ?? 0)
  const isActorRatingQuery = actorRatingFilter > 0

  let actorLabel
  if (actors.length > 0) {
    if (isActorRatingQuery) {
      // qualifying 배우: 조건 별점 충족 → 앞에 ★ 표시
      // 공동출연자: 조건 미충족 → 그대로 (흐리게 렌더)
      actorLabel = actors.map((a) => {
        const q = intent?.actorRatingExact > 0
          ? (a.rating ?? 0) === intent.actorRatingExact
          : (a.rating ?? 0) >= actorRatingFilter
        return q ? `★${a.name}` : a.name
      }).join(', ')
    } else {
      actorLabel = actors.map((a) => a.name).join(', ')
    }
  } else {
    actorLabel = video.actor_name || '—'
  }
  const tags = (video.tags || '').split(',').map(t => t.trim()).filter(Boolean)
  const isChecked = checkedIds?.has(video.id) ?? false

  return (
    <div
      style={{
        background: isChecked ? '#1a2a3a' : '#161616',
        border: `1px solid ${isChecked ? '#3b82f6' : '#2a2a2a'}`,
        borderRadius: 8,
        padding: '12px 14px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onClick={() => onToggleCheck?.(video.id)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleCheck?.(video.id)}
          onClick={(e) => e.stopPropagation()}
          style={{ marginTop: 3, flexShrink: 0, accentColor: '#3b82f6' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 배우 + 코드 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{actorLabel}</span>
            {video.code && <span style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace' }}>{video.code}</span>}
            {video.rating > 0 && <span style={{ color: '#facc15', fontSize: 12 }}>{'★'.repeat(video.rating)}</span>}
            {video.grade && video.grade !== '보관' && (
              <span style={{
                fontSize: 11, padding: '1px 6px', borderRadius: 3,
                background: video.grade === '영구소장' ? '#14532d' : video.grade === '재시청 추천' ? '#1e3a5f' : '#2a1010',
                color: video.grade === '영구소장' ? '#86efac' : video.grade === '재시청 추천' ? '#93c5fd' : '#fca5a5',
              }}>{video.grade}</span>
            )}
            {video.is_new === 1 && <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 3, background: '#422006', color: '#fb923c' }}>NEW</span>}
          </div>
          {/* 파일명 */}
          <div style={{ color: '#94a3b8', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}
            title={video.file_name}>
            {video.file_name}
          </div>
          {/* 태그 */}
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 5 }}>
              {tags.slice(0, 5).map(t => (
                <span key={t} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#1e293b', color: '#7dd3fc' }}>{t}</span>
              ))}
            </div>
          )}
          {/* AI 추천 이유 */}
          <div style={{ fontSize: 12, color: '#a78bfa', borderLeft: '2px solid #4c1d95', paddingLeft: 8, marginTop: 4 }}>
            {reason}
          </div>
          {/* 점수 근거 */}
          {scoreComment && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{scoreComment}</div>
          )}
          {/* 통계 */}
          <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 11, color: '#475569' }}>
            {video.play_count > 0 && <span>▶ {video.play_count}</span>}
            {video.copy_count > 0 && <span>📋 {video.copy_count}</span>}
            {video.themeScore > 0 && <span>점수 {video.themeScore}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// AiChatPanel
// ─────────────────────────────────────────────────────────────
// window.__aiChatCache 에 result/prompt/checkedIds 를 캐싱한다.
// 컴포넌트가 언마운트/재마운트되어도 이전 결과가 복원된다.
function AiChatPanel({ onCopyFiles }) {
  const [prompt,     setPrompt]     = useState(() => window.__aiChatCache?.prompt     ?? '')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [result,     setResult]     = useState(() => window.__aiChatCache?.result     ?? null)
  const [checkedIds, setCheckedIds] = useState(() =>
    window.__aiChatCache?.checkedIds ? new Set(window.__aiChatCache.checkedIds) : new Set()
  )
  const textareaRef = useRef(null)

  // 핵심 상태 변경 시 window 캐시 동기화
  useEffect(() => {
    window.__aiChatCache = {
      prompt,
      result,
      checkedIds: [...checkedIds],
    }
  }, [prompt, result, checkedIds])

  // 전송
  const handleAsk = useCallback(async () => {
    const q = prompt.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setResult(null)
    setCheckedIds(new Set())
    try {
      const res = await window.api.askAiChatRecommend(q)
      if (!res.success) {
        setError(res.error ?? 'AI 추천 실패')
        return
      }
      setResult(res)
      // 모두 기본 체크
      setCheckedIds(new Set(res.items.map(it => it.video.id)))
    } catch (e) {
      setError(e.message || '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }, [prompt])

  // Enter 전송 (Shift+Enter = 줄바꿈)
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }

  const toggleCheck = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (!result) return
    const allIds = result.items.map(it => it.video.id)
    setCheckedIds(checkedIds.size === allIds.length ? new Set() : new Set(allIds))
  }

  const checkedFiles = result
    ? result.items.filter(it => checkedIds.has(it.video.id)).map(it => it.video.file_path)
    : []

  // 의도 배지 렌더
  const renderIntentBadges = (intent) => {
    if (!intent) return null
    const badges = []
    if (intent.minRating > 0) badges.push(`별점 ≥${intent.minRating}`)
    if (intent.onlyNew)       badges.push('NEW만')
    if (intent.onlyNotCopied) badges.push('미복사')
    if (intent.onlyFavorite)  badges.push('즐겨찾기')
    if (intent.videoTags?.length)  badges.push(...intent.videoTags.map(t => `영상태그:${t}`))
    if (intent.actorTags?.length)  badges.push(...intent.actorTags.map(t => `배우태그:${t}`))
    if (intent.actorNames?.length) badges.push(...intent.actorNames.map(n => `배우:${n}`))
    if (intent.excludeGrades?.length) badges.push(`제외:${intent.excludeGrades.join(',')}`)
    return badges.map(b => (
      <span key={b} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, background: '#1e293b', color: '#7dd3fc', marginRight: 4 }}>{b}</span>
    ))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 입력 영역 */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
          예시:
          {EXAMPLE_PROMPTS.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPrompt(p)}
              style={{ marginLeft: 8, fontSize: 11, padding: '2px 7px', borderRadius: 4, border: '1px solid #334155', background: 'none', color: '#64748b', cursor: 'pointer' }}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="자연어로 질문하세요. (Enter 전송 / Shift+Enter 줄바꿈)"
            rows={2}
            style={{
              flex: 1, resize: 'vertical', minHeight: 52,
              background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
              color: '#e2e8f0', padding: '8px 12px', fontSize: 13,
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            onClick={handleAsk}
            disabled={loading || !prompt.trim()}
            style={{
              padding: '0 20px', height: 52, borderRadius: 6, border: 'none',
              background: loading ? '#334155' : '#3b82f6', color: '#fff',
              fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            {loading ? '⏳' : '🔍 질문'}
          </button>
        </div>
      </div>

      {/* 결과 스크롤 영역 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {/* 오류 */}
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 12, background: '#2a1010', border: '1px solid #5c2020', borderRadius: 6, color: '#ff7875', fontSize: 13 }}>
            ❌ {error}
          </div>
        )}

        {/* 로딩 */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🤖</div>
            <div>AI가 분석 중입니다…</div>
            <div style={{ fontSize: 12, marginTop: 6, color: '#334155' }}>의도 분석 → DB 조회 → AI 추천 순으로 진행됩니다.</div>
          </div>
        )}

        {/* 초기 상태 */}
        {!loading && !result && !error && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#334155' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
            <div style={{ color: '#475569', fontSize: 14 }}>위 입력창에 원하는 조건을 자연어로 입력하면</div>
            <div style={{ color: '#475569', fontSize: 14 }}>AI가 DB를 분석해 추천 결과를 제공합니다.</div>
          </div>
        )}

        {/* 결과 */}
        {!loading && result && (
          <>
            {/* 요약 박스 */}
            <div style={{ padding: '12px 16px', marginBottom: 14, background: '#0f1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }}>
              <div style={{ fontWeight: 700, color: '#7dd3fc', marginBottom: 4, fontSize: 14 }}>🤖 {result.summary}</div>
              {result.reason && <div style={{ color: '#94a3b8', fontSize: 12 }}>{result.reason}</div>}
              {result.intent && (
                <div style={{ marginTop: 8 }}>{renderIntentBadges(result.intent)}</div>
              )}
            </div>

            {/* 액션 바 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ color: '#64748b', fontSize: 13 }}>
                {result.items.length}개 추천
              </span>
              <button type="button" onClick={toggleAll}
                style={{ fontSize: 12, padding: '3px 10px', borderRadius: 4, border: '1px solid #334155', background: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                {checkedIds.size === result.items.length ? '전체 해제' : '전체 선택'}
              </button>
              {checkedIds.size > 0 && onCopyFiles && (
                <button type="button"
                  onClick={() => onCopyFiles(checkedFiles)}
                  style={{ fontSize: 12, padding: '3px 12px', borderRadius: 4, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                  📂 선택 복사 ({checkedIds.size}개)
                </button>
              )}
            </div>

            {/* 카드 목록 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.items.map((item) => (
                <AiChatCard
                  key={item.video.id}
                  item={item}
                  intent={result.intent}
                  checkedIds={checkedIds}
                  onToggleCheck={toggleCheck}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────────────────────
export default function RecommendationsPage({ onCopyFiles }) {
  const [tab,           setTab]          = useState('preset')   // 'preset' | 'ai-chat'
  const [activePreset,  setActivePreset] = useState(null)
  const [tagInput,      setTagInput]     = useState('')
  const [videos,        setVideos]       = useState([])
  const [loading,       setLoading]      = useState(false)
  const [error,         setError]        = useState(null)
  const [checkedIds,    setCheckedIds]   = useState(new Set())
  const [limit,         setLimit]        = useState(50)

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
    if (preset.needsTag && !tagInput.trim()) { setError('태그를 입력해 주세요.'); return }
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
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (checkedIds.size === videos.length) setCheckedIds(new Set())
    else setCheckedIds(new Set(videos.map((v) => v.id)))
  }

  const checkedFiles = videos.filter((v) => checkedIds.has(v.id)).map((v) => v.file_path)
  const activePresetInfo = PRESETS.find((p) => p.key === activePreset)

  return (
    <div className="rec-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 탭 헤더 */}
      <div style={{ display: 'flex', borderBottom: '2px solid #1f2937', flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setTab('preset')}
          style={{
            padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            background: 'none',
            color: tab === 'preset' ? '#3b82f6' : '#64748b',
            borderBottom: tab === 'preset' ? '2px solid #3b82f6' : '2px solid transparent',
            marginBottom: -2,
          }}
        >
          🎬 추천 프리셋
        </button>
        <button
          type="button"
          onClick={() => setTab('ai-chat')}
          style={{
            padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            background: 'none',
            color: tab === 'ai-chat' ? '#a78bfa' : '#64748b',
            borderBottom: tab === 'ai-chat' ? '2px solid #a78bfa' : '2px solid transparent',
            marginBottom: -2,
          }}
        >
          💬 AI 채팅 추천
        </button>
      </div>

      {/* AI 채팅 탭 — display:none으로 마운트 유지, state 보존 */}
      <div style={{ flex: 1, minHeight: 0, display: tab === 'ai-chat' ? 'flex' : 'none', flexDirection: 'column' }}>
        <AiChatPanel onCopyFiles={onCopyFiles} />
      </div>

      {/* 프리셋 탭 — display:none으로 마운트 유지 */}
      <div className="rec-page" style={{ flex: 1, minHeight: 0, display: tab === 'preset' ? 'flex' : 'none' }}>
          {/* 프리셋 사이드바 */}
          <div className="rec-sidebar">
            <h2 className="rec-sidebar__title">추천 프리셋</h2>
            <div className="rec-sidebar__tag-input">
              <input
                type="text"
                placeholder="태그 배우 검색용 태그 입력"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                className="rec-sidebar__tag-field"
              />
            </div>
            <div className="rec-sidebar__limit">
              <label>
                최대
                <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                  {[20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}개</option>)}
                </select>
              </label>
            </div>
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={['rec-preset-btn', activePreset === preset.key ? 'rec-preset-btn--active' : ''].join(' ')}
                onClick={() => handlePresetClick(preset)}
              >
                <span className="rec-preset-btn__label">{preset.label}</span>
                <span className="rec-preset-btn__desc">{preset.desc}</span>
              </button>
            ))}
          </div>

          {/* 결과 패널 */}
          <div className="rec-main">
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
                    <button type="button" className="btn-secondary" onClick={toggleAll}>
                      {checkedIds.size === videos.length ? '전체 해제' : '전체 선택'}
                    </button>
                    {checkedIds.size > 0 && onCopyFiles && (
                      <button type="button" className="btn-or-copy" onClick={() => onCopyFiles(checkedFiles)}>
                        📂 선택 복사 ({checkedIds.size}개)
                      </button>
                    )}
                  </>
                )}
                {activePreset && (
                  <button type="button" className="btn-primary" onClick={handleRefresh} disabled={loading}>
                    🔄 새로고침
                  </button>
                )}
              </div>
            </div>

            {error && <div className="rec-main__error">{error}</div>}
            {loading && <div className="rec-main__loading">추천 목록 불러오는 중…</div>}

            {!loading && !activePreset && (
              <div className="rec-main__empty">
                <div className="rec-main__empty-icon">🎬</div>
                <p>왼쪽에서 추천 프리셋을 선택하세요.</p>
              </div>
            )}

            {!loading && activePreset && videos.length === 0 && (
              <div className="rec-main__empty">
                <p>해당 조건의 영상이 없습니다.</p>
                <p className="rec-main__empty-hint">배우 별점 / 태그를 먼저 설정한 후 다시 시도해 보세요.</p>
              </div>
            )}

            {!loading && videos.length > 0 && (
              <div className="rec-main__grid">
                {videos.map((video) => (
                  <VideoCard key={video.id} video={video} checkedIds={checkedIds} onToggleCheck={toggleCheck} />
                ))}
              </div>
            )}
          </div>
        </div>
    </div>
  )
}
