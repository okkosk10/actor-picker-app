/**
 * src/components/SearchBar.jsx
 * 검색 입력창 + 정렬 선택 컴포넌트
 *
 * Props:
 *   query           {string}   - 현재 검색 키워드
 *   onQueryChange   {Function} - 키워드 변경 콜백 (타이핑 즉시 검색)
 *   onSearch        {Function} - 검색 버튼(🔍) 클릭 콜백 (현재 조건으로 DB 재조회)
 *   sortBy          {string}   - 현재 정렬 키
 *   onSortChange    {Function} - 정렬 변경 콜백
 */
import SortSelect from './SortSelect.jsx'

export default function SearchBar({
  query,
  onQueryChange,
  onSearch,
  sortBy,
  onSortChange,
}) {
  // Enter 키로도 검색 새로고침 가능
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') onSearch?.()
  }

  return (
    <div className="search-bar">
      {/* 검색 입력 */}
      <div className="search-input-wrap">
        {/* 🔍 버튼: 클릭 시 현재 조건으로 DB 재조회 (전체 라이브러리 새로고침 역할) */}
        <button
          className="search-icon-btn"
          type="button"
          onClick={() => onSearch?.()}
          title="검색 / 새로고침"
          aria-label="검색 새로고침"
        >
          🔍
        </button>
        <input
          type="text"
          className="search-input"
          placeholder="파일명, 품번, 배우명, 메모, 태그 검색..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
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
