# Nee2P.

> Anonymous end-to-end encrypted messenger. No accounts, no database, no plaintext on the server — ever.

Sessions are identified by a secret phrase. Share the phrase out-of-band; the server only routes encrypted blobs it cannot read.

---

## Features

- **2–8 participants** per session, configurable at creation time
- **Post-quantum crypto** — X25519 + ML-KEM-768 (FIPS 203) hybrid key exchange
- **Argon2id** KDF (t=3, m=64 MiB, p=1) — phrase never leaves the browser
- **AES-256-GCM** with a fresh 12-byte random IV per message
- **Safety Fingerprint** — SHA-256 of all public keys → 12 BIP-39 words; compare out-of-band to detect MITM
- **Dual transport** — WebSocket primary, HTTP long-poll fallback (works behind strict proxies)
- **PWA** — installable, works offline for cached assets, Web Push notifications
- **RAM-only relay** — no database, rooms vanish on TTL (1 h – 7 d, default 24 h)
- **No external CDN** — all vendor libraries vendored locally; works air-gapped

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

## Quick start

```bash
git clone https://github.com/www7man/Nee2P
cd Nee2P
npm install
npm start
# → http://127.0.0.1:8787
```

Open the URL in two browser tabs (or two devices on the same network). Create a session on one, share the phrase, join from the other.

**Environment variables**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8787`  | Port the relay listens on |
| `HOST`   | `127.0.0.1` | Bind address |

---

## Self-hosting

See [DEPLOY.md](DEPLOY.md) for a full guide: Caddy reverse proxy config, launchd plist for macOS, CDN notes, and rollback instructions.

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
server.js           — Node.js relay backend (~400 lines, no framework)
crypto.js           — all crypto primitives (Argon2id, X25519, ML-KEM, AES-GCM)
http-client.js      — HTTP long-poll transport + HushPeek helper
ws-client.js        — WebSocket transport
persistence.js      — IndexedDB session persistence
push.js             — Web Push subscription handling
sw.js               — Service Worker (network-first navigation, cache-first assets)
manifest.json       — PWA manifest
trust.html          — Transparency page: how to verify we have no backdoors
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

See [trust.html](trust.html) for a user-facing explanation with step-by-step self-verification instructions.

---

## License

[MIT](LICENSE) — © 2025 Nee2P. contributors
