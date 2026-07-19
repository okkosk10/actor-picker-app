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
const AUTO_TAG_VARIANTS = {
  '단신': 'actor-meta-size-small',
  '장신': 'actor-meta-size-tall',
  '빈유': 'actor-meta-cup-light',
  '거유': 'actor-meta-cup-medium',
  '폭유': 'actor-meta-cup-full',
  '질사해금': 'actor-meta-flag',
}

export function getActorTagBadgeVariant(label) {
  return AUTO_TAG_VARIANTS[String(label || '').trim()] || 'tag'
}

export default function TagBadge({ label, variant = 'tag', className = '' }) {
  return (
    <span className={['tag-badge', `tag-badge--${variant}`, className].filter(Boolean).join(' ')}>
      {label}
    </span>
  )
}
