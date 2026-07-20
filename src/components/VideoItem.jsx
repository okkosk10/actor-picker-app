/**
 * src/components/VideoItem.jsx
 * 동영상 목록의 단일 항목 컴포넌트
 *
 * Props:
 *   video    {Video}    - DB 레코드
 *   selected {boolean}  - 선택 여부
 *   onClick  {Function} - 클릭 콜백
 *   checked  {boolean}  - 파일 복사 체크박스 선택 여부
 *   onToggle {Function} - 체크박스 토글 콜백 (e, id) => void
 *
 * 표시 레이아웃:
 *   [체크박스(좌)] | 1행: 품번 + 배우명
 *                  2행: 배지 묶음
 *                  3행: 별점
 *                  4행: 파일명
 *                  5행: 폴더명 | 메모
 */
import { memo, useMemo } from 'react'
import { Tag }      from 'antd'
import StarRating   from './StarRating.jsx'
import ActorBadge   from './actors/ActorBadge.jsx'
import ActorTierBadge from './actors/ActorTierBadge.jsx'
import { GRADE_COLORS, formatDate, parseActors } from '../utils/format.js'

const STATUS_MISSING_COLOR = 'red'

function ActorBadgeSnippet({ badges = [], compact = true }) {
  const list = Array.isArray(badges) ? badges : []
  if (list.length === 0) return null
  const shown = list.slice(0, 2)
  const rest = list.length - shown.length
  const title = list.map((badge) => `${badge.label}${badge.description ? ` · ${badge.description}` : ''}`).join(' | ')

  return (
    <span className="vi-actor-badges" title={title}>
      {shown.map((badge) => (
        <ActorBadge
          key={badge.id}
          badge={badge}
          compact={compact}
          iconOnly={Boolean(badge.icon)}
          className={badge.is_active === 0 ? 'actor-badge--muted' : ''}
        />
      ))}
      {rest > 0 && <span className="vi-actor-badges__more" title={title}>+{rest}</span>}
    </span>
  )
}

const VideoItem = memo(function VideoItem({ video, selected, onClick, checked, onToggle }) {
  const borderClass = video.status === 'missing' ? ' video-item--missing' : ''
  const hasSTierActor = Array.isArray(video.actorsList) && video.actorsList.some((a) => a?.tier === 'S')

  const tagList = useMemo(
    () => video.tags ? video.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    [video.tags]
  )

  const actors = useMemo(() => parseActors(video.actor_name), [video.actor_name])
  const actorTokens = useMemo(() => {
    if (Array.isArray(video.actorsList) && video.actorsList.length > 0) {
      return video.actorsList.map((a) => ({
        key: `id-${a.actor_id || a.id || a.name}`,
        name: a.name,
        tier: a.tier ?? null,
      }))
    }
    return actors.map((name, idx) => ({ key: `name-${name}-${idx}`, name, tier: null }))
  }, [video.actorsList, actors])

  return (
    <div
      className={`video-item${selected ? ' video-item--selected' : ''}${borderClass}${hasSTierActor ? ' video-item--actor-tier-s' : ''}`}
      onClick={() => onClick(video)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(video)}
    >
      {/* ── 좌측 체크박스 컬럼 ────────────────────────────────── */}
      {onToggle && (
        <div className="vi-check-col" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="vi-checkbox"
            checked={!!checked}
            onChange={(e) => onToggle(e, video.id)}
            aria-label={`${video.file_name} 선택`}
            title="파일 복사 선택"
          />
        </div>
      )}

      {/* ── 우측 콘텐츠 영역 ──────────────────────────────────── */}
      <div className="vi-content">

      {/* ── 1행: 품번 + 배우명 ────────────────────────────────── */}
      <div className="vi-header">
        <div className="vi-header-left">
          {video.code
            ? <span className="code-badge">{video.code}</span>
            : <span className="code-badge code-badge--empty">-</span>
          }
          <span className="actor-name">
            {actorTokens.length === 0
              ? '(배우 미상)'
              : <>
                  {actorTokens.slice(0, 3).map((token, idx) => (
                    <span key={token.key} className="actor-name__token">
                      <ActorTierBadge tier={token.tier} size="sm" compact className="actor-name__tier" />
                      <span className={idx === 0 ? 'actor-primary' : 'actor-secondary'}>{token.name}</span>
                      {Array.isArray(video.actorsList) && video.actorsList[idx]?.badges?.length > 0 && (
                        <ActorBadgeSnippet badges={video.actorsList[idx].badges} compact />
                      )}
                      {idx < Math.min(actorTokens.length, 3) - 1 && <span className="actor-secondary">, </span>}
                    </span>
                  ))}
                  {actorTokens.length > 3 && (
                    <span className="actor-secondary"> +{actorTokens.length - 3}</span>
                  )}
                </>
            }
          </span>
        </div>
      </div>

      {/* ── 2행: 배지 묶음 ────────────────────────────────────── */}
      <div className="vi-badges">
        {/* NEW 배지 — is_new=1 일 때만 표시 (작업 대기 상태) */}
        {Boolean(video.is_new) && (
          <Tag color="green" style={{ fontWeight: 700, letterSpacing: 1 }}>NEW</Tag>
        )}

        {/* 추천작 배지 — recommended=1 일 때만 */}
        {Boolean(video.recommended) && (
          <Tag color="warning" style={{ fontWeight: 600 }}>⭐ 추천</Tag>
        )}

        {/* 등급 배지 — 보관(기본값)은 생략해서 화면을 깔끔하게 유지 */}
        {video.grade && video.grade !== '보관' && (
          <Tag color={GRADE_COLORS[video.grade] || 'default'}>{video.grade}</Tag>
        )}

        {/* missing 배지 */}
        {video.status === 'missing' && (
          <Tag color={STATUS_MISSING_COLOR}>삭제됨</Tag>
        )}

        {video.subtitle_count > 0 && (
          <Tag color="cyan" title={video.subtitle_added_at ? `자막 추가일: ${formatDate(video.subtitle_added_at)}` : undefined}>
            자막 {video.subtitle_exts || video.subtitle_count}
            {video.subtitle_added_at ? ` · ${formatDate(video.subtitle_added_at)}` : ''}
          </Tag>
        )}

        {/* 사용자 태그 칩 */}
        {tagList.map((tag) => (
          <Tag key={tag} color="blue">{tag}</Tag>
        ))}
      </div>

      {/* ── 3행: 별점 ─────────────────────────────────────────── */}
      <StarRating value={video.rating || 0} readOnly size="sm" />

      {/* ── 4행: 파일명 ───────────────────────────────────────── */}
      <div className="vi-filename" title={video.file_name}>
        {video.file_name}
      </div>

      {/* ── 5행: 폴더 + 메모 미리보기 ────────────────────────── */}
      <div className="vi-footer">
        <span className="vi-folder" title={video.folder_path}>
          📁 {video.folder_path.split(/[\\/]/).pop()}
        </span>
        {video.memo && (
          <span className="vi-memo-preview" title={video.memo}>
            {video.memo}
          </span>
        )}
      </div>

      </div>{/* vi-content end */}
    </div>
  )
})

export default VideoItem
