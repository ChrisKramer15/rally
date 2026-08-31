import { useEffect, useRef, useState } from 'react'
import {
  INITIAL_INDICES,
  INITIAL_STOCKS,
  type IndexQuote,
  type Stock,
} from '../data/stocks'

const HISTORY_LEN = 40

function tickPrice(price: number): number {
  // small random walk, ~±0.35% per tick
  const drift = (Math.random() - 0.5) * price * 0.007
  const next = Math.max(price * 0.5, price + drift)
  return Number(next.toFixed(2))
}

/**
 * Simulates a live market feed by nudging prices on an interval.
 * Returns stocks and indices that update in place, along with a
 * "flash" map indicating whether the last change was up or down.
 */
export function useLiveMarket(intervalMs = 1500) {
  const [stocks, setStocks] = useState<Stock[]>(INITIAL_STOCKS)
  const [indices, setIndices] = useState<IndexQuote[]>(INITIAL_INDICES)
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({})
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const timer = useRef<number | null>(null)

  useEffect(() => {
    timer.current = window.setInterval(() => {
      const nextFlash: Record<string, 'up' | 'down'> = {}

      setStocks((prev) =>
        prev.map((s) => {
          const price = tickPrice(s.price)
          nextFlash[s.symbol] = price >= s.price ? 'up' : 'down'
          return {
            ...s,
            price,
            history: [...s.history.slice(-(HISTORY_LEN - 1)), price],
          }
        }),
      )

      setIndices((prev) =>
        prev.map((i) => {
          const value = tickPrice(i.value)
          nextFlash[i.symbol] = value >= i.value ? 'up' : 'down'
          return {
            ...i,
            value,
            history: [...i.history.slice(-(HISTORY_LEN - 1)), value],
          }
        }),
      )

      setFlash(nextFlash)
      setLastUpdated(new Date())
    }, intervalMs)

    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [intervalMs])

  return { stocks, indices, flash, lastUpdated }
}
