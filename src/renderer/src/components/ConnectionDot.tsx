import type { ConnectionState } from '@shared/types';
import { cn } from '../lib/cn';

const colorMap: Record<ConnectionState, string> = {
  connected: 'bg-[var(--success)]',
  connecting: 'bg-[var(--warning)]',
  reconnecting: 'bg-[var(--warning)]',
  error: 'bg-[var(--danger)]',
  disconnected: 'bg-slate-500',
  idle: 'bg-slate-600',
};

export function ConnectionDot({ state, className }: { state: ConnectionState; className?: string }) {
  const animated = state === 'connecting' || state === 'reconnecting';
  return (
    <span
      className={cn('dot', colorMap[state], animated && 'pulse-dot', className)}
      title={state}
    />
  );
}
