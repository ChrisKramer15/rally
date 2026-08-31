import { useCallback, useEffect, useState } from 'react'
import { hasSupabase } from '../data/supabaseClient'
import { fetchPipelineRuns, type PipelineRun } from '../data/pipelineStore'

export type PipelineFeedStatus = 'loading' | 'ready' | 'unconfigured' | 'error'

/** Aggregate health derived from the loaded run history. */
export interface PipelineSummary {
  totalRuns: number
  successRuns: number
  partialRuns: number
  failureRuns: number
  /** Percentage of runs that were fully clean (0 failed symbols), 0–100. */
  successRate: number
  /** Bars collected across the loaded window. */
  barsCollected: number
  lastRun: PipelineRun | null
}

interface UsePipelineRunsResult {
  runs: PipelineRun[]
  summary: PipelineSummary
  status: PipelineFeedStatus
  error: string | null
  refresh: () => void
}

function summarize(runs: PipelineRun[]): PipelineSummary {
  const total = runs.length
  let success = 0
  let partial = 0
  let failure = 0
  let bars = 0
  for (const r of runs) {
    if (r.status === 'success') success += 1
    else if (r.status === 'partial') partial += 1
    else failure += 1
    bars += r.barsCollected
  }
  return {
    totalRuns: total,
    successRuns: success,
    partialRuns: partial,
    failureRuns: failure,
    successRate: total === 0 ? 0 : Math.round((success / total) * 100),
    barsCollected: bars,
    // runs are newest-first, so the first element is the latest.
    lastRun: runs[0] ?? null,
  }
}

/**
 * Loads collector run history from Supabase for the Data Pipeline page.
 * Exposes a manual refresh so the user can pull the latest without a reload.
 */
export function usePipelineRuns(limit = 50): UsePipelineRunsResult {
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [status, setStatus] = useState<PipelineFeedStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!hasSupabase()) {
      setStatus('unconfigured')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const rows = await fetchPipelineRuns(limit)
      setRuns(rows)
      setStatus('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [limit])

  // Defer the initial load a tick so we don't call setState synchronously in
  // the effect body (mirrors the pattern in useIndexMarket).
  useEffect(() => {
    let cancelled = false
    const id = window.setTimeout(() => {
      if (!cancelled) void refresh()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [refresh])

  return { runs, summary: summarize(runs), status, error, refresh: () => void refresh() }
}
