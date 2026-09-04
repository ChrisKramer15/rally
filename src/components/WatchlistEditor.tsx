import { useEffect, useState } from 'react'
import { MAX_WATCHLIST, MAX_WATCHLISTS, parseTickers } from '../data/stocks'
import type { ClientWatchlist } from '../hooks/useWatchlist'

interface WatchlistEditorProps {
  lists: ClientWatchlist[]
  activeList: ClientWatchlist | null
  activeId: string | null
  canAddList: boolean
  onSelectList: (id: string) => void
  onSaveSymbols: (symbols: string[]) => void
  onAddList: (name: string) => void
  onRenameList: (id: string, name: string) => void
  onRemoveList: (id: string) => void
}

/**
 * Button + modal for managing up to MAX_WATCHLISTS named watchlists.
 *
 * Left rail lists every watchlist (with its symbol count); the right pane edits
 * the selected list's tickers via a free-form paste (comma / space / newline),
 * parsed, deduped, uppercased, and capped at MAX_WATCHLIST. New lists are
 * created inline; a list can be renamed or deleted (the last remaining list
 * can't be deleted). Symbols belong to exactly one list, so pasting a symbol
 * that lives in another list moves it here on save.
 */
export function WatchlistEditor({
  lists,
  activeList,
  activeId,
  canAddList,
  onSelectList,
  onSaveSymbols,
  onAddList,
  onRenameList,
  onRemoveList,
}: WatchlistEditorProps) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)

  // Seed the editor fields from a list. Called on open and whenever the user
  // switches lists — done in event handlers (not an effect) so we don't trigger
  // cascading renders.
  const seedFrom = (list: ClientWatchlist | null) => {
    setRaw(list ? list.symbols.join(', ') : '')
    setNameDraft(list?.name ?? '')
    setRenaming(false)
  }

  const handleOpen = () => {
    seedFrom(activeList)
    setOpen(true)
  }

  const handleSelectList = (id: string) => {
    onSelectList(id)
    seedFrom(lists.find((l) => l.id === id) ?? null)
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

  const handleSaveSymbols = () => {
    onSaveSymbols(parsed)
  }

  const handleAddList = () => {
    if (!canAddList) return
    onAddList(`List ${lists.length + 1}`)
    // The new list starts empty and becomes active; clear the editor fields.
    seedFrom(null)
    setNameDraft(`List ${lists.length + 1}`)
  }

  const handleRename = () => {
    if (!activeId) return
    const clean = nameDraft.trim()
    if (clean) onRenameList(activeId, clean)
    setRenaming(false)
  }

  return (
    <>
      <button className="wl-edit-btn" onClick={handleOpen}>
        Manage lists
      </button>

      {open && (
        <div className="wl-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="wl-modal wl-modal-wide"
            role="dialog"
            aria-modal="true"
            aria-label="Manage watchlists"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wl-modal-head">
              <h3>Manage watchlists</h3>
              <button className="wl-close" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            <div className="wl-manager">
              {/* Left rail: the list picker. */}
              <aside className="wl-list-rail">
                <ul className="wl-list-items">
                  {lists.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        className={`wl-list-item ${l.id === activeId ? 'active' : ''}`}
                        onClick={() => handleSelectList(l.id)}
                      >
                        <span className="wl-list-name">{l.name}</span>
                        <span className="wl-list-count">{l.symbols.length}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="wl-btn ghost wl-add-list"
                  onClick={handleAddList}
                  disabled={!canAddList}
                  title={canAddList ? 'Add a new list' : `Max ${MAX_WATCHLISTS} lists`}
                >
                  + New list ({lists.length}/{MAX_WATCHLISTS})
                </button>
              </aside>

              {/* Right pane: edit the selected list. */}
              <div className="wl-list-editor">
                <div className="wl-list-editor-head">
                  {renaming ? (
                    <div className="wl-rename-row">
                      <input
                        className="wl-name-input"
                        value={nameDraft}
                        maxLength={40}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                        autoFocus
                        aria-label="List name"
                      />
                      <button className="wl-btn primary" onClick={handleRename}>
                        Save
                      </button>
                    </div>
                  ) : (
                    <>
                      <h4>{activeList?.name ?? '—'}</h4>
                      <div className="wl-list-editor-actions">
                        <button
                          className="wl-btn ghost"
                          onClick={() => setRenaming(true)}
                          disabled={!activeList}
                        >
                          Rename
                        </button>
                        <button
                          className="wl-btn danger"
                          onClick={() => activeId && onRemoveList(activeId)}
                          disabled={!activeList || lists.length <= 1}
                          title={lists.length <= 1 ? 'Keep at least one list' : 'Delete this list'}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <p className="wl-hint">
                  Paste tickers from your scanner. Separate with commas, spaces, or new lines.
                  Up to {MAX_WATCHLIST} symbols per list. A symbol lives in one list — pasting it
                  here moves it from any other list on save.
                </p>

                <textarea
                  className="wl-textarea"
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder="AAPL, NVDA, TSLA&#10;MSFT AMZN GOOGL"
                  rows={6}
                />

                <div className="wl-preview">
                  <span className="wl-count">
                    {parsed.length} / {MAX_WATCHLIST} symbols
                  </span>
                  {overflow > 0 && (
                    <span className="wl-overflow">{overflow} over the limit will be dropped</span>
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
                    Close
                  </button>
                  <button className="wl-btn primary" onClick={handleSaveSymbols} disabled={!activeList}>
                    Save list
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
