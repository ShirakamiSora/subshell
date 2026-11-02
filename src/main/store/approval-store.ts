import type { ApprovalRule } from '../../shared/types';
import type { SubshellDb } from './db';
import { SqliteStore } from './sqlite-store';
import { shortId } from '../util/id';

type DefaultRule = Omit<ApprovalRule, 'createdAt' | 'updatedAt'>;

/**
 * 内置命令库：按命令形态给出建议决策。规则只是「匹配」，最终仍受本地风险分级约束：
 * - blocked 永远拒绝；
 * - high 永远至少需要用户确认（规则与模型都不能自动放行）；
 * - 多条规则命中时取最严格的一条（reject > ask > approve）。
 */
export const DEFAULT_APPROVAL_RULES: DefaultRule[] = [
  {
    id: 'builtin-read-status',
    name: '只读状态查询',
    pattern: '^\\s*(systemctl\\s+(status|show|is-active)|service\\s+\\S+\\s+status|df|free|uptime|whoami|hostname|uname|date|ps|ss|netstat|journalctl|cat|tail|head|grep|ls)\\b',
    action: 'approve',
    risk: 'read',
    builtin: true,
    enabled: true,
    note: '不会改变服务器状态，自动放行。',
  },
  {
    id: 'builtin-service-start',
    name: '启动或重启普通服务',
    pattern: '^\\s*(sudo\\s+)?systemctl\\s+(start|restart|reload)\\s+[\\w@.:-]+(\\.service)?\\s*$',
    action: 'approve',
    risk: 'low',
    builtin: true,
    enabled: true,
    note: '不涉及停止与禁用；关键服务会额外转人工确认。',
  },
  {
    id: 'builtin-docker-start',
    name: '启动容器',
    pattern: '^\\s*(sudo\\s+)?docker\\s+(start|restart)\\s+[\\w@.:-]+\\s*$',
    action: 'approve',
    risk: 'low',
    builtin: true,
    enabled: true,
    note: '仅启动单个容器。',
  },
  {
    id: 'builtin-service-stop',
    name: '停止或禁用服务',
    pattern: '^\\s*(sudo\\s+)?systemctl\\s+(stop|disable|mask)\\b',
    action: 'ask',
    risk: 'high',
    builtin: true,
    enabled: true,
    note: '会影响依赖该服务的功能，必须人工确认。',
  },
  {
    id: 'builtin-docker-stop',
    name: '删除或停止容器',
    pattern: '^\\s*(sudo\\s+)?docker\\s+(stop|kill|rm|rmi|volume\\s+rm|system\\s+prune)\\b',
    action: 'ask',
    risk: 'high',
    builtin: true,
    enabled: true,
  },
  {
    id: 'builtin-delete',
    name: '删除或移动文件',
    pattern: '^\\s*(sudo\\s+)?(rm|mv|truncate|shred)\\s+',
    action: 'ask',
    risk: 'high',
    builtin: true,
    enabled: true,
  },
  {
    id: 'builtin-write-config',
    name: '覆盖系统配置',
    pattern: '(^|[^0-9])>\\s*/(etc|boot|usr)/|\\bsed\\s+-i\\b|\\btee\\b',
    action: 'ask',
    risk: 'high',
    builtin: true,
    enabled: true,
  },
  {
    id: 'builtin-chmod',
    name: '修改权限或归属',
    pattern: '^\\s*(sudo\\s+)?(chmod|chown|chgrp|setfacl)\\s+',
    action: 'ask',
    risk: 'high',
    builtin: true,
    enabled: true,
  },
  {
    id: 'builtin-package',
    name: '安装或卸载软件包',
    pattern: '\\b(apt|apt-get|yum|dnf|apk|pip3?|npm|pnpm)\\s+(install|add|remove|purge|autoremove|upgrade|update)\\b',
    action: 'ask',
    risk: 'high',
    builtin: true,
    enabled: true,
  },
  {
    id: 'builtin-firewall',
    name: '修改防火墙',
    pattern: '\\b(iptables|nft|ufw|firewall-cmd)\\b',
    action: 'ask',
    risk: 'high',
    builtin: true,
    enabled: true,
    note: '防火墙变更可能直接切断连接。',
  },
  {
    id: 'builtin-user',
    name: '修改账户与 sudo',
    pattern: '\\b(useradd|userdel|usermod|groupadd|groupdel|passwd|visudo)\\b',
    action: 'ask',
    risk: 'high',
    builtin: true,
    enabled: true,
  },
  {
    id: 'builtin-cron',
    name: '修改定时任务',
    pattern: '\\bcrontab\\s+(-e|-r|[^-])',
    action: 'ask',
    risk: 'medium',
    builtin: true,
    enabled: true,
  },
  {
    id: 'builtin-pipe-shell',
    name: '下载并直接执行远程脚本',
    pattern: '(curl|wget)[^|]*\\|\\s*(sudo\\s+)?(ba|z|k)?sh\\b',
    action: 'reject',
    risk: 'high',
    builtin: true,
    enabled: true,
    note: '无法预知远程脚本内容，默认拒绝。',
  },
  {
    id: 'builtin-destructive',
    name: '破坏性系统操作',
    pattern: '\\b(mkfs(\\.|\\s)|wipefs|shutdown|poweroff|reboot|halt|init\\s+[06])\\b|>\\s*/dev/(sd|nvme|hd|vd)|--no-preserve-root',
    action: 'reject',
    risk: 'blocked',
    builtin: true,
    enabled: true,
    note: '无论是否开启智能审批，都由本地策略直接拒绝。',
  },
];

function nowRules(): ApprovalRule[] {
  const stamp = Date.now();
  return DEFAULT_APPROVAL_RULES.map((rule) => ({ ...rule, createdAt: stamp, updatedAt: stamp }));
}

export class ApprovalRuleStore {
  private readonly store: SqliteStore<ApprovalRule[]>;

  constructor(db: SubshellDb) {
    this.store = new SqliteStore<ApprovalRule[]>(db, 'approval-rules', () => nowRules(), { version: 1 });
  }

  list(): ApprovalRule[] {
    return this.store.read();
  }

  save(input: {
    id?: string;
    name: string;
    pattern: string;
    action: ApprovalRule['action'];
    note?: string;
    enabled?: boolean;
  }): ApprovalRule[] {
    // 提前校验正则，避免坏规则导致每次审批都静默失效。
    new RegExp(input.pattern, 'i');
    const list = this.list();
    const now = Date.now();
    const id = input.id ?? shortId('rule');
    const existing = list.find((rule) => rule.id === id);
    const next: ApprovalRule = {
      id,
      name: input.name.trim() || '未命名规则',
      pattern: input.pattern,
      action: input.action,
      note: input.note,
      builtin: existing?.builtin ?? false,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.write(existing ? list.map((rule) => (rule.id === id ? next : rule)) : [...list, next]);
    return this.list();
  }

  toggle(id: string, enabled: boolean): ApprovalRule[] {
    this.store.write(
      this.list().map((rule) => (rule.id === id ? { ...rule, enabled, updatedAt: Date.now() } : rule)),
    );
    return this.list();
  }

  remove(id: string): ApprovalRule[] {
    this.store.write(this.list().filter((rule) => rule.id !== id));
    return this.list();
  }

  reset(): ApprovalRule[] {
    this.store.write(nowRules());
    return this.list();
  }
}
