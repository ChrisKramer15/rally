import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SYMBOLS, MAX_WATCHLIST, MAX_WATCHLISTS, parseTickers } from '../data/stocks'
import {
  createWatchlist as createWatchlistRemote,
  deleteWatchlist as deleteWatchlistRemote,
  fetchWatchlistsWithSymbols,
  renameWatchlist as renameWatchlistRemote,
  syncWatchlistList,
} from '../data/supabaseDailyStore'

const STORAGE_KEY = 'rally.watchlists.v2'
/** Legacy single-list key (pre multi-watchlist). Migrated on first load. */
const LEGACY_KEY = 'rally.watchlist'

/** A named list held in client state. `id` is the Supabase list id once known;
 *  offline-only lists use a temporary `local:` id until they sync. */
export interface ClientWatchlist {
  id: string
  name: string
  symbols: string[]
}

interface StoredShape {
  lists: ClientWatchlist[]
  activeId: string | null
}

function isLocalId(id: string): boolean {
  return id.startsWith('local:')
}

function newLocalId(): string {
  return `local:${Math.random().toString(36).slice(2, 10)}`
}

/** Load lists from localStorage, migrating the legacy single-list key if present. */
function loadLocal(): StoredShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as StoredShape
      if (parsed && Array.isArray(parsed.lists) && parsed.lists.length > 0) {
        // Re-clean symbols through parseTickers to enforce format + per-list cap.
        const lists = parsed.lists.map((l) => ({
          id: l.id,
          name: l.name,
          symbols: parseTickers(l.symbols.join(',')),
        }))
        const activeId = lists.some((l) => l.id === parsed.activeId)
          ? parsed.activeId
          : lists[0].id
        return { lists, activeId }
      }
    }
  } catch {
    // fall through to legacy / default
  }

  // Legacy migration: fold the old single list into a default "Main".
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const arr = JSON.parse(legacy)
      if (Array.isArray(arr)) {
        const symbols = parseTickers(arr.join(','))
        if (symbols.length > 0) {
          const id = newLocalId()
          return { lists: [{ id, name: 'Main', symbols }], activeId: id }
        }
      }
    }
  } catch {
    // ignore
  }

  const id = newLocalId()
  return { lists: [{ id, name: 'Main', symbols: DEFAULT_SYMBOLS }], activeId: id }
}

function persistLocal(state: StoredShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // best-effort
  }
}

export interface UseWatchlistResult {
  /** All named lists. */
  lists: ClientWatchlist[]
  /** The currently selected list (for editing). */
  activeList: ClientWatchlist | null
  activeId: string | null
  /** De-duplicated union of every list's symbols — the feed/Signals/Backtest input. */
  unionSymbols: string[]
  /** How many lists exist and whether another can be added. */
  canAddList: boolean
  selectList: (id: string) => void
  /** Replace the active list's symbols (from the editor). Caps at MAX_WATCHLIST. */
  saveActiveSymbols: (symbols: string[]) => void
  addList: (name: string) => void
  renameList: (id: string, name: string) => void
  removeList: (id: string) => void
}

/**
 * Multi-watchlist state.
 *
 * Source of truth is Supabase (`watchlists` + `watchlist`); localStorage is a
 * fast initial-render cache and offline fallback. Up to MAX_WATCHLISTS named
 * lists, each capped at MAX_WATCHLIST symbols. A symbol belongs to exactly one
 * list (adding it to another list moves it).
 *
 * Signals / Backtest / Dashboard consume `unionSymbols` — the de-duplicated
 * merge of every list — so they operate on ALL watchlists at once. The editor
 * operates on `activeList`.
 */
export function useWatchlist(): UseWatchlistResult {
  const [{ lists, activeId }, setState] = useState<StoredShape>(loadLocal)

  // Guard the initial Supabase hydrate from clobbering a fresh local edit.
  const editedRef = useRef(false)

  // Hydrate all lists from Supabase once on mount.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const remote = await fetchWatchlistsWithSymbols()
      if (cancelled || editedRef.current || remote.length === 0) return
      const lists: ClientWatchlist[] = remote.map((l) => ({
        id: l.id,
        name: l.name,
        symbols: parseTickers(l.symbols.join(',')),
      }))
      setState((prev) => {
        const activeId = lists.some((l) => l.id === prev.activeId)
          ? prev.activeId
          : lists[0].id
        const next = { lists, activeId }
        persistLocal(next)
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selectList = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.lists.some((l) => l.id === id)) return prev
      const next = { ...prev, activeId: id }
      persistLocal(next)
      return next
    })
  }, [])

  const saveActiveSymbols = useCallback(
    (symbols: string[]) => {
      editedRef.current = true
      const capped = symbols.slice(0, MAX_WATCHLIST)
      setState((prev) => {
        const target = prev.activeId
        const next: StoredShape = {
          ...prev,
          lists: prev.lists.map((l) =>
            l.id === target ? { ...l, symbols: capped } : l,
          ),
        }
        persistLocal(next)
        // Reconcile this list with Supabase (fire-and-forget). Only sync once
        // the list has a real (non-local) id; local-only lists sync when added.
        if (target && !isLocalId(target)) void syncWatchlistList(target, capped)
        return next
      })
    },
    [],
  )

  const addList = useCallback((name: string) => {
    editedRef.current = true
    const clean = name.trim().slice(0, 40) || 'Untitled'
    // Optimistic local insert; adopt the real id once Supabase responds.
    const tempId = newLocalId()
    setState((prev) => {
      if (prev.lists.length >= MAX_WATCHLISTS) return prev
      const next: StoredShape = {
        lists: [...prev.lists, { id: tempId, name: clean, symbols: [] }],
        activeId: tempId,
      }
      persistLocal(next)
      return next
    })
    void (async () => {
      const created = await createWatchlistRemote(clean)
      if (!created) return
      setState((prev) => {
        const next: StoredShape = {
          lists: prev.lists.map((l) =>
            l.id === tempId ? { ...l, id: created.id } : l,
          ),
          activeId: prev.activeId === tempId ? created.id : prev.activeId,
        }
        persistLocal(next)
        return next
      })
    })()
  }, [])

  const renameList = useCallback((id: string, name: string) => {
    editedRef.current = true
    const clean = name.trim().slice(0, 40) || 'Untitled'
    setState((prev) => {
      const next: StoredShape = {
        ...prev,
        lists: prev.lists.map((l) => (l.id === id ? { ...l, name: clean } : l)),
      }
      persistLocal(next)
      return next
    })
    if (!isLocalId(id)) void renameWatchlistRemote(id, clean)
  }, [])

  const removeList = useCallback((id: string) => {
    editedRef.current = true
    setState((prev) => {
      // Never leave zero lists.
      if (prev.lists.length <= 1) return prev
      const lists = prev.lists.filter((l) => l.id !== id)
      const activeId = prev.activeId === id ? lists[0].id : prev.activeId
      const next = { lists, activeId }
      persistLocal(next)
      return next
    })
    if (!isLocalId(id)) void deleteWatchlistRemote(id)
  }, [])

  const activeList = useMemo(
    () => lists.find((l) => l.id === activeId) ?? lists[0] ?? null,
    [lists, activeId],
  )

  // De-duplicated union across all lists, preserving first-seen order.
  const unionSymbols = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const l of lists) {
      for (const s of l.symbols) {
        if (!seen.has(s)) {
          seen.add(s)
          out.push(s)
        }
      }
    }
    return out
  }, [lists])

  return {
    lists,
    activeList,
    activeId,
    unionSymbols,
    canAddList: lists.length < MAX_WATCHLISTS,
    selectList,
    saveActiveSymbols,
    addList,
    renameList,
    removeList,
  }
}
