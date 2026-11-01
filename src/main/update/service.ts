import { app, shell } from 'electron';
import { createLogger } from '../util/logger';

const log = createLogger('update');

/**
 * 更新仓库。发布到自己的 GitHub 仓库后，用环境变量 SUBSHELL_UPDATE_REPO 覆盖，
 * 或在 RELEASING.md 里改成正式地址。
 */
const REPO = process.env.SUBSHELL_UPDATE_REPO ?? 'ShirakamiSora/subshell';

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  url: string;
  notes?: string;
  checkedAt: number;
  error?: string;
}

/** 语义化版本比较，忽略预发布标签的细节（0.3.0-beta < 0.3.0）。 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core, pre] = value.replace(/^v/, '').split('-');
    const nums = (core ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
    return { nums, pre: pre ?? '' };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left.nums[index] ?? 0) - (right.nums[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

/**
 * 检查 GitHub 上的最新版本。
 * 只做「检查 + 提示 + 打开下载页」：完整的静默更新需要代码签名与 electron-updater，
 * 在没有签名证书的前提下强行下载安装会破坏用户信任，因此不做。
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = app.getVersion();
  const base: UpdateInfo = {
    current,
    latest: current,
    hasUpdate: false,
    url: '',
    checkedAt: Date.now(),
  };

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'subshell' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
    const data = (await response.json()) as { tag_name?: string; html_url?: string; body?: string };
    const latest = (data.tag_name ?? '').replace(/^v/, '') || current;
    return {
      ...base,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      url: data.html_url ?? `https://github.com/${REPO}/releases`,
      notes: data.body?.slice(0, 2000),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.debug(`检查更新失败：${message}`);
    return { ...base, error: message };
  }
}

export function openDownloadPage(url: string): void {
  if (/^https:\/\//.test(url)) void shell.openExternal(url);
}
