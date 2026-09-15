-- ---------------------------------------------------------------------------
-- 0018_pipeline_runs_deferred.sql
--
-- Add a dedicated `symbols_deferred` count to pipeline_runs so the Data Pipeline
-- page can show, at a glance, how many symbols a run left for the next run
-- because it hit the hard rolling-hour rate-limit budget (see 0017). This is a
-- HEALTHY backlog signal, distinct from `symbols_skipped` (catch-up symbols that
-- were already current) and `symbols_failed` (errors). A rising deferred count
-- across runs means collection is falling behind the budget.
--
-- Re-runnable: guarded with IF NOT EXISTS + a NOT NULL default so old rows read
-- back as 0.
-- ---------------------------------------------------------------------------

alter table public.pipeline_runs
  add column if not exists symbols_deferred integer not null default 0;

comment on column public.pipeline_runs.symbols_deferred is
  'Symbols left for the next run because the hourly rate-limit budget was reached. Healthy backlog signal, not a failure.';
