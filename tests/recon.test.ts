import { describe, expect, it } from 'vitest';
import { parseRecon, parsePorts, parseUnits, splitSections, parseEnabledUnits } from '../src/main/recon/parse';
import { buildProfile, inferRole } from '../src/main/recon/build-profile';
import type { ServerConfig } from '../src/shared/types';

const raw = `##SECTION:base
HOSTNAME=demo-web-01
OS_NAME=Ubuntu 22.04.3 LTS
OS_ID=ubuntu
OS_VERSION=22.04
KERNEL=5.15.0-91-generic
ARCH=x86_64
VIRT=kvm
CPU_MODEL=Intel Xeon
CPU_CORES=4
MEM_TOTAL_KB=8167424
SWAP_TOTAL_KB=2097148
UPTIME_SECONDS=1036800
LOAD=1.12 0.98 0.87
DISK_TOTAL_KB=83886080
DISK_USED_KB=35232153
IP_ADDRS=10.0.12.8

##SECTION:interfaces
eth0             UP             10.0.12.8/24 fe80::1/64

##SECTION:systemd
  nginx.service loaded active running A high performance web server
● fail2ban.service loaded failed failed Fail2Ban Service
  queue-worker.service loaded inactive dead Queue worker

##SECTION:enabled
nginx.service enabled enabled
fail2ban.service enabled enabled

##SECTION:failed
● fail2ban.service loaded failed failed Fail2Ban Service

##SECTION:docker
web-app|ghcr.io/acme/web:2.4.1|Up 3 days|0.0.0.0:3000->3000/tcp
queue-worker|ghcr.io/acme/worker:2.4.1|Exited (1) 2 hours ago|

##SECTION:ports
tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=3456,fd=6))
tcp LISTEN 0 151 127.0.0.1:3306 0.0.0.0:* users:(("mysqld",pid=1234,fd=21))
udp UNCONN 0 0 127.0.0.53:53 0.0.0.0:* users:(("systemd-resolve",pid=701,fd=13))

##SECTION:processes
  1234 mysql     12.3  6.8 1523712 /usr/sbin/mysqld
  3456 root       1.9  0.4  196608 nginx: master process

##SECTION:runtimes
RUNTIME=nginx|nginx version: nginx/1.18.0 (Ubuntu)
RUNTIME=node|v20.10.0

##SECTION:web
NGINX_SITES:
default
api.acme.example.conf
APACHE_VHOSTS:
CRON:
0 3 * * * /opt/backup/backup.sh
TIMERS:
HOME_DIRS:
ubuntu

##SECTION:security
SSHD:
port 22
permitrootlogin no
passwordauthentication yes
FIREWALL:
Status: active
SELINUX:
Disabled
REBOOT_REQUIRED:
no
END:
`;

const server: ServerConfig = {
  id: 'srv_test',
  name: 'demo-web-01',
  host: '127.0.0.1',
  port: 2222,
  username: 'ubuntu',
  authType: 'password',
  group: 'test',
  tags: [],
  createdAt: '',
  updatedAt: '',
};

describe('侦察输出解析', () => {
  it('按 section 切分并解析基础信息', () => {
    const sections = splitSections(raw);
    expect(sections.base).toContain('HOSTNAME=demo-web-01');
    const recon = parseRecon(raw);
    expect(recon.base.KERNEL).toBe('5.15.0-91-generic');
    expect(recon.units).toHaveLength(3);
    expect(recon.failed.map((unit) => unit.unit)).toEqual(['fail2ban.service']);
    expect(recon.enabled.has('nginx.service')).toBe(true);
    expect(recon.containers).toHaveLength(2);
    expect(recon.ports).toHaveLength(3);
    expect(recon.ports.find((port) => port.port === 80)?.process).toBe('nginx');
    expect(recon.processes[0]?.pid).toBe(1234);
    expect(recon.runtimes).toHaveLength(2);
    expect(recon.web.nginxSites).toContain('api.acme.example.conf');
    expect(recon.security.rebootRequired).toBe(false);
  });

  it('正确处理 ss 的 IPv6 与 netstat 回退', () => {
    const ports = parsePorts('tcp LISTEN 0 128 [::]:22 [::]:* users:(("sshd",pid=812,fd=3))');
    expect(ports[0]).toMatchObject({ protocol: 'tcp', address: '::', port: 22, process: 'sshd', pid: 812 });
  });

  it('解析启用的服务列表', () => {
    const enabled = parseEnabledUnits('nginx.service enabled enabled\nssh.service enabled enabled');
    expect([...enabled]).toEqual(['nginx.service', 'ssh.service']);
  });

  it('解析失败单元', () => {
    const units = parseUnits('● fail2ban.service loaded failed failed Fail2Ban Service');
    expect(units[0]).toMatchObject({ unit: 'fail2ban.service', active: 'failed' });
  });
});

describe('服务器档案构建', () => {
  it('推断角色并生成风险', () => {
    const recon = parseRecon(raw);
    const profile = buildProfile(recon, server, null);
    expect(profile.hostname).toBe('demo-web-01');
    expect(profile.hardware.cpuCores).toBe(4);
    expect(profile.role).toBe('Web 应用服务器');
    expect(profile.services.length).toBeGreaterThanOrEqual(4);
    expect(profile.risks.some((risk) => risk.title.includes('启动失败'))).toBe(true);
    expect(profile.risks.some((risk) => risk.title.includes('SSH 允许密码登录'))).toBe(true);
    expect(profile.webSites.some((site) => site.domain === 'api.acme.example')).toBe(true);
    expect(profile.summary).toContain('demo-web-01');
  });

  it('保留用户笔记与检查项', () => {
    const recon = parseRecon(raw);
    const first = buildProfile(recon, server, null);
    const second = buildProfile(recon, server, {
      ...first,
      notes: '用户笔记',
      checklist: [{ id: 'c1', text: '检查备份', done: false }],
    });
    expect(second.notes).toBe('用户笔记');
    expect(second.checklist).toHaveLength(1);
  });

  it('根据服务推断角色', () => {
    expect(inferRole([{ name: 'docker.service' } as never], [])).toBe('容器宿主');
    expect(inferRole([{ name: 'nginx.service' } as never], [{ name: 'nginx' }])).toBe('Web / 反向代理');
    expect(inferRole([], [])).toBe('通用 Linux 服务器');
  });
});
