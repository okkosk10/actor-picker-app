/**
 * src/components/SortSelect.jsx
 * 정렬 기준 선택 컴포넌트
 *
 * Props:
 *   value    {string}   - 현재 선택된 정렬 키
 *   onChange {Function} - 정렬 변경 콜백 (key: string)
 */
import { SORT_OPTIONS } from '../utils/format.js'

export default function SortSelect({ value, onChange }) {
  return (
    <div className="sort-select-wrap">
      <label className="sort-label" htmlFor="sort-select">정렬</label>
      <select
        id="sort-select"
        className="sort-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
