/**
 * 只读侦察脚本。一次 SSH 往返收集系统、服务、端口、运行时、安全配置等信息。
 * 所有命令都允许失败，输出按 `##SECTION:name` 分段，便于稳定解析。
 */
export function reconScript(): string {
  const script = `set +e
# 强制 C locale：systemd/df/ps/date 等工具的输出会按 LANG 本地化（中文系统会变成
# 「已加载 活动 运行中」），而解析器依赖英文状态词，不固定 locale 会导致整份档案失真。
export LC_ALL=C LANG=C LANGUAGE=C
section() { printf '\\n##SECTION:%s\\n' "$1"; }
v() { printf '%s=%s\\n' "$1" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }

section base
v HOSTNAME "$(hostname 2>/dev/null)"
v OS_NAME "$(awk -F= '$1=="PRETTY_NAME"{gsub(/^"|"$/,"",$2); print $2; exit}' /etc/os-release 2>/dev/null)"
v OS_ID "$(awk -F= '$1=="ID"{gsub(/^"|"$/,"",$2); print $2; exit}' /etc/os-release 2>/dev/null)"
v OS_VERSION "$(awk -F= '$1=="VERSION_ID"{gsub(/^"|"$/,"",$2); print $2; exit}' /etc/os-release 2>/dev/null)"
v KERNEL "$(uname -r 2>/dev/null)"
v ARCH "$(uname -m 2>/dev/null)"
v VIRT "$(systemd-detect-virt 2>/dev/null || echo unknown)"
v CPU_MODEL "$(awk -F': ' '/model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null)"
v CPU_CORES "$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null)"
v MEM_TOTAL_KB "$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"
v SWAP_TOTAL_KB "$(awk '/^SwapTotal:/{print $2}' /proc/meminfo 2>/dev/null)"
v UPTIME_SECONDS "$(awk '{printf "%d", $1}' /proc/uptime 2>/dev/null)"
v LOAD "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
v DISK_TOTAL_KB "$(df -Pk / 2>/dev/null | tail -1 | awk '{print $2}')"
v DISK_USED_KB "$(df -Pk / 2>/dev/null | tail -1 | awk '{print $3}')"
v TIMEZONE "$(cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null | sed 's#.*zoneinfo/##')"
v IP_ADDRS "$(hostname -I 2>/dev/null | tr ' ' ',' | sed 's/,$//')"

section storage
df -Pk -x tmpfs -x devtmpfs 2>/dev/null | awk 'NR>1{print $1"|"$2"|"$3"|"$4"|"$5"|"$6}' | head -20
printf '##INODE\\n'
df -Pi -x tmpfs -x devtmpfs 2>/dev/null | awk 'NR>1{print $1"|"$2"|"$3"|"$4"|"$5"|"$6}' | head -20

section memory
awk '/^MemTotal:|^MemAvailable:|^SwapTotal:|^SwapFree:|^Cached:/{print}' /proc/meminfo 2>/dev/null
awk '/^oom_kill /{print "OOM_KILL="$2}' /proc/vmstat 2>/dev/null

section network
if have ip; then ip route show default 2>/dev/null | head -3; fi
grep -E '^nameserver' /etc/resolv.conf 2>/dev/null | head -3
if have ss; then ss -s 2>/dev/null | head -8; fi
printf 'SOMAXCONN=%s\\n' "$(cat /proc/sys/net/core/somaxconn 2>/dev/null)"
printf 'FILE_NR=%s\\n' "$(cat /proc/sys/fs/file-nr 2>/dev/null)"

section interfaces
if have ip; then ip -br addr 2>/dev/null | head -40
elif have ifconfig; then ifconfig -a 2>/dev/null | head -80
fi

section systemd
if have systemctl; then systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | head -400
fi

section enabled
if have systemctl; then systemctl list-unit-files --type=service --state=enabled --no-legend --no-pager 2>/dev/null | head -200
fi

section failed
if have systemctl; then systemctl --failed --no-legend --no-pager --plain 2>/dev/null | head -50
fi

section docker
if have docker && docker info >/dev/null 2>&1; then
  docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null | head -120
fi

section ports
if have ss; then ss -tulpnH 2>/dev/null | head -250
elif have netstat; then netstat -tulpn 2>/dev/null | head -250
fi

section processes
if ps -eo pid=,user=,%cpu=,%mem=,rss=,args= --sort=-%cpu >/dev/null 2>&1; then
  ps -eo pid=,user=,%cpu=,%mem=,rss=,args= --sort=-%cpu 2>/dev/null | head -18
else
  ps aux 2>/dev/null | head -18
fi

section runtimes
for c in nginx apache2 httpd node python3 python php java mysql mysqld mariadb redis-server postgres docker kubectl k3s git gcc go cargo; do
  if have "$c"; then
    ver="$("$c" --version 2>&1 | head -1 | cut -c1-140)"
    [ -z "$ver" ] && ver="$("$c" -v 2>&1 | head -1 | cut -c1-140)"
    printf 'RUNTIME=%s|%s\\n' "$c" "$ver"
  fi
done

section web
printf 'NGINX_SITES:\\n'
if have nginx; then ls -1 /etc/nginx/sites-enabled 2>/dev/null | head -30; ls -1 /etc/nginx/conf.d 2>/dev/null | head -30; fi
printf 'APACHE_VHOSTS:\\n'
if have apache2ctl; then apache2ctl -S 2>&1 | grep -Ei 'namevhost|:port' | head -20; fi
printf 'CRON:\\n'
crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$' | head -30
printf 'TIMERS:\\n'
if have systemctl; then systemctl list-timers --no-pager --no-legend 2>/dev/null | head -20; fi
printf 'HOME_DIRS:\\n'
ls -1 /home 2>/dev/null | head -20

section health
printf 'ZOMBIES=%s\\n' "$(ps -eo stat= 2>/dev/null | grep -c '^Z' | tr -d ' ')"
printf 'TIME_SYNCED=%s\\n' "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)"
printf 'FAILED_UNITS=%s\\n' "$(systemctl --failed --no-legend --no-pager 2>/dev/null | wc -l | tr -d ' ')"
printf 'JOURNAL_ERRORS=%s\\n' "$(journalctl -p err -S '2 hours ago' --no-pager 2>/dev/null | wc -l | tr -d ' ')"

section certs
if have openssl && have ss && ss -tlnH 2>/dev/null | grep -qE ':443 '; then
  END=$(echo | timeout 5 openssl s_client -connect 127.0.0.1:443 -servername localhost 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -n "$END" ] && printf 'CERT_443=%s\\n' "$END"
fi

section packages
if [ -f /var/log/dpkg.log ]; then grep ' install ' /var/log/dpkg.log 2>/dev/null | tail -8 | cut -c1-160; fi
if [ -f /var/log/dnf.log ]; then grep -i 'installed' /var/log/dnf.log 2>/dev/null | tail -5 | cut -c1-160; fi

section security
printf 'FAILED_LOGINS=%s\\n' "$(lastb 2>/dev/null | wc -l | tr -d ' ')"
if have apt; then UPG=$(timeout 8 apt list --upgradable 2>/dev/null | grep -c '^[a-zA-Z0-9]')
elif have yum; then UPG=$(timeout 8 yum -q check-update 2>/dev/null | grep -c '^[a-zA-Z0-9]')
else UPG=0; fi
printf 'UPGRADABLE=%s\\n' "$UPG"
printf 'LOGIN_USERS=%s\\n' "$(who 2>/dev/null | awk '{print $1}' | sort -u | tr '\\n' ',' | sed 's/,$//')"
printf 'SUDO_USERS=%s\\n' "$(getent group sudo 2>/dev/null | cut -d: -f4)"
printf 'SUID=%s\\n' "$(find /usr/bin /usr/sbin /bin /sbin -perm -4000 -type f 2>/dev/null | wc -l | tr -d ' ')"
printf 'SSHD:\\n'
(sshd -T 2>/dev/null || grep -Ei '^(PermitRootLogin|PasswordAuthentication|Port)' /etc/ssh/sshd_config 2>/dev/null) | grep -Ei 'permitrootlogin|passwordauthentication|^port' | head -10
printf 'FIREWALL:\\n'
if have ufw; then ufw status 2>/dev/null | head -5; elif have firewall-cmd; then firewall-cmd --state 2>/dev/null; else echo unknown; fi
printf 'SELINUX:\\n'
getenforce 2>/dev/null || echo Disabled
printf 'REBOOT_REQUIRED:\\n'
if [ -f /var/run/reboot-required ]; then echo yes; else echo no; fi
printf 'END:\\n'
`;
  return script;
}

/** 侦察脚本的完整命令（由 SshConnection.exec 负责 sh -c 包装）。 */
export function reconCommand(): string {
  return reconScript();
}
