import { ACTOR_BADGE_VARIANTS } from '../../utils/format.js'

export default function ActorBadge({
  badge,
  compact = false,
  iconOnly = false,
  removable = false,
  onRemove,
  onClick,
  selected = false,
  disabled = false,
  className = '',
  title,
}) {
  if (!badge) return null

  const variant = ACTOR_BADGE_VARIANTS.includes(badge.variant) ? badge.variant : 'gray'
  const label = String(badge.label || '').trim()
  const icon = String(badge.icon || '').trim()
  const commonTitle = title || [badge?.label, badge?.description, badge?.is_active === 0 ? '비활성 뱃지' : null].filter(Boolean).join(' · ') || '특수 뱃지'

  const content = (
    <>
      {icon && <span className="actor-badge__icon" aria-hidden="true">{icon}</span>}
      {!iconOnly && label && <span className="actor-badge__label">{label}</span>}
      {selected && !iconOnly && <span className="actor-badge__check" aria-hidden="true">✓</span>}
      {removable && !disabled && onRemove && <span className="actor-badge__remove-mark" aria-hidden="true">×</span>}
    </>
  )

  const classes = [
    'actor-badge',
    `actor-badge--${variant}`,
    compact ? 'actor-badge--compact' : 'actor-badge--normal',
    iconOnly ? 'actor-badge--icon-only' : '',
    selected ? 'actor-badge--selected' : '',
    disabled ? 'actor-badge--disabled' : '',
    removable ? 'actor-badge--removable' : '',
    className,
  ].filter(Boolean).join(' ')

  if (onClick || onRemove) {
    return (
      <button
        type="button"
        className={classes}
        title={commonTitle}
        aria-label={commonTitle}
        disabled={disabled}
        onClick={onClick || onRemove}
        aria-pressed={selected}
      >
        {content}
      </button>
    )
  }

  return (
    <span className={classes} title={commonTitle} aria-label={commonTitle}>
      {content}
    </span>
  )
}