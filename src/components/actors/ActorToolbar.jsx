/**
 * src/components/actors/ActorToolbar.jsx
 * 배우 관리 탭 상단 툴바
 *
 * Props:
 *   query         {string}   - 검색어
 *   onQueryChange {Function} - 검색어 변경 콜백
 *   showArchived  {boolean}  - 아카이브 표시 여부
 *   onToggleArchived {Function} - 아카이브 토글 콜백
 *   onNewActor    {Function} - 신규 배우 버튼 클릭 콜백
 */
export default function ActorToolbar({
  query,
  onQueryChange,
  showArchived,
  onToggleArchived,
  onNewActor,
}) {
  return (
    <div className="actor-toolbar">
      <input
        className="actor-toolbar__search"
        type="search"
        placeholder="배우 이름 검색…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <label className="actor-toolbar__archive-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => onToggleArchived(e.target.checked)}
        />
        아카이브 포함
      </label>
      <button
        className="btn-primary actor-toolbar__new-btn"
        type="button"
        onClick={onNewActor}
      >
        + 배우 추가
      </button>
    </div>
  )
}
