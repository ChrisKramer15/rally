import { clsx } from 'clsx';

type Variant = 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'slate' | 'indigo';

const variants: Record<Variant, string> = {
  green:  'bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700',
  red:    'bg-red-900/50 text-red-300 ring-1 ring-red-700',
  yellow: 'bg-yellow-900/50 text-yellow-300 ring-1 ring-yellow-700',
  blue:   'bg-blue-900/50 text-blue-300 ring-1 ring-blue-700',
  purple: 'bg-purple-900/50 text-purple-300 ring-1 ring-purple-700',
  slate:  'bg-slate-700 text-slate-300',
  indigo: 'bg-indigo-900/50 text-indigo-300 ring-1 ring-indigo-700',
};

interface Props {
  label: string;
  variant?: Variant;
  className?: string;
}

export default function Badge({ label, variant = 'slate', className }: Props) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', variants[variant], className)}>
      {label}
    </span>
  );
}
