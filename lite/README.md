# Nee2P Lite

**One HTML file. Zero Nee2P-controlled servers. Federated discovery via WebTorrent trackers. End-to-end post-quantum crypto.**

```
┌─────────────────────────────────────────────────────┐
│  Alice                              Bob              │
│  ─────                              ───              │
│  open nee2p-lite.html              open nee2p-lite.html
│  enter shared phrase ─────────────► same phrase      │
│       │                                 │            │
│       ▼                                 ▼            │
│   Argon2id → info_hash + PSK + AES-key              │
│       │                                 │            │
│       └─►  WebTorrent trackers (~4 public)  ◄───────┘ │
│              wss://tracker.openwebtorrent.com        │
│              wss://tracker.btorrent.xyz              │
│              wss://tracker.webtorrent.dev            │
│              ...                                     │
│       │                                 │            │
│       ▼      SDP/ICE exchange           ▼            │
│       │   (protected by PSK-HMAC)       │            │
│       │                                 │            │
│       └─► WebRTC peer-to-peer ◄─────────┘            │
│              DataChannel                             │
│              AES-256-GCM on top                      │
└─────────────────────────────────────────────────────┘
```

## What it is and how it differs from main Nee2P

Lite is an **alternative architecture** for specific scenarios — not a replacement for main Nee2P.

| | Nee2P (main) | Nee2P Lite |
|---|---|---|
| Nee2P-controlled servers | 1 relay | 0 |
| Discovery | own relay | federated WebTorrent trackers |
| Hosting | your VPS / Docker / Render | nothing to host |
| Distribution | URL: `Nee2P.com` | single HTML file |
| Async delivery | works (TTL up to 7 days) | **no** (both peers must be online) |
| Push notifications | via relay | not possible |
| Group chat | 2–8 | 2 only (MVP) |
| Voice calls | yes (WebRTC) | not yet |
| File transfer | via `/r/blob` | not yet |

## When to choose Lite

- **Maximum auditability** — one file, readable with `nano`
- **Censorship resistance** — no single point to block (4+ independent trackers)
- **Off-grid / sneakernet** — the file travels over any channel (USB, QR, email)
- **Longevity** — the file works in 10 years regardless of whether the project still exists
- **Zero server trust** — user does not trust any server, including Nee2P's

## When to choose main Nee2P

- Async messages needed (peer receives when they come back online)
- Push notifications needed
- Groups of 3–8 people
- Voice calls
- Mobile-first (iOS Safari has limitations on background WebRTC)

## How to use

1. Download `nee2p-lite.html` (from GitHub Releases, IPFS, or a friend's USB drive)
2. Open it with a double-click in your browser
3. Enter the same shared phrase as your contact
4. Wait for the connection to establish (usually 3–10 seconds)
5. Compare the 12 BIP-39 safety words over a separate channel (MITM protection)
6. Chat

## Crypto stack

Identical to main Nee2P:

- **KDF:** Argon2id (t=3, m=64MiB, p=1) from phrase → 32-byte master key
- **Discovery:** `info_hash = SHA-1(master_key)` — deterministic room ID for trackers
- **PSK:** `psk = HKDF(master_key, "nee2p-lite-psk-v1")` — prevents tracker from injecting a fake peer into the handshake
- **PQ key exchange:** X25519 (ephemeral) + ML-KEM-768 (FIPS 203) hybrid via HKDF
- **Session key:** AES-256-GCM, fresh 12-byte IV per message
- **Safety fingerprint:** SHA-256 of public keys → 12 BIP-39 words (compare out-of-band)

Domain-separated from main Nee2P via distinct HKDF info strings (`nee2p-lite.v1.*` vs `hush.v3.*`), so a same-phrase session in Lite and main Nee2P do **not** interoperate — by design.

## Tracker threat model

The tracker **sees:**
- `info_hash` — deterministic, but not reversible without the phrase (Argon2id)
- IP addresses of peers
- Encrypted SDP/ICE packets
- The moment of the handshake

The tracker **does not see:**
- The phrase
- Message contents
- Keys
- Any metadata after the handshake (everything goes peer-to-peer)

The tracker **cannot:**
- Inject a fake peer — PSK-HMAC rejects any SDP without knowledge of the phrase
- Decrypt messages — even if it MITMs the handshake, the X25519+ML-KEM session key is unreachable without the phrase
- Log content — after the WebRTC handshake, the tracker is no longer in the data path

## Known limitations

1. **Symmetric NAT (~10% of networks)** — traversal requires a TURN server. Lite uses public STUN only, no TURN. Under strict NAT the connection may fail.
2. **iOS Safari in standalone PWA mode** — WebRTC is unreliable in the background.
3. **Both peers must be online simultaneously** — if Bob opens the file 3 hours after Alice, Alice must still have the tab open.
4. **No auto-updates** — there is no service worker or auto-refresh. Users must download a new HTML file when a security fix is released.

## Files

- `nee2p-lite.html` — the single artifact. Open with a double-click.
- `README.md` — this file.

## License

MIT, same as the main project.
