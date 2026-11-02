import { describe, expect, it } from 'vitest';
import { evaluateSecurity } from '../src/main/security/checks';

const riskyOutput = `
##SECTION:LISTEN
tcp LISTEN 0 128 0.0.0.0:6379 0.0.0.0:* users:(("redis-server",pid=123,fd=6))
tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=222,fd=3))
tcp LISTEN 0 128 127.0.0.1:3306 0.0.0.0:* users:(("mysqld",pid=333,fd=8))
##SECTION:SSH_CONFIG
PermitRootLogin yes
PasswordAuthentication yes
PermitEmptyPasswords no
##SECTION:SSHD_EFFECTIVE
permitrootlogin yes
passwordauthentication yes
##SECTION:FIREWALL
Status: inactive
##SECTION:IPTABLES
-P INPUT ACCEPT
##SECTION:USERS
root
backdoor
##SECTION:SUDO
sudo:x:27:alice
##SECTION:UPDATES
12
##SECTION:DOCKER_SOCKET
666 root
##SECTION:TIME
no
##SECTION:FAILED_LOGINS
35
##SECTION:OS_RELEASE
ID=ubuntu
VERSION_ID="18.04"
`;

const cleanOutput = `
##SECTION:LISTEN
tcp LISTEN 0 128 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=10,fd=6))
##SECTION:SSH_CONFIG
PermitRootLogin prohibit-password
PasswordAuthentication no
PermitEmptyPasswords no
MaxAuthTries 3
##SECTION:SSHD_EFFECTIVE
permitrootlogin prohibit-password
passwordauthentication no
maxauthtries 3
##SECTION:FIREWALL
Status: active
##SECTION:IPTABLES
-P INPUT DROP
-A INPUT -p tcp --dport 443 -j ACCEPT
##SECTION:USERS
root
##SECTION:SUDO
##SECTION:UPDATES
0
##SECTION:TIME
yes
##SECTION:FAILED_LOGINS
0
##SECTION:OS_RELEASE
ID=ubuntu
VERSION_ID="22.04"
`;

describe('安全检查评估', () => {
  it('识别公网暴露的高危端口、SSH 配置与系统风险', () => {
    const result = evaluateSecurity({
      serverId: 'srv1',
      raw: riskyOutput,
      profile: null,
      states: {},
    });
    const ids = result.findings.map((finding) => finding.id);
    expect(ids).toContain('port:6379');
    expect(ids).toContain('ssh:public-port');
    expect(ids).toContain('ssh:root-login');
    expect(ids).toContain('ssh:password-auth');
    expect(ids).toContain('firewall:inactive');
    expect(ids).toContain('account:uid0:backdoor');
    expect(ids).toContain('update:pending');
    expect(ids).toContain('docker:socket-permission');
    expect(ids).toContain('time:unsynced');
    expect(ids).toContain('log:failed-logins');
    expect(ids).toContain('os:eol');
    // 只监听 127.0.0.1 的 3306 不应报告为公网暴露
    expect(ids).not.toContain('port:3306');

    const critical = result.findings.filter((finding) => finding.severity === 'critical');
    expect(critical.length).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeLessThan(50);
  });

  it('配置良好时没有待处理风险且评分为满分', () => {
    const result = evaluateSecurity({
      serverId: 'srv1',
      raw: cleanOutput,
      profile: null,
      states: {},
    });
    const open = result.findings.filter((finding) => finding.status === 'open');
    expect(open).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it('合并用户处理状态后不再计入待处理风险', () => {
    const first = evaluateSecurity({
      serverId: 'srv1',
      raw: riskyOutput,
      profile: null,
      states: {},
    });
    const states = {
      'port:6379': { status: 'fixed' as const, updatedAt: Date.now() },
      'ssh:root-login': { status: 'ignored' as const, updatedAt: Date.now() },
    };
    const second = evaluateSecurity({
      serverId: 'srv1',
      raw: riskyOutput,
      profile: null,
      states,
    });
    const fixed = second.findings.find((finding) => finding.id === 'port:6379');
    expect(fixed?.status).toBe('fixed');
    expect(second.score).toBeGreaterThan(first.score);
  });

  it('证书剩余天数过少时给出风险项', () => {
    const result = evaluateSecurity({
      serverId: 'srv1',
      raw: '##SECTION:OS_RELEASE\nID=ubuntu\nVERSION_ID="22.04"',
      profile: {
        serverId: 'srv1',
        scannedAt: new Date().toISOString(),
        hostname: 'demo',
        os: { name: 'Ubuntu', version: '22.04', kernel: '6.0', arch: 'x64' },
        hardware: { cpuModel: '', cpuCores: 2, memTotalKb: 1, swapTotalKb: 0, diskTotalKb: 1, diskUsedKb: 0 },
        network: { interfaces: [] },
        role: 'web',
        summary: '',
        services: [],
        runtimes: [],
        webSites: [],
        risks: [],
        notes: '',
        checklist: [],
        certificates: [{ port: 443, daysLeft: 3, expiresAt: 'soon' }],
        lastUpdated: new Date().toISOString(),
      },
      states: {},
    });
    expect(result.findings.map((finding) => finding.id)).toContain('cert:443');
  });
});
