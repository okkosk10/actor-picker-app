/**
 * src/components/TagBadge.jsx
 * 다용도 배지(badge) / 태그 칩(chip) 컴포넌트
 *
 * Props:
 *   label   {string}  - 표시할 텍스트
 *   variant {string}  - 스타일 변형 키
 *     'recommended' | 'missing' | 'watched' | 'favorite' | 'later' | 'tag'
 *
 * 사용 예:
 *   <TagBadge label="추천" variant="recommended" />
 *   <TagBadge label="4K"   variant="tag" />
 *   <TagBadge label="삭제됨" variant="missing" />
 */
export default function TagBadge({ label, variant = 'tag' }) {
  return (
    <span className={`tag-badge tag-badge--${variant}`}>
      {label}
    </span>
  )
}
