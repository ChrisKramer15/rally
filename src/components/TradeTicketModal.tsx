import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCurrency } from '../data/stocks'
import { DEFAULT_RISK_REWARD, type OrderType, type TradeSide } from '../hooks/useBacktestPortfolio'

export interface TradeTicket {
  side: TradeSide
  shares: number
  orderType: OrderType
  /** Only meaningful for limit orders. */
  limitPrice?: number
  /** User-chosen reward-to-risk multiple (2 = 2:1). */
  riskReward: number
}

const RR_OPTIONS = [1, 1.5, 2, 3, 4] as const
const STOP_BUFFER_ATR = 0.1
const FALLBACK_STOP_PCT = 0.08

interface TradeTicketModalProps {
  symbol: string
  name?: string
  /** Current market price (entry for a market order). */
  price: number
  /** Portfolio budget, used to seed a sensible default share count. */
  budget: number
  /**
   * The symbol's proximal line from its most recent basing zone, if any. Used
   * as the default limit price. When absent, limit defaults to current price.
   */
  proximal?: number | null
  /** The zone's distal line — used to preview the distal-anchored stop. */
  distal?: number | null
  /** ATR at order time — sizes the stop buffer beyond the distal line. */
  atr?: number | null
  /**
   * Default side seeded from the signal's direction: an up move (demand zone)
   * → 'long', a down move (supply zone) → 'short'. The user can still override.
   */
  defaultSide?: TradeSide
  onSubmit: (ticket: TradeTicket) => void
  onClose: () => void
}

export function TradeTicketModal({
  symbol,
  name,
  price,
  budget,
  proximal,
  distal,
  atr,
  defaultSide = 'long',
  onSubmit,
  onClose,
}: TradeTicketModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Seed the side from the signal's direction; the user can flip it.
  const [side, setSide] = useState<TradeSide>(defaultSide)
  // Default sizing: ~10% of the budget, at least 1 share.
  const defaultShares = Math.max(1, Math.floor((budget * 0.1) / (price || 1)))
  const [sharesInput, setSharesInput] = useState<string>(String(defaultShares))
  const [orderType, setOrderType] = useState<OrderType>('market')
  const [riskReward, setRiskReward] = useState<number>(DEFAULT_RISK_REWARD)

  const hasProximal = proximal != null && Number.isFinite(proximal) && proximal > 0
  const defaultLimit = hasProximal ? (proximal as number) : price
  const [limitInput, setLimitInput] = useState<string>(defaultLimit.toFixed(2))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shares = Math.max(0, Math.floor(Number(sharesInput) || 0))
  const limitPrice = Number(limitInput) || 0
  const entry = orderType === 'limit' ? limitPrice : price
  const estCost = shares * entry

  // Preview the stop + target the position will get, mirroring managedLevels in
  // the portfolio hook so the ticket shows what you're committing to.
  const preview = useMemo(() => {
    if (!(entry > 0)) return null
    const buffer = atr && atr > 0 ? atr * STOP_BUFFER_ATR : 0
    const distalNum = distal != null && Number.isFinite(distal) ? (distal as number) : undefined
    let stop: number
    if (side === 'long') {
      stop = distalNum !== undefined && distalNum < entry ? distalNum - buffer : entry * (1 - FALLBACK_STOP_PCT)
      stop = Math.max(0, stop)
      const risk = entry - stop
      return { stop, target: entry + risk * riskReward, usedDistal: distalNum !== undefined && distalNum < entry }
    }
    stop = distalNum !== undefined && distalNum > entry ? distalNum + buffer : entry * (1 + FALLBACK_STOP_PCT)
    const risk = stop - entry
    return { stop, target: Math.max(0, entry - risk * riskReward), usedDistal: distalNum !== undefined && distalNum > entry }
  }, [side, entry, distal, atr, riskReward])

  const canSubmit =
    shares >= 1 &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice > 0))

  const triggerHint = useMemo(() => {
    if (orderType !== 'limit') return null
    const dir = side === 'short' ? 'rises to' : 'drops to'
    return `Fills when ${symbol} ${dir} $${formatCurrency(limitPrice)} (the proximal line).`
  }, [orderType, side, symbol, limitPrice])

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      side,
      shares,
      orderType,
      limitPrice: orderType === 'limit' ? limitPrice : undefined,
      riskReward,
    })
  }

  return (
    <div
      className="wl-modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className="wl-modal tt-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Trade ${symbol}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wl-modal-head">
          <div className="tt-title-group">
            <h3>Trade {symbol}</h3>
            {name && name !== symbol && <span className="tt-name">{name}</span>}
          </div>
          <button className="wl-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="tt-price-row">
          <span className="tt-price-label">Last price</span>
          <span className="tt-price-val">${formatCurrency(price)}</span>
        </div>

        {/* ── Side ── */}
        <div className="tt-field">
          <span className="tt-field-label">Side</span>
          <div className="tt-seg" role="group" aria-label="Side">
            <button
              type="button"
              className={`tt-seg-btn tt-side-long ${side === 'long' ? 'active' : ''}`}
              onClick={() => setSide('long')}
              aria-pressed={side === 'long'}
            >
              Long / Buy
            </button>
            <button
              type="button"
              className={`tt-seg-btn tt-side-short ${side === 'short' ? 'active' : ''}`}
              onClick={() => setSide('short')}
              aria-pressed={side === 'short'}
            >
              Short / Sell
            </button>
          </div>
        </div>

        {/* ── Order type ── */}
        <div className="tt-field">
          <span className="tt-field-label">Order type</span>
          <div className="tt-seg" role="group" aria-label="Order type">
            <button
              type="button"
              className={`tt-seg-btn ${orderType === 'market' ? 'active' : ''}`}
              onClick={() => setOrderType('market')}
              aria-pressed={orderType === 'market'}
            >
              Market
            </button>
            <button
              type="button"
              className={`tt-seg-btn ${orderType === 'limit' ? 'active' : ''}`}
              onClick={() => setOrderType('limit')}
              aria-pressed={orderType === 'limit'}
            >
              Limit (pending)
            </button>
          </div>
        </div>

        {/* ── Shares ── */}
        <div className="tt-field">
          <label className="tt-field-label" htmlFor="tt-shares">Quantity (shares)</label>
          <input
            id="tt-shares"
            className="tt-input"
            type="number"
            min={1}
            step={1}
            value={sharesInput}
            onChange={(e) => setSharesInput(e.target.value)}
            aria-label="Share quantity"
          />
        </div>

        {/* ── Limit price (only for limit orders) ── */}
        {orderType === 'limit' && (
          <div className="tt-field">
            <label className="tt-field-label" htmlFor="tt-limit">
              Limit price {hasProximal && <span className="tt-proximal-tag">proximal line</span>}
            </label>
            <div className="tt-input-wrap">
              <span className="tt-input-dollar">$</span>
              <input
                id="tt-limit"
                className="tt-input tt-input-inline"
                type="number"
                min={0}
                step={0.01}
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                aria-label="Limit price"
              />
            </div>
            {triggerHint && <p className="tt-trigger-hint">{triggerHint}</p>}
          </div>
        )}

        {/* ── Risk : reward ── */}
        <div className="tt-field">
          <span className="tt-field-label">Reward : risk</span>
          <div className="tt-seg" role="group" aria-label="Reward to risk ratio">
            {RR_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`tt-seg-btn ${riskReward === r ? 'active' : ''}`}
                onClick={() => setRiskReward(r)}
                aria-pressed={riskReward === r}
              >
                {r % 1 === 0 ? `${r}:1` : `${r}:1`}
              </button>
            ))}
          </div>
        </div>

        {/* ── Level preview ── */}
        {preview && (
          <div className="tt-levels">
            <div className="tt-level">
              <span className="tt-level-label">Stop-loss</span>
              <span className="tt-level-val tt-level-stop">${formatCurrency(preview.stop)}</span>
              <span className="tt-level-note">
                {preview.usedDistal ? 'beyond distal line' : `${(FALLBACK_STOP_PCT * 100).toFixed(0)}% (no zone)`}
              </span>
            </div>
            <div className="tt-level">
              <span className="tt-level-label">Cash-out</span>
              <span className="tt-level-val tt-level-target">${formatCurrency(preview.target)}</span>
              <span className="tt-level-note">{riskReward}:1 target</span>
            </div>
          </div>
        )}

        {/* ── Estimated cost ── */}
        <div className="tt-cost-row">
          <span className="tt-cost-label">
            Est. {orderType === 'limit' ? 'cost at fill' : 'cost'}
          </span>
          <span className="tt-cost-val">${formatCurrency(estCost)}</span>
        </div>

        {/* ── Actions ── */}
        <div className="tt-actions">
          <button className="wl-btn ghost" onClick={onClose}>Cancel</button>
          <button
            className={`wl-btn primary ${side === 'short' ? 'tt-submit-short' : ''}`}
            onClick={submit}
            disabled={!canSubmit}
          >
            {orderType === 'limit'
              ? `Place ${side} limit order`
              : side === 'short' ? 'Sell short at market' : 'Buy at market'}
          </button>
        </div>
      </div>
    </div>
  )
}
