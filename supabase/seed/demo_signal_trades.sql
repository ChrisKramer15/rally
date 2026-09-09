-- ---------------------------------------------------------------------------
-- demo_signal_trades.sql
--
-- Demo/seed data to visualize the signal-provenance UI on the Backtest screen:
-- a spread of PENDING + ACTIVE (open) positions and CLOSED trades, each tagged
-- with zone kind / zone grade / signal strength so the badges and the closed-
-- trades group-by (Zone / Base grade / Signal) all have something to render.
--
-- Safe to re-run: every row uses a fixed `demo-*` id and ON CONFLICT DO NOTHING.
-- Remove with the companion cleanup at the bottom (commented) or the app's
-- "reset portfolio" button.
--
-- All ids are prefixed `demo-` so they're easy to spot and delete.
-- ---------------------------------------------------------------------------

-- ── PENDING (resting limit orders) ─────────────────────────────────────────
insert into public.trades
  (id, symbol, name, side, status, order_type, placed_date, opened_date,
   entry_price, limit_price, distal_price, atr, swing_target,
   zone_kind, zone_grade, signal_strength, proximal_price, signal_date,
   risk_reward, shares, stop_loss_price, cash_out_price)
values
  ('demo-p1', 'NVDA', 'NVIDIA Corp', 'long', 'pending', 'limit',
   '2026-09-08', null,
   null, 128.50, 122.00, 3.20, 152.00,
   'demand', 'A+', 'A+', 128.50, '2026-08-21',
   2, 40, 121.68, 152.00),
  ('demo-p2', 'TSLA', 'Tesla Inc', 'short', 'pending', 'limit',
   '2026-09-08', null,
   null, 254.00, 262.00, 5.10, 228.00,
   'supply', 'good', 'strong', 254.00, '2026-08-27',
   2, 20, 262.51, 228.00)
on conflict (id) do nothing;

-- ── ACTIVE (filled / open positions) ───────────────────────────────────────
insert into public.trades
  (id, symbol, name, side, status, order_type, placed_date, opened_date,
   entry_price, limit_price, distal_price, atr, swing_target,
   zone_kind, zone_grade, signal_strength, proximal_price, signal_date,
   risk_reward, shares, stop_loss_price, cash_out_price)
values
  ('demo-a1', 'AAPL', 'Apple Inc', 'long', 'open', 'market',
   '2026-09-02', '2026-09-02',
   224.30, null, 216.00, 2.80, 244.00,
   'demand', 'A+', 'strong', 222.10, '2026-08-19',
   2, 30, 215.72, 244.00),
  ('demo-a2', 'AMD', 'Advanced Micro Devices', 'long', 'open', 'limit',
   '2026-08-29', '2026-09-03',
   142.00, 142.00, 135.50, 3.60, 168.00,
   'demand', 'good', 'A+', 142.00, '2026-08-14',
   2, 45, 135.14, 168.00),
  ('demo-a3', 'META', 'Meta Platforms', 'short', 'open', 'market',
   '2026-09-04', '2026-09-04',
   612.00, null, 628.00, 8.40, 560.00,
   'supply', 'weak', 'strong', 615.00, '2026-08-25',
   2, 12, 628.84, 560.00)
on conflict (id) do nothing;

-- ── CLOSED (banked realized P/L) ───────────────────────────────────────────
-- Deliberate spread across grades so the group-by win-rate/net-P&L differs per
-- bucket: A+ signals mostly win, weak signals mostly lose.
insert into public.closed_trades
  (id, symbol, name, side, shares, entry_price, exit_price, realized_pnl,
   opened_date, closed_date,
   zone_kind, zone_grade, signal_strength, proximal_price, signal_date)
values
  -- A+ base / A+ signal — winners
  ('demo-c1', 'MSFT', 'Microsoft Corp', 'long', 25, 402.00, 438.00, 900.00,
   '2026-07-10', '2026-08-01', 'demand', 'A+', 'A+', 402.00, '2026-07-01'),
  ('demo-c2', 'AVGO', 'Broadcom Inc', 'long', 15, 168.00, 189.00, 315.00,
   '2026-07-15', '2026-08-05', 'demand', 'A+', 'A+', 168.00, '2026-07-03'),
  ('demo-c3', 'GOOGL', 'Alphabet Inc', 'long', 30, 176.00, 168.00, -240.00,
   '2026-07-18', '2026-07-29', 'demand', 'A+', 'strong', 176.00, '2026-07-08'),
  -- good base — mixed
  ('demo-c4', 'CRM', 'Salesforce Inc', 'short', 20, 268.00, 246.00, 440.00,
   '2026-07-20', '2026-08-08', 'supply', 'good', 'strong', 268.00, '2026-07-11'),
  ('demo-c5', 'NFLX', 'Netflix Inc', 'long', 8, 690.00, 668.00, -176.00,
   '2026-07-22', '2026-08-02', 'demand', 'good', 'A+', 690.00, '2026-07-14'),
  -- weak base — mostly losers
  ('demo-c6', 'INTC', 'Intel Corp', 'long', 60, 34.50, 31.80, -162.00,
   '2026-07-25', '2026-08-04', 'demand', 'weak', 'strong', 34.50, '2026-07-16'),
  ('demo-c7', 'PYPL', 'PayPal Holdings', 'short', 40, 78.00, 82.50, -180.00,
   '2026-07-28', '2026-08-06', 'supply', 'weak', 'strong', 78.00, '2026-07-19'),
  ('demo-c8', 'F', 'Ford Motor Co', 'long', 200, 11.20, 11.65, 90.00,
   '2026-08-01', '2026-08-12', 'demand', 'weak', 'strong', 11.20, '2026-07-22')
on conflict (id) do nothing;

-- ── Cleanup (uncomment + run to remove the demo rows) ───────────────────────
-- delete from public.trades where id like 'demo-%';
-- delete from public.closed_trades where id like 'demo-%';
