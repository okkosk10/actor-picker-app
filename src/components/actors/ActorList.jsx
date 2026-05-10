/**
 * src/components/actors/ActorList.jsx
 * 배우 목록 (좌측 패널)
 *
 * Props:
 *   actors     {Actor[]}       - 표시할 배우 배열 (video_count, copy_count, open_count 포함)
 *   selectedId {number|null}   - 현재 선택된 배우 id
 *   onSelect   {Function}      - 배우 선택 콜백 (actor)
 *   loading    {boolean}
 */
import ActorImage from '../common/ActorImage.jsx'

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

export default function ActorList({ actors, selectedId, onSelect, loading }) {
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

  return (
    <ul className="actor-list" role="listbox" aria-label="배우 목록">
      {actors.map((actor) => (
        <li
          key={actor.id}
          role="option"
          aria-selected={selectedId === actor.id}
          className={[
            'actor-list__item',
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
              <span className="actor-list__name">
                {actor.name}
                {actor.is_archived === 1 && (
                  <span className="actor-list__archive-badge">archived</span>
                )}
              </span>
              {actor.rating > 0 && (
                <span className="actor-list__rating">{'★'.repeat(actor.rating)}</span>
              )}
            </div>

            {actor.agency && (
              <span className="actor-list__meta">{actor.agency}</span>
            )}

            {/* 태그 */}
            <TagList tags={actor.tags} max={3} />

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
          </div>
        </li>
      ))}
    </ul>
  )
}
