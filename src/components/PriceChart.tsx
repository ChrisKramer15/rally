import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { OHLCV, Zone } from '../types';

interface Props {
  candles: OHLCV[];
  supplyZones?: Zone[];
  demandZones?: Zone[];
}

const fmt = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function PriceChart({ candles, supplyZones = [], demandZones = [] }: Props) {
  const data = candles.map((c) => ({ time: c.time, close: c.close, volume: c.volume }));

  const prices = candles.map((c) => c.close);
  const minP = Math.min(...prices) * 0.995;
  const maxP = Math.max(...prices) * 1.005;

  // Determine trend color
  const first = prices[0];
  const last = prices[prices.length - 1];
  const isUp = last >= first;
  const strokeColor = isUp ? '#10b981' : '#ef4444';
  const fillId = isUp ? 'greenGrad' : 'redGrad';

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <p className="text-xs text-slate-400 mb-3 uppercase tracking-wide">90-Day Price History</p>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="time"
            tickFormatter={fmt}
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minP, maxP]}
            tickFormatter={(v: number) => `$${v.toFixed(v < 10 ? 3 : 0)}`}
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
            labelStyle={{ color: '#94a3b8', fontSize: 11 }}
            formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Close']}
            labelFormatter={(l) => fmt(Number(l))}
          />
          {/* Supply zone lines */}
          {supplyZones.map((z) => (
            <ReferenceLine
              key={z.id + '-h'}
              y={z.priceLow}
              stroke="#ef4444"
              strokeDasharray="4 3"
              strokeOpacity={0.7}
              label={{ value: `S: $${z.priceLow.toFixed(2)}`, fill: '#ef4444', fontSize: 10, position: 'insideTopRight' }}
            />
          ))}
          {/* Demand zone lines */}
          {demandZones.map((z) => (
            <ReferenceLine
              key={z.id + '-l'}
              y={z.priceHigh}
              stroke="#10b981"
              strokeDasharray="4 3"
              strokeOpacity={0.7}
              label={{ value: `D: $${z.priceHigh.toFixed(2)}`, fill: '#10b981', fontSize: 10, position: 'insideBottomRight' }}
            />
          ))}
          <Area
            type="monotone"
            dataKey="close"
            stroke={strokeColor}
            strokeWidth={2}
            fill={`url(#${fillId})`}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
