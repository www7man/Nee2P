# hush.

Anonymous paired messenger. No accounts. Pair by a secret phrase or by its MD5 hash. End-to-end encrypted with AES-256-GCM; the server only sees ciphertext + per-message IV.

## Stack

- Frontend: vanilla HTML + React (via CDN) + JSX compiled in-browser by Babel. WebCrypto for crypto.
- Backend: ~100-line Node http server with WebSocket upgrade (`ws` package). It serves the static files and acts as a relay between exactly two sockets per room.
- No database. Rooms exist only while at least one peer is connected. Messages live only in browser memory and self-destruct when the session timer expires (24 h).

## Run

```bash
cd "Desktop/проекты /2Pee"
npm install
npm start
```

Then open `http://localhost:8787` in two browser windows (or two devices on the same network — replace `localhost` with your LAN IP). Create a session in one, copy the phrase or hash, and join from the other.

`PORT` env var overrides the default `8787`.

## Flow

1. **Welcome** — three actions: create, join, or read the security info.
2. **Create** — pick "случайно" (auto-generated seed) or "своя фраза". The 32-hex MD5 is shown; share either the phrase or the hash. A 5-min grace timer cancels the session if nobody joins.
3. **Join** — enter the phrase or the hash; the client detects which.
4. **Password** — each side sets a local password (≥4 chars). This is a per-device lock, not part of the encryption key.
5. **Waiting** — once both sides "seal", the server emits `paired` and the chat opens.
6. **Chat** — real-time E2E messages, presence, typing indicator, 24 h self-destruct timer with a top progress bar.

## Crypto

- Both sides derive the same AES-256-GCM key from the room's MD5 hash via PBKDF2-SHA-256 with 200 000 iterations and a fixed salt `"hush.v1.salt"`.
- Each message uses a fresh 12-byte IV. The server relays `{type: 'msg', iv, ct}` blobs blindly.
- "Two passwords" is a UX gate — not part of the key. (Mixing each peer's local password into the key would mean an offline peer's lost password destroys the conversation forever, which would conflict with both peers being able to read history independently.)

## Protocol (WebSocket)

```
GET /ws?room=<32-hex>

server → client:
  { type: 'welcome',  isFirst: bool }
  { type: 'peer-already-here' }
  { type: 'peer-joined' }
  { type: 'peer-sealed' }
  { type: 'paired',   startedAt: <ms> }
  { type: 'peer-left' }
  { type: 'room-full' }     (server then closes the socket)

client → server (relayed verbatim to the peer):
  { type: 'msg',    iv: <b64>, ct: <b64>, time: 'HH:MM' }
  { type: 'typing', on: bool }

client → server (terminating):
  { type: 'seal' }          (server emits peer-sealed + maybe paired)
```

## Limits

- Two peers per room. A third connection gets `room-full` and is closed.
- No reconnect logic on the client. If the socket drops mid-chat, current implementation shows "партнёр отключился" and waits. Refresh to start over.
- MD5 is used as the room identifier per the design — it gives roughly 128 bits of entropy, which is fine for a rendezvous string but isn't a defense-grade collision-resistant hash. The AES key itself is derived through PBKDF2 with 200 k iterations.
