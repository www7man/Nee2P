# Contributing to Nee2P

Thanks for considering a contribution. Nee2P is a privacy-first
messenger, so the bar for crypto / security changes is high — but
docs, UI and DX contributions are very welcome.

## Quick dev loop

```bash
git clone https://github.com/www7man/Nee2P
cd Nee2P
npm install
npm start
# → http://127.0.0.1:8787 — open in two tabs

# Wire-format regression test (starts its own client against a
# running relay on port 9787)
PORT=9787 node server.js &
node tools/smoke-wire-format.js
```

Or with Docker:

```bash
docker compose up --build
```

## Good first issues

Look for the `good first issue` label. Typical entry-level work:

- A new UI palette in `nee2p-ui.jsx::PALETTES`
- English translation of UI strings (currently Russian-only — strings
  live in `nee2p-screens.jsx`)
- Docs improvements: nginx example, Windows install notes, FAQ entries
- Sound notification on new message (opt-in)
- `--port` CLI flag as fallback when env var is missing

## Pull-request checklist

- [ ] No new runtime dependencies — vendor everything for air-gap use
- [ ] No external network calls from the browser bundle
- [ ] `CACHE_VERSION` in [sw.js](sw.js) bumped if any JS/JSX changed
- [ ] `node tools/smoke-wire-format.js` passes locally
- [ ] Crypto / wire-format changes include a compat note in the PR body
- [ ] Commit messages follow the repo style: `feat:`, `fix:`, `docs:` …

## Code style

- Vanilla **React 18 via Babel-standalone** — no JSX build step, no
  TypeScript
- Server: **Node stdlib** + `ws` + `web-push` only. No Express, no
  frameworks.
- **Russian** for UI copy, **English** for code, comments, commits, and
  docs (this file, README, SECURITY).
- 2-space indent. Single quotes in JS/JSX. No semicolons at end of
  block-level JSX expressions.
- Prefer flat modules over deep folder trees — the project deliberately
  reads top-to-bottom.

## Crypto / wire-format changes

Anything touching [crypto.js](crypto.js), key exchange, or the relay's
message envelope needs:

1. A **threat-model note** in the PR description — what attacker
   capability changes
2. A **test** added to [tools/smoke-wire-format.js](tools/smoke-wire-format.js)
3. **Backwards-compat note**: how older clients behave against a new
   relay (and vice versa)
4. Tag a maintainer — do not self-merge

## Reporting security bugs

Please use the private channels described in [SECURITY.md](SECURITY.md).
Do not open public issues for vulnerabilities.
