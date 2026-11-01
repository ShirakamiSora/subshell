# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately to the maintainers (for example through GitHub's private vulnerability reporting) with:

- a description of the issue and its impact,
- reproduction steps,
- the affected version or commit.

We will acknowledge the report and work on a fix as quickly as possible.

## Design boundaries

Subshell treats the following as untrusted data: command output, logs, remote files, the server profile, operational notes and model responses. They can never register tools, change the system prompt or alter the local security policy.

- The model only proposes tool calls; risk is classified locally and can only be raised, never lowered by the model.
- Read-only tools may run automatically; changes require explicit approval. Smart mode only auto-runs `service` actions classified as low risk — arbitrary commands and profile writes always ask.
- Destructive commands are blocked locally. Commands wrapped in `sh -c`, `eval`, `bash -lc` or `python -c` are unwrapped and re-classified (up to 3 levels).
- Sensitive files (shadow files, private keys, `.env`, `.npmrc`, `.git-credentials`, `.docker/config.json`, `/etc/ssl/private/`, cloud credentials) are refused.
- Command output, logs and file contents are never interpreted as instructions. The profile and notes are injected into the system prompt but explicitly labelled as untrusted historical records, and writing them requires user approval.
- Credentials and API keys are stored through the OS keychain, never in configuration files, logs or backups.

## Process isolation

- The renderer runs with `sandbox: true`, `contextIsolation: true` and no Node integration. It can only reach privileged capabilities through the typed IPC surface in `src/preload/index.ts`.
- Production builds inject a Content Security Policy (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`). Development mode skips it because Vite HMR needs inline scripts and WebSocket connections.
- Host keys are recorded on first connect; a changed fingerprint refuses the connection until the user explicitly resets it.

## MCP exposure

The built-in MCP server is an additional attack surface and is designed accordingly:

- binds to `127.0.0.1` only,
- requires `Authorization: Bearer <token>` on every request (token generated once and stored in the OS keychain),
- exposes read-only tools by default; `service_action` and `run_command` require an explicit opt-in in settings,
- has no interactive approval channel, so any call that would need approval is rejected instead of auto-approved,
- still applies the local risk engine: `blocked` commands are always refused.

## Update channel

Automatic update checks only query the GitHub Releases API for a version number; nothing about your servers, profiles or usage is reported. The check can be disabled in **Settings → About**.
