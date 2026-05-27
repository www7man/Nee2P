// server.js — Nee2P. relay. Dual transport.
//
// Primary transport (used in prod through Yandex CDN that strips WS upgrade):
//   POST /r/claim  body {room, passwordHash, ttlMs?, groupMax?}
//        → {ok, slot, mode, sessionToken, createdAt, expiresAt, ttlMs,
//           slots, paired, groupMax, peers, batch?}
//   POST /r/send   body {token, type:'msg'|'typing'|'ack'|'leave'|..., ...payload}
//        → {ok}
//   GET  /r/poll?token=...        → {ok:true, events:[...]} (long-poll up to 25s)
//
// Secondary transport (for direct testing without CDN):
//   WS   /ws?room=...    same protocol as before (claim, msg, ack, typing, leave)
//
// Both transports share Room state + the per-slot offline queue. Sessions are
// HTTP-specific; WS sockets are their own. The relay never sees plaintext —
// it only relays {iv, ct} blobs and SHA-256 passwordHashes.
//
// ─── Group chat (2–8 participants) ────────────────────────────
//
// Slots are now an Array of length `groupMax` (default 2 for backward compat).
// The first claimer's `groupMax` (when >2) is sticky on the Room — subsequent
// claims must match (server returns reason:'groupMax-mismatch' otherwise).
//
// Wire format for slot identifiers:
//   • `groupMax === 2` rooms emit LETTER slot ids ('A'/'B') — bit-for-bit
//     compatible with pre-group clients. mySlot stored as number 0/1 in the
//     UI but converted at the wire boundary.
//   • `groupMax > 2` rooms emit NUMERIC slot ids (0..groupMax-1).
//
// New clients accept both forms transparently (toSlotId()/parseSlotId() in
// this file, coerceSlot() in nee2p-app.jsx).
//
// Sender-keys protocol (post-FS, per-epoch):
//   Each member ships a per-session X25519 pubKey + ML-KEM-768 pubKey at claim
//   (as before). The relay forwards everyone's pubkeys to everyone else (peer-
//   pubkey events for each peer). Each pair derives a pairwise key via existing
//   ECDH+KEM+phrase HKDF. That pairwise key is used ONLY to securely deliver
//   each member's SENDER KEY (a 32-byte random AES-GCM secret) to every other
//   member via a new `sender-key` envelope. Regular messages are then encrypted
//   ONCE with the sender's sender-key and broadcast to everyone — recipients
//   look up the cached sender-key for `from` slot to decrypt.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { spawn, execSync } = require('child_process');
const dns = require('dns');
const webpush = require('web-push');

// Process-level error guards. Goal: keep relay running on transient errors
// (broken sockets, push-provider hiccups, malformed inputs from the wild),
// log them so we can audit later, and let launchd's KeepAlive only kick in
// on a REAL crash (e.g. a SIGSEGV or an explicit process.exit). Logs land
// in ~/Library/Logs/nee2p-relay.err.log per the launchd plist.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err && err.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err && err.stack || err);
});

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

// ── Quick Tunnel state ────────────────────────────────────────────────────────
let tunnelProc      = null;
let tunnelUrl       = null;
let tunnelStatus    = 'stopped';  // 'stopped' | 'starting' | 'running' | 'error'
let tunnelError     = null;
let tunnelStartedAt = null;
let tunnelProvider  = 'cloudflared';
let tunnelLog       = [];
const TUNNEL_LOG_MAX = 30;

// npx lives next to the node binary (works for Homebrew / nvm / system Node).
const NPX_BIN = path.join(path.dirname(process.execPath), 'npx');

// ── Supported tunnel providers ─────────────────────────────────────────────────
// Each entry describes: how to spawn the process, what URL pattern to look for,
// and whether the provider needs working DNS (cloudflared SRV lookup) or not.
// SSH-based providers (localhost.run, serveo) and localtunnel use plain TCP/WSS
// → unaffected by V2Box DNS hijacking.
const TUNNEL_PROVIDERS = {
  cloudflared: {
    label:    'Cloudflare',
    domain:   '*.trycloudflare.com',
    urlRe:    /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
    dnsCheck: true,   // needs _v2-origintunneld._tcp.argotunnel.com SRV
    makeProc: (port) => spawn(
      process.env.CLOUDFLARED_PATH || 'cloudflared',
      ['tunnel', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    ),
    notFoundHint: 'Установите cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  },
  localtunnel: {
    label:    'localtunnel',
    domain:   '*.loca.lt',
    urlRe:    /https:\/\/[a-z0-9-]+\.loca\.lt/,
    dnsCheck: false,  // WSS over HTTPS, no SRV lookup
    makeProc: (port) => spawn(
      NPX_BIN, ['--yes', 'localtunnel', '--port', String(port)],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    ),
    notFoundHint: 'npx не найден — нужен Node.js ≥ 16.',
  },
  'localhost.run': {
    label:    'localhost.run',
    domain:   '*.localhost.run',
    urlRe:    /https?:\/\/[a-z0-9-]+\.localhost\.run/,
    dnsCheck: false,  // pure SSH TCP:22
    makeProc: (port) => spawn(
      'ssh',
      ['-R', `80:127.0.0.1:${port}`,
       '-o', 'StrictHostKeyChecking=no',
       '-o', 'UserKnownHostsFile=/dev/null',
       '-o', 'ServerAliveInterval=15',
       '-o', 'ConnectTimeout=20',
       'nokey@localhost.run'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    ),
    notFoundHint: 'ssh не найден.',
  },
  serveo: {
    label:    'serveo.net',
    domain:   '*.serveo.net',
    urlRe:    /https?:\/\/[a-z0-9-]+\.serveo\.net/,
    dnsCheck: false,  // pure SSH TCP:22
    makeProc: (port) => spawn(
      'ssh',
      ['-R', `80:127.0.0.1:${port}`,
       '-o', 'StrictHostKeyChecking=no',
       '-o', 'UserKnownHostsFile=/dev/null',
       '-o', 'ServerAliveInterval=15',
       '-o', 'ConnectTimeout=20',
       'serveo.net'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    ),
    notFoundHint: 'ssh не найден.',
  },
};

function tunnelLogPush(line) { tunnelLog.push(line); if (tunnelLog.length > TUNNEL_LOG_MAX) tunnelLog.shift(); }
process.on('exit', () => { try { if (tunnelProc) tunnelProc.kill(); } catch {} });

const ONE_HOUR = 3600 * 1000;
const MIN_TTL_MS = ONE_HOUR;
const MAX_TTL_MS = 7 * 24 * ONE_HOUR;
const DEFAULT_TTL_MS = 24 * ONE_HOUR;
// Per-room conversation log (kept in RAM only — never persisted to disk).
// Both sides see the whole log on reconnect, so a tab reload doesn't lose
// the history while the session is alive. Capped to protect memory.
const MAX_HISTORY_ITEMS = 1000;
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;

const SESSION_IDLE_MS = 60 * 1000;          // session goes "offline" after 60s of no activity
const POLL_HOLD_MS = 25 * 1000;             // long-poll hangs this long if no events
const SESSION_GC_INTERVAL = 10 * 1000;

const MAX_HTTP_BODY = 512 * 1024;

// Hard ceiling on number of live rooms. Past this point new claims for unknown
// roomIds are refused with `relay-full`. Existing room claims (restores, peer
// joins) continue to work. Sized very generously — hitting it implies abuse.
const MAX_ROOMS = 50000;

// Per-IP throttle on NEW-ROOM creations (kept separate from the general r/*
// token bucket so high-volume legitimate use doesn't deplete this counter).
// Map<ip, {count, windowStart}>; window resets every CLAIM_IP_WINDOW_MS.
const CLAIM_IP_WINDOW_MS = 5 * 60 * 1000;
const CLAIM_IP_MAX = 20;
const CLAIM_IP_BUCKET = new Map();
function claimIpAllow(ip) {
  const now = Date.now();
  let b = CLAIM_IP_BUCKET.get(ip);
  if (!b || now - b.windowStart > CLAIM_IP_WINDOW_MS) {
    b = { count: 0, windowStart: now };
    CLAIM_IP_BUCKET.set(ip, b);
  }
  if (b.count >= CLAIM_IP_MAX) return false;
  b.count += 1;
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - CLAIM_IP_WINDOW_MS;
  for (const [ip, b] of CLAIM_IP_BUCKET) if (b.windowStart < cutoff) CLAIM_IP_BUCKET.delete(ip);
}, 60 * 1000);

// Group bounds — valid sizes pinned to the radio choices in CreatedScreen.
const VALID_GROUP_SIZES = new Set([2, 3, 4, 6, 8]);
const DEFAULT_GROUP_MAX = 2;
const MAX_GROUP_MAX = 8;

// ─── encrypted blob storage (images / files / voice) ────────
// Per-blob ≤ 5 MB; per-room rolling cap 50 MB (LRU evict); relay-wide cap
// 200 MB → 507. Bytes are pure ciphertext as far as the relay is concerned —
// the AES-GCM IV + tag live inside the corresponding msg envelope.
const MAX_BLOB_BYTES   = 5  * 1024 * 1024;
const MAX_ROOM_BLOB_BYTES  = 50  * 1024 * 1024;
const MAX_RELAY_BLOB_BYTES = 200 * 1024 * 1024;
let RELAY_BLOB_BYTES = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.jsx':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ─── VAPID / Web Push bootstrap ──────────────────────────────
// Keys are persisted in the user's home so launchd restarts don't generate
// fresh ones (which would invalidate every existing browser subscription).
const VAPID_PATH = path.join(os.homedir(), '.nee2p-vapid.json');
let VAPID_PUBLIC_KEY = '';
let VAPID_PRIVATE_KEY = '';
try {
  if (fs.existsSync(VAPID_PATH)) {
    const raw = JSON.parse(fs.readFileSync(VAPID_PATH, 'utf8'));
    if (raw && raw.publicKey && raw.privateKey) {
      VAPID_PUBLIC_KEY = raw.publicKey;
      VAPID_PRIVATE_KEY = raw.privateKey;
    }
  }
} catch (e) {
  console.warn('vapid: failed to read', VAPID_PATH, e.message);
}
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  const k = webpush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = k.publicKey;
  VAPID_PRIVATE_KEY = k.privateKey;
  try {
    fs.writeFileSync(VAPID_PATH, JSON.stringify({
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
      generatedAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });
    console.log('vapid: generated new keypair at', VAPID_PATH);
  } catch (e) {
    console.warn('vapid: failed to persist', VAPID_PATH, e.message);
  }
}
try {
  webpush.setVapidDetails('mailto:nee2p@local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (e) {
  console.warn('vapid: setVapidDetails failed', e.message);
}

// ─── shared state ────────────────────────────────────────────
const rooms = new Map();
// O(1) lookup for HTTP session token → {sess, room}. Without this every
// send/poll scanned every room.
const tokenIndex = new Map();

// ─── slot identifier helpers ─────────────────────────────────
// On the wire we use letters ('A','B') for legacy 2-party rooms and numbers
// (0..N-1) for groups. Internally everywhere — Room.slots indices, sess.slot,
// from/peer fields — slots are NUMBERS. These helpers translate at the edge.
function toSlotId(slotNum, groupMax) {
  if (groupMax === 2) return slotNum === 0 ? 'A' : 'B';
  return slotNum;
}
function parseSlotId(v) {
  // Tolerant inverse: accept 'A'/'B', 0/1/.../N, or numeric strings.
  if (typeof v === 'number' && Number.isFinite(v)) return v | 0;
  if (typeof v === 'string') {
    if (v === 'A') return 0;
    if (v === 'B') return 1;
    if (/^\d+$/.test(v)) return parseInt(v, 10);
  }
  return null;
}

class Room {
  constructor(id, groupMax) {
    this.id = id;
    this.createdAt = Date.now();
    this.ttlMs = DEFAULT_TTL_MS;
    this.expiresAt = this.createdAt + this.ttlMs;
    this.groupMax = VALID_GROUP_SIZES.has(groupMax) ? groupMax : DEFAULT_GROUP_MAX;
    // slots[i] = null (free) | {passwordHash, sealed:true, pubKey, kemPubKey}
    this.slots = new Array(this.groupMax).fill(null);
    this.pairedAt = null;
    this.sockets = new Set();          // for WS — each socket carries {ws, slot:number}
    this.sessions = new Map();          // sessionToken → SessionEntry (for HTTP)
    this.history = [];                  // full conversation log (RAM-only)
    this.historyBytes = 0;
    // Encrypted blobs (images / files / voice). Keys are random hex blobIds.
    // Insertion order = LRU order (Map preserves it). When room hits the
    // per-room cap we evict from the head until back under.
    this.blobs = new Map();             // blobId → {bytes:Buffer, mime, size, addedAt}
    this.totalBlobBytes = 0;
    // Forward-secrecy bookkeeping. Bumped each time any slot's pubKey is
    // (re)published; we tag every stored history item with the current epoch
    // so the client knows which session key it was encrypted under.
    this.epoch = 0;
  }
  occupants() {
    // Backward-compat for 2-party rooms: emit the historic {A:{...}, B:{...}}
    // shape so old clients keep working. Group rooms emit an Array.
    if (this.groupMax === 2) {
      return {
        A: this.slots[0] ? { claimed: true, sealed: this.slots[0].sealed } : { claimed: false, sealed: false },
        B: this.slots[1] ? { claimed: true, sealed: this.slots[1].sealed } : { claimed: false, sealed: false },
      };
    }
    return this.slots.map(s => s
      ? { claimed: true, sealed: s.sealed }
      : { claimed: false, sealed: false });
  }
  isPaired() {
    // "paired" for groups means: every slot is filled & sealed.
    for (const s of this.slots) if (!s || !s.sealed) return false;
    return true;
  }
  isSlotOnline(slotNum) {
    const now = Date.now();
    for (const s of this.sockets) if (s.slot === slotNum) return true;
    for (const sess of this.sessions.values()) {
      if (sess.slot === slotNum && (now - sess.lastSeen) < SESSION_IDLE_MS) return true;
    }
    return false;
  }
}

// SessionEntry: { token, roomId, slot (number), lastSeen, pendingEvents: [], pollWaiter, wasOnline }

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Extract the session token from `Authorization: Bearer ...` (preferred — keeps
// it out of CDN access logs) and fall back to the legacy `?token=` URL param so
// older clients keep working during the transition.
function getToken(req, url) {
  const h = req.headers['authorization'];
  if (typeof h === 'string' && h.startsWith('Bearer ')) {
    const t = h.slice(7).trim();
    if (t) return t;
  }
  return url.searchParams.get('token');
}

function appendHistory(room, item) {
  room.history.push(item);
  room.historyBytes += item.bytes;
  while (room.history.length > MAX_HISTORY_ITEMS || room.historyBytes > MAX_HISTORY_BYTES) {
    const dropped = room.history.shift();
    if (!dropped) break;
    room.historyBytes -= dropped.bytes;
  }
}

function destroyRoom(id) {
  const room = rooms.get(id);
  if (!room) return;
  for (const s of room.sockets) {
    try { s.ws.send(JSON.stringify({ type: 'room-expired' })); s.ws.close(); } catch {}
  }
  for (const sess of room.sessions.values()) {
    tokenIndex.delete(sess.token);
    pushEvent(sess, { type: 'room-expired' });
  }
  // Reclaim blob bytes from the relay-wide counter so a churn of rooms doesn't
  // leave the global cap permanently inflated.
  if (room.totalBlobBytes) {
    RELAY_BLOB_BYTES = Math.max(0, RELAY_BLOB_BYTES - room.totalBlobBytes);
    room.totalBlobBytes = 0;
    room.blobs.clear();
  }
  rooms.delete(id);
}

// ─── session push / poll / stream ────────────────────────────
function pushEvent(session, event) {
  // SSE stream — preferred. Push the event straight onto the open connection
  // so there's no per-event round-trip gap.
  if (session.streamRes && !session.streamRes.writableEnded) {
    try {
      session.streamRes.write('data: ' + JSON.stringify(event) + '\n\n');
      session.lastSeen = Date.now();
      return;
    } catch {
      // Broken socket — drop the ref so subsequent events skip straight to the
      // pollWaiter fallback instead of throwing on each push.
      session.streamRes = null;
    }
  }
  // legacy long-poll path
  session.pendingEvents.push(event);
  if (session.pollWaiter) {
    clearTimeout(session.pollWaiter.timeout);
    const w = session.pollWaiter;
    session.pollWaiter = null;
    const events = session.pendingEvents.splice(0);
    w.resolve(events);
  }
  // Web Push fallback: peer's tab has no live stream → poke them with a
  // generic notification. The relay only sees ciphertext — we forward the
  // original encrypted msg envelope so a persistence-enabled SW can unwrap
  // and decrypt the body locally with the IndexedDB-cached session key.
  if (event && event.type === 'msg' && !session.streamRes && session.pushSubscription) {
    fireWebPush(session, event).catch(() => {});
  }
}

async function fireWebPush(session, msgEvent) {
  if (!session.pushSubscription) return;
  // FIX 6: use a stable per-session random tag instead of leaking the roomId
  // prefix. The push provider sees this tag and could otherwise correlate
  // notifications across the same session. `pushTag` is set at subscribe time
  // (crypto-random 12 hex chars); fall back to 'nee2p' for legacy sessions.
  //
  // Preview-decryption pipeline:
  // We forward the encrypted msg envelope inside `enc`. The push provider's
  // outer ciphertext (web-push sealed to subscription.p256dh+auth) wraps this
  // entire JSON; the SW unwraps the outer, then if it finds a cached
  // sessionKey for `enc.roomId` in IndexedDB, decrypts `enc.ct` with `enc.iv`
  // to show a real message preview. If anything is missing/stale, the SW
  // falls back to `body`. The relay still cannot read plaintext.
  //
  // Web Push payload ceiling: most providers enforce ~4KB encrypted, which
  // works out to ~3KB plaintext after AES-128-GCM + sealed-box overhead. If
  // the encrypted msg (ct + ivCt) won't fit, drop `enc` and ship the generic
  // body — the receiver will still see "новое сообщение" and the unread badge.
  const PAYLOAD_CEILING = 3000;
  const base = {
    title: 'Nee2P.',
    body: 'новое сообщение',
    tag: session.pushTag || 'nee2p',
    url: '/2Pee/',
  };
  let payload;
  if (msgEvent && typeof msgEvent.iv === 'string' && typeof msgEvent.ct === 'string') {
    const enc = {
      roomId: session.roomId,
      iv: msgEvent.iv,
      ct: msgEvent.ct,
      from: msgEvent.from,
      epoch: msgEvent.epoch,
      time: msgEvent.time,
      id: msgEvent.id,
    };
    // ivCt only present for blob bubbles (separate AES-GCM payload carrying
    // time + private blobMeta — see handleOne()).
    if (typeof msgEvent.ivCt === 'string') enc.ivCt = msgEvent.ivCt;
    if (msgEvent.blob && typeof msgEvent.blob === 'object') {
      enc.blob = {
        blobId:     msgEvent.blob.blobId,
        mime:       msgEvent.blob.mime,
        size:       msgEvent.blob.size,
        kind:       msgEvent.blob.kind,
        durationMs: msgEvent.blob.durationMs,
      };
    }
    const withEnc = JSON.stringify({ ...base, enc });
    if (Buffer.byteLength(withEnc, 'utf8') <= PAYLOAD_CEILING) {
      payload = withEnc;
    } else {
      payload = JSON.stringify(base);
    }
  } else {
    payload = JSON.stringify(base);
  }
  try {
    // FIX 4: cap the push round-trip at 5s. The web-push lib will otherwise
    // hang indefinitely on a stalled provider (FCM/APNs/Mozilla autopush) and
    // pile up. Promise.race lets the rest of the fan-out keep moving.
    await Promise.race([
      webpush.sendNotification(session.pushSubscription, payload, { TTL: 60 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('push-timeout')), 5000)),
    ]);
  } catch (err) {
    const code = err && err.statusCode;
    if (code === 404 || code === 410) {
      // subscription dead — drop it so we stop trying
      session.pushSubscription = null;
    } else {
      console.warn('webpush send error', code || (err && err.message) || err);
    }
  }
}

function broadcastEventToRoom(room, event, exceptToken) {
  for (const sess of room.sessions.values()) {
    if (sess.token === exceptToken) continue;
    pushEvent(sess, event);
  }
}

// also broadcast to live WS sockets so both transports stay in sync
function broadcastWS(room, obj, exceptWs) {
  for (const s of room.sockets) {
    if (s.ws === exceptWs) continue;
    try { s.ws.send(JSON.stringify(obj)); } catch {}
  }
}

function broadcastAll(room, event, except) {
  // except can be {token} or {ws}
  broadcastEventToRoom(room, event, except && except.token);
  broadcastWS(room, event, except && except.ws);
}

// Send `event` to a specific slot (across HTTP sessions + WS sockets).
function sendToSlot(room, slotNum, event) {
  for (const sess of room.sessions.values()) {
    if (sess.slot === slotNum) pushEvent(sess, event);
  }
  for (const s of room.sockets) {
    if (s.slot === slotNum) { try { s.ws.send(JSON.stringify(event)); } catch {} }
  }
}

// Send `event` to every slot EXCEPT slotNum.
function broadcastToOthers(room, exceptSlotNum, event) {
  for (const sess of room.sessions.values()) {
    if (sess.slot === exceptSlotNum) continue;
    pushEvent(sess, event);
  }
  for (const s of room.sockets) {
    if (s.slot === exceptSlotNum) continue;
    try { s.ws.send(JSON.stringify(event)); } catch {}
  }
}

// ─── claim helper used by both transports ────────────────────
//   Returns { result, batch?, justPaired, room, slot, pubKeyChanged }
//     result = the claim-result message body to deliver to the claimer.
//     pubKeyChanged = true when the slot's pubKey was added or replaced —
//     callers should broadcast peer-pubkey events to all other slots.
function performClaim(roomId, m) {
  if (typeof m.passwordHash !== 'string' || !/^[a-f0-9]{64}$/.test(m.passwordHash)) {
    return { result: { type: 'claim-result', ok: false, reason: 'bad-hash' } };
  }
  // Optional pubKey: base64-encoded raw X25519 (32 bytes → 44 chars b64). We
  // don't fail the claim if it's malformed — just ignore it (backward-compat
  // with old clients that don't know about forward secrecy).
  let pubKeyB64 = null;
  if (typeof m.pubKey === 'string' && /^[A-Za-z0-9+/=]{40,80}$/.test(m.pubKey)) {
    pubKeyB64 = m.pubKey;
  }
  // Optional kemPubKey: base64-encoded ML-KEM-768 public key (1184 bytes →
  // ~1580 chars b64). Same backward-compat policy: malformed → ignored, and
  // claim still succeeds (peer just gets pre-quantum X25519+phrase mode).
  let kemPubKeyB64 = null;
  if (typeof m.kemPubKey === 'string' && /^[A-Za-z0-9+/=]{1200,2000}$/.test(m.kemPubKey)) {
    kemPubKeyB64 = m.kemPubKey;
  }

  // Validate / default groupMax.
  let requestedGroupMax = null;
  if (typeof m.groupMax === 'number' && Number.isFinite(m.groupMax)) {
    if (!VALID_GROUP_SIZES.has(m.groupMax)) {
      return { result: { type: 'claim-result', ok: false, reason: 'bad-group-max' } };
    }
    requestedGroupMax = m.groupMax;
  }

  let room = rooms.get(roomId) || null;
  if (room && room.expiresAt <= Date.now()) { destroyRoom(roomId); room = null; }

  if (!room) {
    // Global ceiling on simultaneous live rooms. We re-check rooms.has(roomId)
    // out of paranoia even though `room` was just null — destroyRoom above
    // ensures the entry is gone, and creating with a duplicate id is benign.
    if (rooms.size >= MAX_ROOMS && !rooms.has(roomId)) {
      return { result: { type: 'claim-result', ok: false, reason: 'relay-full' } };
    }
    // First claim creates the room and locks in groupMax (default 2).
    const gm = requestedGroupMax || DEFAULT_GROUP_MAX;
    room = new Room(roomId, gm);
    if (typeof m.ttlMs === 'number' && Number.isFinite(m.ttlMs)) {
      room.ttlMs = Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.floor(m.ttlMs)));
      room.expiresAt = room.createdAt + room.ttlMs;
    }
    rooms.set(roomId, room);
  } else if (requestedGroupMax !== null && requestedGroupMax !== room.groupMax) {
    // Subsequent claim with a conflicting groupMax. We don't let one client
    // silently mutate room size — they probably typed the wrong number.
    return { result: { type: 'claim-result', ok: false, reason: 'groupMax-mismatch' } };
  }

  // existing slot? (restore-by-passwordHash)
  let restored = -1;
  for (let i = 0; i < room.slots.length; i++) {
    if (room.slots[i] && room.slots[i].passwordHash === m.passwordHash) { restored = i; break; }
  }

  if (restored >= 0) {
    let pubKeyChanged = false;
    if (pubKeyB64 && room.slots[restored].pubKey !== pubKeyB64) {
      room.slots[restored].pubKey = pubKeyB64;
      room.epoch += 1;
      pubKeyChanged = true;
    }
    // KEM pubkey: store/replace alongside the X25519 pubKey. Changing it
    // doesn't independently bump the epoch (the X25519 swap already does),
    // but storing here lets the peer-pubkey broadcast carry it.
    if (kemPubKeyB64 && room.slots[restored].kemPubKey !== kemPubKeyB64) {
      room.slots[restored].kemPubKey = kemPubKeyB64;
      if (!pubKeyChanged) { room.epoch += 1; pubKeyChanged = true; }
    }
    return {
      result: {
        type: 'claim-result', ok: true,
        slot: toSlotId(restored, room.groupMax),
        mode: 'restored',
        createdAt: room.createdAt, expiresAt: room.expiresAt, ttlMs: room.ttlMs,
        slots: room.occupants(), paired: room.isPaired(),
        groupMax: room.groupMax,
        peers: listPeersFor(room, restored),
        // Legacy 2-party convenience fields (kept for old clients).
        peerPubKey: room.groupMax === 2 ? (room.slots[1 - restored]?.pubKey || null) : null,
        peerKemPubKey: room.groupMax === 2 ? (room.slots[1 - restored]?.kemPubKey || null) : null,
        epoch: room.epoch,
      },
      batch: room.history.slice(),
      room, slot: restored, justPaired: false, pubKeyChanged,
    };
  }

  // first-free slot
  let slot = -1;
  for (let i = 0; i < room.slots.length; i++) {
    if (!room.slots[i]) { slot = i; break; }
  }
  if (slot < 0) {
    // every slot taken AND passwordHash didn't match any of them → locked.
    return { result: { type: 'claim-result', ok: false, reason: 'locked' } };
  }

  room.slots[slot] = {
    passwordHash: m.passwordHash, sealed: true,
    pubKey: pubKeyB64, kemPubKey: kemPubKeyB64,
  };
  let pubKeyChanged = false;
  if (pubKeyB64 || kemPubKeyB64) {
    room.epoch += 1;
    pubKeyChanged = true;
  }
  const justPaired = room.isPaired() && !room.pairedAt;
  if (justPaired) room.pairedAt = Date.now();

  return {
    result: {
      type: 'claim-result', ok: true,
      slot: toSlotId(slot, room.groupMax),
      mode: 'claimed',
      createdAt: room.createdAt, expiresAt: room.expiresAt, ttlMs: room.ttlMs,
      slots: room.occupants(), paired: room.isPaired(),
      groupMax: room.groupMax,
      peers: listPeersFor(room, slot),
      // Legacy 2-party convenience fields (kept for old clients).
      peerPubKey: room.groupMax === 2 ? (room.slots[1 - slot]?.pubKey || null) : null,
      peerKemPubKey: room.groupMax === 2 ? (room.slots[1 - slot]?.kemPubKey || null) : null,
      epoch: room.epoch,
    },
    batch: room.history.slice(),
    room, slot, justPaired, pubKeyChanged,
  };
}

// Build the peers[] array delivered in claim-result. One entry per OTHER
// currently-occupied slot with whatever public keys we have for them. The
// claimer uses this to start the sender-key handshake immediately, without
// waiting on the per-peer peer-pubkey events (which still fire — both paths
// are idempotent on the client).
function listPeersFor(room, mySlotNum) {
  const peers = [];
  for (let i = 0; i < room.slots.length; i++) {
    if (i === mySlotNum) continue;
    const s = room.slots[i];
    if (!s) continue;
    peers.push({
      slot: toSlotId(i, room.groupMax),
      pubKey: s.pubKey || null,
      kemPubKey: s.kemPubKey || null,
    });
  }
  return peers;
}

// Broadcast peer-pubkey events whenever a slot's pubKey was added or replaced.
// One event per (recipient, target) — i.e. when slot X publishes a pubkey we
// tell EACH other slot "here is slot X's pubkey for epoch N". On the legacy
// 2-party path that's a single event per peer (one direction). For groups it
// fans out to (N-1) events per change.
//
// The event also carries `kemPubKey` so the receiver (if they have a KEM
// keypair) can encapsulate / decapsulate to derive the pairwise PQ shared.
function broadcastPubKeyChange(room) {
  const epoch = room.epoch;
  // For each (target, recipient) pair where target has a pubkey AND
  // recipient !== target, push one peer-pubkey event.
  for (let target = 0; target < room.slots.length; target++) {
    const t = room.slots[target];
    if (!t || (!t.pubKey && !t.kemPubKey)) continue;
    for (let recipient = 0; recipient < room.slots.length; recipient++) {
      if (recipient === target) continue;
      const ev = {
        type: 'peer-pubkey',
        peer: toSlotId(target, room.groupMax),
        pubKey: t.pubKey || null,
        kemPubKey: t.kemPubKey || null,
        epoch,
      };
      sendToSlot(room, recipient, ev);
    }
  }
}

// ─── HTTP server: static files + /r/* endpoints ─────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // Rate-limit API endpoints by client IP. CDN forwards X-Forwarded-For;
  // fall back to remote address. Static files and stream/poll skip the
  // limiter (the stream is one long-lived connection, not a burst).
  if (p.startsWith('/r/') && p !== '/r/stream' && p !== '/r/poll') {
    const xff = req.headers['x-forwarded-for'];
    const ip = (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
            || req.socket.remoteAddress || 'unknown';
    if (!rateLimitOk(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '2' });
      return res.end('{"ok":false,"reason":"rate-limited"}');
    }
  }

  // Yandex CDN strips POST (returns 405 before reaching the origin) but forwards
  // PUT. Accept both verbs so the client can pick whichever one survives the CDN.
  const isWrite = req.method === 'POST' || req.method === 'PUT';
  if (isWrite && p === '/r/claim')  return handleClaim(req, res);
  if (isWrite && p === '/r/send')   return handleSend(req, res);
  if (req.method === 'GET' && p === '/r/poll')   return handlePoll(req, res, url);
  if (req.method === 'GET' && p === '/r/stream') return handleStream(req, res, url);
  if (req.method === 'GET' && p === '/r/vapid-pubkey') return handleVapidPubkey(req, res);
  if (isWrite && p === '/r/push-subscribe')   return handlePushSubscribe(req, res);
  if (isWrite && p === '/r/push-unsubscribe') return handlePushUnsubscribe(req, res);
  if (isWrite && p === '/r/peek')             return handlePeek(req, res);

  // Encrypted blob upload / fetch. PUT body is raw ciphertext (NOT JSON), so
  // we bypass the JSON readBody helper.
  if (isWrite && p === '/r/blob') return handleBlobPut(req, res, url);
  if (req.method === 'GET' && p.startsWith('/r/blob/')) return handleBlobGet(req, res, url, p);
  if (req.method === 'GET' && p === '/r/admin/stats') return handleAdminStats(req, res);
  if (req.method === 'OPTIONS' && p.startsWith('/r/admin/')) return handleAdminCors(req, res);
  if (req.method === 'DELETE' && p.startsWith('/r/admin/room/')) return handleAdminDeleteRoom(req, res, p);
  if (req.method === 'GET'  && p === '/r/admin/tunnel')        return handleAdminTunnelStatus(req, res);
  if (req.method === 'GET'  && p === '/r/admin/tunnel/start') return handleAdminTunnelStart(req, res);
  if (req.method === 'GET'  && p === '/r/admin/tunnel/stop')  return handleAdminTunnelStop(req, res);
  if (req.method === 'GET'  && p === '/r/admin/tunnel/fix-v2box') return handleAdminFixV2BoxDns(req, res);
  if (req.method === 'GET'  && p.startsWith('/r/admin/room/') && url.searchParams.get('delete') === '1') return handleAdminDeleteRoom(req, res, p);

  // static
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end('Method not allowed');
  }
  let urlPath = decodeURIComponent(p);
  if (urlPath === '/') urlPath = '/index.html';
  const safe = path.normalize(urlPath).replace(/^[/\\]+/, '');
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_HTTP_BODY) { req.destroy(); reject(new Error('body too large')); return; }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function handleClaim(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { ok: false, reason: 'bad-body' }); }

  const room = body.room;
  if (!room || !/^[a-f0-9]{32}$/.test(room)) return sendJSON(res, 400, { ok: false, reason: 'bad-room' });

  // Snapshot "did this room already exist" BEFORE performClaim — so we know
  // whether the claim ended up creating a new Room and should count against
  // the per-IP claim throttle. (Expired rooms get destroyed inside the call,
  // but if we observed them here as existing they wouldn't decrement either.)
  const existedBefore = rooms.has(room);

  const out = performClaim(room, body);
  if (!out.result.ok) return sendJSON(res, 200, out.result);

  // Throttle ONLY new-room creations per IP. Restores / joins to existing
  // rooms are unaffected (a legitimate group of 8 should be able to all
  // claim from the same NAT without tripping the limit).
  if (!existedBefore) {
    const xff = req.headers['x-forwarded-for'];
    const ip = (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
            || req.socket.remoteAddress || 'unknown';
    if (!claimIpAllow(ip)) {
      // Roll back the room we just created so abusers can't fill the table.
      destroyRoom(room);
      return sendJSON(res, 429, { ok: false, reason: 'too-many-rooms' });
    }
  }

  // create HTTP session
  const token = crypto.randomBytes(16).toString('hex');
  const sess = {
    token, roomId: room, slot: out.slot,        // numeric
    lastSeen: Date.now(),
    pendingEvents: [],
    pollWaiter: null,
    wasOnline: true,
  };
  out.room.sessions.set(token, sess);
  tokenIndex.set(token, { sess, room: out.room });

  const slotId = toSlotId(out.slot, out.room.groupMax);

  // tell peers a slot is now online + (maybe) state changed
  broadcastAll(out.room,
    { type: 'peer-state', slots: out.room.occupants(), paired: out.room.isPaired() },
    { token });
  broadcastAll(out.room,
    { type: 'peer-online', peer: slotId, online: true },
    { token });
  if (out.justPaired) {
    broadcastAll(out.room, { type: 'paired', pairedAt: out.room.pairedAt }, null);
  }
  // Forward-secrecy: if THIS claim brought a new (or different) pubKey, push
  // peer-pubkey events to ALL sides so they can derive the new pairwise key
  // (and re-distribute their sender keys for the new epoch).
  if (out.pubKeyChanged) {
    broadcastPubKeyChange(out.room);
  }

  const reply = { ...out.result, sessionToken: token };
  if (out.batch && out.batch.length) reply.batch = out.batch;
  if (out.room.isPaired()) reply.pairedAt = out.room.pairedAt;
  sendJSON(res, 200, reply);
}

// Read-only room probe used by the Join screen to tell the user, before they
// enter a password, whether the room they're about to join actually exists and
// how many participants are currently online. No session token is created and
// no slot is claimed. Returns `exists:false` for missing or expired rooms.
async function handlePeek(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { ok: false, reason: 'bad-body' }); }

  const room = body.room;
  if (!room || !/^[a-f0-9]{32}$/.test(room)) return sendJSON(res, 400, { ok: false, reason: 'bad-room' });

  let r = rooms.get(room) || null;
  if (r && r.expiresAt <= Date.now()) { destroyRoom(room); r = null; }
  if (!r) return sendJSON(res, 200, { ok: true, exists: false });

  let claimed = 0;
  let online  = 0;
  for (let i = 0; i < r.slots.length; i++) {
    if (r.slots[i]) {
      claimed += 1;
      if (r.isSlotOnline(i)) online += 1;
    }
  }
  sendJSON(res, 200, {
    ok: true,
    exists: true,
    groupMax: r.groupMax,
    claimed,
    online,
    paired: r.isPaired(),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  });
}

async function handleSend(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { ok: false, reason: 'bad-body' }); }
  const token = body.token;
  if (!token || typeof token !== 'string') return sendJSON(res, 400, { ok: false, reason: 'no-token' });

  const entry = tokenIndex.get(token);
  if (!entry) return sendJSON(res, 401, { ok: false, reason: 'bad-token' });
  const { sess, room } = entry;
  sess.lastSeen = Date.now();

  // Compact batch form: {token, items: [{type, ...}, ...]} — lets the
  // client coalesce a rapid burst into a single round-trip. Yandex CDN
  // throttles parallel PUTs aggressively, so batching is much faster than
  // a one-PUT-per-message stream.
  if (Array.isArray(body.items)) {
    const ids = [];
    for (const it of body.items) {
      if (!it || typeof it.type !== 'string') continue;
      ids.push(handleOne(sess, room, it));
    }
    return sendJSON(res, 200, { ok: true, ids: ids.filter(Boolean) });
  }

  const t = body.type;
  if (t === 'msg' || t === 'typing' || t === 'delete' || t === 'read' ||
      t === 'kem-ct' || t === 'react' || t === 'sender-key' || t === 'signal') {
    const id = handleOne(sess, room, body);
    return sendJSON(res, 200, { ok: true, id });
  }

  if (t === 'ack') {
    // ack is now a no-op (full history is held in RAM until room expiry).
    return sendJSON(res, 200, { ok: true });
  }

  if (t === 'leave') { return sendJSON(res, 200, { ok: true }); }

  sendJSON(res, 400, { ok: false, reason: 'unknown-type' });
}

// Process one item. Pushes to peers and returns msg id (or null).
function handleOne(sess, room, item) {
  const mySlotNum = sess.slot;                       // number
  const mySlotId = toSlotId(mySlotNum, room.groupMax);

  if (item.type === 'msg') {
    if (typeof item.iv !== 'string' || typeof item.ct !== 'string') return null;
    // Per-message ciphertext cap. ~48000 base64 chars ≈ 36KB binary — fits
    // any normal text message; oversized payloads must go through /r/blob.
    // Blocks the "blast N×512KB ciphertexts to evict history" attack.
    if (item.ct.length > 48000) return null;
    // FIX 7: validate client-supplied id format. We keep client-assigned ids
    // (the alternative — server-assigning + round-tripping the new id back —
    // would break local-echo, reply-to, delete and reactions because the
    // sender already wrote the message into its local store under the old id).
    // The sane-format check `[A-Za-z0-9_-]{1,64}` blocks the cheap spoofing
    // tricks (path-style ids, oversized ids, control chars) while preserving
    // the round-trip semantics. Collisions between honest peers are still
    // possible in theory but the id space is large enough that crypto.randomBytes(8)
    // hex on the client (32-bit collision lower bound for 8 random bytes is
    // birthday ≈ 2^32 messages) is fine for a chat-scale relay.
    let id;
    if (typeof item.id === 'string') {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(item.id)) return null;
      id = item.id;
    } else {
      id = crypto.randomBytes(8).toString('hex');
    }
    // Tag with the room's current FS epoch so the client can pick the right
    // session key when it sees the item later (via msg event OR via batch on
    // restore). The client may not have any key for an old epoch after reload
    // — that's expected, see nee2p-app.jsx ingestMessage().
    const stored = {
      id, from: mySlotId, iv: item.iv, ct: item.ct,
      time: item.time || nowHHMM(),
      epoch: room.epoch,
      bytes: item.iv.length + item.ct.length + 64,
    };
    // Wire-format refactor: blob bubbles ship an envelope where iv = bytes-iv
    // (re-used by getBlobObjectURL to decrypt the downloaded blob ciphertext)
    // and ct = a SEPARATE AES-GCM payload carrying time + private blobMeta.
    // That separate payload needs its own iv → `ivCt`. Pass through verbatim
    // if present; the relay treats it as an opaque base64 string.
    if (typeof item.ivCt === 'string' && item.ivCt.length > 0 && item.ivCt.length <= 64) {
      stored.ivCt = item.ivCt;
      stored.bytes += item.ivCt.length;
    }
    // Optional sender-key epoch (informational; sender bumps this each time
    // they rotate their sender key — receivers can detect "I don't have THIS
    // sender-key epoch yet" and surface a placeholder).
    if (typeof item.senderKeyEpoch === 'number') stored.senderKeyEpoch = item.senderKeyEpoch;
    if (typeof item.replyTo === 'string') stored.replyTo = item.replyTo;
    // Self-destruct hint: PLAINTEXT metadata, just like replyTo. Only 10/60/3600
    // are accepted; everything else is dropped silently.
    if (item.expireSecAfterRead === 10 ||
        item.expireSecAfterRead === 60 ||
        item.expireSecAfterRead === 3600) {
      stored.expireSecAfterRead = item.expireSecAfterRead;
    }
    // Wire-format refactor: sanitize the blob descriptor to the FOUR fields
    // the relay legitimately needs to route + the receiver needs BEFORE
    // decryption to decide image-vs-file rendering. Filename, jpeg preview
    // (`thumb`) and audio energy curve (`waveform`) used to live here in
    // plaintext — they now travel INSIDE the AES-GCM payload and never reach
    // the server. Old clients that still send those fields → silently dropped.
    if (item.blob && typeof item.blob === 'object' && typeof item.blob.blobId === 'string') {
      const ib = item.blob;
      const cleanBlob = { blobId: ib.blobId };
      if (typeof ib.mime === 'string')        cleanBlob.mime = ib.mime;
      if (typeof ib.size === 'number')        cleanBlob.size = ib.size;
      if (typeof ib.kind === 'string')        cleanBlob.kind = ib.kind;
      if (typeof ib.durationMs === 'number')  cleanBlob.durationMs = ib.durationMs;
      stored.blob = cleanBlob;
      stored.bytes += 256;
    }
    // Reactions live on the stored item so the restore-batch sees them too.
    stored.reactions = {};
    appendHistory(room, stored);
    // Broadcast the msg to everyone EXCEPT the sender.
    broadcastToOthers(room, mySlotNum, { type: 'msg', ...stored });
    return id;
  }

  if (item.type === 'typing') {
    broadcastToOthers(room, mySlotNum, { type: 'typing', from: mySlotId, on: !!item.on });
    return null;
  }

  if (item.type === 'delete') {
    const idx = room.history.findIndex(x => x.id === item.id);
    if (idx < 0) return null;
    // Peer-authorization: only the original sender may delete their message.
    // history[].from is in wire format (letter for 2p rooms, number for group
    // rooms); coerce both sides to numeric slots before comparing.
    const ownerSlotNum = parseSlotId(room.history[idx].from);
    if (ownerSlotNum === null || ownerSlotNum !== mySlotNum) return null;
    const dropped = room.history.splice(idx, 1)[0];
    room.historyBytes -= dropped.bytes;
    broadcastToOthers(room, mySlotNum, { type: 'msg-delete', id: item.id });
    return null;
  }

  if (item.type === 'read') {
    if (typeof item.upto !== 'string') return null;
    // msgIds are 12-16 hex chars in practice; 80 is a wide safety margin.
    if (item.upto.length === 0 || item.upto.length > 80) return null;
    broadcastToOthers(room, mySlotNum, { type: 'read', peer: mySlotId, upto: item.upto });
    return null;
  }

  if (item.type === 'kem-ct') {
    // ML-KEM-768 ciphertext: in 2-party mode the sender encapsulated against
    // the peer's KEM pubkey and is shipping the ~1088-byte ciphertext so the
    // peer can decap and arrive at the same 32-byte shared secret. In group
    // mode the ciphertext is targeted at a specific peer (`toSlot`).
    if (typeof item.ct !== 'string' || item.ct.length < 1200 || item.ct.length > 2000) return null;
    const epoch = (typeof item.epoch === 'number') ? item.epoch : room.epoch;
    const toSlotNum = parseSlotId(item.toSlot);
    if (toSlotNum !== null && toSlotNum >= 0 && toSlotNum < room.slots.length) {
      // Group / targeted delivery.
      const ev = { type: 'kem-ct', from: mySlotId, toSlot: toSlotId(toSlotNum, room.groupMax),
                   ct: item.ct, epoch };
      sendToSlot(room, toSlotNum, ev);
    } else {
      // Legacy 2-party fan-out (server picks "the other" slot).
      if (room.groupMax !== 2) return null;
      const otherNum = mySlotNum === 0 ? 1 : 0;
      const ev = { type: 'kem-ct', from: mySlotId, ct: item.ct, epoch };
      sendToSlot(room, otherNum, ev);
    }
    return null;
  }

  if (item.type === 'sender-key') {
    // New group-chat envelope: ciphertext containing the sender's freshly
    // generated AES-GCM sender key, encrypted via the pairwise key with the
    // target peer (HKDF of ECDH+KEM+phrase — same primitive that used to
    // produce the 2-party session key).
    //
    //   item = {type:'sender-key', toSlot:<number|letter>, iv, ct,
    //           senderKeyEpoch?: number, epoch?: number}
    //
    // The server just routes — it has no plaintext access to the sender key.
    const toSlotNum = parseSlotId(item.toSlot);
    if (toSlotNum === null || toSlotNum < 0 || toSlotNum >= room.slots.length) return null;
    if (toSlotNum === mySlotNum) return null;
    if (typeof item.iv !== 'string' || typeof item.ct !== 'string') return null;
    const ev = {
      type: 'sender-key',
      from: mySlotId,
      toSlot: toSlotId(toSlotNum, room.groupMax),
      iv: item.iv, ct: item.ct,
      epoch: typeof item.epoch === 'number' ? item.epoch : room.epoch,
    };
    if (typeof item.senderKeyEpoch === 'number') ev.senderKeyEpoch = item.senderKeyEpoch;
    sendToSlot(room, toSlotNum, ev);
    return null;
  }

  if (item.type === 'signal') {
    // WebRTC signalling envelope (SDP offer/answer + ICE candidates).
    // Broadcast-only — no history, no persistence. Treated like 'typing' /
    // 'read' from a relay perspective: ephemeral, fan-out to the other slot(s).
    // The payload (iv, ct) is AES-GCM-encrypted by the sender under the
    // group sender-key — the relay sees opaque base64. Server enforces a
    // small ciphertext cap so a buggy peer can't ship multi-MB SDP blobs.
    if (typeof item.iv !== 'string' || typeof item.ct !== 'string') return null;
    if (item.iv.length > 64 || item.ct.length > 16000) return null;
    const ev = {
      type: 'signal',
      from: mySlotId,
      iv: item.iv, ct: item.ct,
    };
    if (typeof item.ivCt === 'string' && item.ivCt.length > 0 && item.ivCt.length <= 64) {
      ev.ivCt = item.ivCt;
    }
    if (typeof item.senderKeyEpoch === 'number') ev.senderKeyEpoch = item.senderKeyEpoch;
    broadcastToOthers(room, mySlotNum, ev);
    return null;
  }

  if (item.type === 'react') {
    // Emoji reaction toggle. PLAINTEXT metadata — see comment on `msg` above.
    if (typeof item.msgId !== 'string' || item.msgId.length === 0 || item.msgId.length > 64) return null;
    if (typeof item.emoji !== 'string' || item.emoji.length === 0 || item.emoji.length > 8) return null;
    const target = room.history.find(x => x.id === item.msgId);
    if (!target) return null;
    if (!target.reactions || typeof target.reactions !== 'object') target.reactions = {};
    // Cap distinct emoji per message at 16. Toggling an EXISTING emoji is
    // always allowed (so users can still un-react past the cap); only adding
    // a brand-new emoji key past the cap is dropped. Stops a single user
    // ballooning history bytes by spamming exotic codepoints.
    const REACT_DISTINCT_CAP = 16;
    const existingKeys = Object.keys(target.reactions);
    if (existingKeys.length >= REACT_DISTINCT_CAP &&
        !Object.prototype.hasOwnProperty.call(target.reactions, item.emoji)) {
      return null;
    }
    const list = Array.isArray(target.reactions[item.emoji]) ? target.reactions[item.emoji] : [];
    // Reactions are tagged with the SENDER'S slot identifier (always in the
    // current room's wire format — letters for 2p, numbers for groups). The
    // UI does any final coercion.
    const had = list.includes(mySlotId);
    let op;
    let nextList;
    if (had) {
      nextList = list.filter(s => s !== mySlotId);
      op = 'remove';
    } else {
      nextList = [...list, mySlotId];
      op = 'add';
    }
    if (nextList.length === 0) {
      delete target.reactions[item.emoji];
    } else {
      target.reactions[item.emoji] = nextList;
    }
    broadcastToOthers(room, mySlotNum, {
      type: 'react', msgId: item.msgId, emoji: item.emoji, from: mySlotId, op,
    });
    return null;
  }
  return null;
}

// ─── token-bucket rate limiter ───────────────────────────────
// Crude per-IP guard against accidental floods (e.g. a runaway client) and
// trivial DoS attempts. Numbers are generous — normal humans nowhere near.
const RL_BUCKET = new Map(); // ip → {tokens, lastRefill}
const RL_CAPACITY = 200;
const RL_REFILL_PER_SEC = 20;
function rateLimitOk(ip) {
  const now = Date.now();
  let b = RL_BUCKET.get(ip);
  if (!b) { b = { tokens: RL_CAPACITY, lastRefill: now }; RL_BUCKET.set(ip, b); }
  const delta = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(RL_CAPACITY, b.tokens + delta * RL_REFILL_PER_SEC);
  b.lastRefill = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [ip, b] of RL_BUCKET) if (b.lastRefill < cutoff) RL_BUCKET.delete(ip);
}, 60 * 1000);

function handleSessionGone(sess, room, notify) {
  room.sessions.delete(sess.token);
  tokenIndex.delete(sess.token);
  if (notify && !room.isSlotOnline(sess.slot)) {
    broadcastAll(room, {
      type: 'peer-online',
      peer: toSlotId(sess.slot, room.groupMax),
      online: false,
    }, null);
  }
  if (sess.pollWaiter) {
    clearTimeout(sess.pollWaiter.timeout);
    sess.pollWaiter.resolve(sess.pendingEvents.splice(0));
    sess.pollWaiter = null;
  }
}

async function handlePoll(req, res, url) {
  const token = getToken(req, url);
  if (!token) return sendJSON(res, 400, { ok: false, reason: 'no-token' });

  const entry = tokenIndex.get(token);
  if (!entry) return sendJSON(res, 401, { ok: false, reason: 'bad-token' });
  const { sess } = entry;
  sess.lastSeen = Date.now();

  if (sess.pendingEvents.length) {
    const events = sess.pendingEvents.splice(0);
    return sendJSON(res, 200, { ok: true, events });
  }
  // If a previous /r/poll is still parked on this session (e.g. client opened
  // a second poll before the first returned), wake the old waiter immediately
  // with whatever's queued so it doesn't hang for the full POLL_HOLD_MS — and
  // so events delivered between abandonment and timeout aren't stranded.
  if (sess.pollWaiter) {
    clearTimeout(sess.pollWaiter.timeout);
    const prev = sess.pollWaiter;
    sess.pollWaiter = null;
    prev.resolve(sess.pendingEvents.splice(0));
  }
  const events = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (sess.pollWaiter && sess.pollWaiter.timeout === timeout) sess.pollWaiter = null;
      resolve(sess.pendingEvents.splice(0));
    }, POLL_HOLD_MS);
    sess.pollWaiter = { resolve: (evs) => { resolve(evs || []); }, timeout };
  });
  sendJSON(res, 200, { ok: true, events });
}

// SSE — a single long-lived connection. Server flushes each event the moment
// it happens, so multi-message bursts arrive with zero per-event gap.
function handleStream(req, res, url) {
  const token = getToken(req, url);
  if (!token) return sendJSON(res, 400, { ok: false, reason: 'no-token' });
  const entry = tokenIndex.get(token);
  if (!entry) return sendJSON(res, 401, { ok: false, reason: 'bad-token' });
  const { sess } = entry;
  sess.lastSeen = Date.now();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // ask nginx-style proxies not to buffer chunks
  });
  res.write('retry: 1500\n\n');                          // EventSource auto-reconnect delay
  // flush any buffered events first
  for (const ev of sess.pendingEvents.splice(0)) {
    res.write('data: ' + JSON.stringify(ev) + '\n\n');
  }
  // If the same session already has a live SSE stream open (e.g. user opened
  // a second tab, or a stale stream is still hanging), close it cleanly so
  // pushEvent never targets a stale socket. The old stream's 'close' handler
  // will clear its heartbeat; we'll install ours below.
  if (sess.streamRes && sess.streamRes !== res && !sess.streamRes.writableEnded) {
    try { sess.streamRes.end(); } catch {}
  }
  sess.streamRes = res;

  // keepalive comment line every 20s so CDN / Caddy don't time the idle out
  const heartbeat = setInterval(() => {
    try { res.write(': hb\n\n'); sess.lastSeen = Date.now(); }
    catch { clearInterval(heartbeat); }
  }, 20000);

  const onClose = () => {
    clearInterval(heartbeat);
    if (sess.streamRes === res) sess.streamRes = null;
  };
  req.on('close', onClose);
  res.on('close', onClose);
}

// ─── Web Push endpoints ──────────────────────────────────────
function handleAdminStats(req, res) {
  const adminKey = process.env.ADMIN_KEY || 'nee2p-admin-local';
  if (req.headers['x-admin-key'] !== adminKey) {
    res.writeHead(403, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
  }

  let sessionCount = 0;
  let pairedCount = 0;
  let totalHistoryBytes = 0;
  let totalBlobBytes = 0;

  const roomList = [];
  for (const room of rooms.values()) {
    sessionCount += room.sessions.size;
    if (room.isPaired()) pairedCount++;
    totalHistoryBytes += room.historyBytes;
    totalBlobBytes += room.totalBlobBytes;

    let onlineCount = 0;
    for (let i = 0; i < room.groupMax; i++) {
      if (room.isSlotOnline(i)) onlineCount++;
    }

    roomList.push({
      id: room.id,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      ttlMs: room.ttlMs,
      groupMax: room.groupMax,
      paired: room.isPaired(),
      pairedAt: room.pairedAt,
      onlineCount,
      sessionCount: room.sessions.size,
      msgCount: room.history.length,
      historyBytes: room.historyBytes,
      blobCount: room.blobs.size,
      blobBytes: room.totalBlobBytes,
      slotsSealed: room.slots.map(s => !!(s && s.sealed)),
    });
  }

  const data = {
    uptime: Math.floor(process.uptime()),
    roomCount: rooms.size,
    sessionCount,
    pairedCount,
    totalHistoryBytes,
    totalBlobBytes,
    relayBlobBytes: RELAY_BLOB_BYTES,
    rooms: roomList,
  };

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ ok: true, data }));
}

function handleAdminCors(req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, DELETE, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'x-admin-key',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
}

function handleAdminDeleteRoom(req, res, p) {
  const adminKey = process.env.ADMIN_KEY || 'nee2p-admin-local';
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };
  if (req.headers['x-admin-key'] !== adminKey) {
    res.writeHead(403, headers);
    return res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
  }
  // strip optional ?delete=1 query param to get clean id
  const id = p.slice('/r/admin/room/'.length).split('?')[0];
  if (!rooms.has(id)) {
    res.writeHead(404, headers);
    return res.end(JSON.stringify({ ok: false, error: 'not-found' }));
  }
  destroyRoom(id);
  res.writeHead(200, headers);
  res.end(JSON.stringify({ ok: true }));
}

// ── Admin tunnel ──────────────────────────────────────────────────────────────
const ADMIN_JSON = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
function adminAuthOk(req) { return req.headers['x-admin-key'] === (process.env.ADMIN_KEY || 'nee2p-admin-local'); }

function handleAdminTunnelStatus(req, res) {
  if (!adminAuthOk(req)) { res.writeHead(403, ADMIN_JSON); return res.end(JSON.stringify({ ok: false, error: 'forbidden' })); }
  res.writeHead(200, ADMIN_JSON);
  res.end(JSON.stringify({ ok: true, data: {
    status:    tunnelStatus,
    url:       tunnelUrl,
    startedAt: tunnelStartedAt,
    error:     tunnelError,
    provider:  tunnelProvider,
    log:       tunnelLog,
    pid:       tunnelProc ? tunnelProc.pid : null,
  }}));
}

async function handleAdminTunnelStart(req, res) {
  if (!adminAuthOk(req)) { res.writeHead(403, ADMIN_JSON); return res.end(JSON.stringify({ ok: false, error: 'forbidden' })); }
  if (tunnelStatus === 'running' || tunnelStatus === 'starting') {
    res.writeHead(200, ADMIN_JSON);
    return res.end(JSON.stringify({ ok: true, data: { status: tunnelStatus, url: tunnelUrl, provider: tunnelProvider } }));
  }

  // ── Provider selection ─────────────────────────────────────────────────────
  const qp   = new URL(req.url, 'http://x').searchParams;
  const pkey = qp.get('provider') || 'cloudflared';
  const prov = TUNNEL_PROVIDERS[pkey];
  if (!prov) {
    res.writeHead(400, ADMIN_JSON);
    return res.end(JSON.stringify({ ok: false, error: `unknown-provider: ${pkey}` }));
  }

  // ── DNS pre-check (cloudflared only) ──────────────────────────────────────
  // V2Box/Xray intercepts DNS and returns fake 198.18.0.0/15 IPs.
  // cloudflared needs _v2-origintunneld._tcp.argotunnel.com SRV → HTTP 530.
  // SSH/WSS providers are not affected → skip check.
  if (prov.dnsCheck) {
    try {
      const addrs = await dns.promises.resolve4('argotunnel.com');
      if (addrs.length > 0 && addrs.every(a => /^198\.18\./.test(a))) {
        tunnelStatus = 'error';
        tunnelError  = 'dns-hijacked';
        res.writeHead(200, ADMIN_JSON);
        return res.end(JSON.stringify({ ok: false, error: 'dns-hijacked' }));
      }
    } catch { /* other DNS error — let cloudflared surface it */ }
  }

  tunnelUrl = null; tunnelError = null; tunnelLog = []; tunnelStatus = 'starting';
  tunnelStartedAt = null; tunnelProvider = pkey;

  tunnelProc = prov.makeProc(PORT);

  tunnelProc.on('error', (err) => {
    tunnelStatus = 'error';
    tunnelError  = err.code === 'ENOENT' ? `${prov.label}: ${prov.notFoundHint}` : err.message;
    tunnelProc   = null;
  });

  function parseLine(line) {
    tunnelLogPush(line);
    if (!tunnelUrl) {
      const m = line.match(prov.urlRe);
      if (m) { tunnelUrl = m[0]; tunnelStatus = 'running'; tunnelStartedAt = Date.now(); }
    }
  }

  tunnelProc.stdout.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) parseLine(l.trim()); }));
  tunnelProc.stderr.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) parseLine(l.trim()); }));

  tunnelProc.on('close', (code) => {
    if (tunnelStatus !== 'stopped') {
      tunnelStatus = (code === 0 || code === null) ? 'stopped' : 'error';
      if (code && code !== 0 && !tunnelError) tunnelError = `${prov.label}: process exited with code ${code}`;
    }
    tunnelProc = null;
  });

  res.writeHead(200, ADMIN_JSON);
  res.end(JSON.stringify({ ok: true, data: { status: 'starting', provider: pkey } }));
}

function handleAdminTunnelStop(req, res) {
  if (!adminAuthOk(req)) { res.writeHead(403, ADMIN_JSON); return res.end(JSON.stringify({ ok: false, error: 'forbidden' })); }
  if (tunnelProc) { try { tunnelProc.kill('SIGTERM'); } catch {} tunnelProc = null; }
  tunnelStatus = 'stopped'; tunnelUrl = null; tunnelError = null; tunnelStartedAt = null;
  res.writeHead(200, ADMIN_JSON);
  res.end(JSON.stringify({ ok: true }));
}

// ── Admin: patch V2Box config.json to bypass argotunnel.com through DNS/VPN ──
async function handleAdminFixV2BoxDns(req, res) {
  if (!adminAuthOk(req)) { res.writeHead(403, ADMIN_JSON); return res.end(JSON.stringify({ ok: false, error: 'forbidden' })); }

  const V2BOX_CONFIG = path.join(os.homedir(),
    'Library/Group Containers/group.hossin.asaadi.V2Box/config.json');

  // ── Read ──────────────────────────────────────────────────────────────────
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(V2BOX_CONFIG, 'utf8')); }
  catch (e) {
    res.writeHead(200, ADMIN_JSON);
    return res.end(JSON.stringify({ ok: false, error: `Не удалось прочитать V2Box config.json: ${e.message}` }));
  }

  let changed = false;

  // ── 1. Per-domain DNS server: 8.8.8.8 handles argotunnel.com directly ────
  if (!cfg.dns) cfg.dns = {};
  if (!Array.isArray(cfg.dns.servers)) cfg.dns.servers = [];
  const hasDnsServer = cfg.dns.servers.some(
    s => typeof s === 'object' && Array.isArray(s.domains) && s.domains.includes('domain:argotunnel.com')
  );
  if (!hasDnsServer) {
    cfg.dns.servers.unshift({ address: '8.8.8.8', domains: ['domain:argotunnel.com'], skipFallback: true });
    changed = true;
  }

  // ── 2. Routing rules ──────────────────────────────────────────────────────
  if (!cfg.routing) cfg.routing = {};
  if (!Array.isArray(cfg.routing.rules)) cfg.routing.rules = [];
  const rules = cfg.routing.rules;

  // 2a. DNS bypass: argotunnel.com DNS queries → direct (BEFORE dnsQuery→proxy)
  const hasDnsRule = rules.some(r =>
    r.outboundTag === 'direct' &&
    Array.isArray(r.inboundTag) && r.inboundTag.includes('dnsQuery') &&
    Array.isArray(r.domain) && r.domain.includes('domain:argotunnel.com')
  );
  if (!hasDnsRule) {
    const proxyDnsIdx = rules.findIndex(r =>
      Array.isArray(r.inboundTag) && r.inboundTag.includes('dnsQuery') && r.outboundTag !== 'direct'
    );
    const dnsBypass = { outboundTag: 'direct', type: 'field',
      inboundTag: ['dnsQuery'], domain: ['domain:argotunnel.com'] };
    if (proxyDnsIdx >= 0) rules.splice(proxyDnsIdx, 0, dnsBypass);
    else rules.unshift(dnsBypass);
    changed = true;
  }

  // 2b. TCP bypass: argotunnel.com TCP → direct (insert before directSocks rule)
  const hasTcpRule = rules.some(r =>
    r.outboundTag === 'direct' && !r.inboundTag &&
    Array.isArray(r.domain) && r.domain.includes('domain:argotunnel.com')
  );
  if (!hasTcpRule) {
    const directSocksIdx = rules.findIndex(r =>
      Array.isArray(r.inboundTag) && r.inboundTag.includes('directSocks')
    );
    const tcpBypass = { outboundTag: 'direct', type: 'field', domain: ['domain:argotunnel.com'] };
    if (directSocksIdx >= 0) rules.splice(directSocksIdx, 0, tcpBypass);
    else rules.push(tcpBypass);
    changed = true;
  }

  if (!changed) {
    res.writeHead(200, ADMIN_JSON);
    return res.end(JSON.stringify({
      ok: true, alreadyFixed: true,
      message: 'Правила уже применены. Переподключитесь в V2Box, затем запустите туннель.'
    }));
  }

  // ── Write back ────────────────────────────────────────────────────────────
  try { fs.writeFileSync(V2BOX_CONFIG, JSON.stringify(cfg, null, 2), 'utf8'); }
  catch (e) {
    res.writeHead(200, ADMIN_JSON);
    return res.end(JSON.stringify({ ok: false, error: `Не удалось записать config.json: ${e.message}` }));
  }

  // ── Kill PacketTunnel → macOS/V2Box restart it with new config ────────────
  let killed = false;
  try {
    const pidStr = execSync('pgrep -f PacketTunnel', { encoding: 'utf8' }).trim();
    const pid = parseInt(pidStr.split('\n')[0], 10);
    if (pid > 0) { process.kill(pid, 'SIGTERM'); killed = true; }
  } catch { /* PacketTunnel not running or pgrep failed */ }

  tunnelStatus = 'stopped'; tunnelError = null;
  res.writeHead(200, ADMIN_JSON);
  res.end(JSON.stringify({
    ok: true, killed,
    message: killed
      ? 'Конфиг обновлён, VPN-процесс перезапущен. Подождите ~5 сек, затем нажмите «Запустить туннель».'
      : 'Конфиг обновлён. Откройте V2Box → переподключитесь вручную, затем запустите туннель снова.'
  }));
}

function handleVapidPubkey(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(VAPID_PUBLIC_KEY);
}

async function handlePushSubscribe(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { ok: false, reason: 'bad-body' }); }
  const token = body && body.token;
  const sub   = body && body.subscription;
  if (!token || typeof token !== 'string') return sendJSON(res, 400, { ok: false, reason: 'no-token' });
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || !sub.keys) {
    return sendJSON(res, 400, { ok: false, reason: 'bad-subscription' });
  }
  const entry = tokenIndex.get(token);
  if (!entry) return sendJSON(res, 401, { ok: false, reason: 'bad-token' });
  entry.sess.pushSubscription = sub;
  // FIX 6: assign a stable random tag for this session if we haven't already.
  // Keeps the push provider from correlating notifications via roomId prefix.
  // Kept across re-subscribes within the same session so legitimate iOS-style
  // notification replacement still works.
  if (!entry.sess.pushTag) {
    entry.sess.pushTag = crypto.randomBytes(6).toString('hex');
  }
  sendJSON(res, 200, { ok: true });
}

async function handlePushUnsubscribe(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { ok: false, reason: 'bad-body' }); }
  const token = body && body.token;
  if (!token || typeof token !== 'string') return sendJSON(res, 400, { ok: false, reason: 'no-token' });
  const entry = tokenIndex.get(token);
  if (!entry) return sendJSON(res, 401, { ok: false, reason: 'bad-token' });
  entry.sess.pushSubscription = null;
  sendJSON(res, 200, { ok: true });
}

// ─── encrypted blob upload / download ────────────────────────
// MIMEs the server is willing to *echo back* on GET. Everything else gets
// served as application/octet-stream so a malicious peer can't trick a
// browser into rendering a stored blob as e.g. text/html.
function sanitizeBlobMime(mime) {
  const m = String(mime || '').toLowerCase().slice(0, 120);
  if (m.startsWith('image/') || m.startsWith('audio/') || m === 'application/octet-stream') return m;
  return 'application/octet-stream';
}

function readRawBody(req, capBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > capBytes) {
        req.destroy();
        reject(Object.assign(new Error('blob too large'), { code: 'TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks, total)));
    req.on('error', reject);
  });
}

async function handleBlobPut(req, res, url) {
  const token = getToken(req, url);
  if (!token) return sendJSON(res, 400, { ok: false, reason: 'no-token' });
  const entry = tokenIndex.get(token);
  if (!entry) return sendJSON(res, 401, { ok: false, reason: 'bad-token' });
  const { sess, room } = entry;
  sess.lastSeen = Date.now();

  const mime = sanitizeBlobMime(url.searchParams.get('mime') || 'application/octet-stream');
  const declaredSize = Number(url.searchParams.get('size') || '0');
  if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > MAX_BLOB_BYTES) {
    return sendJSON(res, 413, { ok: false, reason: 'too-large' });
  }

  // 5MB cap + a bit of slack so the cutoff in readRawBody triggers AFTER the
  // user-meaningful boundary (the size we actually store is the bytes received).
  let bytes;
  try {
    bytes = await readRawBody(req, MAX_BLOB_BYTES + 16 * 1024);
  } catch (e) {
    if (e && e.code === 'TOO_LARGE') return sendJSON(res, 413, { ok: false, reason: 'too-large' });
    return sendJSON(res, 400, { ok: false, reason: 'bad-body' });
  }
  if (bytes.length === 0) return sendJSON(res, 400, { ok: false, reason: 'empty' });
  if (bytes.length > MAX_BLOB_BYTES) return sendJSON(res, 413, { ok: false, reason: 'too-large' });

  // The body stream is async — the room may have been destroyed (TTL expiry,
  // explicit cleanup) while we were reading. The closure still holds a `room`
  // ref so storing here would push to a detached Map and leak the bytes into
  // RELAY_BLOB_BYTES with no decrement path. Re-check identity against the
  // live tokenIndex to be safe.
  const liveEntry = tokenIndex.get(token);
  if (!liveEntry || liveEntry.room !== entry.room || rooms.get(entry.room.id) !== entry.room) {
    return sendJSON(res, 410, { ok: false, reason: 'room-gone' });
  }

  // Relay-wide cap: refuse before we touch room state. The room caller can
  // still hit the per-room cap below and we'll evict from THAT room only.
  if (RELAY_BLOB_BYTES + bytes.length > MAX_RELAY_BLOB_BYTES) {
    return sendJSON(res, 507, { ok: false, reason: 'relay-full' });
  }

  // Per-room cap: LRU-evict oldest until the new blob fits. Map iteration
  // order is insertion order, so the first key is the oldest.
  while (room.totalBlobBytes + bytes.length > MAX_ROOM_BLOB_BYTES && room.blobs.size > 0) {
    const oldestKey = room.blobs.keys().next().value;
    const dropped = room.blobs.get(oldestKey);
    room.blobs.delete(oldestKey);
    if (dropped) {
      room.totalBlobBytes -= dropped.size;
      RELAY_BLOB_BYTES = Math.max(0, RELAY_BLOB_BYTES - dropped.size);
    }
  }
  if (bytes.length > MAX_ROOM_BLOB_BYTES) {
    return sendJSON(res, 413, { ok: false, reason: 'too-large' });
  }

  const blobId = crypto.randomBytes(12).toString('hex');
  room.blobs.set(blobId, { bytes, mime, size: bytes.length, addedAt: Date.now() });
  room.totalBlobBytes += bytes.length;
  RELAY_BLOB_BYTES += bytes.length;

  sendJSON(res, 200, { ok: true, blobId, expiresAt: room.expiresAt });
}

function handleBlobGet(req, res, url, p) {
  const token = getToken(req, url);
  if (!token) return sendJSON(res, 400, { ok: false, reason: 'no-token' });
  const entry = tokenIndex.get(token);
  if (!entry) return sendJSON(res, 401, { ok: false, reason: 'bad-token' });
  const { sess, room } = entry;
  sess.lastSeen = Date.now();

  const blobId = p.slice('/r/blob/'.length);
  if (!/^[a-f0-9]{24}$/.test(blobId)) return sendJSON(res, 400, { ok: false, reason: 'bad-blob-id' });

  const rec = room.blobs.get(blobId);
  if (!rec) return sendJSON(res, 404, { ok: false, reason: 'no-blob' });
  // Touch LRU position: re-insert at tail so frequently-fetched blobs aren't
  // the first ones evicted on the next upload burst.
  room.blobs.delete(blobId);
  room.blobs.set(blobId, rec);

  res.writeHead(200, {
    'Content-Type': sanitizeBlobMime(rec.mime),
    'Content-Length': rec.bytes.length,
    'Cache-Control': 'no-store',
  });
  res.end(rec.bytes);
}

// ─── WebSocket transport (kept for direct/dev use) ──────────
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const roomId = url.searchParams.get('room');
  if (!roomId || !/^[a-f0-9]{32}$/.test(roomId)) { socket.destroy(); return; }

  wss.handleUpgrade(req, socket, head, (ws) => {
    let mySlot = null;           // number
    let myRoom = rooms.get(roomId) || null;
    if (myRoom && myRoom.expiresAt <= Date.now()) { destroyRoom(roomId); myRoom = null; }

    const safeSend = (obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };

    if (!myRoom) safeSend({ type: 'room-state', exists: false });
    else safeSend({
      type: 'room-state', exists: true,
      createdAt: myRoom.createdAt, expiresAt: myRoom.expiresAt, ttlMs: myRoom.ttlMs,
      slots: myRoom.occupants(), paired: myRoom.isPaired(),
      groupMax: myRoom.groupMax,
    });

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m.type !== 'string') return;

      if (m.type === 'claim') {
        const out = performClaim(roomId, m);
        if (!out.result.ok) return safeSend(out.result);
        mySlot = out.slot;                                 // number
        myRoom = out.room;
        myRoom.sockets.add({ ws, slot: mySlot });
        safeSend(out.result);
        if (out.batch && out.batch.length) safeSend({ type: 'msg-batch', items: out.batch });
        const mySlotId = toSlotId(mySlot, myRoom.groupMax);
        broadcastAll(myRoom, {
          type: 'peer-state', slots: myRoom.occupants(), paired: myRoom.isPaired(),
        }, { ws });
        broadcastAll(myRoom, { type: 'peer-online', peer: mySlotId, online: true }, { ws });
        if (out.justPaired) {
          broadcastAll(myRoom, { type: 'paired', pairedAt: myRoom.pairedAt }, null);
          safeSend({ type: 'paired', pairedAt: myRoom.pairedAt });
        } else if (myRoom.isPaired()) {
          safeSend({ type: 'paired', pairedAt: myRoom.pairedAt });
        }
        if (out.pubKeyChanged) {
          broadcastPubKeyChange(myRoom);
        }
        return;
      }

      if (!myRoom || mySlot === null) return;

      // Funnel everything else through handleOne so behaviour matches the
      // HTTP path exactly (one source of truth for fan-out semantics).
      if (m.type === 'msg' || m.type === 'typing' || m.type === 'delete' ||
          m.type === 'read' || m.type === 'kem-ct' || m.type === 'react' ||
          m.type === 'sender-key' || m.type === 'signal') {
        // Build a fake "sess" shim so handleOne can reach our slot number.
        const sessShim = { slot: mySlot };
        const id = handleOne(sessShim, myRoom, m);
        if (m.type === 'msg' && id) safeSend({ type: 'msg-stored', id });
        return;
      }

      if (m.type === 'ack') return;             // no-op, see HTTP handler
      if (m.type === 'leave') { try { ws.close(); } catch {}; return; }
    });

    ws.on('close', () => {
      if (!myRoom) return;
      for (const s of [...myRoom.sockets]) if (s.ws === ws) myRoom.sockets.delete(s);
      if (mySlot !== null && !myRoom.isSlotOnline(mySlot)) {
        broadcastAll(myRoom, {
          type: 'peer-online',
          peer: toSlotId(mySlot, myRoom.groupMax),
          online: false,
        }, null);
      }
    });
    ws.on('error', () => { try { ws.close(); } catch {} });
  });
});

// ─── periodic cleanup ────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.expiresAt <= now) { destroyRoom(id); continue; }
    // session sweep
    const slotStillOnlineBefore = room.slots.map((_, i) => room.isSlotOnline(i));
    for (const [tok, sess] of room.sessions) {
      if (now - sess.lastSeen > SESSION_IDLE_MS) {
        // session is dead
        room.sessions.delete(tok);
        tokenIndex.delete(tok);
        if (sess.pollWaiter) {
          clearTimeout(sess.pollWaiter.timeout);
          sess.pollWaiter.resolve([]);
        }
      }
    }
    for (let i = 0; i < room.slots.length; i++) {
      const isOnlineNow = room.isSlotOnline(i);
      if (slotStillOnlineBefore[i] && !isOnlineNow) {
        broadcastAll(room, {
          type: 'peer-online',
          peer: toSlotId(i, room.groupMax),
          online: false,
        }, null);
      }
    }
  }
}, SESSION_GC_INTERVAL);

server.listen(PORT, HOST, () => {
  console.log(`Nee2P. running at http://${HOST}:${PORT}`);
});
