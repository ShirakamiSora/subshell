import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { useApp } from '../store/app';
import { cn } from '../lib/cn';

const styleMap = {
  info: { icon: Info, color: 'text-[var(--blue)]', border: 'border-sky-400/25', bg: 'bg-sky-950/80' },
  success: { icon: CheckCircle2, color: 'text-[var(--success)]', border: 'border-emerald-400/25', bg: 'bg-emerald-950/80' },
  warning: { icon: AlertTriangle, color: 'text-[var(--warning)]', border: 'border-amber-400/25', bg: 'bg-amber-950/80' },
  error: { icon: XCircle, color: 'text-[var(--danger)]', border: 'border-rose-400/25', bg: 'bg-rose-950/80' },
} as const;

export function Toast() {
  const toast = useApp((state) => state.toast);
  const dismiss = useApp((state) => state.dismissToast);
  if (!toast) return null;
  const config = styleMap[toast.level];
  const Icon = config.icon;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-6">
      <div
        className={cn(
          'pointer-events-auto fade-in flex max-w-xl items-start gap-2.5 rounded-xl border px-4 py-2.5 text-[13px] shadow-xl shadow-black/40 ',
          config.border,
          config.bg,
        )}
      >
        <Icon size={15} className={cn('mt-0.5 flex-none', config.color)} />
        <span className="leading-relaxed text-[var(--text)]">{toast.message}</span>
        <button className="ml-2 flex-none text-[var(--muted)] hover:text-white" onClick={dismiss}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
