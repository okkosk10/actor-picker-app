/**
 * src/components/SearchBar.jsx
 * 검색 입력창 + 정렬 선택 컴포넌트
 *
 * Props:
 *   query           {string}   - 현재 검색 키워드
 *   onQueryChange   {Function} - 키워드 변경 콜백
 *   sortBy          {string}   - 현재 정렬 키
 *   onSortChange    {Function} - 정렬 변경 콜백
 */
import SortSelect from './SortSelect.jsx'

export default function SearchBar({
  query,
  onQueryChange,
  sortBy,
  onSortChange,
}) {
  return (
    <div className="search-bar">
      {/* 검색 입력 */}
      <div className="search-input-wrap">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          className="search-input"
          placeholder="파일명, 품번, 배우명, 메모, 태그 검색..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <button
            className="search-clear"
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="검색어 초기화"
          >
            ✕
          </button>
        )}
      </div>

      {/* 정렬 선택 */}
      <SortSelect value={sortBy} onChange={onSortChange} />
    </div>
  )
}
