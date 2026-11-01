import type { RiskLevel } from '../../shared/types';

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

const BLOCKED: { pattern: RegExp; reason: string }[] = [
  { pattern: /rm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(?:\s|$|\*)/i, reason: '递归删除根目录' },
  { pattern: /rm\s+-[a-z]*f[a-z]*r[a-z]*\s+\/(?:\s|$|\*)/i, reason: '递归删除根目录' },
  { pattern: /--no-preserve-root/i, reason: '强制递归删除根目录' },
  { pattern: /\bmkfs(\.|\s)/i, reason: '格式化文件系统' },
  { pattern: /\bwipefs\b/i, reason: '擦除文件系统签名' },
  { pattern: /\bdd\s+.*of=\/dev\/(sd|nvme|hd|vd)/i, reason: '直接写入磁盘设备' },
  { pattern: /:\s*\(\s*\)\s*\{.*\}\s*;?\s*:/, reason: 'Fork 炸弹' },
  { pattern: /chmod\s+-R\s+0{3,4}\s+\/(?:\s|$)/i, reason: '递归清空根目录权限' },
  { pattern: /chmod\s+-R\s+0?777\s+\/(?:\s|$)/i, reason: '递归放开根目录权限' },
  { pattern: /(shutdown|poweroff|reboot|halt|init\s+[06])\b/i, reason: '关机或重启整机' },
  { pattern: /systemctl\s+isolate\s+(rescue|emergency)/i, reason: '切换到救援模式，会中断所有服务' },
  { pattern: /iptables\s+-F\b/i, reason: '清空防火墙规则' },
  { pattern: /userdel\s+-r\s+root/i, reason: '删除 root 用户' },
  { pattern: />\s*\/dev\/(sd|nvme|hd|vd)/i, reason: '直接覆盖磁盘设备' },
  { pattern: />\s*\/boot\//i, reason: '覆盖引导分区文件，会导致系统无法启动' },
];

/**
 * 嵌套命令：`sh -c '…'`、`eval '…'` 包裹一层就能绕过字面量正则。
 * 这里把内层命令抽出来重新分级，任一层命中高危就整体升级。
 */
const NESTED_PATTERNS = [
  /(?:^|[;&|(]\s*|\s)(?:ba|da|k|z)?sh\s+(?:-[A-Za-z]+\s+)*?-[A-Za-z]*c[A-Za-z]*\s+(['"])([\s\S]*?)\1/g,
  /\beval\s+(['"])([\s\S]*?)\1/g,
  /\b(?:python3?|perl|node)\s+-[ce]\s+(['"])([\s\S]*?)\1/g,
];

const HIGH: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+/i, reason: '递归删除文件' },
  { pattern: /\bdocker\s+(system\s+prune|volume\s+prune|rm\s+-f|rmi\s+-f)/i, reason: '强制删除容器或清理数据卷' },
  { pattern: /\b(kill|pkill|killall)\s+(-9\s+)?1\b/i, reason: '终止 PID 1' },
  { pattern: /\bsystemctl\s+(stop|disable|mask)\s+(ssh|sshd|network|networking|systemd-|firewalld|ufw)/i, reason: '停止关键系统服务' },
  { pattern: /\btruncate\s+-s\s*0\s+\/var\/log/i, reason: '清空系统日志' },
  { pattern: /\bcrontab\s+-r\b/i, reason: '删除全部定时任务' },
  { pattern: /\b(userdel|groupdel|passwd|visudo)\b/i, reason: '修改系统账户' },
  { pattern: /\b(chmod|chown)\s+-R\s+.*\s+\/(?:\s|$)/i, reason: '递归修改根目录权限' },
  { pattern: />\s*\/etc\//i, reason: '覆盖系统配置文件' },
  { pattern: /\b(iptables|nft)\s+.*(-F|flush|delete)/i, reason: '修改防火墙规则' },
  { pattern: /\bapt(-get)?\s+(remove|purge|autoremove)|\byum\s+remove|\bdnf\s+remove/i, reason: '卸载软件包' },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i, reason: '下载并直接执行远程脚本' },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(python3?|perl|node)\b/i, reason: '下载并直接执行远程代码' },
  { pattern: /\bfind\s+\/\s.*(?:-delete|-exec\s+rm)\b/i, reason: '在根目录递归删除文件' },
];

const MEDIUM: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask)\b/i, reason: '变更 systemd 服务状态' },
  { pattern: /\bservice\s+\S+\s+(start|stop|restart|reload)\b/i, reason: '变更服务状态' },
  { pattern: /\bdocker\s+(start|stop|restart|rm|kill|pull|run|exec)\b/i, reason: '变更容器状态' },
  { pattern: /\b(kill|pkill|killall)\b/i, reason: '终止进程' },
  { pattern: /\b(rm|mv|cp|chmod|chown|truncate|tee)\s/i, reason: '修改服务器文件' },
  { pattern: /(^|[^2])>\s*[^&\s]/i, reason: '写入或覆盖文件' },
  { pattern: /\bsed\s+-i\b/i, reason: '原地修改文件' },
  { pattern: /\b(apt|apt-get|yum|dnf|apk|pip3?|npm|pnpm)\s+(install|add|upgrade|update)\b/i, reason: '安装或升级软件包' },
  { pattern: /\bgit\s+(pull|reset|checkout|clean)\b/i, reason: '变更代码目录' },
  { pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|python)/i, reason: '下载并直接执行远程脚本' },
  { pattern: /\bcrontab\s+-e|\bcrontab\s+[^-]/i, reason: '修改定时任务' },
  { pattern: /\bsystemctl\s+(enable|disable)\b/i, reason: '修改开机自启' },
];

/** 不区分参数即可视为只读的命令。 */
const SIMPLE_READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'awk', 'df', 'du', 'free',
  'ps', 'ss', 'netstat', 'journalctl', 'ip', 'ifconfig', 'uname', 'uptime', 'hostname', 'whoami', 'id',
  'groups', 'date', 'which', 'whereis', 'find', 'stat', 'wc', 'sort', 'uniq', 'cut', 'tr', 'echo',
  'printf', 'pwd', 'env', 'printenv', 'type', 'file', 'lsblk', 'lsof', 'readlink', 'realpath',
  'basename', 'dirname', 'cal', 'jq', 'dig', 'nslookup', 'host', 'ping', 'traceroute', 'mtr', 'whois',
  'last', 'lastb', 'w', 'getent', 'vmstat', 'iostat', 'mpstat', 'pidstat', 'sensors', 'nvidia-smi',
  'md5sum', 'sha1sum', 'sha256sum', 'base64', 'zipinfo', 'tree', 'top', 'htop', 'mount', 'dmesg',
  'lsusb', 'lspci', 'lscpu', 'systemd-analyze', 'loginctl', 'timedatectl', 'hostnamectl', 'localectl',
  'ipcs', 'ipcrm', 'nproc', 'arch', 'users',
]);

/**
 * 判断单个命令段是否只读。
 * 写重定向、tee、sed -i、find -delete/-exec 等一律不算只读。
 */
function isReadOnlySegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  const first = lower.split(/\s+/)[0] ?? '';

  // 写重定向（追加到 /dev/null 或关闭 stderr 除外）
  if (/(^|[^0-9])>{1,2}\s*(?!\/dev\/null\b|\/dev\/stderr\b|&[12]\b)\S/.test(trimmed)) return false;
  if (/\b(tee|sed\s+-i|find\b.*(?:-delete|-exec)|xargs)\b/i.test(lower)) return false;

  if (first === 'systemctl') return /^systemctl\s+(status|show|list-|is-|cat)\b/.test(lower);
  if (first === 'service') return /^service\s+\S+\s+status\b/.test(lower);
  if (first === 'docker') return /^docker\s+((ps|logs|inspect|stats|images|version|info|top|port)\b|compose\s+(ps|logs)\b)/.test(lower);
  if (first === 'kubectl') return /^kubectl\s+(get|describe|logs|top|version|api-resources)\b/.test(lower);
  if (first === 'git') return /^git\s+(status|log|diff|show|branch|rev-parse|remote\s+-v|ls-files|blame)\b/.test(lower);
  if (first === 'apt' || first === 'apt-get') return /^(apt|apt-get)\s+list\b/.test(lower);
  if (first === 'dpkg') return /^dpkg\s+(-l|-L|-s|-S)\b/.test(lower);
  if (first === 'rpm') return /^rpm\s+(-q|-qa|-qi)\b/.test(lower);
  if (first === 'npm') return /^npm\s+(ls|list|view|outdated)\b/.test(lower);
  if (first === 'pip' || first === 'pip3') return /^pip3?\s+(list|show|freeze)\b/.test(lower);
  if (first === 'openssl') return /^openssl\s+(x509|s_client|verify|version)\b/.test(lower);
  if (first === 'curl') return /^curl\b.*\s(-I|--head)\b/.test(lower) || /-o\s+\/dev\/null\b/.test(lower);
  if (first === 'wget') return /^wget\b.*--spider\b/.test(lower);
  if (first === 'tar') return /^tar\b.*\s-[a-z]*t[a-z]*\b/.test(lower);
  if (first === 'nginx') return /^nginx\s+-[tT]\b/.test(lower);
  if (first === 'apache2ctl' || first === 'httpd') return /^(apache2ctl|httpd)\s+-[tS]\b/.test(lower);
  if (first === 'redis-cli') return /^redis-cli\s+(info|ping|dbsize|config\s+get)\b/.test(lower);
  if (first === 'certbot') return /^certbot\s+(certificates|renew\s+--dry-run)\b/.test(lower);
  if (first === 'sed') return /^sed\s+(-n|--quiet)\b/.test(lower);

  return SIMPLE_READ_ONLY.has(first);
}

/**
 * 对 shell 命令做风险分级。模型不能降低本地判定：
 * 拦截项直接拒绝，高危与中危必须经用户审批。
 *
 * @param depth 递归深度，用于防止 `sh -c` 自嵌套造成无限递归。
 */
export function classifyCommand(command: string, depth = 0): RiskAssessment {
  const normalized = command.replace(/\s+/g, ' ').trim();
  if (!normalized) return { level: 'blocked', reasons: ['空命令'] };

  // 先看内层：`sh -c 'rm -rf /'`、`eval "…"` 这类一层壳不应绕过判定。
  // 注意：必须先把内层命令全部收集出来再递归。正则是模块级共享对象，
  // 递归里重置 lastIndex 会让外层循环回到起点，造成死循环。
  if (depth < 3) {
    const nested: string[] = [];
    for (const pattern of NESTED_PATTERNS) {
      const scan = new RegExp(pattern.source, 'g');
      for (const match of command.matchAll(scan)) {
        const inner = (match[2] ?? '').trim();
        if (inner && inner !== normalized) nested.push(inner);
      }
    }
    for (const inner of nested) {
      const result = classifyCommand(inner, depth + 1);
      if (result.level === 'blocked' || result.level === 'high') {
        return {
          level: result.level,
          reasons: [`嵌套命令（${result.reasons[0] ?? '高危操作'}）`],
        };
      }
    }
  }

  for (const item of BLOCKED) {
    if (item.pattern.test(normalized)) return { level: 'blocked', reasons: [item.reason] };
  }

  const reasons: string[] = [];
  let level: RiskLevel = 'medium';

  for (const item of HIGH) {
    if (item.pattern.test(normalized)) {
      reasons.push(item.reason);
      level = 'high';
    }
  }
  if (level !== 'high') {
    for (const item of MEDIUM) {
      if (item.pattern.test(normalized)) reasons.push(item.reason);
    }
    if (!reasons.length) reasons.push('执行自定义命令');
  }

  // 管道与多命令：每一段都只读时整体视为只读（如 `ls -la | grep xxx`、`echo ok`）。
  const segments = normalized.split(/\s*(?:;|&&|\|\||\|)\s*/).filter(Boolean);
  const allReadOnly = segments.length > 0 && segments.every((segment) => isReadOnlySegment(segment));
  if (level !== 'high' && allReadOnly) {
    return { level: 'read', reasons: ['只读查询命令'] };
  }

  return { level, reasons };
}

const CRITICAL_UNITS = /^(ssh|sshd|systemd-|network|networking|firewalld|ufw|dbus)/i;

/** 服务操作的风险：停止/禁用关键服务属于高危。 */
export function classifyServiceAction(action: string, unit: string): RiskAssessment {
  const name = unit.replace(/\.service$/, '');
  if (action === 'stop' || action === 'disable') {
    if (CRITICAL_UNITS.test(name)) {
      return { level: 'high', reasons: [`${action} 关键服务 ${name}`] };
    }
    return { level: 'medium', reasons: [`${action} 服务 ${name}`] };
  }
  if (action === 'start' || action === 'restart' || action === 'reload' || action === 'enable') {
    return { level: 'low', reasons: [`${action} 服务 ${name}`] };
  }
  return { level: 'medium', reasons: [`对服务 ${name} 执行 ${action}`] };
}

/** 敏感文件（密钥、密码、影子文件）不允许发送给模型。 */
export function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /(^|\/)etc\/(shadow|gshadow|sudoers)(\.|$|\/)/.test(lower) ||
    /(^|\/)etc\/ssl\/private(\/|$)/.test(lower) ||
    /(^|\/)\.ssh\/(id_|.*_key|.*\.pem)/.test(lower) ||
    /(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.|$)/.test(lower) ||
    /\.(pem|key|p12|pfx|kdbx)$/.test(lower) ||
    /(^|\/)\.env(\.|$)/.test(lower) ||
    /(^|\/)(credentials|secrets?)(\.|\/|$)/.test(lower) ||
    /(^|\/)\.aws\/credentials/.test(lower) ||
    /(^|\/)\.kube\/config/.test(lower) ||
    /(^|\/)\.git-credentials/.test(lower) ||
    /(^|\/)\.(netrc|pgpass|my\.cnf|npmrc|pypirc)(\.|$)/.test(lower) ||
    /(^|\/)\.docker\/config\.json/.test(lower)
  );
}

const ALLOWED_READ_ROOTS = ['/var/log', '/var/www', '/etc', '/opt', '/srv', '/home', '/root', '/tmp', '/usr/local'];

/** 读取文件前的路径校验：绝对路径、无穿越、位于可读目录。 */
export function validateReadPath(path: string): { ok: boolean; reason?: string; normalized: string } {
  const normalized = path.trim();
  if (!normalized.startsWith('/')) return { ok: false, reason: '必须使用绝对路径', normalized };
  if (normalized.includes('..')) return { ok: false, reason: '路径不能包含 ..', normalized };
  if (isSensitivePath(normalized)) return { ok: false, reason: '该文件可能包含密钥或密码，禁止读取', normalized };
  if (!ALLOWED_READ_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
    return { ok: false, reason: `只允许读取 ${ALLOWED_READ_ROOTS.join('、')} 下的文件`, normalized };
  }
  return { ok: true, normalized };
}

/** 服务名/容器名白名单校验，避免命令注入。 */
export function isValidUnitName(name: string): boolean {
  return /^[a-zA-Z0-9@_.:-]{1,120}$/.test(name);
}
