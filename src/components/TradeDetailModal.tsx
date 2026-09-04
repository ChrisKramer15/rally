import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDailyBarsFromSupabase } from '../data/supabaseDailyStore'
import type { DailyBar } from '../data/tiingo'
import { formatCurrency } from '../data/stocks'
import type { BacktestPosition } from '../hooks/useBacktestPortfolio'

interface TradeDetailModalProps {
  position: BacktestPosition
  /** Current live market price for the symbol, if available. */
  livePrice: number | null
  onClose: () => void
}

const CHART_H = 360
const PAD_T = 14
const PAD_B = 8
const PAD_L = 0
const PAD_R = 64
const MIN_STEP = 12
/** How many trailing daily bars to load into the chart. */
const RANGE_BARS = 130

/**
 * A managed price level to draw as a horizontal line across the chart.
 */
interface Level {
  price: number
  label: string
  /** CSS color (usually a --neon-* var) for the line + label. */
  color: string
  /** 'solid' entry line, 'dashed' for stop/target/limit. */
  dashed?: boolean
}

/**
 * Tracks the rendered pixel width of an element via ResizeObserver so the SVG
 * viewBox matches 1:1 and candles never stretch.
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

/**
 * TradeDetailModal
 *
 * Opened by clicking an open (active) or pending row on the Backtest page. It
 * shows the symbol's recent daily candles with horizontal reference lines for
 * the managed trade levels:
 *   • entry      — the fill price (open) or the resting limit price (pending)
 *   • stop-loss  — the risk floor/ceiling
 *   • cash-out   — the profit target
 * A pending order also draws its limit (trigger) line. The price axis auto-
 * expands to include every level so the lines are always on-screen even when
 * they sit outside the visible candle range.
 */
export function TradeDetailModal({ position, livePrice, onClose }: TradeDetailModalProps) {
  const [bars, setBars] = useState<DailyBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const chartWrapRef = useRef<HTMLDivElement>(null)
  const chartWidth = useElementWidth(chartWrapRef, 720)

  useEffect(() => {
    let cancelled = false
    fetchDailyBarsFromSupabase(position.symbol)
      .then((data) => { if (!cancelled) { setBars(data); setLoading(false) } })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load candle data.')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [position.symbol])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isShort = position.side === 'short'
  const isPending = position.status === 'pending'

  // Entry: the fill price for an open position, or the resting limit for a
  // pending one (that's the price it's waiting to trade at).
  const entryPrice = isPending
    ? (position.limitPrice ?? null)
    : (position.entryPrice ?? null)

  // Build the set of horizontal levels to draw.
  const levels = useMemo<Level[]>(() => {
    const out: Level[] = []
    if (entryPrice !== null && Number.isFinite(entryPrice)) {
      out.push({
        price: entryPrice,
        label: isPending ? `Limit / entry $${formatCurrency(entryPrice)}` : `Entry $${formatCurrency(entryPrice)}`,
        color: 'var(--neon-cyan)',
      })
    }
    out.push({
      price: position.stopLossPrice,
      label: `Stop-loss $${formatCurrency(position.stopLossPrice)}`,
      color: 'var(--neon-red)',
      dashed: true,
    })
    out.push({
      price: position.cashOutPrice,
      label: `Cash-out $${formatCurrency(position.cashOutPrice)}`,
      color: 'var(--neon-green)',
      dashed: true,
    })
    return out
  }, [entryPrice, isPending, position.stopLossPrice, position.cashOutPrice])

  // Actual reward-to-risk, derived from the managed levels against the entry
  // (fill price, or the resting limit while pending).
  const rrLabel = useMemo(() => {
    if (entryPrice === null || !Number.isFinite(entryPrice)) return null
    const risk = Math.abs(entryPrice - position.stopLossPrice)
    const reward = Math.abs(position.cashOutPrice - entryPrice)
    if (risk <= 0) return null
    return `${(reward / risk).toFixed(1)}:1`
  }, [entryPrice, position.stopLossPrice, position.cashOutPrice])

  const chartBars = useMemo(() => bars.slice(-RANGE_BARS), [bars])

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
        aria-label={`${position.symbol} trade detail`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="wl-modal-head td-head">
          <div className="td-title-group">
            <span className="td-symbol">{position.symbol}</span>
            <span className={`bt-side-badge ${isShort ? 'bt-side-short' : 'bt-side-long'}`}>
              {isShort ? 'SHORT' : 'LONG'}
            </span>
            {position.name && position.name !== position.symbol && (
              <span className="td-name">{position.name}</span>
            )}
          </div>
          <div className="td-price-group">
            {livePrice !== null && (
              <span className="td-price">${formatCurrency(livePrice)}</span>
            )}
            <span className={`bt-pending-tag ${isPending ? '' : 'bt-open-tag'}`}>
              {isPending ? 'Pending' : 'Open'}
            </span>
          </div>
          <button className="wl-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {/* ── Level legend ── */}
        <div className="tl-legend">
          {levels.map((l) => (
            <span key={l.label} className="tl-legend-item">
              <span
                className="tl-legend-swatch"
                style={{ background: l.color, opacity: l.dashed ? 0.85 : 1 }}
              />
              {l.label}
            </span>
          ))}
          <span className="tl-legend-meta">
            {position.shares} sh{rrLabel ? ` · ${rrLabel} R` : ''} · {position.orderType}
          </span>
        </div>

        {/* ── Chart ── */}
        <div className="td-chart-wrap" ref={chartWrapRef}>
          {loading && <div className="td-loading">Loading chart…</div>}
          {!loading && error && <div className="td-error">{error}</div>}
          {!loading && !error && chartBars.length < 2 && (
            <div className="td-loading">No candle data available for {position.symbol}.</div>
          )}
          {!loading && !error && chartBars.length >= 2 && (
            <LevelCandleChart
              bars={chartBars}
              width={chartWidth}
              levels={levels}
              livePrice={livePrice}
            />
          )}
        </div>

        <div className="bt-footnote">
          {isPending
            ? `This limit order fills when price ${isShort ? 'rises to' : 'drops to'} the entry line, then the stop-loss and cash-out lines govern the open position.`
            : 'Solid cyan is your entry. The trade exits at the red stop-loss or the green cash-out, whichever price reaches first.'}
        </div>
      </div>
    </div>
  )
}

// ── Candle chart with horizontal level lines ─────────────────────────────────

interface LevelCandleChartProps {
  bars: DailyBar[]
  width: number
  levels: Level[]
  livePrice: number | null
}

function LevelCandleChart({ bars, width, levels, livePrice }: LevelCandleChartProps) {
  const n = bars.length
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const containerW = Math.max(320, Math.round(width))
  const neededW = n * MIN_STEP + PAD_L + PAD_R
  const chartW = Math.max(containerW, neededW)
  const totalW = chartW - PAD_L - PAD_R
  const step = n > 0 ? totalW / n : totalW

  // Scroll to the latest candles on load.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [n, chartW])

  const resolveIdxFromClientX = useCallback((clientX: number) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vbX = ((clientX - rect.left) / rect.width) * chartW
    const idx = Math.floor((vbX - PAD_L) / step)
    setHoveredIdx(idx >= 0 && idx < n ? idx : null)
  }, [n, step, chartW])

  const mouseMoveHandler = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    resolveIdxFromClientX(e.clientX)
  }, [resolveIdxFromClientX])

  const geom = useMemo(() => {
    const barLow = Math.min(...bars.map((b) => b.low))
    const barHigh = Math.max(...bars.map((b) => b.high))
    // Expand the vertical range so every managed level (and the live price) is
    // guaranteed on-screen, even when it sits outside the candle range.
    const extra = [...levels.map((l) => l.price), ...(livePrice !== null ? [livePrice] : [])]
      .filter((p) => Number.isFinite(p))
    let lo = Math.min(barLow, ...extra)
    let hi = Math.max(barHigh, ...extra)
    // Small padding so lines/candles don't sit flush against the edges.
    const pad = (hi - lo) * 0.06 || 1
    lo -= pad
    hi += pad
    return { lo, hi, range: hi - lo || 1 }
  }, [bars, levels, livePrice])

  const maxVol = Math.max(...bars.map((b) => b.volume))
  const volH = CHART_H * 0.16
  const priceH = CHART_H - volH - PAD_T - PAD_B - 6

  const priceY = useCallback(
    (p: number) => PAD_T + priceH - ((p - geom.lo) / geom.range) * priceH,
    [priceH, geom.lo, geom.range],
  )

  if (n < 2) return null

  const bodyWidth = Math.max(2, step - 1.5)
  const priceLabels = Array.from({ length: 6 }, (_, i) => geom.lo + (geom.range * i) / 5)
  const dateStep = Math.max(1, Math.floor(n / 5))
  const dateLabels = bars
    .map((b, i) => ({ i, date: b.date }))
    .filter((_, i) => i % dateStep === 0)

  const crosshairX = hoveredIdx !== null ? PAD_L + hoveredIdx * step + step / 2 : null
  const hoverBar = hoveredIdx !== null ? bars[hoveredIdx] ?? null : null
  const hoverChangePct = hoverBar && hoveredIdx! > 0 && bars[hoveredIdx! - 1]
    ? ((hoverBar.close - bars[hoveredIdx! - 1].close) / bars[hoveredIdx! - 1].close) * 100
    : null

  return (
    <>
      {hoverBar && (
        <div className="td-readout" aria-hidden="true">
          <span className="td-readout-date">{formatDateLabel(hoverBar.date)}</span>
          <span className="td-readout-val">O <b>{formatCurrency(hoverBar.open)}</b></span>
          <span className="td-readout-val">H <b>{formatCurrency(hoverBar.high)}</b></span>
          <span className="td-readout-val">L <b>{formatCurrency(hoverBar.low)}</b></span>
          <span className="td-readout-val">C <b>{formatCurrency(hoverBar.close)}</b></span>
          {hoverChangePct !== null && (
            <span className={`td-readout-chg ${hoverChangePct >= 0 ? 'up' : 'down'}`}>
              {hoverChangePct >= 0 ? '+' : ''}{hoverChangePct.toFixed(2)}%
            </span>
          )}
        </div>
      )}
      <div className="td-chart-scroll" ref={scrollRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${chartW} ${CHART_H}`}
          width={chartW}
          height={CHART_H}
          className="td-candle-svg"
          role="img"
          aria-label={`${bars.length}-day candlestick chart with trade levels`}
          onMouseMove={mouseMoveHandler}
          onMouseLeave={() => setHoveredIdx(null)}
          style={{ cursor: 'crosshair', touchAction: 'pan-x' }}
        >
          <defs>
            <linearGradient id="tlVolUp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--neon-green)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--neon-green)" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id="tlVolDown" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--neon-red)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--neon-red)" stopOpacity="0.06" />
            </linearGradient>
          </defs>

          {/* ── Price grid ── */}
          {priceLabels.map((price, i) => (
            <line key={i} x1={PAD_L} y1={priceY(price)} x2={chartW - PAD_R} y2={priceY(price)}
              stroke="rgba(120,90,255,0.10)" strokeWidth={1} />
          ))}

          {/* ── Candles ── */}
          {bars.map((bar, i) => {
            const cx = PAD_L + i * step + step / 2
            const laneX = PAD_L + i * step
            const bullish = bar.close >= bar.open
            const color = bullish ? 'var(--neon-green)' : 'var(--neon-red)'
            const isHovered = hoveredIdx === i

            const bodyTop = priceY(Math.max(bar.open, bar.close))
            const bodyBot = priceY(Math.min(bar.open, bar.close))
            const bodyH = Math.max(1, bodyBot - bodyTop)

            const volBarH = maxVol > 0 ? (bar.volume / maxVol) * (volH - 4) : 0
            const volY = CHART_H - PAD_B - volBarH
            const volFill = bullish ? 'url(#tlVolUp)' : 'url(#tlVolDown)'

            return (
              <g key={bar.date} opacity={isHovered ? 1 : 0.9}>
                <line x1={cx} y1={priceY(bar.high)} x2={cx} y2={priceY(bar.low)}
                  stroke={color} strokeWidth={1} />
                <rect x={cx - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyH}
                  fill={color} stroke={color} strokeWidth={1} opacity={bullish ? 0.9 : 0.75} />
                <rect x={cx - bodyWidth / 2} y={volY} width={bodyWidth} height={volBarH} fill={volFill} />
                <rect x={laneX} y={PAD_T} width={step} height={CHART_H - PAD_T}
                  fill="transparent" aria-hidden="true" />
              </g>
            )
          })}

          {/* ── Managed trade levels (drawn above candles) ── */}
          {levels.map((l) => {
            if (!Number.isFinite(l.price)) return null
            const y = priceY(l.price)
            return (
              <g key={l.label} pointerEvents="none">
                <line x1={PAD_L} y1={y} x2={chartW - PAD_R} y2={y}
                  stroke={l.color} strokeWidth={l.dashed ? 1.25 : 1.75}
                  strokeDasharray={l.dashed ? '6 4' : undefined}
                  style={{ filter: `drop-shadow(0 0 3px ${l.color})` }} />
                <text x={PAD_L + 6} y={y - 4} fontSize={9} fill={l.color}
                  style={{ fontFamily: 'var(--mono)' }}>
                  {l.label}
                </text>
              </g>
            )
          })}

          {/* ── Live price marker ── */}
          {livePrice !== null && Number.isFinite(livePrice) && (
            <line x1={PAD_L} y1={priceY(livePrice)} x2={chartW - PAD_R} y2={priceY(livePrice)}
              stroke="rgba(200,200,255,0.5)" strokeWidth={1} strokeDasharray="2 3" pointerEvents="none" />
          )}

          {/* ── Crosshair ── */}
          {crosshairX !== null && (
            <line x1={crosshairX} y1={PAD_T} x2={crosshairX} y2={PAD_T + priceH}
              stroke="rgba(200,200,255,0.35)" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />
          )}

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
      <LevelPriceAxis priceLabels={priceLabels} priceY={priceY} levels={levels} livePrice={livePrice} />
    </>
  )
}

// ── Pinned price axis ────────────────────────────────────────────────────────

interface LevelPriceAxisProps {
  priceLabels: number[]
  priceY: (p: number) => number
  levels: Level[]
  livePrice: number | null
}

function LevelPriceAxis({ priceLabels, priceY, levels, livePrice }: LevelPriceAxisProps) {
  const W = PAD_R
  return (
    <svg className="td-price-axis" viewBox={`0 0 ${W} ${CHART_H}`} width={W} height={CHART_H} aria-hidden="true">
      {priceLabels.map((price, i) => (
        <text key={i} x={4} y={priceY(price) + 3} textAnchor="start" fontSize={9}
          fill="var(--muted)" style={{ fontFamily: 'var(--mono)' }}>
          {formatCurrency(price)}
        </text>
      ))}

      {/* Colored pill for each managed level at its exact price. */}
      {levels.map((l) => {
        if (!Number.isFinite(l.price)) return null
        const py = Math.min(Math.max(priceY(l.price), PAD_T + 7), CHART_H - 7)
        return (
          <g key={l.label}>
            <rect x={0} y={py - 7} width={W} height={14} fill={l.color} rx={2} opacity={0.95} />
            <text x={W / 2} y={py + 3} textAnchor="middle" fontSize={9} fontWeight={700}
              fill="#04121a" style={{ fontFamily: 'var(--mono)' }}>
              {formatCurrency(l.price)}
            </text>
          </g>
        )
      })}

      {livePrice !== null && Number.isFinite(livePrice) && (() => {
        const py = Math.min(Math.max(priceY(livePrice), PAD_T + 7), CHART_H - 7)
        return (
          <g>
            <rect x={0} y={py - 7} width={W} height={14} fill="rgba(200,200,255,0.85)" rx={2} />
            <text x={W / 2} y={py + 3} textAnchor="middle" fontSize={9} fontWeight={700}
              fill="#04121a" style={{ fontFamily: 'var(--mono)' }}>
              {formatCurrency(livePrice)}
            </text>
          </g>
        )
      })()}
    </svg>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDateLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-').map(Number)
  return `${MONTH_ABBR[month - 1]} ${day}`
}
