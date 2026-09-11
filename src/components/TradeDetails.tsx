import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDailyBarsFromSupabase } from '../data/supabaseDailyStore'
import type { DailyBar } from '../data/tiingo'
import { formatCurrency } from '../data/stocks'
import { formatDetailRR, placedMoment, type TradeDetailData } from '../data/tradeDetailData'

// ── Chart geometry (mirrors TradeDetailModal's inline chart) ────────────────
const CHART_H = 300
const PAD_T = 14
const PAD_B = 8
const PAD_L = 0
const PAD_R = 64
const MIN_STEP = 10
const RANGE_BARS = 130

interface Level {
  price: number
  label: string
  color: string
  dashed?: boolean
}

function money(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? `$${formatCurrency(v)}` : '—'
}

function dateOrDash(v: string | null | undefined): string {
  return v ?? '—'
}

// ── Expandable details panel ────────────────────────────────────────────────

/**
 * The inline "Details" drawer shown under a pending / active / closed row. It
 * lists the full trade data set and renders a candle chart with the managed
 * levels AND the supply/demand zone band (proximal↔distal) drawn behind the
 * candles. Bars are loaded lazily on first expand.
 */
export function TradeDetails({ data }: { data: TradeDetailData }) {
  const [bars, setBars] = useState<DailyBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(wrapRef, 640)

  useEffect(() => {
    let cancelled = false
    fetchDailyBarsFromSupabase(data.symbol)
      .then((d) => { if (!cancelled) { setBars(d); setLoading(false) } })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load candle data.')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [data.symbol])

  const isPending = data.status === 'pending'
  const rr = formatDetailRR(data)

  const levels = useMemo<Level[]>(() => {
    const out: Level[] = []
    // Entry: actual fill for open/closed, resting limit while pending.
    const entryRef = data.entryPrice ?? (isPending ? data.limitPrice : undefined)
    if (entryRef != null && Number.isFinite(entryRef)) {
      out.push({
        price: entryRef,
        label: isPending ? `Limit ${money(entryRef)}` : `Entry ${money(entryRef)}`,
        color: 'var(--neon-cyan)',
      })
    }
    if (data.stopLossPrice != null) {
      out.push({ price: data.stopLossPrice, label: `Stop ${money(data.stopLossPrice)}`, color: 'var(--neon-red)', dashed: true })
    }
    if (data.cashOutPrice != null) {
      out.push({ price: data.cashOutPrice, label: `Target ${money(data.cashOutPrice)}`, color: 'var(--neon-green)', dashed: true })
    }
    // Exit marker for a closed trade.
    if (data.status === 'closed' && data.exitPrice != null) {
      out.push({ price: data.exitPrice, label: `Exit ${money(data.exitPrice)}`, color: 'var(--neon-orange)' })
    }
    return out
  }, [data, isPending])

  // The supply/demand zone band: proximal (entry edge) ↔ distal (far edge).
  const zone = useMemo(() => {
    const { proximalPrice, distalPrice } = data
    if (proximalPrice == null || distalPrice == null) return null
    if (!Number.isFinite(proximalPrice) || !Number.isFinite(distalPrice)) return null
    return {
      top: Math.max(proximalPrice, distalPrice),
      bottom: Math.min(proximalPrice, distalPrice),
      kind: data.side === 'short' ? 'supply' : 'demand',
    }
  }, [data])

  const chartBars = useMemo(() => bars.slice(-RANGE_BARS), [bars])

  return (
    <div className="td-inline">
      {/* ── Data grid ── */}
      <dl className="td-facts">
        <Fact label="Explosive bar date" value={dateOrDash(data.signalDate)} />
        <Fact label="Proximal price" value={money(data.proximalPrice)} />
        <Fact label="Stop-loss price" value={money(data.stopLossPrice)} />
        <Fact label="Limit price (placed)" value={money(data.limitPrice)} />
        <Fact label="Actual entry price" value={money(data.entryPrice)} />
        <Fact label="Actual exit price" value={money(data.exitPrice)} />
        <Fact label="Order placed" value={placedMoment(data)} />
        <Fact label="Entry date" value={dateOrDash(data.openedDate)} />
        <Fact label="Exit date" value={dateOrDash(data.closedDate)} />
        <Fact label="Reward : risk" value={rr} highlight />
      </dl>

      {/* ── Chart with zone band + levels ── */}
      <div className="td-inline-chart" ref={wrapRef}>
        {loading && <div className="td-loading">Loading chart…</div>}
        {!loading && error && <div className="td-error">{error}</div>}
        {!loading && !error && chartBars.length < 2 && (
          <div className="td-loading">No candle data for {data.symbol}.</div>
        )}
        {!loading && !error && chartBars.length >= 2 && (
          <ZoneCandleChart bars={chartBars} width={width} levels={levels} zone={zone} />
        )}
      </div>
    </div>
  )
}

function Fact({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`td-fact ${highlight ? 'td-fact-hi' : ''}`}>
      <dt className="td-fact-label">{label}</dt>
      <dd className="td-fact-val">{value}</dd>
    </div>
  )
}

// ── Candle chart with a shaded zone band + horizontal levels ────────────────

interface ZoneBand {
  top: number
  bottom: number
  kind: string
}

function ZoneCandleChart({
  bars,
  width,
  levels,
  zone,
}: {
  bars: DailyBar[]
  width: number
  levels: Level[]
  zone: ZoneBand | null
}) {
  const n = bars.length
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const containerW = Math.max(300, Math.round(width))
  const neededW = n * MIN_STEP + PAD_L + PAD_R
  const chartW = Math.max(containerW, neededW)
  const totalW = chartW - PAD_L - PAD_R
  const step = n > 0 ? totalW / n : totalW

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [n, chartW])

  const geom = useMemo(() => {
    const barLow = Math.min(...bars.map((b) => b.low))
    const barHigh = Math.max(...bars.map((b) => b.high))
    const extra = [
      ...levels.map((l) => l.price),
      ...(zone ? [zone.top, zone.bottom] : []),
    ].filter((p) => Number.isFinite(p))
    let lo = Math.min(barLow, ...extra)
    let hi = Math.max(barHigh, ...extra)
    const pad = (hi - lo) * 0.06 || 1
    lo -= pad
    hi += pad
    return { lo, hi, range: hi - lo || 1 }
  }, [bars, levels, zone])

  const maxVol = Math.max(...bars.map((b) => b.volume))
  const volH = CHART_H * 0.16
  const priceH = CHART_H - volH - PAD_T - PAD_B - 6

  const priceY = useCallback(
    (p: number) => PAD_T + priceH - ((p - geom.lo) / geom.range) * priceH,
    [priceH, geom.lo, geom.range],
  )

  if (n < 2) return null

  const bodyWidth = Math.max(2, step - 1.5)
  const priceLabels = Array.from({ length: 5 }, (_, i) => geom.lo + (geom.range * i) / 4)
  const dateStep = Math.max(1, Math.floor(n / 5))
  const dateLabels = bars.map((b, i) => ({ i, date: b.date })).filter((_, i) => i % dateStep === 0)

  const zoneColor = zone?.kind === 'supply' ? 'var(--neon-red)' : 'var(--neon-green)'

  return (
    <div className="td-inline-chart-scroll" ref={scrollRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chartW} ${CHART_H}`}
        width={chartW}
        height={CHART_H}
        className="td-candle-svg"
        role="img"
        aria-label={`${bars.length}-day chart with supply/demand zone and trade levels`}
      >
        <defs>
          <linearGradient id="tdiVolUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--neon-green)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--neon-green)" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="tdiVolDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--neon-red)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--neon-red)" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* ── Supply/demand zone band (behind everything) ── */}
        {zone && Number.isFinite(zone.top) && Number.isFinite(zone.bottom) && (() => {
          const yTop = priceY(zone.top)
          const yBot = priceY(zone.bottom)
          const h = Math.max(1, yBot - yTop)
          return (
            <g pointerEvents="none">
              <rect x={PAD_L} y={yTop} width={chartW - PAD_R} height={h}
                fill={zoneColor} opacity={0.1} />
              <line x1={PAD_L} y1={yTop} x2={chartW - PAD_R} y2={yTop}
                stroke={zoneColor} strokeWidth={1} opacity={0.5} strokeDasharray="4 3" />
              <line x1={PAD_L} y1={yBot} x2={chartW - PAD_R} y2={yBot}
                stroke={zoneColor} strokeWidth={1} opacity={0.5} strokeDasharray="4 3" />
              <text x={PAD_L + 6} y={yTop + 11} fontSize={9} fill={zoneColor}
                style={{ fontFamily: 'var(--mono)' }}>
                {zone.kind === 'supply' ? 'Supply zone' : 'Demand zone'}
              </text>
            </g>
          )
        })()}

        {/* ── Price grid ── */}
        {priceLabels.map((price, i) => (
          <line key={i} x1={PAD_L} y1={priceY(price)} x2={chartW - PAD_R} y2={priceY(price)}
            stroke="rgba(120,90,255,0.10)" strokeWidth={1} />
        ))}

        {/* ── Candles ── */}
        {bars.map((bar, i) => {
          const cx = PAD_L + i * step + step / 2
          const bullish = bar.close >= bar.open
          const color = bullish ? 'var(--neon-green)' : 'var(--neon-red)'
          const bodyTop = priceY(Math.max(bar.open, bar.close))
          const bodyBot = priceY(Math.min(bar.open, bar.close))
          const bodyH = Math.max(1, bodyBot - bodyTop)
          const volBarH = maxVol > 0 ? (bar.volume / maxVol) * (volH - 4) : 0
          const volY = CHART_H - PAD_B - volBarH
          const volFill = bullish ? 'url(#tdiVolUp)' : 'url(#tdiVolDown)'
          return (
            <g key={bar.date} opacity={0.9}>
              <line x1={cx} y1={priceY(bar.high)} x2={cx} y2={priceY(bar.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyH}
                fill={color} stroke={color} strokeWidth={1} opacity={bullish ? 0.9 : 0.75} />
              <rect x={cx - bodyWidth / 2} y={volY} width={bodyWidth} height={volBarH} fill={volFill} />
            </g>
          )
        })}

        {/* ── Managed levels ── */}
        {levels.map((l) => {
          if (!Number.isFinite(l.price)) return null
          const y = priceY(l.price)
          return (
            <g key={l.label} pointerEvents="none">
              <line x1={PAD_L} y1={y} x2={chartW - PAD_R} y2={y}
                stroke={l.color} strokeWidth={l.dashed ? 1.25 : 1.75}
                strokeDasharray={l.dashed ? '6 4' : undefined}
                style={{ filter: `drop-shadow(0 0 3px ${l.color})` }} />
              <text x={PAD_L + 6} y={y - 4} fontSize={9} fill={l.color} style={{ fontFamily: 'var(--mono)' }}>
                {l.label}
              </text>
            </g>
          )
        })}

        {/* ── Date labels ── */}
        {dateLabels.map(({ i, date }) => (
          <text key={date} x={PAD_L + i * step + step / 2} y={PAD_T + priceH + 10}
            textAnchor="middle" fontSize={9} fill="var(--muted)"
            style={{ fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
            {formatDateLabel(date)}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDateLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-').map(Number)
  return `${MONTH_ABBR[month - 1]} ${day}`
}
