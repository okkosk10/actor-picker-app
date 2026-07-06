/**
 * src/components/FilterBar.jsx
 * 검색 결과 필터링 바
 *
 * Props:
 *   filters        {object}   - 현재 필터 상태 (useVideoSearch.filters)
 *   onFiltersChange {Function} - 필터 변경 콜백 (patch 객체를 받아 부분 업데이트)
 *   totalCount     {number}   - 현재 결과 수
 *   totalSize      {number}   - 현재 결과 총 용량(bytes)
 *
 * 필터 항목:
 *   체크박스: 추천작만 / 삭제요망 제외 / missing 제외 / deleted 제외
 *   등급 체크박스 그룹
 *   최소 별점 Select
 *
 * Ant Design: Checkbox, Checkbox.Group, Select 사용
 */
import { Checkbox, Select } from 'antd'
import { GRADES, formatFileSize } from '../utils/format.js'

const { Option } = Select

// 등급 Checkbox.Group 옵션 (순서 고정)
const GRADE_OPTIONS = GRADES.map((g) => ({ label: g, value: g }))

// 최소 별점 Select 옵션
const RATING_OPTIONS = [
  { label: '제한 없음', value: 0 },
  { label: '★ 이상',   value: 1 },
  { label: '★★ 이상',  value: 2 },
  { label: '★★★ 이상', value: 3 },
  { label: '★★★★ 이상', value: 4 },
  { label: '★★★★★',   value: 5 },
]

const SUBTITLE_ADDED_OPTIONS = [
  { label: '전체', value: 0 },
  { label: '7일 이내', value: 7 },
  { label: '30일 이내', value: 30 },
  { label: '90일 이내', value: 90 },
  { label: '1년 이내', value: 365 },
]

export default function FilterBar({ filters, onFiltersChange, totalCount, totalSize }) {
  return (
    <div className="filter-bar">

      {/* ── 빠른 체크박스 필터 ─────────────────────────────── */}
      <div className="filter-section filter-section--quick">

        <Checkbox
          checked={filters.excludeMissing}
          onChange={(e) => onFiltersChange({ excludeMissing: e.target.checked })}
        >
          삭제됨 숨기기
        </Checkbox>

        <Checkbox
          checked={filters.excludeDeleted}
          onChange={(e) => onFiltersChange({ excludeDeleted: e.target.checked })}
        >
          영구삭제 숨기기
        </Checkbox>

        <Checkbox
          checked={filters.excludeDeleteGrade}
          onChange={(e) => onFiltersChange({ excludeDeleteGrade: e.target.checked })}
        >
          삭제요망 제외
        </Checkbox>

        <Checkbox
          checked={filters.recommendedOnly}
          onChange={(e) => onFiltersChange({ recommendedOnly: e.target.checked })}
        >
          ⭐ 추천작만
        </Checkbox>

        <Checkbox
          checked={filters.subtitleOnly}
          onChange={(e) => onFiltersChange({ subtitleOnly: e.target.checked })}
        >
          자막 있음만
        </Checkbox>

      </div>

      {/* ── 등급 체크박스 그룹 ─────────────────────────────── */}
      <div className="filter-section filter-section--grades">
        <span className="filter-label">등급</span>
        <Checkbox.Group
          options={GRADE_OPTIONS}
          value={filters.grades}
          onChange={(checkedValues) => onFiltersChange({ grades: checkedValues })}
        />
        {filters.grades.length > 0 && (
          <button
            className="filter-clear-btn"
            type="button"
            onClick={() => onFiltersChange({ grades: [] })}
            title="등급 필터 초기화"
          >
            초기화
          </button>
        )}
      </div>

      {/* ── 최소 별점 + 결과 수 ────────────────────────────── */}
      <div className="filter-section filter-section--rating">
        <span className="filter-label">최소 별점</span>
        <Select
          value={filters.minRating}
          onChange={(val) => onFiltersChange({ minRating: val })}
          size="small"
          style={{ minWidth: 110 }}
          popupMatchSelectWidth={false}
        >
          {RATING_OPTIONS.map((opt) => (
            <Option key={opt.value} value={opt.value}>
              {opt.label}
            </Option>
          ))}
        </Select>

        {/* 현재 결과 수 / 총 용량 */}
        <span className="filter-result-info">
          <strong>{totalCount}</strong>개
          {totalSize > 0 && (
            <span className="filter-result-size">
              {' / '}{formatFileSize(totalSize)}
            </span>
          )}
        </span>
      </div>

      <div className="filter-section filter-section--subtitle-date">
        <span className="filter-label">자막 수정일</span>
        <Select
          value={filters.subtitleAddedDays}
          onChange={(val) => onFiltersChange({ subtitleAddedDays: val })}
          size="small"
          style={{ minWidth: 110 }}
          popupMatchSelectWidth={false}
        >
          {SUBTITLE_ADDED_OPTIONS.map((opt) => (
            <Option key={opt.value} value={opt.value}>
              {opt.label}
            </Option>
          ))}
        </Select>
        {filters.subtitleAddedDays > 0 && (
          <button
            className="filter-clear-btn"
            type="button"
            onClick={() => onFiltersChange({ subtitleAddedDays: 0 })}
            title="자막 수정일 필터 초기화"
          >
            초기화
          </button>
        )}
      </div>

    </div>
  )
}
