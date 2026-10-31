export interface CommandSuggestion {
  name: string;
  description: string;
  /** 插入终端的文本（不含前面的命令名） */
  insert: string;
}

/** 常用运维命令库：用于终端 Tab 补全与命令说明。 */
export const COMMON_COMMANDS: CommandSuggestion[] = [
  { name: 'systemctl status', description: '查看服务状态', insert: 'systemctl status ' },
  { name: 'systemctl restart', description: '重启服务', insert: 'systemctl restart ' },
  { name: 'systemctl start', description: '启动服务', insert: 'systemctl start ' },
  { name: 'systemctl stop', description: '停止服务', insert: 'systemctl stop ' },
  { name: 'systemctl reload', description: '重载服务配置', insert: 'systemctl reload ' },
  { name: 'systemctl list-units', description: '列出 systemd 单元', insert: 'systemctl list-units --type=service --all --no-pager' },
  { name: 'systemctl --failed', description: '查看失败的服务', insert: 'systemctl --failed' },
  { name: 'journalctl -u', description: '查看服务日志', insert: 'journalctl -u  -n 100 --no-pager' },
  { name: 'journalctl -f', description: '实时跟踪日志', insert: 'journalctl -f' },
  { name: 'journalctl -p err', description: '查看错误级别日志', insert: 'journalctl -p err -S "1 hour ago" --no-pager' },
  { name: 'docker ps', description: '查看运行中的容器', insert: 'docker ps' },
  { name: 'docker ps -a', description: '查看所有容器', insert: 'docker ps -a' },
  { name: 'docker logs', description: '查看容器日志', insert: 'docker logs --tail 100 ' },
  { name: 'docker stats', description: '容器资源占用', insert: 'docker stats --no-stream' },
  { name: 'docker restart', description: '重启容器', insert: 'docker restart ' },
  { name: 'docker compose ps', description: '查看 Compose 服务', insert: 'docker compose ps' },
  { name: 'df -h', description: '磁盘使用率', insert: 'df -h' },
  { name: 'df -i', description: 'inode 使用率', insert: 'df -i' },
  { name: 'du -sh', description: '统计目录大小', insert: 'du -sh ' },
  { name: 'free -m', description: '内存使用情况', insert: 'free -m' },
  { name: 'top', description: '实时进程监控', insert: 'top -b -n 1 | head -20' },
  { name: 'ps aux', description: '查看进程列表', insert: 'ps aux --sort=-%cpu | head -15' },
  { name: 'ss -tulpn', description: '监听端口与进程', insert: 'ss -tulpn' },
  { name: 'ss -s', description: 'TCP 连接统计', insert: 'ss -s' },
  { name: 'netstat -tulpn', description: '监听端口（旧命令）', insert: 'netstat -tulpn' },
  { name: 'tail -f', description: '实时查看日志文件', insert: 'tail -f ' },
  { name: 'tail -n 200', description: '查看日志末尾', insert: 'tail -n 200 ' },
  { name: 'grep -i error', description: '过滤错误日志', insert: 'grep -i error ' },
  { name: 'nginx -t', description: '检查 Nginx 配置', insert: 'nginx -t' },
  { name: 'iptables -L', description: '查看防火墙规则', insert: 'iptables -L -n --line-numbers' },
  { name: 'ufw status', description: '查看 ufw 状态', insert: 'ufw status verbose' },
  { name: 'firewall-cmd --list-all', description: '查看 firewalld 规则', insert: 'firewall-cmd --list-all' },
  { name: 'last', description: '最近登录记录', insert: 'last -n 10' },
  { name: 'lastb', description: '失败登录记录', insert: 'lastb | head -20' },
  { name: 'who', description: '当前登录用户', insert: 'who' },
  { name: 'uptime', description: '运行时长与负载', insert: 'uptime' },
  { name: 'ip addr', description: '网络接口与地址', insert: 'ip addr' },
  { name: 'ip route', description: '路由表', insert: 'ip route' },
  { name: 'curl -I', description: '检查 HTTP 响应头', insert: 'curl -I ' },
  { name: 'openssl s_client', description: '检查 TLS 证书', insert: 'openssl s_client -connect 127.0.0.1:443 -servername localhost </dev/null 2>/dev/null | openssl x509 -noout -dates' },
  { name: 'certbot certificates', description: '查看证书与到期时间', insert: 'certbot certificates' },
  { name: 'smartctl -H', description: '磁盘健康检查', insert: 'smartctl -H ' },
  { name: 'iostat -x', description: '磁盘 IO 统计', insert: 'iostat -x 1 3' },
  { name: 'vmstat 1', description: '系统整体状态', insert: 'vmstat 1 5' },
  { name: 'crontab -l', description: '查看定时任务', insert: 'crontab -l' },
  { name: 'systemctl list-timers', description: '查看 systemd 定时器', insert: 'systemctl list-timers --all --no-pager' },
  { name: 'mysql -e', description: '执行 MySQL 查询', insert: 'mysql -e "SHOW PROCESSLIST;"' },
  { name: 'redis-cli info', description: '查看 Redis 状态', insert: 'redis-cli info' },
  { name: 'pg_stat_activity', description: '查看 PostgreSQL 连接', insert: 'psql -c "SELECT * FROM pg_stat_activity;"' },
  { name: 'kubectl get nodes', description: '查看 K8s 节点', insert: 'kubectl get nodes -o wide' },
  { name: 'kubectl get pods', description: '查看 K8s Pod', insert: 'kubectl get pods -A' },
  { name: 'apt update', description: '更新软件源', insert: 'apt update' },
  { name: 'apt list --upgradable', description: '查看可升级包', insert: 'apt list --upgradable' },
  { name: 'yum check-update', description: '查看可升级包（RHEL）', insert: 'yum check-update' },
  { name: 'dmesg', description: '内核日志', insert: 'dmesg -T | tail -50' },
  { name: 'uname -a', description: '内核与架构信息', insert: 'uname -a' },
  { name: 'cat /etc/os-release', description: '系统版本', insert: 'cat /etc/os-release' },
];

/** 按当前输入的最后一段做前缀匹配。 */
export function suggestCommands(input: string, limit = 8): CommandSuggestion[] {
  const trimmed = input.trimStart();
  if (!trimmed) return COMMON_COMMANDS.slice(0, limit);
  const token = trimmed.split(/\s+/).at(-1) ?? '';
  if (!token) return COMMON_COMMANDS.slice(0, limit);
  const lower = token.toLowerCase();
  return COMMON_COMMANDS.filter((command) => command.name.toLowerCase().startsWith(lower)).slice(0, limit);
}
