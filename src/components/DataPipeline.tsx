import { useState } from 'react'
import { usePipelineRuns } from '../hooks/usePipelineRuns'
import type { PipelineRun, PipelineStatus } from '../data/pipelineStore'

/** Human-readable relative + absolute timestamp. */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60_000)
  let rel: string
  if (mins < 1) rel = 'just now'
  else if (mins < 60) rel = `${mins}m ago`
  else if (mins < 1440) rel = `${Math.round(mins / 60)}h ago`
  else rel = `${Math.round(mins / 1440)}d ago`
  return `${rel} · ${d.toLocaleString('en-US', { hour12: false })}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const STATUS_LABEL: Record<PipelineStatus, string> = {
  success: 'Success',
  partial: 'Partial',
  failure: 'Failure',
}

function StatusPill({ status }: { status: PipelineStatus }) {
  return <span className={`pipe-pill pipe-${status}`}>{STATUS_LABEL[status]}</span>
}

/** One run row with an expandable detail drawer (per-symbol + errors). */
function RunRow({ run }: { run: PipelineRun }) {
  const [open, setOpen] = useState(false)
  const errorEntries = Object.entries(run.errors)
  const symbolEntries = Object.entries(run.perSymbol)
  const hasDetail = errorEntries.length > 0 || symbolEntries.length > 0 || Boolean(run.message)

  return (
    <li className="pipe-run">
      <button
        type="button"
        className="pipe-run-head"
        onClick={() => hasDetail && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <StatusPill status={run.status} />
        <span className="pipe-run-when">{formatWhen(run.startedAt)}</span>
        <span className="pipe-run-trigger">{run.trigger}</span>
        <span className="pipe-run-stat">
          <span className="pipe-metric">{run.barsCollected}</span> bars
        </span>
        <span className="pipe-run-stat">
          <span className="pipe-metric">{run.symbolsTotal}</span> symbols
        </span>
        <span className={`pipe-run-stat ${run.symbolsFailed > 0 ? 'down' : ''}`}>
          <span className="pipe-metric">{run.symbolsFailed}</span> failed
        </span>
        <span className="pipe-run-dur">{formatDuration(run.durationMs)}</span>
        {hasDetail && <span className="pipe-caret">{open ? '−' : '+'}</span>}
      </button>

      {open && (
        <div className="pipe-run-detail">
          {run.message && <p className="pipe-run-message">{run.message}</p>}

          {errorEntries.length > 0 && (
            <div className="pipe-detail-block">
              <h4 className="down">Errors ({errorEntries.length})</h4>
              <ul className="pipe-error-list">
                {errorEntries.map(([sym, msg]) => (
                  <li key={sym}>
                    <span className="pipe-error-sym">{sym}</span>
                    <span className="pipe-error-msg">{msg}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {symbolEntries.length > 0 && (
            <div className="pipe-detail-block">
              <h4>Bars collected per symbol</h4>
              <div className="pipe-symbol-grid">
                {symbolEntries
                  .sort((a, b) => b[1] - a[1])
                  .map(([sym, count]) => (
                    <span key={sym} className={`pipe-symbol-chip ${count === 0 ? 'zero' : ''}`}>
                      <span className="pipe-symbol-name">{sym}</span>
                      <span className="pipe-symbol-count">{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Data Pipeline monitoring page: shows collector run health, success/failure
 * stats, and a chronological log of runs with expandable per-symbol detail.
 */
export function DataPipeline() {
  const { runs, summary, status, error, refresh } = usePipelineRuns()

  return (
    <div className="pipe-page">
      <section className="pipe-stats">
        <div className="panel pipe-stat-card">
          <span className="pipe-stat-label">Success rate</span>
          <span className="pipe-stat-value">
            {status === 'ready' ? `${summary.successRate}%` : '—'}
          </span>
          <span className="pipe-stat-sub">{summary.totalRuns} runs tracked</span>
        </div>
        <div className="panel pipe-stat-card">
          <span className="pipe-stat-label">Outcomes</span>
          <span className="pipe-stat-value">
            <span className="up">{summary.successRuns}</span>
            {' / '}
            <span className="pipe-warn">{summary.partialRuns}</span>
            {' / '}
            <span className="down">{summary.failureRuns}</span>
          </span>
          <span className="pipe-stat-sub">success / partial / failure</span>
        </div>
        <div className="panel pipe-stat-card">
          <span className="pipe-stat-label">Bars collected</span>
          <span className="pipe-stat-value">{summary.barsCollected.toLocaleString()}</span>
          <span className="pipe-stat-sub">across tracked window</span>
        </div>
        <div className="panel pipe-stat-card">
          <span className="pipe-stat-label">Last run</span>
          <span className="pipe-stat-value pipe-stat-sm">
            {summary.lastRun ? <StatusPill status={summary.lastRun.status} /> : '—'}
          </span>
          <span className="pipe-stat-sub">
            {summary.lastRun ? formatWhen(summary.lastRun.startedAt) : 'no runs yet'}
          </span>
        </div>
      </section>

      <section className="panel pipe-log">
        <div className="panel-head">
          <h2>Run Log</h2>
          <div className="panel-head-actions">
            <span className="panel-sub">collect-daily-bars</span>
            <button
              type="button"
              className="wl-edit-btn"
              onClick={refresh}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {status === 'unconfigured' && (
          <div className="pipe-empty">
            Supabase isn't configured. Set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to view pipeline run history.
          </div>
        )}

        {status === 'error' && (
          <div className="feed-error-banner">{error ?? 'Failed to load pipeline runs.'}</div>
        )}

        {status === 'loading' && runs.length === 0 && (
          <div className="pipe-empty">Loading run history…</div>
        )}

        {status === 'ready' && runs.length === 0 && (
          <div className="pipe-empty">
            No pipeline runs recorded yet. Runs appear here after the collector executes.
          </div>
        )}

        {runs.length > 0 && (
          <>
            <div className="pipe-log-head">
              <span>Status</span>
              <span>When</span>
              <span>Trigger</span>
              <span>Bars</span>
              <span>Symbols</span>
              <span>Failed</span>
              <span>Duration</span>
              <span />
            </div>
            <ul className="pipe-run-list">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
