interface SparklineProps {
  data: number[]
  positive: boolean
  width?: number
  height?: number
  strokeWidth?: number
}

/**
 * Lightweight inline SVG sparkline with a neon glow + area fill.
 * No external chart library required.
 */
export function Sparkline({
  data,
  positive,
  width = 160,
  height = 48,
  strokeWidth = 2,
}: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)

  const points = data.map((v, i) => {
    const x = i * stepX
    const y = height - ((v - min) / range) * (height - strokeWidth * 2) - strokeWidth
    return [x, y] as const
  })

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`

  const color = positive ? 'var(--neon-green)' : 'var(--neon-red)'
  const gradId = `spark-${positive ? 'up' : 'down'}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="sparkline"
      preserveAspectRatio="none"
      role="img"
      aria-label={positive ? 'Trending up' : 'Trending down'}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
      />
    </svg>
  )
}
