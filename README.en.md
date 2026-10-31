# Subshell

> An AI-assisted SSH operations workbench that actually knows your servers.

Subshell combines an **interactive SSH terminal**, **automatic server discovery**, **continuous monitoring** and an **AI operations assistant** in one desktop app. On connect it behaves like an engineer who already knows the machine: it inventories the system and services, builds a long-lived profile, watches key metrics and lets you troubleshoot and control services in natural language.

![Welcome](docs/screenshots/welcome.png)

## Highlights

- **Automatic discovery** — OS, CPU/memory/disk, every mount point and inode usage, systemd services, Docker containers, listening ports, runtimes, web sites, security posture, certificates, recent package installs.
- **Long-lived profile** — structured JSON profile per server with role, summary, services, risks, checklist and notes. History is compacted into short summaries so the file never grows without bound.
- **Continuous monitoring** — background sampling of CPU, memory, disk, load and network; service, port and process snapshots every 60 seconds; new services are discovered and tracked automatically.
- **Natural language operations** — "restart nginx", "why is the disk full", "check fail2ban logs". The model calls tools, and risky actions require your approval.
- **Smart approval** — read-only tools run automatically; low-risk changes (start/restart/reload ordinary services) run automatically in Smart mode; stopping services, editing files and arbitrary commands still ask. A Strict mode confirms everything.
- **Verified operations** — after a service action the app checks `systemctl is-active` / container state and feeds the result back to the model.
- **Interactive terminal** — xterm.js with resize, copy/paste and reconnect. Press `Tab` for command completion; use **Command analysis** to understand a command before running it.
- **Token usage & estimated cost** — per-conversation token counts with a cost estimate based on prices you enter manually.
- **Bilingual UI** — Simplified Chinese and English.

## Quick start

Requirements: Node.js 22+, Windows 10/11 (also runs on macOS/Linux), and a Linux server reachable over SSH.

```bash
npm install
npm run dev
```

Build a Windows portable package:

```bash
npm run dist:win
```

### Try it in five minutes

1. Add a server (or use your own Linux host).
2. Configure a model provider in **Settings → Model providers**: OpenAI-compatible (OpenAI, DeepSeek, Moonshot...), Anthropic Messages, or Ollama.
3. Connect. Subshell discovers the server, builds a profile and starts monitoring.
4. Open **AI Assistant** and ask: "check the server status", "restart nginx", "why did fail2ban fail?".


## Configuration

Settings are stored under the app data directory (defaults to `subshell-runtime/data` next to the executable, falling back to `%APPDATA%\subshell\data`):

```
data/
  settings.json
  servers.json
  secrets.json        # encrypted with the OS keychain
  providers.json
  known-hosts.json
  audit.jsonl
  servers/<id>/
    profile.json      # profile + compacted history
    runtime.json      # metric samples and events
    chat.json         # conversation history
```

Credentials and API keys are encrypted with the OS keychain (DPAPI / Keychain / libsecret) and never written to config files or logs.

### Language

Switch between Chinese and English in **Settings → Appearance → Language**.

## Architecture

- Electron 38 + React 19 + TypeScript
- ssh2 for connections, command execution, shells and SFTP
- xterm.js for the terminal
- zustand for state, Tailwind CSS 4 for styling
- A small in-house model adapter: OpenAI Chat Completions, Anthropic Messages, Ollama (streaming + tool calls)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Development

```bash
npm run dev        # development with HMR
npm run build      # production build
npm test           # unit and integration tests
npm run typecheck  # type checking
```

The test suite covers discovery parsing, profile building, risk classification, sensitive paths, CPU math, alerting, SSH end-to-end (connect / discovery / sampling / service actions / interactive shell), the agent loop (auto-run, approval, rejection, context trimming), streaming protocol parsing and persistence.

## Security model

- The model only proposes tool calls; local rules decide risk and the user decides execution.
- Read-only tools may run automatically; changes require approval unless explicitly low-risk in Smart mode.
- Dangerous commands (wiping the root filesystem, formatting, shutdown, firewall flush) are blocked locally.
- Sensitive files (`/etc/shadow`, private keys, `.env`, cloud credentials) cannot be read by the model.
- Command output, logs and file contents are treated as untrusted data, never as instructions.
- Every change is written to the audit log.

## Known limitations

- Focused on Linux + systemd; other init systems get limited information.
- Real SSH hosts use the standard ssh2 stack; validate on a non-production host before relying on it.
- Some machines require launching the app with `--no-sandbox` (Chromium sandbox initialization can be blocked by third-party security software). The desktop shortcut created by the installer includes this flag.
- Monitoring data and profiles stay local; multi-user sync is not implemented.

## License

[MIT](LICENSE)
