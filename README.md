# Nee2P — Post-Quantum Anonymous Messenger

> No accounts. No database. No plaintext on the server. Ever.
> 2–8 people · X25519 + ML-KEM-768 · RAM-only relay · self-hostable in one Node process.

[![Release](https://img.shields.io/github/v/release/www7man/Nee2P?color=7c5cff&label=release)](https://github.com/www7man/Nee2P/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](#quick-start)
[![CI](https://github.com/www7man/Nee2P/actions/workflows/ci.yml/badge.svg)](https://github.com/www7man/Nee2P/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/docker-compose-blue?logo=docker)](#docker)
[![Live demo](https://img.shields.io/badge/demo-Nee2P.com-7c5cff)](https://Nee2P.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**🌐 Try it now: [Nee2P.com](https://Nee2P.com)** — a fresh RAM-only instance. No telemetry, no accounts. Server source = this repo.

### Self-host in 60 seconds

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/www7man/Nee2P)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https%3A%2F%2Fgithub.com%2Fwww7man%2FNee2P)
[![Run on Fly.io](https://img.shields.io/badge/Fly.io-flyctl%20launch-7c3aed?logo=hackthebox&logoColor=white)](DEPLOY.md#flyio)

Or run anywhere with Docker:

```bash
git clone https://github.com/www7man/Nee2P && cd Nee2P && docker compose up --build
# → http://127.0.0.1:8787
```

Full guide: [DEPLOY.md](DEPLOY.md) — covers Linux VPS + nginx + systemd, macOS + Caddy, CDN notes, and rollback.

<!-- TODO: record a 10-second GIF of: create session → share phrase → join → first message
     Save as docs/demo.gif and uncomment:
![Nee2P demo](docs/demo.gif)
-->

Sessions are identified by a secret phrase. Share the phrase out-of-band; the server only routes encrypted blobs it cannot read.

---

## Features

- **2–8 participants** per session, configurable at creation time
- **Post-quantum crypto** — X25519 + ML-KEM-768 (FIPS 203) hybrid key exchange
- **Argon2id** KDF (t=3, m=64 MiB, p=1) — phrase never leaves the browser
- **AES-256-GCM** with a fresh 12-byte random IV per message
- **Safety Fingerprint** — SHA-256 of all public keys → 12 BIP-39 words; compare out-of-band to detect MITM
- **Dual transport** — WebSocket primary, HTTP long-poll fallback (works behind strict proxies)
- **WebRTC voice calls** — peer-to-peer, encrypted, no relay touches audio
- **PWA** — installable, works offline for cached assets, Web Push notifications
- **RAM-only relay** — no database, rooms vanish on TTL (1 h – 7 d, default 24 h)
- **No external CDN** — all vendor libraries vendored locally; works air-gapped

---

## How it compares

|                            |  Nee2P  | Session | SimpleX | Briar |
|----------------------------|:-------:|:-------:|:-------:|:-----:|
| No accounts / phone number |   ✅    |   ✅    |   ✅    |  ✅   |
| No database on the server  |   ✅    |   ❌    |   ❌    |  n/a  |
| Post-quantum crypto        |   ✅    |   ❌    |   ✅    |  ❌   |
| Self-host in one process   |   ✅    |   ❌    |   ⚠️    |  ❌   |
| Runs in any browser        |   ✅    |   ❌    |   ❌    |  ❌   |
| Group size                 |  2–8    |  100+   |   50+   | small |
| Server source code size    | ~1500 LOC |  large |  large  |  n/a  |

---

## Crypto stack

```
phrase
  └─ Argon2id(t=3, m=65536, p=1, salt=room-id) → ikm
       └─ HKDF-SHA-256 → base_key

per-session ECDH:
  X25519 keypair  ──┐
  ML-KEM-768      ──┴─ HKDF-SHA-256(X25519_shared || mlkem_shared || base_key) → session_key

messages:
  AES-256-GCM(session_key, iv=crypto.getRandomValues(12 bytes))
  server receives: { iv: <base64>, ct: <base64> }  — no plaintext, ever
```

Group sessions use a sender-keys protocol: each participant derives a pairwise HKDF key with every other member and distributes their sender key encrypted to each pair.

---

## Local development

```bash
git clone https://github.com/www7man/Nee2P
cd Nee2P
npm install
npm start
# → http://127.0.0.1:8787
```

Open the URL in two browser tabs (or two devices on the same network). Create a session on one, share the phrase, join from the other.

For production self-host see [Self-host in 60 seconds](#self-host-in-60-seconds) above or [DEPLOY.md](DEPLOY.md) for the full guide.

### Environment variables

See [.env.example](.env.example) for the full reference.

| Variable      | Default      | Description                                   |
|---------------|--------------|-----------------------------------------------|
| `PORT`        | `8787`       | Port the relay listens on                     |
| `HOST`        | `127.0.0.1`  | Bind address                                  |
| `ADMIN_KEY`   | `nee2p-admin-local` | Auth header for `/r/admin/stats`       |

Web Push VAPID keys are read from `~/.nee2p-vapid.json` — generate once with `npx web-push generate-vapid-keys` and write the JSON manually. Push is optional.

---

## Self-hosting

[DEPLOY.md](DEPLOY.md) covers four paths in detail:

- **One-click cloud** — Render, Fly.io, Railway (configs in repo: `render.yaml`, `fly.toml`, `railway.json`)
- **Docker** — `docker compose up -d --build` behind any reverse proxy
- **Linux VPS** — nginx + systemd + Let's Encrypt (the classic stack)
- **macOS** — Caddy + launchd (for relays running at home)

All paths end up at the same `~50 MB` Node process listening on one port. The relay has no database, so updates and rollbacks are stateless.

---

## Server API

The relay is a thin message bus. It never stores or logs message content.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/ws?room=<hex32>` | WebSocket upgrade — primary transport |
| `PUT`  | `/r/claim` | Claim a slot in a room (HTTP fallback) |
| `PUT`  | `/r/send`  | Send an encrypted message |
| `GET`  | `/r/poll`  | Long-poll for new messages |
| `GET`  | `/r/stream`| SSE stream for new messages |
| `PUT`  | `/r/peek`  | Read-only probe: returns `{exists, groupMax, claimed, online}` without claiming a slot |

---

## Project structure

```
index.html          — shell, loads vendor libs + JSX app
nee2p-app.jsx       — root React component, state machine
nee2p-screens.jsx   — screen components (Welcome, Created, Join, Chat, …)
nee2p-ui.jsx        — design system (GlassButton, palette, icons, …)
server.js           — Node.js relay backend (~1500 lines, no framework)
crypto.js           — all crypto primitives (Argon2id, X25519, ML-KEM, AES-GCM)
http-client.js      — HTTP long-poll transport + HushPeek helper
ws-client.js        — WebSocket transport
webrtc.js           — WebRTC peer-to-peer audio calls
persistence.js      — IndexedDB session persistence
push.js             — Web Push subscription handling
sw.js               — Service Worker (network-first navigation, cache-first assets)
manifest.json       — PWA manifest
trust.html          — Transparency page: how to verify we have no backdoors
admin.html          — Admin dashboard (rooms, sessions, blobs, uptime)
vendor/             — Vendored libs (React, Babel, Argon2, ML-KEM, noble-ed25519, BIP-39)
tools/              — Dev utilities (icon generator, wire-format smoke test)
```

---

## Security model

**What the server sees:** room ID (MD5 of phrase), slot index, `{iv, ct}` blobs, timestamps.

**What the server cannot see:** the phrase, any key material, plaintext messages, participant identity.

**Trust boundary:** the server is fully compromised → attacker still cannot read past messages (no key material stored) and cannot impersonate participants (Safety Fingerprint detects key substitution).

**Limitations:**
- Anonymity at the network level requires Tor or a VPN — the server sees IP addresses.
- If your browser or OS is compromised, no application-layer crypto helps.
- The phrase is the shared secret — choose one that is hard to guess and share it over a separate channel.

See [trust.html](trust.html) for a user-facing explanation with step-by-step self-verification instructions, and [SECURITY.md](SECURITY.md) for the disclosure policy.

---

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop, code style, and good-first-issue ideas. Crypto / wire-format changes have a higher bar; everything else is fair game.

---

## License

[MIT](LICENSE) — © 2025 Nee2P. contributors
