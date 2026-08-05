import { Wifi, WifiOff, ExternalLink } from 'lucide-react';
import { hasFinnhubKey } from '../services/marketData';

export default function DataSourceBanner() {
  const hasKey = hasFinnhubKey();

  if (hasKey) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-1.5 mb-4">
        <Wifi size={12} />
        <span>Live data — Binance (crypto) · Finnhub (stocks, ETFs) · ExchangeRate-API (forex)</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-xs text-yellow-300 bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-3 py-2 mb-4">
      <WifiOff size={12} className="mt-0.5 flex-shrink-0" />
      <span>
        Partial live data — Binance (crypto) and ExchangeRate-API (forex) are always live.
        For stocks and ETFs, add your free Finnhub key to{' '}
        <code className="bg-slate-700 px-1 rounded">.env</code> as{' '}
        <code className="bg-slate-700 px-1 rounded">VITE_FINNHUB_API_KEY</code>.{' '}
        <a
          href="https://finnhub.io/register"
          target="_blank"
          rel="noopener noreferrer"
          className="underline inline-flex items-center gap-0.5 hover:text-yellow-100"
        >
          Get free key <ExternalLink size={10} />
        </a>
      </span>
    </div>
  );
}
