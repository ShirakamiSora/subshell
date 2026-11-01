import type { Language, RiskLevel, ServiceState } from '@shared/types';

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

export function formatDuration(seconds: number, language: Language = 'zh'): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (language === 'en') {
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

export function formatRelative(ts: number, language: Language = 'zh'): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (language === 'en') {
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${minutes}m ago`;
    if (diff < 86_400_000) return `${hours}h ago`;
    return `${days}d ago`;
  }
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${minutes} 分钟前`;
  if (diff < 86_400_000) return `${hours} 小时前`;
  return `${days} 天前`;
}

function locale(language: Language): string {
  return language === 'en' ? 'en-US' : 'zh-CN';
}

export function formatTime(ts: number, language: Language = 'zh'): string {
  return new Date(ts).toLocaleTimeString(locale(language), { hour12: false });
}

export function formatDateTime(ts: number | string, language: Language = 'zh'): string {
  const date = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale(language), { hour12: false });
}

/** 服务状态对应的 i18n key，组件里用 t() 渲染。 */
export function serviceStateKey(state: ServiceState): string {
  switch (state) {
    case 'running':
      return 'service.state.running';
    case 'stopped':
      return 'service.state.stopped';
    case 'failed':
      return 'service.state.failed';
    default:
      return 'service.state.unknown';
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

/** 风险等级对应的 i18n key（tool.risk.* 已在字典中）。 */
export function riskLabelKey(risk: RiskLevel): string {
  return `tool.risk.${risk}`;
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
