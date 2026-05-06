/**
 * src/components/SortSelect.jsx
 * 정렬 기준 선택 컴포넌트 (Ant Design Select 사용)
 *
 * Props:
 *   value    {string}   - 현재 선택된 정렬 키
 *   onChange {Function} - 정렬 변경 콜백 (key: string)
 *
 * 지원 정렬:
 *   created_desc  최신 추가순
 *   updated_desc  최근 수정순
 *   rating_desc   별점 높은순
 *   rating_asc    별점 낮은순
 *   recommended   추천작 우선
 *   actor_asc     배우명순
 *   code_asc      품번순
 *   random        랜덤순
 */
import { Select } from 'antd'
import { SORT_OPTIONS } from '../utils/format.js'

const { Option } = Select

export default function SortSelect({ value, onChange }) {
  return (
    <div className="sort-select-wrap">
      <span className="sort-label">정렬</span>
      <Select
        value={value}
        onChange={onChange}
        size="small"
        style={{ minWidth: 130 }}
        popupMatchSelectWidth={false}
      >
        {SORT_OPTIONS.map((opt) => (
          <Option key={opt.value} value={opt.value}>
            {opt.label}
          </Option>
        ))}
      </Select>
    </div>
  )
}

