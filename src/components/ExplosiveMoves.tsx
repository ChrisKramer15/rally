import { useState } from 'react'
import { useExplosiveMoves, type ExplosiveMove, type ExplosiveGrade } from '../hooks/useExplosiveMoves'
import { formatCurrency, type Stock } from '../data/stocks'
import { TickerDetailModal } from './TickerDetailModal'

interface ExplosiveMovesProps {
  stocks: Stock[]
  status: 'live' | 'simulated' | 'loading' | 'error'
}

function GradeBadge({ grade }: { grade: ExplosiveGrade }) {
  return (
    <span className={`em-grade-badge em-grade-${grade === 'A+' ? 'aplus' : 'strong'}`}>
      {grade === 'A+' ? '⚡ A+' : '◆ Strong'}
    </span>
  )
}

/**
 * Mini move bar: the fill ALWAYS encodes direction (green = up, red = down).
 * The grade is shown separately as an OUTLINE + soft glow around the bar —
 * orange for A+, pink for strong — so direction is never masked by the grade
 * color (mirrors the candle-chart treatment in the detail modal).
 */
function MoveBar({ move }: { move: ExplosiveMove }) {
  const pct      = move.latest.changePct
  const positive = pct >= 0
  const isAplus  = move.latest.grade === 'A+'
  const isStrong = move.latest.grade === 'strong'
  const barH     = 28
  const barW     = 14

  // Height scaled to a max of ~15% move = full bar.
  const maxScale = 15
  const h = Math.max(2, (Math.min(Math.abs(pct), maxScale) / maxScale) * (barH * 0.85))
  const y = positive ? barH / 2 - h : barH / 2

  // Fill = direction only.
  const fill = positive ? 'var(--neon-green)' : 'var(--neon-red)'

  // Outline = grade indicator.
  const outline = isAplus
    ? 'var(--neon-orange)'
    : isStrong
      ? 'var(--neon-pink)'
      : 'none'
  const glow = isAplus
    ? 'drop-shadow(0 0 3px rgba(255,140,0,0.7))'
    : isStrong
      ? 'drop-shadow(0 0 3px rgba(255,61,242,0.6))'
      : undefined

  return (
    <svg
      width={barW}
      height={barH}
      aria-hidden="true"
      className="em-move-bar"
      style={{ overflow: 'visible' }}
    >
      <line
        x1={barW / 2} y1={0}
        x2={barW / 2} y2={barH}
        stroke="rgba(120,110,180,0.15)"
        strokeWidth={1}
      />
      <rect
        x={1} y={y}
        width={barW - 2} height={h}
        rx={2}
        fill={fill}
        stroke={outline}
        strokeWidth={outline === 'none' ? 0 : 1.5}
        opacity={0.9}
        style={glow ? { filter: glow } : undefined}
      />
      <line
        x1={0} y1={barH / 2}
        x2={barW} y2={barH / 2}
        stroke="rgba(120,110,180,0.25)"
        strokeWidth={1}
      />
    </svg>
  )
}

function MoveRow({
  move,
  onSelect,
}: {
  move: ExplosiveMove
  onSelect: (symbol: string) => void
}) {
  const { latest } = move
  const positive    = latest.changePct >= 0
  const gapPositive = latest.gapPct >= 0

  return (
    <li
      className={`em-row em-row-clickable ${latest.grade === 'A+' ? 'em-row-aplus' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(move.symbol)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(move.symbol) }}
      aria-label={`View details for ${move.symbol}`}
    >
      {/* Symbol + name */}
      <div className="em-col-sym">
        <span className="em-sym">{move.symbol}</span>
        {move.name && move.name !== move.symbol && (
          <span className="em-name">{move.name}</span>
        )}
      </div>

      {/* Grade badge */}
      <div className="em-col-grade">
        <GradeBadge grade={latest.grade} />
      </div>

      {/* Mini move bar */}
      <div className="em-col-bar">
        <MoveBar move={move} />
      </div>

      {/* Price */}
      <div className="em-col-num">
        <span className="em-price">${formatCurrency(latest.close)}</span>
      </div>

      {/* Change % */}
      <div className="em-col-num">
        <span className={`em-change ${positive ? 'up' : 'down'}`}>
          {positive ? '+' : ''}{latest.changePct.toFixed(2)}%
        </span>
      </div>

      {/* Body ratio */}
      <div className="em-col-num">
        <span
          className="em-body-ratio"
          style={{
            color: latest.bodyRatio >= 0.7
              ? 'var(--neon-orange)'
              : latest.bodyRatio >= 0.6
                ? 'var(--neon-cyan)'
                : 'var(--muted)',
          }}
        >
          {(latest.bodyRatio * 100).toFixed(0)}%
        </span>
      </div>

      {/* Move size in ATR multiples */}
      <div className="em-col-num">
        <span
          className="em-stat"
          style={{ color: latest.atrMultiple >= 3 ? 'var(--neon-orange)' : 'var(--neon-cyan)' }}
        >
          {latest.atrMultiple.toFixed(1)}×
        </span>
      </div>

      {/* Relative volume */}
      <div className="em-col-num">
        <span
          className="em-stat"
          style={{ color: latest.relVolume >= 1.5 ? 'var(--neon-orange)' : 'var(--muted)' }}
        >
          {latest.relVolume.toFixed(1)}×
        </span>
      </div>

      {/* Gap % */}
      <div className="em-col-num">
        <span className={`em-stat ${gapPositive ? 'up' : 'down'}`}>
          {gapPositive ? '+' : ''}{latest.gapPct.toFixed(2)}%
        </span>
      </div>

      {/* Date of latest signal */}
      <div className="em-col-num em-col-date">
        <span className="em-date">{latest.date}</span>
      </div>
    </li>
  )
}

export function ExplosiveMoves({ stocks, status }: ExplosiveMovesProps) {
  const [moveMultiple, setMoveMultiple] = useState(2)
  const [freshnessDays, setFreshnessDays] = useState(10)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)

  const { moves: allMoves, skippedCount, uncachedCount } = useExplosiveMoves(
    stocks,
    moveMultiple,
    freshnessDays,
  )

  // The Signals page is about *actionable* signals, so it lists only symbols
  // whose most recent explosive move is within the freshness window. Stale
  // moves still exist in history (and show on the chart, dimmed) — they're just
  // not surfaced here as live signals.
  const moves = allMoves.filter((m) => m.latest.isFresh)

  const selectedStock: Stock | null = selectedSymbol
    ? (stocks.find((s) => s.symbol === selectedSymbol) ?? null)
    : null

  // Pass the full grade map for the selected symbol so the modal highlights
  // every explosive candle in history, not just the latest one. Freshness
  // fading uses freshDates below.
  const selectedMove = selectedSymbol
    ? allMoves.find((m) => m.symbol === selectedSymbol)
    : undefined
  const explosiveGrades: Map<string, 'A+' | 'strong'> | undefined = selectedMove?.allGrades
  const freshDates: Set<string> | undefined = selectedMove?.freshDates

  const isLoading = status === 'loading'

  const aplusCount  = moves.filter((m) => m.latest.grade === 'A+').length
  const strongCount = moves.length - aplusCount
  const staleHidden = allMoves.length - moves.length

  return (
    <div className="em-page">
      {/* ── Page header ── */}
      <div className="em-header panel">
        <div className="em-header-left">
          <h2>Explosive Moves</h2>
          <p className="em-subtitle">
            Fresh signals: a ≥{moveMultiple}× ATR move with ≥60% body in the last {freshnessDays} trading
            days. Orange = A+ (clean body + volume surge).
          </p>
        </div>

        {/* Threshold control */}
        <div className="em-controls">
          <label className="em-control">
            <span className="em-control-label">Min Move</span>
            <div className="em-control-input-wrap">
              <input
                className="em-control-input"
                type="number"
                min={0.5}
                max={10}
                step={0.25}
                value={moveMultiple}
                onChange={(e) => setMoveMultiple(Number(e.target.value))}
                aria-label="Minimum move in ATR multiples"
              />
              <span className="em-control-unit">× ATR</span>
            </div>
          </label>
          <label className="em-control">
            <span className="em-control-label">Freshness</span>
            <div className="em-control-input-wrap">
              <input
                className="em-control-input"
                type="number"
                min={1}
                max={120}
                step={1}
                value={freshnessDays}
                onChange={(e) => setFreshnessDays(Number(e.target.value))}
                aria-label="Freshness window in trading days"
              />
              <span className="em-control-unit">days</span>
            </div>
          </label>
        </div>

        {/* Summary */}
        <div className="em-summary">
          <div className="em-summary-row">
            <span className="em-count">{moves.length}</span>
            <span className="em-count-label">symbols</span>
          </div>
          {moves.length > 0 && (
            <div className="em-summary-pills">
              {aplusCount > 0 && (
                <span className="em-summary-pill em-summary-aplus">
                  {aplusCount} A+
                </span>
              )}
              {strongCount > 0 && (
                <span className="em-summary-pill em-summary-strong">
                  {strongCount} strong
                </span>
              )}
            </div>
          )}
          {staleHidden > 0 && (
            <span
              className="em-skipped"
              title={`${staleHidden} symbol(s) had explosive moves, but only older than the ${freshnessDays}-day window`}
            >
              · {staleHidden} stale
            </span>
          )}
          {(skippedCount > 0 || uncachedCount > 0) && (
            <span
              className="em-skipped"
              title={`${uncachedCount} symbols still loading, ${skippedCount} skipped (too little history for ATR)`}
            >
              · {uncachedCount + skippedCount} excluded
            </span>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="panel em-table-panel">
        <div className="em-row em-row-head">
          <div className="em-col-sym">Symbol</div>
          <div className="em-col-grade">Grade</div>
          <div className="em-col-bar"></div>
          <div className="em-col-num">Price</div>
          <div className="em-col-num">Move</div>
          <div className="em-col-num">Body</div>
          <div className="em-col-num">ATR</div>
          <div className="em-col-num">Vol</div>
          <div className="em-col-num">Gap</div>
          <div className="em-col-num em-col-date">Date</div>
        </div>

        {isLoading && moves.length === 0 ? (
          <div className="em-empty">
            <span className="em-empty-icon">⏳</span>
            <span>Loading market data…</span>
          </div>
        ) : moves.length === 0 ? (
          <div className="em-empty">
            <span className="em-empty-icon">🔍</span>
            <span>
              No fresh explosive moves
              {stocks.length === 0
                ? ' — add symbols to your watchlist to get started.'
                : staleHidden > 0
                  ? `. ${staleHidden} symbol(s) moved earlier — widen the Freshness window to see them.`
                  : '. Try lowering the Min Move threshold or widening Freshness.'}
            </span>
          </div>
        ) : (
          <ul className="em-list" aria-label="Explosive moves list">
            {moves.map((m) => (
              <MoveRow key={m.symbol} move={m} onSelect={setSelectedSymbol} />
            ))}
          </ul>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="em-legend">
        <span className="em-legend-item"><strong>⚡ A+</strong> — clean body (≥70%) + volume surge (≥1.5×)</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item"><strong>◆ Strong</strong> — clears the bar but not both boosters</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item"><strong>Body</strong> — |close−open| ÷ (high−low)</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item"><strong>ATR</strong> — move size vs normal daily range</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item"><strong>Vol</strong> — today's volume vs 20-day average</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item">Click any row to open the full chart</span>
      </div>

      {selectedStock && (
        <TickerDetailModal
          key={selectedStock.symbol}
          stock={selectedStock}
          onClose={() => setSelectedSymbol(null)}
          explosiveGrades={explosiveGrades}
          freshDates={freshDates}
        />
      )}
    </div>
  )
}
