# Contributing

Thanks for your interest in Subshell.

## Development setup

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
```

Node.js 22+ is required. On Windows you need the Microsoft C++ Build Tools only if the optional native dependency of `ssh2` needs to be compiled; it is not required for the app to work.

## Guidelines

- Keep the security model intact: the model proposes, local code decides, the user approves. Never let model output lower a local risk level.
- Add tests for parsing, risk classification, storage, health aggregation, MCP and agent behaviour when you change them.
- UI text must go through the i18n helper (`useI18n` in the renderer) so both Chinese and English stay complete. Add new keys to both dictionaries in `src/renderer/src/lib/i18n.ts`.
- New persisted data must use `JsonStore` with a `version` and a `migrate` function.
- Do not commit credentials, private keys, real server addresses or personal data.

## UI changes

Screenshots and the demo GIF are generated from the production build with a mocked `window.subshell`:

```bash
npm run build
node scripts/ui-preview.mjs   # writes docs/screenshots/*.png
python scripts/make-gif.py    # optional: rebuild docs/screenshots/demo.gif
```

## Pull requests

1. Describe the problem and the approach.
2. Include tests where practical.
3. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` before opening the PR.
