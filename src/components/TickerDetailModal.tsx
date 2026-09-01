import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDailyBarsFromSupabase } from '../data/supabaseDailyStore'
import type { DailyBar } from '../data/tiingo'
import { changePct, formatCurrency, type Stock } from '../data/stocks'
import type { ExplosiveGrade } from '../hooks/useExplosiveMoves'

interface TickerDetailModalProps {
  stock: Stock
  onClose: () => void
  /**
   * Map of YYYY-MM-DD → grade for every explosive candle in this symbol's history.
   * A+ candles get orange glow; 'strong' candles get cyan highlight.
   * Absent on the regular watchlist modal — all candles render normally.
   */
  explosiveGrades?: Map<string, ExplosiveGrade>
}

const VOL_SECTION_RATIO = 0.18

type Timeframe = 'D' | 'W'

const RANGE_OPTIONS = {
  D: [
    { label: '1M', bars: 22 },
    { label: '3M', bars: 65 },
    { label: '6M', bars: 130 },
    { label: '1Y', bars: 260 },
  ],
  W: [
    { label: '3M', bars: 65 },
    { label: '6M', bars: 130 },
    { label: '1Y', bars: 260 },
    { label: '2Y', bars: 520 },
  ],
} as const

// ── Weekly aggregation ────────────────────────────────────────────────────────
function toWeeklyBars(daily: DailyBar[]): DailyBar[] {
  if (daily.length === 0) return []
  const weekMap = new Map<string, DailyBar & { _count: number }>()
  const weekOrder: string[] = []
  for (const bar of daily) {
    const d = new Date(bar.date + 'T00:00:00Z')
    const day = (d.getUTCDay() + 6) % 7
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - day)
    const key = monday.toISOString().slice(0, 10)
    if (!weekMap.has(key)) {
      weekOrder.push(key)
      weekMap.set(key, { date: key as DailyBar['date'], open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, _count: 1 })
    } else {
      const w = weekMap.get(key)!
      w.high = Math.max(w.high, bar.high)
      w.low = Math.min(w.low, bar.low)
      w.close = bar.close
      w.volume += bar.volume
      w._count++
    }
  }
  return weekOrder.map((k) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _count, ...bar } = weekMap.get(k)!
    return bar
  })
}

// ── Main modal ───────────────────────────────────────────────────────────────
export function TickerDetailModal({ stock, onClose, explosiveGrades }: TickerDetailModalProps) {
  const [bars, setBars] = useState<DailyBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>('D')
  const [rangeIdx, setRangeIdx] = useState(1)
  const [selectedBar, setSelectedBar] = useState<DailyBar | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedBar(null)
    fetchDailyBarsFromSupabase(stock.symbol)
      .then((data) => { if (!cancelled) { setBars(data); setLoading(false) } })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load candle data.')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [stock.symbol])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ranges = RANGE_OPTIONS[timeframe]
  const safeRangeIdx = Math.min(rangeIdx, ranges.length - 1)
  const slicedDaily = bars.slice(-ranges[safeRangeIdx].bars)
  const chartBars = timeframe === 'W' ? toWeeklyBars(slicedDaily) : slicedDaily

  const latestBar = bars[bars.length - 1]
  const statsBar = selectedBar ?? latestBar
  const statsBarIdx = statsBar ? chartBars.findIndex((b) => b.date === statsBar.date) : -1
  const prevStatsBar = statsBarIdx > 0 ? chartBars[statsBarIdx - 1] : undefined

  const pct = changePct(stock.price, stock.prevClose)
  const positive = pct >= 0

  const handleTimeframeChange = (tf: Timeframe) => {
    setTimeframe(tf); setRangeIdx(1); setSelectedBar(null)
  }
  const handleSelectBar = useCallback((bar: DailyBar) => {
    setSelectedBar((prev) => prev?.date === bar.date ? null : bar)
  }, [])

  // Grade of the currently-shown stats bar (for stat strip accent).
  const statsBarGrade = statsBar ? (explosiveGrades?.get(statsBar.date) ?? null) : null

  return (
    <div
      className="wl-modal-overlay td-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className="wl-modal td-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${stock.symbol} details`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="wl-modal-head td-head">
          <div className="td-title-group">
            <span className="td-symbol">{stock.symbol}</span>
            {stock.name && <span className="td-name">{stock.name}</span>}
          </div>
          <div className="td-price-group">
            <span className="td-price">${formatCurrency(stock.price)}</span>
            <span className={`td-change ${positive ? 'up' : 'down'}`}>
              {positive ? '+' : ''}{pct.toFixed(2)}%
            </span>
          </div>
          <button className="wl-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {/* ── Controls ── */}
        <div className="td-controls">
          <div className="td-tf-bar" role="group" aria-label="Chart timeframe">
            {(['D', 'W'] as const).map((tf) => (
              <button key={tf} className={`td-tf-btn ${timeframe === tf ? 'active' : ''}`}
                onClick={() => handleTimeframeChange(tf)} aria-pressed={timeframe === tf}>
                {tf === 'D' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
          <div className="td-range-bar" role="group" aria-label="Chart range">
            {ranges.map((r, i) => (
              <button key={r.label} className={`td-range-btn ${safeRangeIdx === i ? 'active' : ''}`}
                onClick={() => { setRangeIdx(i); setSelectedBar(null) }} aria-pressed={safeRangeIdx === i}>
                {r.label}
              </button>
            ))}
          </div>
          {selectedBar && (
            <button className="td-clear-sel" onClick={() => setSelectedBar(null)} aria-label="Clear candle selection">
              Clear selection
            </button>
          )}
        </div>

        {/* ── Chart ── */}
        <div className="td-chart-wrap">
          {loading && <div className="td-loading">Loading chart…</div>}
          {!loading && error && <div className="td-error">{error}</div>}
          {!loading && !error && chartBars.length < 2 && <div className="td-loading">No data available yet.</div>}
          {!loading && !error && chartBars.length >= 2 && (
            <CandleChart
              bars={chartBars}
              timeframe={timeframe}
              explosiveGrades={explosiveGrades}
              selectedDate={selectedBar?.date ?? null}
              onSelectBar={handleSelectBar}
            />
          )}
        </div>

        {/* ── Stats strip ── */}
        {statsBar && (
          <OhlcvStats
            bar={statsBar}
            prevBar={prevStatsBar}
            isSelected={selectedBar !== null}
            grade={statsBarGrade}
          />
        )}
      </div>
    </div>
  )
}

// ── Candle chart ─────────────────────────────────────────────────────────────

interface CandleChartProps {
  bars: DailyBar[]
  timeframe: Timeframe
  explosiveGrades?: Map<string, ExplosiveGrade>
  selectedDate: string | null
  onSelectBar: (bar: DailyBar) => void
}

const CHART_H = 340
const CHART_W = 720
const PAD_T = 12
const PAD_B = 8
const PAD_L = 0
const PAD_R = 52

function CandleChart({ bars, timeframe, explosiveGrades, selectedDate, onSelectBar }: CandleChartProps) {
  const n = bars.length
  if (n < 2) return null

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const totalW = CHART_W - PAD_L - PAD_R
  const step = totalW / n
  const bodyWidth = timeframe === 'W' ? Math.max(3, step * 0.7) : Math.max(2, step - 1.5)

  const allLow  = Math.min(...bars.map((b) => b.low))
  const allHigh = Math.max(...bars.map((b) => b.high))
  const priceRange = allHigh - allLow || 1

  const maxVol = Math.max(...bars.map((b) => b.volume))
  const volH   = CHART_H * VOL_SECTION_RATIO
  const priceH = CHART_H - volH - PAD_T - PAD_B - 6

  const priceY = (p: number) => PAD_T + priceH - ((p - allLow) / priceRange) * priceH

  const priceLabels = Array.from({ length: 6 }, (_, i) => allLow + (priceRange * i) / 5)
  const refClose    = bars[0].close
  const dateStep    = Math.max(1, Math.floor(n / 5))
  const dateLabels  = bars.map((b, i) => ({ i, date: b.date })).filter((_, i) => i % dateStep === 0)

  const mouseMoveHandler = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vbX = ((e.clientX - rect.left) / rect.width) * CHART_W
    const idx = Math.floor((vbX - PAD_L) / step)
    setHoveredIdx(idx >= 0 && idx < n ? idx : null)
  }, [n, step])

  const crosshairX = hoveredIdx !== null ? PAD_L + hoveredIdx * step + step / 2 : null
  const hasAnyExplosive = (explosiveGrades?.size ?? 0) > 0

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="td-candle-svg"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${timeframe === 'W' ? 'Weekly' : 'Daily'} candlestick chart`}
      onMouseMove={mouseMoveHandler}
      onMouseLeave={() => setHoveredIdx(null)}
      style={{ cursor: 'crosshair' }}
    >
      <defs>
        <linearGradient id="tdVolUp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--neon-green)"   stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--neon-green)" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="tdVolDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--neon-red)"   stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--neon-red)" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="tdVolAplus" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--neon-orange)"   stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--neon-orange)" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="tdVolStrong" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--neon-cyan)"   stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--neon-cyan)" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="tdVolSelected" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--neon-cyan)"   stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--neon-cyan)" stopOpacity="0.08" />
        </linearGradient>
        {/* Two-pass glow for A+ candles only */}
        <filter id="tdOrangeGlow" x="-80%" y="-40%" width="260%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur2" />
          <feMerge>
            <feMergeNode in="blur2" />
            <feMergeNode in="blur1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Price grid ── */}
      {priceLabels.map((price, i) => (
        <line key={i} x1={PAD_L} y1={priceY(price)} x2={CHART_W - PAD_R} y2={priceY(price)}
          stroke="rgba(120,90,255,0.10)" strokeWidth={1} />
      ))}

      {/* ── Prev-close reference ── */}
      <line x1={PAD_L} y1={priceY(refClose)} x2={CHART_W - PAD_R} y2={priceY(refClose)}
        stroke="rgba(177,77,255,0.45)" strokeWidth={1} strokeDasharray="4 3" />

      {/* ── Crosshair ── */}
      {crosshairX !== null && (
        <line x1={crosshairX} y1={PAD_T} x2={crosshairX} y2={PAD_T + priceH}
          stroke="rgba(200,200,255,0.25)" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />
      )}

      {/* ── Candles ── */}
      {bars.map((bar, i) => {
        const cx      = PAD_L + i * step + step / 2
        const laneX   = PAD_L + i * step
        const bullish = bar.close >= bar.open

        const grade       = explosiveGrades?.get(bar.date) ?? null
        const isAplus     = grade === 'A+'
        const isStrong    = grade === 'strong'
        const isExplosive = isAplus || isStrong
        const isSelected  = bar.date === selectedDate
        const isHovered   = hoveredIdx === i

        // Colour hierarchy: A+ → orange, strong → cyan, selected → cyan,
        // regular bullish → green, regular bearish → red.
        const color = isAplus
          ? 'var(--neon-orange)'
          : (isStrong || isSelected)
            ? 'var(--neon-cyan)'
            : bullish
              ? 'var(--neon-green)'
              : 'var(--neon-red)'

        // Dim everything else when explosives are present OR a candle is selected.
        const dimmed = (hasAnyExplosive && !isExplosive && !isSelected) ||
                       (selectedDate !== null && !isSelected)
        const opacity = dimmed ? 0.3 : (isHovered && !isSelected) ? 0.85 : 0.9

        const candleW = isAplus
          ? Math.max(bodyWidth * 1.5, bodyWidth + 3)
          : isStrong || isSelected
            ? Math.max(bodyWidth * 1.2, bodyWidth + 2)
            : bodyWidth

        const bodyTop = priceY(Math.max(bar.open, bar.close))
        const bodyBot = priceY(Math.min(bar.open, bar.close))
        const bodyH   = Math.max(1, bodyBot - bodyTop)

        const volBarH = maxVol > 0 ? (bar.volume / maxVol) * (volH - 4) : 0
        const volY    = CHART_H - PAD_B - volBarH
        const highY   = priceY(bar.high)

        // Bearish body fill: solid color (not hollow).
        const bodyFill = bullish ? color : color

        const volFill = isAplus     ? 'url(#tdVolAplus)'
                      : isStrong    ? 'url(#tdVolStrong)'
                      : isSelected  ? 'url(#tdVolSelected)'
                      : bullish     ? 'url(#tdVolUp)'
                      :               'url(#tdVolDown)'

        return (
          <g key={bar.date}>
            {/* Lane highlights */}
            {isAplus && (
              <rect x={laneX} y={PAD_T} width={step} height={priceH}
                fill="rgba(255,140,0,0.07)" rx={2} />
            )}
            {isStrong && !isSelected && (
              <rect x={laneX} y={PAD_T} width={step} height={priceH}
                fill="rgba(34,227,255,0.04)" rx={2} />
            )}
            {isSelected && !isAplus && (
              <rect x={laneX} y={PAD_T} width={step} height={priceH}
                fill="rgba(34,227,255,0.06)" rx={2} />
            )}
            {isHovered && !isSelected && !isExplosive && (
              <rect x={laneX} y={PAD_T} width={step} height={priceH}
                fill="rgba(200,200,255,0.04)" rx={2} />
            )}

            {/* Candle group */}
            <g opacity={opacity} filter={isAplus ? 'url(#tdOrangeGlow)' : undefined}>
              {/* Wick */}
              <line x1={cx} y1={priceY(bar.high)} x2={cx} y2={priceY(bar.low)}
                stroke={color} strokeWidth={isAplus ? 2 : isStrong || isSelected ? 1.5 : 1} />
              {/* Body — always filled solid (bullish green, bearish red/color) */}
              <rect
                x={cx - candleW / 2} y={bodyTop}
                width={candleW} height={bodyH}
                fill={bodyFill}
                stroke={color}
                strokeWidth={isAplus ? 2 : isStrong || isSelected ? 1.5 : 1}
                opacity={bullish ? 0.9 : 0.75}
              />
              {/* Volume */}
              <rect x={cx - candleW / 2} y={volY} width={candleW} height={volBarH} fill={volFill} />
            </g>

            {/* ⚡ annotation for A+ candles */}
            {isAplus && (
              <text x={cx} y={highY - 6} textAnchor="middle" fontSize={13}
                style={{ filter: 'drop-shadow(0 0 4px rgba(255,140,0,0.9))', pointerEvents: 'none' }}>
                ⚡
              </text>
            )}

            {/* Hit area */}
            <rect x={laneX} y={PAD_T} width={step} height={CHART_H - PAD_T}
              fill="transparent" style={{ cursor: 'pointer' }}
              onClick={() => onSelectBar(bar)} aria-label={`Candle ${bar.date}`} role="button" />
          </g>
        )
      })}

      {/* ── Price labels ── */}
      {priceLabels.map((price, i) => (
        <text key={i} x={CHART_W - PAD_R + 4} y={priceY(price) + 3}
          textAnchor="start" fontSize={9} fill="var(--muted)"
          style={{ fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
          {formatCurrency(price)}
        </text>
      ))}

      {/* ── Date labels ── */}
      {dateLabels.map(({ i, date }) => (
        <text key={date} x={PAD_L + i * step + step / 2} y={PAD_T + priceH + 10}
          textAnchor="middle" fontSize={9} fill="var(--muted)"
          style={{ fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
          {formatDateLabel(date)}
        </text>
      ))}

      {/* ── Crosshair close label ── */}
      {crosshairX !== null && hoveredIdx !== null && (() => {
        const bar = bars[hoveredIdx]
        if (!bar) return null
        const py = priceY(bar.close)
        return (
          <>
            <line x1={CHART_W - PAD_R} y1={py} x2={CHART_W - PAD_R + 4} y2={py}
              stroke="rgba(200,200,255,0.5)" strokeWidth={1} pointerEvents="none" />
            <rect x={CHART_W - PAD_R + 4} y={py - 6} width={48} height={13}
              fill="rgba(20,23,38,0.85)" rx={2} pointerEvents="none" />
            <text x={CHART_W - PAD_R + 6} y={py + 3} textAnchor="start" fontSize={9}
              fill="var(--neon-cyan)" style={{ fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
              {formatCurrency(bar.close)}
            </text>
          </>
        )
      })()}
    </svg>
  )
}

// ── OHLCV stat strip ──────────────────────────────────────────────────────────

interface OhlcvStatsProps {
  bar: DailyBar
  prevBar: DailyBar | undefined
  isSelected: boolean
  grade: ExplosiveGrade | null
}

function OhlcvStats({ bar, prevBar, isSelected, grade }: OhlcvStatsProps) {
  const closePct = prevBar
    ? ((bar.close - prevBar.close) / prevBar.close) * 100
    : null
  const sessionPct = bar.open > 0
    ? ((bar.close - bar.open) / bar.open) * 100
    : null
  const totalRange = bar.high - bar.low
  const bodySize   = Math.abs(bar.close - bar.open)
  const bodyRatio  = totalRange > 0 ? bodySize / totalRange : 0
  const volChange  = prevBar && prevBar.volume > 0
    ? ((bar.volume - prevBar.volume) / prevBar.volume) * 100
    : null

  const accentColor = grade === 'A+'
    ? 'var(--neon-orange)'
    : (grade === 'strong' || isSelected)
      ? 'var(--neon-cyan)'
      : undefined

  const stats: { label: string; value: string; sub?: string; color?: string }[] = [
    { label: 'Open',  value: `$${formatCurrency(bar.open)}` },
    { label: 'High',  value: `$${formatCurrency(bar.high)}`, color: 'var(--neon-green)' },
    { label: 'Low',   value: `$${formatCurrency(bar.low)}`,  color: 'var(--neon-red)' },
    {
      label: 'Close', value: `$${formatCurrency(bar.close)}`, color: accentColor,
      sub: closePct != null ? `${closePct >= 0 ? '+' : ''}${closePct.toFixed(2)}% vs prev` : undefined,
    },
    {
      label: 'Session Δ',
      value: sessionPct != null ? `${sessionPct >= 0 ? '+' : ''}${sessionPct.toFixed(2)}%` : '—',
      color: sessionPct != null ? (sessionPct >= 0 ? 'var(--neon-green)' : 'var(--neon-red)') : undefined,
      sub: 'close vs open',
    },
    {
      label: 'Body / Range',
      value: `${(bodyRatio * 100).toFixed(0)}%`,
      color: bodyRatio >= 0.7 ? 'var(--neon-orange)' : bodyRatio >= 0.5 ? 'var(--neon-cyan)' : undefined,
      sub: bodyRatio >= 0.7 ? 'A+ marubozu' : bodyRatio >= 0.5 ? 'strong' : 'weak / doji',
    },
    {
      label: 'Volume',
      value: formatVolume(bar.volume),
      sub: volChange != null ? `${volChange >= 0 ? '+' : ''}${volChange.toFixed(1)}% vs prev` : undefined,
      color: volChange != null ? (volChange >= 0 ? 'var(--neon-cyan)' : 'var(--muted)') : undefined,
    },
    { label: 'Date', value: bar.date },
  ]

  const stripClass = [
    'td-stats',
    isSelected && !grade ? 'td-stats-selected' : '',
    grade === 'A+' ? 'td-stats-explosive' : '',
    grade === 'strong' ? 'td-stats-selected' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={stripClass}>
      {stats.map((s) => (
        <div key={s.label} className="td-stat">
          <span className="td-stat-label">{s.label}</span>
          <span className="td-stat-value" style={s.color ? { color: s.color } : undefined}>
            {s.value}
          </span>
          {s.sub && <span className="td-stat-sub">{s.sub}</span>}
        </div>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)         return `${(v / 1_000).toFixed(1)}K`
  return v.toString()
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDateLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-').map(Number)
  return `${MONTH_ABBR[month - 1]} ${day}`
}
