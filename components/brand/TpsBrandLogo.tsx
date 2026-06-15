import styles from './TpsBrandLogo.module.css'

export function TpsBrandLogo({
  className = '',
  animateOnDesktop = true,
  priority = false,
}: {
  className?: string
  animateOnDesktop?: boolean
  priority?: boolean
}) {
  return (
    <span
      className={`${styles.logo} ${
        animateOnDesktop ? styles.animated : ''
      } ${className}`}
      role="img"
      aria-label="TPS"
    >
      <img
        src="/brand/tps-logo-x.png"
        alt=""
        width={780}
        height={780}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        draggable={false}
        className={styles.mark}
      />
      <img
        src="/brand/tps-logo-wordmark.png"
        alt=""
        width={780}
        height={105}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        draggable={false}
        className={styles.wordmark}
      />
    </span>
  )
}
