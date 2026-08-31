-- Pipeline run log: one row per collect-daily-bars invocation.
--
-- Why: the collector already returns a per-run JSON summary, but nothing was
-- persisted, so there was no history to monitor. This table captures each run's
-- outcome (success / partial / failure), timing, and per-symbol errors so the
-- frontend can render a Data Pipeline monitoring page.
--
-- Access model (mirrors prices/watchlist):
--   * The Edge Function (service_role) BYPASSES RLS and WRITES rows.
--   * The browser (anon) gets READ-ONLY access; no client write policies exist.

create table if not exists public.pipeline_runs (
  id            bigint generated always as identity primary key,
  -- 'success'  = ran, zero symbol errors
  -- 'partial'  = ran, some symbols collected but others errored
  -- 'failure'  = the run itself failed (bad config, watchlist read error, etc.)
  status        text        not null check (status in ('success', 'partial', 'failure')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz not null default now(),
  -- Wall-clock duration in milliseconds.
  duration_ms   integer     not null default 0,
  -- How the run was kicked off: 'cron' | 'manual' | 'unknown'.
  trigger       text        not null default 'unknown',
  -- Number of symbols in the run's universe.
  symbols_total integer     not null default 0,
  -- Symbols that errored during collection.
  symbols_failed integer    not null default 0,
  -- Total bars upserted across all symbols.
  bars_collected integer    not null default 0,
  -- Per-symbol bar counts: { "AAPL": 12, "MSFT": 0, ... }
  per_symbol    jsonb       not null default '{}'::jsonb,
  -- Per-symbol error messages: { "XYZ": "Tiingo ... 429 ..." }
  errors        jsonb       not null default '{}'::jsonb,
  -- A top-level message for run-level failures (nullable).
  message       text
);

comment on table public.pipeline_runs is
  'One row per collect-daily-bars run. Written only by the collector; anon read-only.';

-- Newest-first listing is the common query for the monitoring page.
create index if not exists pipeline_runs_started_desc_idx
  on public.pipeline_runs (started_at desc);

alter table public.pipeline_runs enable row level security;

-- Public read access so the dashboard can show run history + health.
drop policy if exists pipeline_runs_public_read on public.pipeline_runs;
create policy pipeline_runs_public_read
  on public.pipeline_runs
  for select
  to anon, authenticated
  using (true);

-- NOTE: deliberately NO insert/update/delete policies for anon/authenticated.
-- All writes go through the Edge Function with the service_role key.
