/**
 * src/components/common/StarRating.jsx
 * 별점 입력/표시 컴포넌트 (재사용 가능)
 *
 * Props:
 *   value    {number}    - 현재 별점 (0~5)
 *   onChange {Function}  - 별점 변경 콜백 (readOnly=false 일 때만 사용)
 *   readOnly {boolean}   - true 이면 표시만 (기본: false)
 *   size     {'sm'|'md'} - 아이콘 크기 (기본: 'md')
 */
import { useState } from 'react'

export default function StarRating({ value = 0, onChange, readOnly = false, size = 'md' }) {
  const [hovered, setHovered] = useState(0)
  const active = hovered || value

  return (
    <div className={`star-rating star-rating--${size}${readOnly ? ' star-rating--readonly' : ''}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star${n <= active ? ' star--on' : ''}`}
          onClick={() => !readOnly && onChange && onChange(n === value ? 0 : n)}
          onMouseEnter={() => !readOnly && setHovered(n)}
          onMouseLeave={() => !readOnly && setHovered(0)}
          disabled={readOnly}
          aria-label={`${n}점`}
        >
          ★
        </button>
      ))}
    </div>
  )
}
