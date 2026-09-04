/**
 * PipelineStore: reads collector run history from Supabase `pipeline_runs`.
 *
 * This is a browser-facing READ path using the anon key (RLS grants anon
 * read-only on pipeline_runs; writes happen only in the Edge Function via the
 * service role). Returns [] when Supabase is unconfigured so the UI can show a
 * "not configured" state instead of erroring.
 */

import { getSupabase } from './supabaseClient'

export type PipelineStatus = 'success' | 'partial' | 'failure'
export type StageStatus = 'success' | 'partial' | 'failure' | 'skipped'

/** One stage of a collector run (resolve -> fetch -> upsert). */
export interface PipelineStage {
  stage: string
  status: StageStatus
  ms: number
  detail: string
}

/** One collector run, as consumed by the Data Pipeline page. */
export interface PipelineRun {
  id: number
  status: PipelineStatus
  startedAt: string // ISO
  finishedAt: string // ISO
  durationMs: number
  trigger: string
  /** 'primary' | 'catchup' | 'manual'. */
  mode: string
  /** Which named list this run collected (null for legacy / universe runs). */
  watchlistId: string | null
  watchlistName: string | null
  symbolsTotal: number
  symbolsFailed: number
  /** Symbols the smart catch-up skipped (already holding today's bar). */
  symbolsSkipped: number
  barsCollected: number
  perSymbol: Record<string, number>
  errors: Record<string, string>
  /** Ordered per-stage breakdown. */
  stages: PipelineStage[]
  message: string | null
}

/** Raw row shape as stored in Postgres (snake_case). */
interface PipelineRunRow {
  id: number
  status: PipelineStatus
  started_at: string
  finished_at: string
  duration_ms: number
  trigger: string
  mode: string | null
  watchlist_id: string | null
  watchlist_name: string | null
  symbols_total: number
  symbols_failed: number
  symbols_skipped: number | null
  bars_collected: number
  per_symbol: Record<string, number> | null
  errors: Record<string, string> | null
  stages: PipelineStage[] | null
  message: string | null
}

function rowToRun(r: PipelineRunRow): PipelineRun {
  return {
    id: r.id,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    trigger: r.trigger,
    mode: r.mode ?? 'primary',
    watchlistId: r.watchlist_id,
    watchlistName: r.watchlist_name,
    symbolsTotal: r.symbols_total,
    symbolsFailed: r.symbols_failed,
    symbolsSkipped: r.symbols_skipped ?? 0,
    barsCollected: r.bars_collected,
    perSymbol: r.per_symbol ?? {},
    errors: r.errors ?? {},
    stages: r.stages ?? [],
    message: r.message,
  }
}

/**
 * Fetch the most recent collector runs, newest first.
 * Returns [] when Supabase is unconfigured or there are no runs yet.
 */
export async function fetchPipelineRuns(limit = 50): Promise<PipelineRun[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('pipeline_runs')
    .select(
      'id,status,started_at,finished_at,duration_ms,trigger,mode,watchlist_id,watchlist_name,symbols_total,symbols_failed,symbols_skipped,bars_collected,per_symbol,errors,stages,message',
    )
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Supabase read for pipeline_runs failed: ${error.message}`)
  }
  return (data as PipelineRunRow[] | null ?? []).map(rowToRun)
}
