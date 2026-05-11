/**
 * src/pages/Dashboard/DashboardRecommendations.jsx
 * 가중치 기반 대시보드 추천 — 섹션별 카드 UI
 */
import { useState, useEffect, useCallback } from 'react'
import StarRating from '../../components/common/StarRating.jsx'

// ── 유틸 ─────────────────────────────────────────────────────
function formatDate(str) {
  if (!str) return '—'
  return str.slice(0, 10)
}
function fmtDays(days) {
  if (days >= 9999) return '활동 없음'
  if (days === 0)   return '오늘'
  if (days === 1)   return '어제'
  if (days < 30)    return `${days}일 전`
  if (days < 365)   return `${Math.floor(days / 30)}개월 전`
  return `${Math.floor(days / 365)}년 전`
}
const GRADE_COLOR = {
  '영구소장':    '#f59e0b',
  '재시청 추천': '#10b981',
  '만족':        '#6366f1',
  '보관':        '#6b7280',
  '애매':        '#d97706',
  '삭제요망':    '#ef4444',
}
const ISSUE_COLOR = {
  '배우 연결 필요': '#f59e0b',
  '배우 없음':      '#ef4444',
  '태그 없음':      '#6b7280',
  '평점 없음':      '#d97706',
  '추천 표시 없음': '#6b7280',
}

// ── 추천 카드 ─────────────────────────────────────────────────
function RecCard({ video, onCopyFiles, onViewDetail, showScore = true, extraBadge = null, showRatingEdit = false, onRatingUpdate }) {
  const [updating, setUpdating] = useState(false)

  const handleOpen   = () => window.api.openVideo(video.filePath)
  const handleFolder = () => window.api.openFolder(video.folderPath)
  const handleCopy   = () => onCopyFiles && onCopyFiles([video.filePath])
  const handleDetail = () => onViewDetail && onViewDetail(video.id)

  const handleRatingChange = useCallback(async (newRating) => {
    if (updating) return
    setUpdating(true)
    try {
      await window.api.updateGrade(video.id, {
        grade:       video.grade       || '보관',
        rating:      newRating,
        recommended: video.recommended ? 1 : 0,
      })
      onRatingUpdate && onRatingUpdate(video.id, newRating)
    } catch (e) {
      console.error('[RecCard] 평점 업데이트 실패:', e)
    } finally {
      setUpdating(false)
    }
  }, [video.id, video.grade, video.recommended, updating, onRatingUpdate])

  const actorLabels = video.actors?.map(a => a.name).join(', ') || video.actorName || '—'
  const tagLabels   = video.tags?.length > 0 ? video.tags.slice(0, 4).join(', ') + (video.tags.length > 4 ? ' …' : '') : '—'

  return (
    <div className="rec-card">
      {/* 헤더 행 */}
      <div className="rec-card__header">
        <span className="rec-card__title" title={video.fileName}>{video.fileName}</span>
        {showScore && (
          <span className="rec-card__score" title="추천 점수">
            {video.score >= 0 ? '+' : ''}{video.score}
          </span>
        )}
      </div>

      {/* 배우 / 태그 */}
      <div className="rec-card__meta">
        <span className="rec-card__meta-label">배우</span>
        <span className="rec-card__meta-value" title={actorLabels}>{actorLabels}</span>
      </div>
      <div className="rec-card__meta">
        <span className="rec-card__meta-label">태그</span>
        <span className="rec-card__meta-value" title={video.tags?.join(', ')}>{tagLabels}</span>
      </div>

      {/* 평점 + 등급 */}
      <div className="rec-card__rating-row">
        {showRatingEdit ? (
          <StarRating value={video.rating} onChange={handleRatingChange} size="sm" />
        ) : (
          <StarRating value={video.rating} readOnly size="sm" />
        )}
        {video.grade && (
          <span
            className="rec-card__grade"
            style={{ color: GRADE_COLOR[video.grade] ?? '#6b7280' }}
          >
            {video.grade}
          </span>
        )}
        {video.recommended && <span className="rec-card__rec-badge">★추천</span>}
      </div>

      {/* 추가 뱃지 (섹션별 메시지) */}
      {extraBadge && <div className="rec-card__extra-badge">{extraBadge}</div>}

      {/* 추천 이유 */}
      {video.reasons && video.reasons.length > 0 && (
        <div className="rec-card__reasons">
          {video.reasons.slice(0, 3).map(r => (
            <span key={r} className="rec-card__reason-tag">{r}</span>
          ))}
        </div>
      )}

      {/* 활동 통계 */}
      <div className="rec-card__stats">
        <span title="장치 복사">📲 {video.copyDeviceCount ?? 0}</span>
        <span title="클립보드 복사">📋 {video.copyClipCount ?? 0}</span>
        <span title="재생">▶ {video.openCount ?? 0}</span>
        <span className="rec-card__stats-date" title="최근 활동일">
          {fmtDays(video.lastActivityDays)}
        </span>
      </div>

      {/* 액션 버튼 */}
      <div className="rec-card__actions">
        <button type="button" className="rec-card__btn" onClick={handleOpen}   title="파일 열기">재생</button>
        <button type="button" className="rec-card__btn" onClick={handleFolder} title="폴더 열기">폴더</button>
        <button type="button" className="rec-card__btn" onClick={handleCopy}   title="장치 복사">복사</button>
        <button type="button" className="rec-card__btn rec-card__btn--detail" onClick={handleDetail} title="라이브러리에서 보기">상세</button>
      </div>
    </div>
  )
}

// ── 메타데이터 수정 카드 ───────────────────────────────────────
function MetaCard({ video, onViewDetail }) {
  const handleFolder = () => window.api.openFolder(video.folderPath)
  const handleDetail = () => onViewDetail && onViewDetail(video.id)
  const actorLabels  = video.actors?.map(a => a.name).join(', ') || video.actorName || '—'

  return (
    <div className="rec-card rec-card--meta">
      <div className="rec-card__header">
        <span className="rec-card__title" title={video.fileName}>{video.fileName}</span>
      </div>
      <div className="rec-card__meta">
        <span className="rec-card__meta-label">배우</span>
        <span className="rec-card__meta-value">{actorLabels}</span>
      </div>
      <div className="rec-card__issues">
        {video.metadataIssues?.filter(i => i !== '추천 표시 없음').map(issue => (
          <span
            key={issue}
            className="rec-card__issue-tag"
            style={{ borderColor: ISSUE_COLOR[issue] ?? '#6b7280', color: ISSUE_COLOR[issue] ?? '#6b7280' }}
          >
            {issue}
          </span>
        ))}
      </div>
      <div className="rec-card__actions">
        <button type="button" className="rec-card__btn" onClick={handleFolder}>폴더</button>
        <button type="button" className="rec-card__btn rec-card__btn--detail" onClick={handleDetail}>수정하기</button>
      </div>
    </div>
  )
}

// ── 섹션 래퍼 ─────────────────────────────────────────────────
function RecSection({ title, icon, count, description, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rec-section">
      <button
        type="button"
        className="rec-section__header"
        onClick={() => setOpen(o => !o)}
      >
        <span className="rec-section__icon">{icon}</span>
        <span className="rec-section__title">{title}</span>
        <span className="rec-section__count">{count}개</span>
        <span className="rec-section__toggle">{open ? '▲' : '▼'}</span>
      </button>
      {description && <p className="rec-section__desc">{description}</p>}
      {open && <div className="rec-section__cards">{children}</div>}
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function DashboardRecommendations({ onCopyFiles, onViewDetail }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  // 평점 업데이트 후 로컬 반영용
  const [ratingOverrides, setRatingOverrides] = useState({})

  const fetchRecs = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.getDashboardRecommendations()
      setData(result)
      setRatingOverrides({})
    } catch (e) {
      setError(e.message || '추천 로드 실패')
    } finally {
      setLoading(false)
    }
  }

  // 첫 렌더 시 자동 로드
  useEffect(() => { fetchRecs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRatingUpdate = useCallback((videoId, newRating) => {
    setRatingOverrides(prev => ({ ...prev, [videoId]: newRating }))
  }, [])

  const applyRatingOverride = (video) => {
    const ov = ratingOverrides[video.id]
    return ov !== undefined ? { ...video, rating: ov } : video
  }

  if (loading) return <div className="dash-loading">추천 계산 중…</div>
  if (error)   return (
    <div className="dash-error">
      추천 로드 실패: {error}
      <button className="btn-secondary" onClick={fetchRecs} style={{ marginLeft: 12 }}>재시도</button>
    </div>
  )
  if (!data)   return null

  const {
    topPicks = [], stalePreferences = [], highRatedUnderViewed = [],
    worthRevisiting = [], needsMetadata = [],
    ratingReview: { upCandidates = [], downCandidates = [], mismatch = [] } = {},
  } = data

  const cardProps = { onCopyFiles, onViewDetail, onRatingUpdate: handleRatingUpdate }

  return (
    <div className="rec-dash">
      {/* 새로고침 */}
      <div className="rec-dash__toolbar">
        <span className="rec-dash__info">로컬 DB 기반 가중치 추천 · AI 없음</span>
        <button type="button" className="btn-secondary" onClick={fetchRecs}>🔄 추천 새로고침</button>
      </div>

      {/* ① 오늘 추천 TOP */}
      <RecSection
        title="오늘 추천 TOP"
        icon="🏆"
        count={topPicks.length}
        description="배우 취향 · 태그 · 평점 · 활동 기록을 종합한 추천 점수 상위 작품입니다."
      >
        {topPicks.length === 0
          ? <p className="rec-section__empty">데이터가 부족합니다. 활동 기록이 쌓이면 표시됩니다.</p>
          : topPicks.map(v => (
              <RecCard key={v.id} video={applyRatingOverride(v)} showScore {...cardProps} />
            ))
        }
      </RecSection>

      {/* ② 취향은 맞는데 방치된 작품 */}
      <RecSection
        title="취향은 맞는데 방치된 작품"
        icon="💤"
        count={stalePreferences.length}
        description="자주 보는 배우가 출연하거나 취향 태그가 포함되어 있지만 최근 30일 이상 활동이 없는 작품입니다."
        defaultOpen={stalePreferences.length > 0}
      >
        {stalePreferences.length === 0
          ? <p className="rec-section__empty">해당 항목 없음</p>
          : stalePreferences.map(v => (
              <RecCard key={v.id} video={applyRatingOverride(v)} showScore
                extraBadge={`${fmtDays(v.lastActivityDays)} 방치`} {...cardProps} />
            ))
        }
      </RecSection>

      {/* ③ 고평점인데 덜 본 작품 */}
      <RecSection
        title="고평점인데 덜 본 작품"
        icon="⭐"
        count={highRatedUnderViewed.length}
        description="별점 4점 이상이지만 활동 횟수가 2회 이하인 작품입니다."
        defaultOpen={highRatedUnderViewed.length > 0}
      >
        {highRatedUnderViewed.length === 0
          ? <p className="rec-section__empty">해당 항목 없음</p>
          : highRatedUnderViewed.map(v => (
              <RecCard key={v.id} video={applyRatingOverride(v)} showScore={false} {...cardProps} />
            ))
        }
      </RecSection>

      {/* ④ 다시 볼만한 작품 */}
      <RecSection
        title="다시 볼만한 작품"
        icon="🔁"
        count={worthRevisiting.length}
        description="이전에 장치에 복사한 적 있지만 최근 30일 동안 활동이 없는 작품입니다."
        defaultOpen={worthRevisiting.length > 0}
      >
        {worthRevisiting.length === 0
          ? <p className="rec-section__empty">해당 항목 없음</p>
          : worthRevisiting.map(v => (
              <RecCard key={v.id} video={applyRatingOverride(v)} showScore
                extraBadge={`이전 복사 ${v.copyDeviceCount}회 · ${fmtDays(v.lastActivityDays)} 방치`} {...cardProps} />
            ))
        }
      </RecSection>

      {/* ⑤ 수정 추천 */}
      <RecSection
        title="수정 추천"
        icon="✏️"
        count={needsMetadata.length}
        description="태그 없음 · 평점 없음 · 배우 연결 부족 등 메타데이터가 부족한 작품입니다."
        defaultOpen={needsMetadata.length > 0}
      >
        {needsMetadata.length === 0
          ? <p className="rec-section__empty">수정이 필요한 항목 없음</p>
          : needsMetadata.map(v => (
              <MetaCard key={v.id} video={v} onViewDetail={onViewDetail} />
            ))
        }
      </RecSection>

      {/* ⑥ 평점 재검토 */}
      <RecSection
        title="평점 재검토 추천"
        icon="📊"
        count={upCandidates.length + downCandidates.length + mismatch.length}
        description="실제 이용 패턴과 현재 평점이 맞지 않는 작품입니다. 직접 확인 후 수정하세요."
        defaultOpen={(upCandidates.length + downCandidates.length + mismatch.length) > 0}
      >
        {upCandidates.length > 0 && (
          <div className="rec-review-group">
            <div className="rec-review-group__label rec-review-group__label--up">
              ▲ 평점 올리기 후보
            </div>
            <p className="rec-review-group__desc">자주 이용한 작품인데 평점이 낮습니다. 평점 상향을 검토해보세요.</p>
            <div className="rec-section__cards">
              {upCandidates.map(v => (
                <RecCard key={v.id} video={applyRatingOverride(v)} showScore={false}
                  showRatingEdit
                  extraBadge={`최근 30일 ${v.recent30d}회 · 총 ${v.totalActivity}회 이용`}
                  {...cardProps} />
              ))}
            </div>
          </div>
        )}

        {downCandidates.length > 0 && (
          <div className="rec-review-group">
            <div className="rec-review-group__label rec-review-group__label--down">
              ▼ 평점 낮추기 검토
            </div>
            <p className="rec-review-group__desc">평점은 높지만 최근 이용이 거의 없습니다. 평점 하향 또는 보관 여부를 검토해보세요.</p>
            <div className="rec-section__cards">
              {downCandidates.map(v => (
                <RecCard key={v.id} video={applyRatingOverride(v)} showScore={false}
                  showRatingEdit
                  extraBadge={`${fmtDays(v.lastActivityDays)} 미이용`}
                  {...cardProps} />
              ))}
            </div>
          </div>
        )}

        {mismatch.length > 0 && (
          <div className="rec-review-group">
            <div className="rec-review-group__label rec-review-group__label--mismatch">
              ⚠ 추천 표시 불일치
            </div>
            <p className="rec-review-group__desc">추천 표시와 평점이 어긋나 있습니다. 상태를 다시 확인해보세요.</p>
            <div className="rec-section__cards">
              {mismatch.map(v => {
                const badge = v.recommended && v.rating <= 2
                  ? `추천 표시 있음 · 평점 ${v.rating}점`
                  : `평점 ${v.rating}점 · 추천 표시 없음`
                return (
                  <RecCard key={v.id} video={applyRatingOverride(v)} showScore={false}
                    showRatingEdit
                    extraBadge={badge}
                    {...cardProps} />
                )
              })}
            </div>
          </div>
        )}

        {upCandidates.length === 0 && downCandidates.length === 0 && mismatch.length === 0 && (
          <p className="rec-section__empty">평점 재검토 항목 없음</p>
        )}
      </RecSection>
    </div>
  )
}
