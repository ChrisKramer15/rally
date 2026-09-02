import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDailyBarsFromSupabase } from '../data/supabaseDailyStore'
import type { DailyBar } from '../data/tiingo'
import { changePct, formatCurrency, type Stock } from '../data/stocks'
import type { ExplosiveGrade } from '../hooks/useExplosiveMoves'
import { detectBasesForBars, type BasingZone } from '../hooks/useBasingZones'

interface TickerDetailModalProps {
  stock: Stock
  onClose: () => void
  /**
   * Map of YYYY-MM-DD → grade for every explosive candle in this symbol's history.
   * A+ candles get orange highlight; 'strong' candles get pink highlight.
   * Absent on the regular watchlist modal — all candles render normally.
   */
  explosiveGrades?: Map<string, ExplosiveGrade>
  /**
   * Dates (YYYY-MM-DD) of explosive candles considered *fresh* (within the
   * freshness window). Fresh candles get the full outline+glow+icon treatment;
   * graded candles NOT in this set are dimmed as stale historical context.
   * If omitted, all graded candles are treated as fresh.
   */
  freshDates?: Set<string>
}

const VOL_SECTION_RATIO = 0.18

/**
 * Tracks the rendered pixel width of an element via ResizeObserver.
 * Used to size the candle chart's viewBox so it renders 1:1 with no stretch.
 */
function useElementWidth(ref: React.RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth || fallback)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, fallback])
  return width
}

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
export function TickerDetailModal({ stock, onClose, explosiveGrades, freshDates }: TickerDetailModalProps) {
  const [bars, setBars] = useState<DailyBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>('D')
  const [rangeIdx, setRangeIdx] = useState(1)
  const [selectedBar, setSelectedBar] = useState<DailyBar | null>(null)
  const [showZones, setShowZones] = useState(true)
  const [showExplosive, setShowExplosive] = useState(true)
  const overlayRef = useRef<HTMLDivElement>(null)
  const chartWrapRef = useRef<HTMLDivElement>(null)
  const chartWidth = useElementWidth(chartWrapRef, CHART_W)

  // The modal is mounted with key={stock.symbol} by its parents, so a symbol
  // change remounts this component with fresh initial state (loading:true, no
  // bars, no selection). The effect below only owns the async fetch.
  useEffect(() => {
    let cancelled = false
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

  // Detect basing zones on the FULL daily history so ATR + base look-back are
  // accurate, then keep only zones whose base is visible in the current slice.
  // Zones are a daily-timeframe concept; weekly bar dates won't line up.
  const zones = useMemo<BasingZone[]>(() => {
    if (timeframe !== 'D' || bars.length === 0) return []
    const all = detectBasesForBars(bars, stock.symbol)
    const firstVisibleDate = slicedDaily[0]?.date
    if (!firstVisibleDate) return []
    return all.filter((z) => z.endDate >= firstVisibleDate)
  }, [bars, stock.symbol, timeframe, slicedDaily])

  const visibleZones = showZones ? zones : []

  // When explosive traits are toggled off, drop the grade map entirely so every
  // candle (and the stats strip) renders like a normal one.
  const activeGrades = showExplosive ? explosiveGrades : undefined
  const hasExplosiveData = (explosiveGrades?.size ?? 0) > 0

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
  const statsBarGrade = statsBar ? (activeGrades?.get(statsBar.date) ?? null) : null

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
          {hasExplosiveData && (
            <button
              className={`td-explosive-toggle ${showExplosive ? 'active' : ''}`}
              onClick={() => setShowExplosive((v) => !v)}
              aria-pressed={showExplosive}
              title="Toggle explosive-move highlighting"
            >
              {showExplosive ? '⚡ Explosive on' : '⚡ Explosive off'}
            </button>
          )}
          {timeframe === 'D' && zones.length > 0 && (
            <button
              className={`td-zone-toggle ${showZones ? 'active' : ''}`}
              onClick={() => setShowZones((v) => !v)}
              aria-pressed={showZones}
              title="Toggle supply/demand basing zones"
            >
              {showZones ? '◧ Zones on' : '◧ Zones off'} ({zones.length})
            </button>
          )}
          {selectedBar && (
            <button className="td-clear-sel" onClick={() => setSelectedBar(null)} aria-label="Clear candle selection">
              Clear selection
            </button>
          )}
        </div>

        {/* ── Chart ── */}
        <div className="td-chart-wrap" ref={chartWrapRef}>
          {loading && <div className="td-loading">Loading chart…</div>}
          {!loading && error && <div className="td-error">{error}</div>}
          {!loading && !error && chartBars.length < 2 && <div className="td-loading">No data available yet.</div>}
          {!loading && !error && chartBars.length >= 2 && (
            <CandleChart
              bars={chartBars}
              timeframe={timeframe}
              width={chartWidth}
              explosiveGrades={activeGrades}
              freshDates={freshDates}
              zones={visibleZones}
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
  /** Measured pixel width of the chart container; drives the viewBox so nothing stretches. */
  width: number
  explosiveGrades?: Map<string, ExplosiveGrade>
  /** Dates of fresh explosive candles; graded candles outside this set render dimmed. */
  freshDates?: Set<string>
  /** Detected basing zones to overlay (already filtered to the visible range). */
  zones?: BasingZone[]
  selectedDate: string | null
  onSelectBar: (bar: DailyBar) => void
}

const CHART_H = 340
const CHART_W = 720
const PAD_T = 12
const PAD_B = 8
const PAD_L = 0
const PAD_R = 52

function CandleChart({ bars, timeframe, width, explosiveGrades, freshDates, zones, selectedDate, onSelectBar }: CandleChartProps) {
  const n = bars.length

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // viewBox width tracks the real rendered width so the 1:1 aspect ratio holds
  // and text/candles never stretch horizontally.
  const chartW = Math.max(320, Math.round(width))
  const totalW = chartW - PAD_L - PAD_R
  const step = n > 0 ? totalW / n : totalW

  // Declared before the early return so hook order stays stable across renders.
  const mouseMoveHandler = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vbX = ((e.clientX - rect.left) / rect.width) * chartW
    const idx = Math.floor((vbX - PAD_L) / step)
    setHoveredIdx(idx >= 0 && idx < n ? idx : null)
  }, [n, step, chartW])

  if (n < 2) return null

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

  const crosshairX = hoveredIdx !== null ? PAD_L + hoveredIdx * step + step / 2 : null
  const hasAnyExplosive = (explosiveGrades?.size ?? 0) > 0

  // Map each visible bar date → its x-lane index, for positioning zone boxes.
  const idxByDate = new Map<string, number>()
  bars.forEach((b, i) => idxByDate.set(b.date, i))

  // Resolve each zone to on-chart geometry. A fresh zone's box runs to the right
  // edge (still live). A mitigated zone's box ends at the candle where price
  // first returned to it — after that, the zone is "used up".
  const rightEdge = chartW - PAD_R
  const zoneRects = (zones ?? [])
    .map((z) => {
      const startI = idxByDate.get(z.startDate)
      if (startI === undefined) return null
      const x = PAD_L + startI * step
      // If mitigated and the touch bar is on-screen, stop the box there.
      const mitI = z.mitigatedDate ? idxByDate.get(z.mitigatedDate) : undefined
      const endX = z.mitigated && mitI !== undefined
        ? PAD_L + mitI * step + step / 2
        : rightEdge
      const w = Math.max(2, endX - x)
      const proxY = priceY(z.proximal)
      const distY = priceY(z.distal)
      const top = Math.min(proxY, distY)
      const height = Math.max(2, Math.abs(distY - proxY))
      return { zone: z, x, w, endX, proxY, distY, top, height }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${chartW} ${CHART_H}`}
      className="td-candle-svg"
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
        {/* Soft single-pass glow for A+ candles — a gentle orange halo, not a blaze */}
        <filter id="tdOrangeSoftGlow" x="-60%" y="-40%" width="220%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Matching soft glow for strong candles — same treatment, pink halo */}
        <filter id="tdPinkSoftGlow" x="-60%" y="-40%" width="220%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Price grid ── */}
      {priceLabels.map((price, i) => (
        <line key={i} x1={PAD_L} y1={priceY(price)} x2={chartW - PAD_R} y2={priceY(price)}
          stroke="rgba(120,90,255,0.10)" strokeWidth={1} />
      ))}

      {/* ── Prev-close reference ── */}
      <line x1={PAD_L} y1={priceY(refClose)} x2={chartW - PAD_R} y2={priceY(refClose)}
        stroke="rgba(177,77,255,0.45)" strokeWidth={1} strokeDasharray="4 3" />

      {/* ── Basing zones (behind candles) ── */}
      {zoneRects.map(({ zone, x, w, endX, proxY, distY, top, height }) => {
        const demand = zone.kind === 'demand'
        // Demand → green tint, supply → red tint. A+ zones brighter.
        const base = demand ? '52,227,140' : '255,77,109'
        // Mitigated (used-up) zones are dimmed — the fresh first-touch is gone.
        const dim = zone.mitigated ? 0.35 : 1
        const fillOpacity = (zone.grade === 'A+' ? 0.16 : zone.grade === 'good' ? 0.1 : 0.06) * dim
        const lineOpacity = (zone.grade === 'A+' ? 0.85 : zone.grade === 'good' ? 0.6 : 0.4) * dim
        const label = `${demand ? 'Demand' : 'Supply'} · ${zone.grade}${zone.mitigated ? ' · used' : ''}`
        return (
          <g key={`${zone.explosiveDate}-${zone.startDate}`} pointerEvents="none">
            <rect
              x={x} y={top} width={w} height={height}
              fill={`rgba(${base},${fillOpacity})`}
              rx={1}
            />
            {/* Proximal line (entry, closest to price) — solid, dashed if used */}
            <line x1={x} y1={proxY} x2={endX} y2={proxY}
              stroke={`rgba(${base},${lineOpacity})`} strokeWidth={1}
              strokeDasharray={zone.mitigated ? '2 3' : undefined} />
            {/* Distal line (stop, furthest) — dashed */}
            <line x1={x} y1={distY} x2={endX} y2={distY}
              stroke={`rgba(${base},${lineOpacity})`} strokeWidth={1} strokeDasharray="3 3" />
            {/* Small tick at the mitigation point where price returned */}
            {zone.mitigated && (
              <line x1={endX} y1={top} x2={endX} y2={top + height}
                stroke={`rgba(${base},${lineOpacity + 0.2})`} strokeWidth={1} />
            )}
            {/* Zone label at the base's left edge */}
            <text
              x={x + 3} y={top - 3}
              fontSize={8} fill={`rgba(${base},${Math.min(1, lineOpacity + 0.15)})`}
              style={{ fontFamily: 'var(--mono)' }}
            >
              {label}
            </text>
          </g>
        )
      })}

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
        // A graded candle is "stale" when a freshness set is provided and this
        // candle's date isn't in it. Stale candles keep their marker for context
        // but render quietly (no glow, faded outline/icon).
        const isStale     = isExplosive && freshDates !== undefined && !freshDates.has(bar.date)
        const isFreshMark = isExplosive && !isStale

        // The candle FILL always encodes direction: green = up, red = down, so
        // you can always read which way a highlighted candle moved.
        const color = bullish ? 'var(--neon-green)' : 'var(--neon-red)'

        // The candle STROKE carries the grade as an outline: orange for A+, pink
        // for strong, cyan for a manual selection, else it just matches the fill.
        // Stale graded candles use a muted grade tint so they don't compete with
        // fresh signals.
        const strokeColor = isStale
          ? (isAplus ? 'rgba(255,140,0,0.45)' : 'rgba(255,61,242,0.45)')
          : isAplus
            ? 'var(--neon-orange)'
            : isStrong
              ? 'var(--neon-pink)'
              : isSelected
                ? 'var(--neon-cyan)'
                : color

        // Dim everything else when explosives are present OR a candle is selected.
        const dimmed = (hasAnyExplosive && !isExplosive && !isSelected) ||
                       (selectedDate !== null && !isSelected)
        const opacity = dimmed ? 0.3 : (isHovered && !isSelected) ? 0.85 : 0.9

        // Fresh graded candles are widened for emphasis; stale ones stay normal
        // width so they blend into the historical context.
        const candleW = isFreshMark
          ? Math.max(bodyWidth * 1.5, bodyWidth + 3)
          : isSelected
            ? Math.max(bodyWidth * 1.2, bodyWidth + 2)
            : bodyWidth

        const bodyTop = priceY(Math.max(bar.open, bar.close))
        const bodyBot = priceY(Math.min(bar.open, bar.close))
        const bodyH   = Math.max(1, bodyBot - bodyTop)

        const volBarH = maxVol > 0 ? (bar.volume / maxVol) * (volH - 4) : 0
        const volY    = CHART_H - PAD_B - volBarH
        const highY   = priceY(bar.high)



        // Volume bars also follow direction (up/down) rather than grade, so the
        // whole candle reads consistently; the glowing lane box flags the grade.
        const volFill = bullish ? 'url(#tdVolUp)' : 'url(#tdVolDown)'

        return (
          <g key={bar.date}>
            {/* Lane highlights — fresh graded candles glow; stale ones get a
                faint outline only (kept for context, but visually recede). */}
            {isAplus && isFreshMark && (
              <rect x={laneX + 0.5} y={PAD_T} width={step - 1} height={priceH}
                fill="rgba(255,140,0,0.03)" stroke="rgba(255,140,0,0.4)" strokeWidth={1} rx={2}
                filter="url(#tdOrangeSoftGlow)" />
            )}
            {isStrong && isFreshMark && (
              <rect x={laneX + 0.5} y={PAD_T} width={step - 1} height={priceH}
                fill="rgba(255,61,242,0.03)" stroke="rgba(255,61,242,0.4)" strokeWidth={1} rx={2}
                filter="url(#tdPinkSoftGlow)" />
            )}
            {isStale && (
              <rect x={laneX + 0.5} y={PAD_T} width={step - 1} height={priceH}
                fill="none"
                stroke={isAplus ? 'rgba(255,140,0,0.14)' : 'rgba(255,61,242,0.14)'}
                strokeWidth={1} strokeDasharray="2 3" rx={2} />
            )}
            {isSelected && !isAplus && (
              <rect x={laneX} y={PAD_T} width={step} height={priceH}
                fill="rgba(34,227,255,0.06)" rx={2} />
            )}
            {isHovered && !isSelected && !isExplosive && (
              <rect x={laneX} y={PAD_T} width={step} height={priceH}
                fill="rgba(200,200,255,0.04)" rx={2} />
            )}

            {/* Candle group — glow only for fresh graded candles */}
            <g opacity={opacity} filter={isFreshMark && isAplus ? 'url(#tdOrangeSoftGlow)' : isFreshMark && isStrong ? 'url(#tdPinkSoftGlow)' : undefined}>
              {/* Wick — grade-colored outline via strokeColor (stale = thin) */}
              <line x1={cx} y1={priceY(bar.high)} x2={cx} y2={priceY(bar.low)}
                stroke={strokeColor} strokeWidth={isFreshMark && isAplus ? 2 : isFreshMark && isStrong ? 1.5 : isSelected ? 1.5 : 1} />
              {/* Body — green (up) / red (down) fill, grade-colored outline */}
              <rect
                x={cx - candleW / 2} y={bodyTop}
                width={candleW} height={bodyH}
                fill={color}
                stroke={strokeColor}
                strokeWidth={isFreshMark && isAplus ? 2 : isFreshMark && isStrong ? 1.5 : isSelected ? 1.5 : 1}
                opacity={bullish ? 0.9 : 0.75}
              />
              {/* Volume */}
              <rect x={cx - candleW / 2} y={volY} width={candleW} height={volBarH} fill={volFill} />
            </g>

            {/* ⚡ annotation for A+ candles — full for fresh, faded for stale */}
            {isAplus && (
              <text x={cx} y={highY - 6} textAnchor="middle"
                fontSize={isFreshMark ? 13 : 9}
                opacity={isFreshMark ? 1 : 0.4}
                style={isFreshMark ? { filter: 'drop-shadow(0 0 4px rgba(255,140,0,0.9))', pointerEvents: 'none' } : { pointerEvents: 'none' }}>
                ⚡
              </text>
            )}

            {/* ◆ annotation for strong candles — full for fresh, faded for stale */}
            {isStrong && (
              <text x={cx} y={highY - 6} textAnchor="middle"
                fontSize={isFreshMark ? 11 : 8}
                fill="var(--neon-pink)"
                opacity={isFreshMark ? 1 : 0.4}
                style={isFreshMark ? { filter: 'drop-shadow(0 0 4px rgba(255,61,242,0.9))', pointerEvents: 'none' } : { pointerEvents: 'none' }}>
                ◆
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
        <text key={i} x={chartW - PAD_R + 4} y={priceY(price) + 3}
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
            <line x1={chartW - PAD_R} y1={py} x2={chartW - PAD_R + 4} y2={py}
              stroke="rgba(200,200,255,0.5)" strokeWidth={1} pointerEvents="none" />
            <rect x={chartW - PAD_R + 4} y={py - 6} width={48} height={13}
              fill="rgba(20,23,38,0.85)" rx={2} pointerEvents="none" />
            <text x={chartW - PAD_R + 6} y={py + 3} textAnchor="start" fontSize={9}
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
    : grade === 'strong'
      ? 'var(--neon-pink)'
      : isSelected
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
    grade === 'strong' ? 'td-stats-strong' : '',
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
