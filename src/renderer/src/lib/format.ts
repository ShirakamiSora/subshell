import type { RiskLevel, ServiceState } from '@shared/types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatKb(kb: number): string {
  return formatBytes(kb * 1024);
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatDateTime(ts: number | string): string {
  const date = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function serviceStateLabel(state: ServiceState): string {
  switch (state) {
    case 'running':
      return '运行中';
    case 'stopped':
      return '已停止';
    case 'failed':
      return '失败';
    default:
      return '未知';
  }
}

export function serviceStateColor(state: ServiceState): string {
  switch (state) {
    case 'running':
      return 'text-[var(--success)]';
    case 'stopped':
      return 'text-slate-400';
    case 'failed':
      return 'text-[var(--danger)]';
    default:
      return 'text-amber-400';
  }
}

export function riskLabel(risk: RiskLevel): string {
  switch (risk) {
    case 'read':
      return '只读';
    case 'low':
      return '低风险';
    case 'medium':
      return '中风险';
    case 'high':
      return '高风险';
    default:
      return '已阻止';
  }
}

export function riskColor(risk: RiskLevel): { text: string; bg: string; border: string } {
  switch (risk) {
    case 'read':
      return { text: 'text-[var(--blue)]', bg: 'bg-sky-400/10', border: 'border-sky-400/20' };
    case 'low':
      return { text: 'text-[var(--success)]', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' };
    case 'medium':
      return { text: 'text-[var(--warning)]', bg: 'bg-amber-400/10', border: 'border-amber-400/20' };
    case 'high':
      return { text: 'text-[var(--danger)]', bg: 'bg-rose-400/10', border: 'border-rose-400/20' };
    default:
      return { text: 'text-[var(--danger)]', bg: 'bg-rose-500/15', border: 'border-rose-500/30' };
  }
}

export function severityColor(severity: 'info' | 'warning' | 'critical'): string {
  switch (severity) {
    case 'critical':
      return 'bg-[var(--danger)]';
    case 'warning':
      return 'bg-[var(--warning)]';
    default:
      return 'bg-[var(--blue)]';
  }
}

export function firstNameLetter(name: string): string {
  return (name.trim()[0] ?? 'S').toUpperCase();
}

export function shortPath(path: string | undefined, max = 42): string {
  if (!path) return '';
  return path.length > max ? `…${path.slice(-max)}` : path;
}
