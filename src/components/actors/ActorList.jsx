/**
 * src/components/actors/ActorList.jsx
 * 배우 목록 (좌측 패널)
 *
 * Props:
 *   actors     {Actor[]}  - 표시할 배우 배열
 *   selectedId {number|null} - 현재 선택된 배우 id
 *   onSelect   {Function} - 배우 선택 콜백 (actor)
 *   loading    {boolean}
 */
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
          {/* 썸네일 placeholder */}
          <div className="actor-list__thumb">
            {actor.image_path ? (
              <img src={actor.image_path} alt={actor.name} className="actor-list__thumb-img" />
            ) : (
              <span className="actor-list__thumb-placeholder">👤</span>
            )}
          </div>

          <div className="actor-list__info">
            <span className="actor-list__name">
              {actor.name}
              {actor.is_archived === 1 && (
                <span className="actor-list__archive-badge">archived</span>
              )}
            </span>
            {(actor.category || actor.agency) && (
              <span className="actor-list__meta">
                {[actor.category, actor.agency].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>

          {actor.rating > 0 && (
            <span className="actor-list__rating">{'★'.repeat(actor.rating)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
