import { clsx } from 'clsx';

interface Props {
  label: string;
  value: string;
  sub?: string;
  color?: 'default' | 'green' | 'red' | 'yellow';
}

const colorMap = {
  default: 'text-white',
  green:   'text-emerald-400',
  red:     'text-red-400',
  yellow:  'text-yellow-400',
};

export default function StatCard({ label, value, sub, color = 'default' }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={clsx('text-xl font-bold', colorMap[color])}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}
