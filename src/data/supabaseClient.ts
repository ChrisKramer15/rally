/**
 * Supabase client for reading daily bars from the browser.
 *
 * The frontend uses the ANON public key only, which is safe to ship: RLS grants
 * anon read-only access to `prices`/`watchlist` and denies all writes. Writes
 * happen exclusively in the server-side Edge Function (service role).
 *
 * Configuration is optional. When the env vars are absent (e.g. local dev before
 * the project exists), `getSupabase()` returns null and callers fall back to the
 * simulated feed — mirroring how the Tiingo key was handled.
 *
 * Env:
 *   VITE_SUPABASE_URL       https://<project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY  the anon/public API key
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when both Supabase env vars are configured. */
export function hasSupabase(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

// Lazily instantiate a single shared client so we don't create one per call.
let client: SupabaseClient | null = null

/** The shared Supabase client, or null when unconfigured. */
export function getSupabase(): SupabaseClient | null {
  if (!hasSupabase()) return null
  if (!client) {
    client = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: { persistSession: false },
    })
  }
  return client
}

/** Minimal row shape of the public.prices table (browser-visible columns). */
export interface PriceRow {
  symbol: string
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
}
