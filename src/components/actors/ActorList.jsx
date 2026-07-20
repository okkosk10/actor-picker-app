/**
 * src/components/actors/ActorList.jsx
 * 배우 목록 (좌측 패널)
 *
 * Props:
 *   actors         {Actor[]}       - 표시할 배우 배열 (video_count, copy_count, open_count 포함)
 *   selectedId     {number|null}   - 현재 선택된 배우 id
 *   onSelect       {Function}      - 배우 선택 콜백 (actor)
 *   loading        {boolean}
 *   onConfirmNew   {Function|null} - 제공 시 "확인" 버튼 표시 (actorId) => void
 *   onDismissNew   {Function|null} - 제공 시 "무시" 버튼 표시 (actorId) => void
 */
import ActorImage from '../common/ActorImage.jsx'
import ActorBadge from './ActorBadge.jsx'
import ActorTierBadge from './ActorTierBadge.jsx'

function TagList({ tags, max = 3 }) {
  if (!tags) return null
  const list = tags.split(',').map((t) => t.trim()).filter(Boolean)
  const shown = list.slice(0, max)
  const rest  = list.length - shown.length
  return (
    <div className="actor-list__tags">
      {shown.map((t) => (
        <span key={t} className="actor-list__tag">{t}</span>
      ))}
      {rest > 0 && <span className="actor-list__tag actor-list__tag--more">+{rest}</span>}
    </div>
  )
}

function AliasSummary({ aliases }) {
  const list = String(aliases || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

  if (list.length === 0) return null
  return <div className="actor-list__alias">{list.slice(0, 2).join(' / ')}</div>
}

function MemoSummary({ memo }) {
  const text = String(memo || '').trim()
  if (!text) return null

  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || ''
  if (!firstLine) return null

  return <div className="actor-list__memo" title={text}>{firstLine}</div>
}

function BadgeSummary({ badges = [] }) {
  const list = Array.isArray(badges) ? badges : []
  if (list.length === 0) return null
  const shown = list.slice(0, 2)
  const rest = list.length - shown.length
  const tooltip = list.map((badge) => badge.label).filter(Boolean).join(', ')

  return (
    <div className="actor-list__badges" title={tooltip}>
      {shown.map((badge) => (
        <ActorBadge key={badge.id} badge={badge} compact className={badge.is_active === 0 ? 'actor-badge--muted' : ''} />
      ))}
      {rest > 0 && <span className="actor-list__badge-more" title={tooltip}>+{rest}</span>}
    </div>
  )
}

export default function ActorList({ actors, selectedId, onSelect, loading, onConfirmNew, onDismissNew }) {
  if (loading) {
    return <div className="actor-list actor-list--loading">불러오는 중…</div>
  }

  if (actors.length === 0) {
    return (
      <div className="actor-list actor-list--empty">
        <p>배우 정보가 없습니다.</p>
        <p className="actor-list__empty-hint">폴더를 스캔하면 자동으로 추가됩니다.</p>
      </div>
    )
  }

  const showNewActions = typeof onConfirmNew === 'function' || typeof onDismissNew === 'function'

  return (
    <ul className="actor-list" role="listbox" aria-label="배우 목록">
      {actors.map((actor) => {
        const tier = actor.tier || null
        const tierClass = tier === 'S'
          ? 'actor-list__item--tier-s'
          : tier === 'A'
            ? 'actor-list__item--tier-a'
            : tier === 'B'
              ? 'actor-list__item--tier-b'
              : ''
        return (
        <li
          key={actor.id}
          role="option"
          aria-selected={selectedId === actor.id}
          className={[
            'actor-list__item',
            tierClass,
            selectedId === actor.id ? 'actor-list__item--active' : '',
            actor.is_archived ? 'actor-list__item--archived' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onSelect(actor)}
        >
          {/* 썸네일 */}
          <div className="actor-list__thumb">
            <ActorImage
              fileName={actor.image_path}
              alt={actor.name}
              className="actor-list__thumb-img"
              placeholderClass="actor-list__thumb-placeholder"
            />
          </div>

          <div className="actor-list__info">
            <div className="actor-list__name-row">
              <ActorTierBadge tier={tier} size="sm" />
              <span className="actor-list__name">
                {actor.name}
                {actor.is_archived === 1 && (
                  <span className="actor-list__archive-badge">archived</span>
                )}
              </span>
              {actor.rating > 0 && (
                <span className="actor-list__rating">{Number(actor.rating).toFixed(1)} / 10</span>
              )}
            </div>

            <BadgeSummary badges={actor.badges} />

            {/* 태그 */}
            <TagList tags={actor.tags} max={5} />

            <AliasSummary aliases={actor.aliases} />

            {/* 메모 요약 */}
            <MemoSummary memo={actor.memo} />

            {/* 통계 뱃지 */}
            <div className="actor-list__stats">
              {(actor.video_count ?? 0) > 0 && (
                <span className="actor-list__stat" title="연결 작품 수">
                  🎬 {actor.video_count}
                </span>
              )}
              {(actor.copy_count ?? 0) > 0 && (
                <span className="actor-list__stat actor-list__stat--copy" title="복사 횟수">
                  📋 {actor.copy_count}
                </span>
              )}
              {(actor.open_count ?? 0) > 0 && (
                <span className="actor-list__stat actor-list__stat--open" title="재생 횟수">
                  ▶ {actor.open_count}
                </span>
              )}
            </div>

            {/* 새 배우 탭 액션 버튼 */}
            {showNewActions && (
              <div className="actor-list__new-actions" onClick={(e) => e.stopPropagation()}>
                {onConfirmNew && (
                  <button
                    type="button"
                    className="actor-list__new-btn actor-list__new-btn--confirm"
                    title="New 상태 해제 — 배우 목록에 유지"
                    onClick={() => onConfirmNew(actor.id)}
                  >
                    확인
                  </button>
                )}
                {onDismissNew && (
                  <button
                    type="button"
                    className="actor-list__new-btn actor-list__new-btn--dismiss"
                    title="New 상태 해제 + 아카이브 — 배우 목록에서 숨김"
                    onClick={() => onDismissNew(actor.id)}
                  >
                    무시
                  </button>
                )}
              </div>
            )}
          </div>
        </li>
        )
      })}
    </ul>
  )
}
