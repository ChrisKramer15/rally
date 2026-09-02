import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCurrency } from '../data/stocks'
import type { OrderType, ZoneKind } from '../hooks/useBacktestPortfolio'

export interface TradeTicket {
  shares: number
  orderType: OrderType
  /** Only meaningful for limit orders. */
  limitPrice?: number
  zoneKind?: ZoneKind
}

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
  /** Zone side that decides the limit trigger direction. */
  zoneKind?: ZoneKind | null
  onSubmit: (ticket: TradeTicket) => void
  onClose: () => void
}

export function TradeTicketModal({
  symbol,
  name,
  price,
  budget,
  proximal,
  zoneKind,
  onSubmit,
  onClose,
}: TradeTicketModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Default sizing: ~10% of the budget, at least 1 share.
  const defaultShares = Math.max(1, Math.floor((budget * 0.1) / (price || 1)))
  const [sharesInput, setSharesInput] = useState<string>(String(defaultShares))
  const [orderType, setOrderType] = useState<OrderType>('market')

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
  const fillPrice = orderType === 'limit' ? limitPrice : price
  const estCost = shares * fillPrice

  const effectiveZoneKind: ZoneKind = zoneKind ?? 'demand'

  const canSubmit =
    shares >= 1 &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice > 0))

  const triggerHint = useMemo(() => {
    if (orderType !== 'limit') return null
    const dir = effectiveZoneKind === 'supply' ? 'rises to' : 'drops to'
    return `Fills when ${symbol} ${dir} $${formatCurrency(limitPrice)} (the proximal line).`
  }, [orderType, effectiveZoneKind, symbol, limitPrice])

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      shares,
      orderType,
      limitPrice: orderType === 'limit' ? limitPrice : undefined,
      zoneKind: orderType === 'limit' ? effectiveZoneKind : undefined,
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
          <button className="wl-btn primary" onClick={submit} disabled={!canSubmit}>
            {orderType === 'limit' ? 'Place limit order' : 'Buy at market'}
          </button>
        </div>
      </div>
    </div>
  )
}
