/**
 * Persistent store for per-symbol price history (the sparkline series).
 *
 * This is deliberately behind a small interface so the storage backend can be
 * swapped without touching the consuming hook/components. Today it's backed by
 * localStorage; later it can be backed by a database via a fetch-based
 * implementation (e.g. `class ApiHistoryStore implements HistoryStore`) that
 * calls a backend endpoint. See the "later task" note in the README/roadmap.
 *
 * The interface is async on purpose: localStorage resolves synchronously, but a
 * networked/DB implementation will not, and callers should already await it.
 */

export type SymbolHistory = Record<string, number[]>

export interface HistoryStore {
  /** Load stored history for the given symbols. Missing symbols return no entry. */
  load(symbols: string[]): Promise<SymbolHistory>
  /** Persist the full current history for the given symbols (rolling window applied by caller). */
  save(history: SymbolHistory): Promise<void>
}

const STORAGE_KEY = 'rally.history'

/** Maximum points retained per symbol. Matches the sparkline's rolling window. */
export const HISTORY_LEN = 40

/** localStorage-backed implementation. Per-browser, per-device; fine until a backend exists. */
export class LocalHistoryStore implements HistoryStore {
  async load(symbols: string[]): Promise<SymbolHistory> {
    const all = this.readAll()
    const out: SymbolHistory = {}
    for (const sym of symbols) {
      if (Array.isArray(all[sym])) out[sym] = all[sym]
    }
    return out
  }

  async save(history: SymbolHistory): Promise<void> {
    // Merge with any existing data so symbols not in this update are preserved,
    // and cap each series to the rolling window before writing.
    const all = this.readAll()
    for (const [sym, points] of Object.entries(history)) {
      all[sym] = points.slice(-HISTORY_LEN)
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {
      // Best-effort: quota errors or private-mode restrictions shouldn't break the feed.
    }
  }

  private readAll(): SymbolHistory {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed as SymbolHistory
    } catch {
      // Corrupt data resets cleanly.
    }
    return {}
  }
}

/** The store instance the app uses. Swap this line to change backends later. */
export const historyStore: HistoryStore = new LocalHistoryStore()
