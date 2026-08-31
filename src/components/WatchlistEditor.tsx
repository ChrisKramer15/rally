import { useEffect, useState } from 'react'
import { MAX_WATCHLIST, parseTickers } from '../data/stocks'

interface WatchlistEditorProps {
  symbols: string[]
  onSave: (symbols: string[]) => void
}

/**
 * Button + modal for editing the watchlist by pasting tickers.
 *
 * Accepts a free-form paste (comma / space / newline separated), parses it into
 * clean symbols, dedupes, uppercases, and caps at MAX_WATCHLIST. The parsed
 * preview updates live so the user can see exactly what will be saved.
 */
export function WatchlistEditor({ symbols, onSave }: WatchlistEditorProps) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')

  // Seed the textarea with the current watchlist and open the modal.
  const handleOpen = () => {
    setRaw(symbols.join(', '))
    setOpen(true)
  }

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const parsed = parseTickers(raw)
  const overflow = parseTickers(raw, Number.MAX_SAFE_INTEGER).length - parsed.length

  const handleSave = () => {
    onSave(parsed)
    setOpen(false)
  }

  return (
    <>
      <button className="wl-edit-btn" onClick={handleOpen}>
        Paste tickers
      </button>

      {open && (
        <div className="wl-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="wl-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit watchlist"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wl-modal-head">
              <h3>Edit watchlist</h3>
              <button className="wl-close" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            <p className="wl-hint">
              Paste tickers from your scanner. Separate with commas, spaces, or new lines.
              Up to {MAX_WATCHLIST} symbols are tracked.
            </p>

            <textarea
              className="wl-textarea"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="AAPL, NVDA, TSLA&#10;MSFT AMZN GOOGL"
              rows={6}
              autoFocus
            />

            <div className="wl-preview">
              <span className="wl-count">
                {parsed.length} / {MAX_WATCHLIST} symbols
              </span>
              {overflow > 0 && (
                <span className="wl-overflow">
                  {overflow} over the limit will be dropped
                </span>
              )}
            </div>

            {parsed.length > 0 && (
              <div className="wl-chips">
                {parsed.map((s) => (
                  <span className="wl-chip" key={s}>
                    {s}
                  </span>
                ))}
              </div>
            )}

            <div className="wl-actions">
              <button className="wl-btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="wl-btn primary" onClick={handleSave} disabled={parsed.length === 0}>
                Save watchlist
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
