import { generateKeyPairSync } from 'node:crypto';
import { Server, type Connection } from 'ssh2';
import type { ServerChannel } from 'ssh2';
import { createLogger } from '../util/logger';

const log = createLogger('demo-server');

interface DemoService {
  unit: string;
  description: string;
  active: string;
  sub: string;
  enabled: boolean;
}

interface DemoContainer {
  name: string;
  image: string;
  status: string;
  ports: string;
}

interface ExecOutput {
  stdout: string;
  stderr: string;
  code: number;
}

/** 内存中的模拟 Linux 主机，覆盖侦察、监控、日志与常见运维命令。 */
class DemoHost {
  private services: DemoService[] = [
    { unit: 'ssh.service', description: 'OpenSSH server daemon', active: 'active', sub: 'running', enabled: true },
    { unit: 'nginx.service', description: 'A high performance web server and a reverse proxy server', active: 'active', sub: 'running', enabled: true },
    { unit: 'mysql.service', description: 'MySQL Community Server', active: 'active', sub: 'running', enabled: true },
    { unit: 'redis-server.service', description: 'Advanced key-value store', active: 'active', sub: 'running', enabled: true },
    { unit: 'docker.service', description: 'Docker Application Container Engine', active: 'active', sub: 'running', enabled: true },
    { unit: 'cron.service', description: 'Regular background program processing daemon', active: 'active', sub: 'running', enabled: true },
    { unit: 'php8.1-fpm.service', description: 'The PHP 8.1 FastCGI Process Manager', active: 'active', sub: 'running', enabled: true },
    { unit: 'fail2ban.service', description: 'Fail2Ban Service', active: 'failed', sub: 'failed', enabled: true },
    { unit: 'systemd-journald.service', description: 'Journal Service', active: 'active', sub: 'running', enabled: false },
  ];

  private containers: DemoContainer[] = [
    { name: 'web-app', image: 'ghcr.io/acme/web:2.4.1', status: 'Up 3 days', ports: '0.0.0.0:3000->3000/tcp' },
    { name: 'cache-redis', image: 'redis:7-alpine', status: 'Up 3 days', ports: '6379/tcp' },
    { name: 'queue-worker', image: 'ghcr.io/acme/worker:2.4.1', status: 'Exited (1) 2 hours ago', ports: '' },
  ];

  private cpuTotal = 100_000;
  private cpuIdle = 72_000;
  private rx = 8_400_000_000;
  private tx = 3_100_000_000;
  private cwd = '/home/ubuntu';
  private mysqlConnections = 23;

  private ports(): string[] {
    return [
      'tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=812,fd=3))',
      'tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=3456,fd=6))',
      'tcp LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=3456,fd=7))',
      'tcp LISTEN 0 128 0.0.0.0:3000 0.0.0.0:* users:(("docker-proxy",pid=4512,fd=4))',
      'tcp LISTEN 0 151 127.0.0.1:3306 0.0.0.0:* users:(("mysqld",pid=1234,fd=21))',
      'tcp LISTEN 0 511 127.0.0.1:6379 0.0.0.0:* users:(("redis-server",pid=1789,fd=6))',
      'tcp LISTEN 0 511 127.0.0.1:8080 0.0.0.0:* users:(("node",pid=2345,fd=22))',
      'udp UNCONN 0 0 127.0.0.53:53 0.0.0.0:* users:(("systemd-resolve",pid=701,fd=13))',
    ];
  }

  private processes(): string[] {
    return [
      '  1234 mysql     12.3  6.8 1523712 /usr/sbin/mysqld --daemonize --pid-file=/run/mysqld/mysqld.pid',
      '  2345 ubuntu     6.7 11.2 1873920 node /opt/web-app/server.js',
      '  3456 root       1.9  0.4  196608 nginx: master process /usr/sbin/nginx -g daemon on; master_process on;',
      '  3457 www-data   0.8  0.3  198400 nginx: worker process',
      '  1789 redis      0.7  0.5   76800 /usr/bin/redis-server 127.0.0.1:6379',
      '  812  root       0.3  0.2   28672 sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups',
      '  4512 root       0.2  0.1   10240 docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 3000',
      '  987  systemd+   0.1  0.3   51200 /lib/systemd/systemd-resolved',
      '  2210 ubuntu     0.1  1.4  327680 php-fpm: pool www',
      '  3344 root       0.1  0.4  131072 dockerd -H fd:// --containerd=/run/containerd/containerd.sock',
    ];
  }

  private reconOutput(): string {
    const services = this.services
      .map((service) => `${service.active === 'failed' ? '● ' : '  '}${service.unit} loaded ${service.active} ${service.sub} ${service.description}`)
      .join('\n');
    const enabled = this.services
      .filter((service) => service.enabled)
      .map((service) => `${service.unit} enabled enabled`)
      .join('\n');
    const failed = this.services
      .filter((service) => service.active === 'failed')
      .map((service) => `● ${service.unit} loaded ${service.active} ${service.sub} ${service.description}`)
      .join('\n');
    const containers = this.containers.map((container) => `${container.name}|${container.image}|${container.status}|${container.ports}`).join('\n');

    return [
      '##SECTION:base',
      'HOSTNAME=demo-web-01',
      'OS_NAME=Ubuntu 22.04.3 LTS',
      'OS_ID=ubuntu',
      'OS_VERSION=22.04',
      'KERNEL=5.15.0-91-generic',
      'ARCH=x86_64',
      'VIRT=kvm',
      'CPU_MODEL=Intel(R) Xeon(R) Platinum 8255C CPU @ 2.50GHz',
      'CPU_CORES=4',
      'MEM_TOTAL_KB=8167424',
      'SWAP_TOTAL_KB=2097148',
      'UPTIME_SECONDS=1036800',
      'LOAD=1.12 0.98 0.87',
      'DISK_TOTAL_KB=83886080',
      'DISK_USED_KB=35232153',
      'TIMEZONE=Asia/Shanghai',
      'IP_ADDRS=10.0.12.8',
      '',
      '##SECTION:storage',
      '/dev/vda1|83886080|35232153|44354307|42%|/',
      '/dev/vdb1|209715200|167772160|41943040|80%|/data',
      '##INODE',
      '/dev/vda1|5242880|655360|4587520|13%|/',
      '/dev/vdb1|13107200|10485760|2621440|80%|/data',
      '',
      '##SECTION:memory',
      'MemTotal:        8167424 kB',
      'MemAvailable:    3600000 kB',
      'SwapTotal:       2097148 kB',
      'SwapFree:        2096128 kB',
      'Cached:          1200000 kB',
      'OOM_KILL=2',
      '',
      '##SECTION:network',
      'default via 10.0.12.1 dev eth0 proto dhcp src 10.0.12.8 metric 100',
      'nameserver 127.0.0.53',
      'TCP:   45 (estab 12, closed 20, orphaned 0, timewait 8)',
      'SOMAXCONN=4096',
      'FILE_NR=3456 0 9223372036854775807',
      '',
      '##SECTION:interfaces',
      'lo               UNKNOWN        127.0.0.1/8 ::1/128',
      'eth0             UP             10.0.12.8/24 fe80::216:3eff:fe12:8a4c/64',
      '',
      '##SECTION:systemd',
      services,
      '',
      '##SECTION:enabled',
      enabled,
      '',
      '##SECTION:failed',
      failed,
      '',
      '##SECTION:docker',
      containers,
      '',
      '##SECTION:ports',
      ...this.ports(),
      '',
      '##SECTION:processes',
      ...this.processes(),
      '',
      '##SECTION:runtimes',
      'RUNTIME=nginx|nginx version: nginx/1.18.0 (Ubuntu)',
      'RUNTIME=php|PHP 8.1.2-1ubuntu2.14 (cli) (built: Aug 18 2023 11:41:29) (NTS)',
      'RUNTIME=node|v20.10.0',
      'RUNTIME=python3|Python 3.10.12',
      'RUNTIME=mysql|mysql  Ver 8.0.35-0ubuntu0.22.04.1 for Linux on x86_64 ((Ubuntu))',
      'RUNTIME=docker|Docker version 24.0.7, build afdd53b',
      'RUNTIME=git|git version 2.34.1',
      '',
      '##SECTION:web',
      'NGINX_SITES:',
      'default',
      'api.acme.example.conf',
      'APACHE_VHOSTS:',
      'CRON:',
      '0 3 * * * /opt/backup/backup.sh >> /var/log/backup.log 2>&1',
      'TIMERS:',
      'Mon 2026-01-05 00:00:00 CST  2 days      -  certbot.timer         certbot.timer',
      'HOME_DIRS:',
      'ubuntu',
      'deploy',
      '',
      '##SECTION:health',
      'ZOMBIES=2',
      'TIME_SYNCED=yes',
      'FAILED_UNITS=1',
      'JOURNAL_ERRORS=37',
      '',
      '##SECTION:certs',
      'CERT_443=Jun  1 12:00:00 2027 GMT',
      '',
      '##SECTION:packages',
      '2026-01-02 10:12:01 install nginx:amd64 <none> 1.18.0',
      '2026-01-03 09:00:12 install php8.1-fpm:amd64 <none> 8.1.2',
      '',
      '##SECTION:security',
      'FAILED_LOGINS=128',
      'UPGRADABLE=23',
      'LOGIN_USERS=ubuntu',
      'SUDO_USERS=ubuntu,deploy',
      'SUID=21',
      'SSHD:',
      'port 22',
      'permitrootlogin no',
      'passwordauthentication yes',
      'FIREWALL:',
      'Status: active',
      'SELINUX:',
      'Disabled',
      'REBOOT_REQUIRED:',
      'no',
      'END:',
    ].join('\n');
  }

  private metricOutput(): string {
    // 让 CPU 使用率在 18%-46% 之间自然波动。
    const totalDelta = 400;
    const idleDelta = totalDelta - Math.round(70 + Math.random() * 110);
    this.cpuTotal += totalDelta;
    this.cpuIdle += idleDelta;
    this.rx += Math.round(1_800_000 + Math.random() * 6_000_000);
    this.tx += Math.round(900_000 + Math.random() * 3_000_000);
    this.mysqlConnections = Math.max(8, Math.min(60, this.mysqlConnections + Math.round((Math.random() - 0.5) * 4)));

    const memTotal = 8167424;
    const memAvailable = Math.round(3_400_000 + Math.random() * 500_000);
    const used = memTotal - memAvailable;
    const busy = this.cpuTotal - this.cpuIdle;
    return [
      `CPU=${busy} 0 0 ${this.cpuIdle} 0 0 0 0`,
      `MEM_TOTAL=${memTotal}`,
      `MEM_AVAILABLE=${memAvailable}`,
      'SWAP_TOTAL=2097148',
      'SWAP_FREE=2096128',
      'LOAD=1.08 0.96 0.88',
      'UPTIME=1036815.42',
      `DISK=83886080 ${Math.round(35232153 + used / 200)}`,
      `NET=${this.rx} ${this.tx}`,
      'PROCS=147',
    ].join('\n');
  }

  private statusOutput(): string {
    const failed = this.services
      .filter((service) => service.active === 'failed')
      .map((service) => `● ${service.unit} loaded failed failed ${service.description}`)
      .join('\n');
    return [
      '##SECTION:failed',
      failed,
      '',
      '##SECTION:docker',
      ...this.containers.map((container) => `${container.name}|${container.image}|${container.status}|${container.ports}`),
      '',
      '##SECTION:ports',
      ...this.ports(),
      '',
      '##SECTION:processes',
      ...this.processes(),
    ].join('\n');
  }

  private journal(unit: string, lines: number): string {
    const name = unit.replace(/\.service$/, '');
    if (name === 'fail2ban') {
      return [
        'Jan 05 09:12:11 demo-web-01 systemd[1]: Starting Fail2Ban Service...',
        'Jan 05 09:12:11 demo-web-01 fail2ban-server[2211]: Failed to access socket path: /var/run/fail2ban/fail2ban.sock. Is fail2ban running?',
        'Jan 05 09:12:11 demo-web-01 systemd[1]: fail2ban.service: Main process exited, code=exited, status=255/EXCEPTION',
        'Jan 05 09:12:11 demo-web-01 systemd[1]: fail2ban.service: Failed with result \'exit-code\'.',
        'Jan 05 09:12:11 demo-web-01 systemd[1]: Failed to start Fail2Ban Service.',
        'Jan 05 09:12:14 demo-web-01 systemd[1]: fail2ban.service: Scheduled restart job, restart counter is at 5.',
        'Jan 05 09:12:14 demo-web-01 systemd[1]: Stopped Fail2Ban Service.',
      ].join('\n');
    }
    if (name === 'nginx') {
      return [
        'Jan 05 09:30:02 demo-web-01 nginx[3456]: 10.0.12.31 - - [05/Jan/2026:09:30:02 +0800] "GET /health HTTP/1.1" 200 2 "-" "kube-probe/1.28"',
        'Jan 05 09:30:04 demo-web-01 nginx[3456]: 10.0.12.44 - - [05/Jan/2026:09:30:04 +0800] "GET /api/orders?page=2 HTTP/1.1" 502 157 "-" "Mozilla/5.0"',
        'Jan 05 09:30:04 demo-web-01 nginx[3456]: 2026/01/05 09:30:04 [error] 3457#3457: *8821 connect() failed (111: Connection refused) while connecting to upstream, client: 10.0.12.44, server: api.acme.example, request: "GET /api/orders?page=2 HTTP/1.1", upstream: "http://127.0.0.1:8080/api/orders?page=2"',
        'Jan 05 09:30:09 demo-web-01 nginx[3456]: 10.0.12.31 - - [05/Jan/2026:09:30:09 +0800] "GET /health HTTP/1.1" 200 2 "-" "kube-probe/1.28"',
      ]
        .slice(-Math.min(lines, 4))
        .join('\n');
    }
    return [
      `Jan 05 09:30:01 demo-web-01 systemd[1]: ${unit}: Scheduled restart job.`,
      `Jan 05 09:30:02 demo-web-01 systemd[1]: Started ${unit}.`,
      `Jan 05 09:30:02 demo-web-01 ${name}[2210]: ready to accept connections`,
    ].join('\n');
  }

  private serviceStatus(unit: string): ExecOutput {
    const name = unit.replace(/\.service$/, '');
    const service = this.services.find((item) => item.unit === unti(unit));
    if (!service) {
      return { stdout: '', stderr: `Unit ${unit} could not be found.`, code: 4 };
    }
    const running = service.active === 'active';
    const lines = [
      `● ${service.unit} - ${service.description}`,
      `     Loaded: loaded (/lib/systemd/system/${service.unit}; ${service.enabled ? 'enabled' : 'disabled'}; vendor preset: enabled)`,
      running ? '     Active: active (running) since Mon 2025-12-22 21:14:07 CST; 1 weeks 5 days ago' : `     Active: ${service.active} (${service.sub}) since Mon 2026-01-05 09:12:11 CST; 18min ago`,
      `    Process: 2210 ExecStart=/usr/sbin/${name} (code=exited, status=0/SUCCESS)`,
      '   Main PID: 2210 (nginx)',
      '      Tasks: 5 (limit: 9451)',
      '     Memory: 12.4M',
      '        CPU: 1.204s',
      '     CGroup: /system.slice/nginx.service',
      '             ├─3456 nginx: master process /usr/sbin/nginx -g daemon on; master_process on;',
      '             └─3457 nginx: worker process',
    ];
    return { stdout: lines.join('\n'), stderr: '', code: running ? 0 : 3 };
  }

  private dockerOutput(args: string): ExecOutput {
    if (/^ps\b/.test(args)) {
      const body = this.containers
        .map((container) => `${container.name}\t${container.image}\t${container.status}\t${container.ports}`)
        .join('\n');
      return { stdout: body, stderr: '', code: 0 };
    }
    if (/^inspect\b/.test(args)) {
      const name = args.split(/\s+/).at(-1) ?? '';
      const container = this.containers.find((item) => item.name === name);
      if (!container) return { stdout: '', stderr: `Error: No such object: ${name}`, code: 1 };
      if (args.includes('--format')) {
        const status = /^Up/.test(container.status) ? 'running' : 'exited';
        return {
          stdout: `${status} | restarts=0 | image=${container.image} | started=2025-12-22T21:14:07Z`,
          stderr: '',
          code: 0,
        };
      }
      return { stdout: JSON.stringify({ Name: `/${container.name}`, State: { Status: 'running' } }, null, 2), stderr: '', code: 0 };
    }
    if (/^logs\b/.test(args)) {
      const name = args.split(/\s+/).at(-1) ?? '';
      return {
        stdout: [
          `[2026-01-05T09:28:12Z] INFO  ${name} started (pid 1)`,
          `[2026-01-05T09:29:02Z] WARN  upstream responded slowly: 1842ms`,
          `[2026-01-05T09:29:44Z] ERROR connect ECONNREFUSED 127.0.0.1:8080`,
          `[2026-01-05T09:30:00Z] INFO  retrying in 2000ms`,
        ].join('\n'),
        stderr: '',
        code: 0,
      };
    }
    return { stdout: '', stderr: '', code: 0 };
  }

  private controlService(action: string, unit: string): ExecOutput {
    const target = this.services.find((service) => service.unit === unti(unit));
    if (!target) return { stdout: '', stderr: `Unit ${unit} could not be found.`, code: 4 };
    if (action === 'start' || action === 'restart' || action === 'reload') {
      target.active = 'active';
      target.sub = 'running';
      return { stdout: '', stderr: '', code: 0 };
    }
    if (action === 'stop') {
      target.active = 'inactive';
      target.sub = 'dead';
      return { stdout: '', stderr: '', code: 0 };
    }
    if (action === 'enable' || action === 'disable') {
      target.enabled = action === 'enable';
      return { stdout: '', stderr: '', code: 0 };
    }
    return { stdout: '', stderr: `Unknown operation ${action}`, code: 1 };
  }

  /** 处理一条已去掉包装的 shell 命令。 */
  exec(command: string): ExecOutput {
    const cmd = command.trim();
    if (!cmd) return { stdout: '', stderr: '', code: 0 };

    if (cmd.includes('##SECTION') && cmd.includes('section base')) {
      return { stdout: this.reconOutput(), stderr: '', code: 0 };
    }
    if (cmd.includes('MEM_TOTAL=') && cmd.includes('CPU=')) return { stdout: this.metricOutput(), stderr: '', code: 0 };
    if (cmd.includes('##SECTION:failed')) return { stdout: this.statusOutput(), stderr: '', code: 0 };

    let match = cmd.match(/^systemctl\s+is-active\s+(\S+)/);
    if (match) {
      const target = this.services.find((service) => service.unit === unti(match![1]!));
      return { stdout: `${target?.active ?? 'inactive'}\n`, stderr: '', code: target?.active === 'active' ? 0 : 3 };
    }

    match = cmd.match(/^systemctl\s+(start|stop|restart|reload|enable|disable)\s+(\S+)/);
    if (match) return this.controlService(match[1]!, match[2]!);

    match = cmd.match(/^systemctl\s+status\s+(\S+)/);
    if (match) return this.serviceStatus(match[1]!);

    match = cmd.match(/^systemctl\s+show\s+.*--\s+(\S+)/);
    if (match) {
      const target = this.services.find((service) => service.unit === unti(match![1]!));
      return {
        stdout: [
          `Id=${target?.unit ?? match[1]}`,
          `Description=${target?.description ?? ''}`,
          `LoadState=loaded`,
          `ActiveState=${target?.active ?? 'inactive'}`,
          `SubState=${target?.sub ?? 'dead'}`,
        ].join('\n'),
        stderr: '',
        code: 0,
      };
    }

    match = cmd.match(/^journalctl\s+.*-u\s+(\S+)/);
    if (match) {
      const linesMatch = cmd.match(/-n\s+(\d+)/);
      return { stdout: this.journal(match[1]!, linesMatch ? Number(linesMatch[1]) : 40), stderr: '', code: 0 };
    }

    if (/^docker\b/.test(cmd)) {
      const args = cmd.replace(/^docker\s+/, '');
      return this.dockerOutput(args);
    }

    if (/^ps\b/.test(cmd)) return { stdout: this.processes().join('\n'), stderr: '', code: 0 };
    if (/^ss\s+-tulpn/.test(cmd)) return { stdout: this.ports().join('\n'), stderr: '', code: 0 };
    if (/^netstat\b/.test(cmd)) return { stdout: this.ports().join('\n'), stderr: '', code: 0 };
    if (/^df\s+-h/.test(cmd)) {
      return {
        stdout: [
          'Filesystem      Size  Used Avail Use% Mounted on',
          '/dev/vda1        80G   34G   43G  45% /',
          'tmpfs           3.9G     0  3.9G   0% /dev/shm',
          '/dev/vda15      105M  6.1M   99M   6% /boot/efi',
        ].join('\n'),
        stderr: '',
        code: 0,
      };
    }
    if (/^df\b/.test(cmd)) {
      return { stdout: '/dev/vda1 83886080 35232153 44354307 45% /', stderr: '', code: 0 };
    }
    if (/^free\b/.test(cmd)) {
      return {
        stdout: [
          '               total        used        free      shared  buff/cache   available',
          'Mem:            7976        4412         612         214        2951        3072',
          'Swap:           2047           0        2047',
        ].join('\n'),
        stderr: '',
        code: 0,
      };
    }
    if (/^uptime/.test(cmd)) {
      return { stdout: ' 09:42:11 up 12 days,  4:02,  1 user,  load average: 1.12, 0.98, 0.87', stderr: '', code: 0 };
    }
    if (/^hostname$/.test(cmd)) return { stdout: 'demo-web-01', stderr: '', code: 0 };
    if (/^uname/.test(cmd)) return { stdout: '5.15.0-91-generic', stderr: '', code: 0 };
    if (/^whoami$/.test(cmd)) return { stdout: 'ubuntu', stderr: '', code: 0 };
    if (/^id$/.test(cmd)) {
      return { stdout: 'uid=1000(ubuntu) gid=1000(ubuntu) groups=1000(ubuntu),4(adm),27(sudo),30(dip),113(docker)', stderr: '', code: 0 };
    }
    if (/^date/.test(cmd)) return { stdout: new Date().toString(), stderr: '', code: 0 };

    match = cmd.match(/^tail\s+.*-n\s+(\d+)\s+(\S+)/);
    if (match) {
      const path = match[2]!;
      if (path.includes('nginx/error.log')) {
        return {
          stdout: [
            '2026/01/05 09:30:04 [error] 3457#3457: *8821 connect() failed (111: Connection refused) while connecting to upstream, client: 10.0.12.44, server: api.acme.example, request: "GET /api/orders?page=2 HTTP/1.1", upstream: "http://127.0.0.1:8080/api/orders?page=2"',
            '2026/01/05 09:31:12 [error] 3457#3457: *8830 no live upstreams while connecting to upstream, client: 10.0.12.44, server: api.acme.example, request: "GET /api/health HTTP/1.1", upstream: "http://127.0.0.1:8080/api/health"',
          ].join('\n'),
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '2026-01-05 03:00:01 backup started\n2026-01-05 03:02:19 backup finished (success)', stderr: '', code: 0 };
    }

    match = cmd.match(/^sed\s+-n\s+'(\d+),(\d+)p'\s+(\S+)/);
    if (match) {
      return {
        stdout: [
          'server {',
          '    listen 80;',
          '    server_name api.acme.example;',
          '',
          '    location / {',
          '        proxy_pass http://127.0.0.1:8080;',
          '        proxy_set_header Host $host;',
          '    }',
          '}',
        ].join('\n'),
        stderr: '',
        code: 0,
      };
    }

    match = cmd.match(/^ls\s+.*?\s+(\S+)$/);
    if (match) {
      return {
        stdout: [
          'total 48K',
          'drwxr-xr-x 2 root root 4.0K Dec 20 11:02 sites-enabled',
          'drwxr-xr-x 2 root root 4.0K Dec 20 11:02 sites-available',
          'drwxr-xr-x 2 root root 4.0K Jan  5 09:12 conf.d',
          '-rw-r--r-- 1 root root 1.4K Dec 20 11:02 nginx.conf',
          'drwxr-xr-x 2 root root 4.0K Dec 20 11:02 snippets',
        ].join('\n'),
        stderr: '',
        code: 0,
      };
    }

    match = cmd.match(/^cat\s+(\S+)/);
    if (match) {
      if (match[1]!.includes('os-release')) {
        return {
          stdout: 'PRETTY_NAME="Ubuntu 22.04.3 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\nID=ubuntu',
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '# demo file content', stderr: '', code: 0 };
    }

    match = cmd.match(/^echo\s+(.*)$/);
    if (match) return { stdout: match[1]!.replace(/^["']|["']$/g, ''), stderr: '', code: 0 };

    if (/^true$/.test(cmd)) return { stdout: '', stderr: '', code: 0 };
    if (/^clear$/.test(cmd)) return { stdout: '\x1b[2J\x1b[H', stderr: '', code: 0 };

    return { stdout: '', stderr: `bash: ${cmd.split(/\s+/)[0]}: command not found`, code: 127 };
  }

  prompt(): string {
    const display = this.cwd === '/home/ubuntu' ? '~' : this.cwd;
    return `ubuntu@demo-web-01:${display}$ `;
  }

  get currentDir(): string {
    return this.cwd;
  }

  cd(path: string): void {
    if (!path || path === '~') {
      this.cwd = '/home/ubuntu';
      return;
    }
    if (path.startsWith('/')) this.cwd = path.replace(/\/+$/, '') || '/';
    else if (path === '..') this.cwd = this.cwd.split('/').slice(0, -1).join('/') || '/';
    else this.cwd = `${this.cwd}/${path}`.replace(/\/+/g, '/');
  }

  mysqlConn(): number {
    return this.mysqlConnections;
  }
}

function unti(unit: string): string {
  return unit.endsWith('.service') ? unit : `${unit}.service`;
}

/** 去掉 `sh -c '...'` 与 sudo 包装，得到实际脚本。 */
export function unwrapCommand(raw: string): string {
  let cmd = raw.trim();
  cmd = cmd.replace(/^sudo\s+(-S\s+-p\s+''\s+--|-n\s+--)\s+/, '');
  const wrapped = cmd.match(/^sh\s+-c\s+'([\s\S]*)'$/);
  if (wrapped) cmd = wrapped[1]!.replace(/'\\''/g, "'");
  return cmd.trim();
}

export interface DemoServerInfo {
  host: string;
  port: number;
}

/** 本地演示 SSH 服务：127.0.0.1 随机端口，接受任意用户名与密码。 */
export class DemoServer {
  private server: Server | null = null;
  private host = new DemoHost();
  private port = 0;
  private connections = new Set<Connection>();

  get info(): DemoServerInfo | null {
    return this.server ? { host: '127.0.0.1', port: this.port } : null;
  }

  async start(): Promise<DemoServerInfo> {
    if (this.server) return { host: '127.0.0.1', port: this.port };
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const server = new Server({ hostKeys: [privateKey] }, (client) => {
      this.connections.add(client);
      client.on('close', () => this.connections.delete(client));
      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username) ctx.accept();
        else if (ctx.method === 'none') ctx.reject(['password']);
        else ctx.reject(['password']);
      });
      client.on('ready', () => {
        client.on('session', (acceptSession) => {
          const session = acceptSession();
          session.on('pty', (accept) => accept?.());
          session.on('window-change', (accept) => accept?.());
          session.on('shell', (accept) => {
            const stream = accept();
            this.attachShell(stream);
          });
          session.on('exec', (accept, _reject, info) => {
            const stream = accept();
            const output = this.host.exec(unwrapCommand(info.command));
            if (output.stdout) stream.write(output.stdout);
            if (output.stderr) stream.stderr.write(output.stderr);
            stream.exit(output.code);
            stream.end();
          });
        });
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    this.server = server;
    this.port = typeof address === 'object' && address ? address.port : 0;
    log.info(`演示 SSH 服务已启动 127.0.0.1:${this.port}`);
    return { host: '127.0.0.1', port: this.port };
  }

  private attachShell(stream: ServerChannel): void {
    stream.write('Welcome to Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0-91-generic x86_64)\r\n\r\n');
    stream.write(' * Documentation:  https://help.ubuntu.com\r\n');
    stream.write(' * Management:     https://landscape.canonical.com\r\n\r\n');
    stream.write('  System information as of Mon Jan  5 09:42:11 CST 2026\r\n\r\n');
    stream.write('  System load:  1.12               Processes:             147\r\n');
    stream.write('  Usage of /:   45.0% of 80.00GB   Users logged in:       0\r\n');
    stream.write('  Memory usage: 55%                IPv4 address for eth0: 10.0.12.8\r\n\r\n');
    stream.write('Last login: Mon Jan  5 08:12:04 2026 from 10.0.12.1\r\n');
    stream.write(this.host.prompt());

    let buffer = '';
    stream.on('data', (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          stream.write('\r\n');
          this.runShellCommand(stream, buffer);
          buffer = '';
        } else if (char === '\x7f') {
          if (buffer.length) {
            buffer = buffer.slice(0, -1);
            stream.write('\b \b');
          }
        } else if (char === '\x03') {
          buffer = '';
          stream.write('^C\r\n');
          stream.write(this.host.prompt());
        } else if (char === '\x04') {
          stream.write('\r\nexit\r\n');
          stream.exit(0);
          stream.end();
          return;
        } else {
          buffer += char;
          stream.write(char);
        }
      }
    });
  }

  private runShellCommand(stream: ServerChannel, input: string): void {
    const command = input.trim();
    if (!command) {
      stream.write(this.host.prompt());
      return;
    }
    if (command === 'exit' || command === 'logout') {
      stream.exit(0);
      stream.end();
      return;
    }
    if (command === 'clear') {
      stream.write('\x1b[2J\x1b[H');
      stream.write(this.host.prompt());
      return;
    }
    if (command === 'pwd') {
      stream.write(`${this.host.currentDir}\r\n${this.host.prompt()}`);
      return;
    }
    const cd = command.match(/^cd\s+(.*)$/);
    if (cd) {
      this.host.cd(cd[1]!.trim());
      stream.write(this.host.prompt());
      return;
    }

    const output = this.host.exec(command);
    if (output.stdout) stream.write(output.stdout.replace(/\n/g, '\r\n').replace(/\r\r/g, '\r') + '\r\n');
    if (output.stderr) stream.write(`\x1b[31m${output.stderr}\x1b[0m\r\n`);
    stream.write(this.host.prompt());
  }

  stop(): void {
    for (const client of this.connections) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.connections.clear();
    this.server?.close();
    this.server = null;
    this.port = 0;
  }
}
