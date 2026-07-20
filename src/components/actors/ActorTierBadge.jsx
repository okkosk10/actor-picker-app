const VALID_TIERS = new Set(['S', 'A', 'B'])

export default function ActorTierBadge({
  tier,
  size = 'md',
  compact = false,
  className = '',
}) {
  if (!VALID_TIERS.has(tier)) return null

  return (
    <span
      className={[
        'actor-tier',
        `actor-tier--${String(tier).toLowerCase()}`,
        `actor-tier--${size}`,
        compact ? 'actor-tier--compact' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-label={`${tier}급 배우`}
      title={`${tier}급`}
    >
      {tier}
    </span>
  )
}
