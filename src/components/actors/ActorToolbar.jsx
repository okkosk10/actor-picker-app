/**
 * src/components/actors/ActorToolbar.jsx
 * 배우 관리 탭 상단 툴바 — 검색 + 필터 + 액션 버튼
 *
 * Props:
 *   query         {string}   - 검색어 (이름/별칭/태그/메모 통합)
 *   onQueryChange {Function} - 검색어 변경 콜백
 *   filters       {object}   - { minRating, tag, sortBy, minVideoCount }
 *   onFiltersChange {Function} - 필터 변경 콜백 (patch)
 *   showArchived  {boolean}  - 아카이브 표시 여부
 *   onToggleArchived {Function}
 *   onNewActor    {Function} - 신규 배우 버튼 클릭 콜백
 *   onSync        {Function} - 배우-영상 동기화 콜백
 */
export default function ActorToolbar({
  query,
  onQueryChange,
  filters = {},
  onFiltersChange,
  showArchived,
  onToggleArchived,
  onNewActor,
  onSync,
  onCleanupOrphans,
  tierCounts,
  tierFilter,
  onTierFilterChange,
  onOpenTierManager,
  badgeDefinitions = [],
  badgeFilter = 'all',
  onBadgeFilterChange,
  onOpenBadgeManager,
}) {
  const SORT_OPTIONS = [
    { value: 'name_asc',         label: '이름 오름차순' },
    { value: 'rating_desc',      label: '별점 높은 순' },
    { value: 'video_count_desc', label: '작품 수 많은 순' },
    { value: 'copy_count_desc',  label: '복사 많은 순' },
    { value: 'open_count_desc',  label: '재생 많은 순' },
    { value: 'updated_desc',     label: '최근 수정순' },
    { value: 'tier_desc',        label: '등급 높은 순' },
  ]

  const counts = tierCounts || { S: 0, A: 0, B: 0, unranked: 0, total: 0, limits: { S: 10, A: 20, B: 30 } }
  const badgeOptions = [
    { value: 'all', label: '전체 뱃지' },
    { value: 'none', label: '뱃지 없음' },
    ...badgeDefinitions.map((badge) => ({
      value: String(badge.id),
      label: `${badge.icon ? `${badge.icon} ` : ''}${badge.label}`,
    })),
  ]

  return (
    <div className="actor-toolbar">
      {/* 검색 (이름/별칭/태그/메모 통합) */}
      <input
        className="actor-toolbar__search"
        type="search"
        placeholder="이름·별칭·태그·메모 검색…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />

      {/* 필터 행 */}
      <div className="actor-toolbar__filters">
        {/* 별점 필터 */}
        <label className="actor-toolbar__filter-item">
          <span>별점 ≥</span>
          <select
            value={filters.minRating ?? 0}
            onChange={(e) => onFiltersChange({ minRating: Number(e.target.value) })}
          >
            <option value={0}>전체</option>
            <option value={1}>1+</option>
            <option value={2}>2+</option>
            <option value={3}>3+</option>
            <option value={4}>4+</option>
            <option value={5}>5</option>
          </select>
        </label>

        {/* 태그 필터 */}
        <input
          className="actor-toolbar__filter-tag"
          type="text"
          placeholder="태그 필터"
          value={filters.tag ?? ''}
          onChange={(e) => onFiltersChange({ tag: e.target.value })}
        />

        {/* 최소 작품 수 */}
        <label className="actor-toolbar__filter-item">
          <span>작품 ≥</span>
          <input
            type="number"
            min={0}
            style={{ width: 48 }}
            value={filters.minVideoCount ?? 0}
            onChange={(e) => onFiltersChange({ minVideoCount: Number(e.target.value) || 0 })}
          />
        </label>

        {/* 정렬 */}
        <select
          className="actor-toolbar__sort"
          value={filters.sortBy ?? 'name_asc'}
          onChange={(e) => onFiltersChange({ sortBy: e.target.value })}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* 아카이브 토글 */}
        <label className="actor-toolbar__archive-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onToggleArchived(e.target.checked)}
          />
          아카이브 포함
        </label>
      </div>

      {/* 액션 버튼 */}
      <div className="actor-toolbar__actions">
        <div className="actor-toolbar__tier-summary" aria-label="배우 티어 요약">
          <span>활성 기준 · 전체 {counts.total}</span>
          <span>| S {counts.S}/{counts.limits?.S ?? 10}</span>
          <span>| A {counts.A}/{counts.limits?.A ?? 20}</span>
          <span>| B {counts.B}/{counts.limits?.B ?? 30}</span>
          <span>| 무등급 {counts.unranked}</span>
        </div>
        <div className="actor-toolbar__tier-filters" role="group" aria-label="배우 티어 필터">
          {[
            { key: 'all', label: '전체' },
            { key: 'S', label: 'S' },
            { key: 'A', label: 'A' },
            { key: 'B', label: 'B' },
            { key: 'unranked', label: '무등급' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`actor-toolbar__tier-filter-btn${tierFilter === opt.key ? ' actor-toolbar__tier-filter-btn--active' : ''}`}
              onClick={() => onTierFilterChange?.(opt.key)}
              aria-pressed={tierFilter === opt.key}
              title={`티어 필터: ${opt.label}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <label className="actor-toolbar__filter-item actor-toolbar__filter-item--badge">
          <span>특수 뱃지</span>
          <select
            value={badgeFilter}
            onChange={(e) => onBadgeFilterChange?.(e.target.value)}
          >
            {badgeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <button
          className="btn-secondary"
          type="button"
          onClick={onOpenTierManager}
          title="티어 관리"
        >
          티어 관리
        </button>
        <button
          className="btn-secondary"
          type="button"
          onClick={onOpenBadgeManager}
          title="특수 뱃지 관리"
        >
          뱃지 관리
        </button>
        <button
          className="btn-primary actor-toolbar__new-btn"
          type="button"
          onClick={onNewActor}
        >
          + 배우 추가
        </button>
        {onSync && (
          <button
            className="btn-secondary"
            type="button"
            onClick={onSync}
            title="videos.actor_name 기반으로 video_actors 재동기화"
          >
            🔄 배우-영상 동기화
          </button>
        )}
        {onCleanupOrphans && (
          <button
            className="btn-secondary"
            type="button"
            onClick={onCleanupOrphans}
            title="어떤 영상에도 연결되지 않은 배우 정리"
          >
            🧹 고아 배우 정리
          </button>
        )}
      </div>
    </div>
  )
}
