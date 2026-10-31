# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately to the maintainers (for example through GitHub's private vulnerability reporting) with:

- a description of the issue and its impact,
- reproduction steps,
- the affected version or commit.

We will acknowledge the report and work on a fix as quickly as possible.

## Design boundaries

Subshell treats the following as untrusted data: command output, logs, remote files and model responses. They can never register tools, change the system prompt or alter the local security policy.

- The model only proposes tool calls; risk is classified locally and can only be raised, never lowered by the model.
- Read-only tools may run automatically; changes require explicit approval unless classified as low risk in Smart mode.
- Destructive commands are blocked locally.
- Sensitive files (shadow files, private keys, `.env`, cloud credentials) are refused.
- Credentials and API keys are stored through the OS keychain, never in configuration files, logs or backups.
