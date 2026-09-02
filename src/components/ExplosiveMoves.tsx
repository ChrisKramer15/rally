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
      {grade === 'A+' ? '⚡ A+' : '▲ Strong'}
    </span>
  )
}

/**
 * Mini bar chart: 4 prior close-to-close moves (grey) + today's move (green/red).
 * Uses the latest candle's changePct; prior bars are approximated from the
 * surrounding context we don't have in this shape, so we just show the one bar
 * with its grade color standing alone — clean and accurate.
 */
function MoveBar({ move }: { move: ExplosiveMove }) {
  const pct      = move.latest.changePct
  const positive = pct >= 0
  const isAplus  = move.latest.grade === 'A+'
  const barH     = 28
  const barW     = 14

  // Height scaled to a max of ~15% move = full bar.
  const maxScale = 15
  const h = Math.max(2, (Math.min(Math.abs(pct), maxScale) / maxScale) * (barH * 0.85))
  const y = positive ? barH / 2 - h : barH / 2

  const fill = isAplus
    ? 'var(--neon-orange)'
    : positive
      ? 'var(--neon-green)'
      : 'var(--neon-red)'

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
        opacity={isAplus ? 1 : 0.85}
        style={isAplus ? { filter: 'drop-shadow(0 0 3px rgba(255,140,0,0.7))' } : undefined}
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

      {/* Gap % */}
      <div className="em-col-num">
        <span className={`em-stat ${gapPositive ? 'up' : 'down'}`}>
          {gapPositive ? '+' : ''}{latest.gapPct.toFixed(2)}%
        </span>
      </div>

      {/* Intraday range */}
      <div className="em-col-num">
        <span className="em-stat">{latest.rangePct.toFixed(2)}%</span>
      </div>

      {/* Date of latest signal */}
      <div className="em-col-num em-col-date">
        <span className="em-date">{latest.date}</span>
      </div>
    </li>
  )
}

export function ExplosiveMoves({ stocks, status }: ExplosiveMovesProps) {
  const [minChangePct, setMinChangePct] = useState(5)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)

  const { moves, skippedCount, uncachedCount } = useExplosiveMoves(stocks, minChangePct)

  const selectedStock: Stock | null = selectedSymbol
    ? (stocks.find((s) => s.symbol === selectedSymbol) ?? null)
    : null

  // Pass the full grade map for the selected symbol so the modal highlights
  // every explosive candle in history, not just the latest one.
  const explosiveGrades: Map<string, 'A+' | 'strong'> | undefined = selectedSymbol
    ? (moves.find((m) => m.symbol === selectedSymbol)?.allGrades)
    : undefined

  const isLoading = status === 'loading'

  const aplusCount  = moves.filter((m) => m.latest.grade === 'A+').length
  const strongCount = moves.length - aplusCount

  return (
    <div className="em-page">
      {/* ── Page header ── */}
      <div className="em-header panel">
        <div className="em-header-left">
          <h2>Explosive Moves</h2>
          <p className="em-subtitle">
            Candles with ≥{minChangePct}% move and ≥60% body ratio, scanned across full history.
            Orange = A+ marubozu (≥70% body).
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
                min={1}
                max={50}
                step={0.5}
                value={minChangePct}
                onChange={(e) => setMinChangePct(Number(e.target.value))}
                aria-label="Minimum price change percent"
              />
              <span className="em-control-unit">%</span>
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
          {(skippedCount > 0 || uncachedCount > 0) && (
            <span
              className="em-skipped"
              title={`${uncachedCount} symbols still loading, ${skippedCount} skipped (< 2 bars)`}
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
          <div className="em-col-num">Gap</div>
          <div className="em-col-num">Range</div>
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
              No explosive moves found
              {stocks.length === 0
                ? ' — add symbols to your watchlist to get started.'
                : '. Try lowering the Min Move threshold.'}
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
        <span className="em-legend-item"><strong>⚡ A+</strong> — marubozu, body ≥70% of range (little/no wick)</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item"><strong>▲ Strong</strong> — body 60–69% of range</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item"><strong>Body</strong> — |close−open| ÷ (high−low)</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item"><strong>Gap</strong> — open vs prior close</span>
        <span className="em-sep">·</span>
        <span className="em-legend-item">Click any row to open the full chart</span>
      </div>

      {selectedStock && (
        <TickerDetailModal
          key={selectedStock.symbol}
          stock={selectedStock}
          onClose={() => setSelectedSymbol(null)}
          explosiveGrades={explosiveGrades}
        />
      )}
    </div>
  )
}
