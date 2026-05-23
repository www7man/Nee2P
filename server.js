// server.js — hush. relay. Dual transport.
//
// Primary transport (used in prod through Yandex CDN that strips WS upgrade):
//   POST /r/claim  body {room, passwordHash, ttlMs?}
//        → {ok, slot, mode, sessionToken, createdAt, expiresAt, ttlMs,
//           slots, paired, batch?}
//   POST /r/send   body {token, type:'msg'|'typing'|'ack'|'leave', ...payload}
//        → {ok}
//   GET  /r/poll?token=...        → {ok:true, events:[...]} (long-poll up to 25s)
//
// Secondary transport (for direct testing without CDN):
//   WS   /ws?room=...    same protocol as before (claim, msg, ack, typing, leave)
//
// Both transports share Room state + the per-slot offline queue. Sessions are
// HTTP-specific; WS sockets are their own. The relay never sees plaintext —
// it only relays {iv, ct} blobs and SHA-256 passwordHashes.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

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

// ─── shared state ────────────────────────────────────────────
const rooms = new Map();
// O(1) lookup for HTTP session token → {sess, room}. Without this every
// send/poll scanned every room.
const tokenIndex = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.createdAt = Date.now();
    this.ttlMs = DEFAULT_TTL_MS;
    this.expiresAt = this.createdAt + this.ttlMs;
    this.slots = { A: null, B: null };
    this.pairedAt = null;
    this.sockets = new Set();          // for WS
    this.sessions = new Map();          // sessionToken → SessionEntry (for HTTP)
    this.history = [];                  // full conversation log (RAM-only)
    this.historyBytes = 0;
  }
  occupants() {
    return {
      A: this.slots.A ? { claimed: true, sealed: this.slots.A.sealed } : { claimed: false, sealed: false },
      B: this.slots.B ? { claimed: true, sealed: this.slots.B.sealed } : { claimed: false, sealed: false },
    };
  }
  isPaired() {
    return !!(this.slots.A?.sealed && this.slots.B?.sealed);
  }
  isSlotOnline(slot) {
    const now = Date.now();
    for (const s of this.sockets) if (s.slot === slot) return true;
    for (const sess of this.sessions.values()) {
      if (sess.slot === slot && (now - sess.lastSeen) < SESSION_IDLE_MS) return true;
    }
    return false;
  }
}

// SessionEntry: { token, roomId, slot, lastSeen, pendingEvents: [], pollWaiter, wasOnline }

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
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
    } catch {}
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

// ─── claim helper used by both transports ────────────────────
//   Returns { result, batch?, justPaired, room, slot }
//     result = the claim-result message body to deliver to the claimer
function performClaim(roomId, m) {
  if (typeof m.passwordHash !== 'string' || !/^[a-f0-9]{64}$/.test(m.passwordHash)) {
    return { result: { type: 'claim-result', ok: false, reason: 'bad-hash' } };
  }
  let room = rooms.get(roomId) || null;
  if (room && room.expiresAt <= Date.now()) { destroyRoom(roomId); room = null; }

  if (!room) {
    room = new Room(roomId);
    if (typeof m.ttlMs === 'number' && Number.isFinite(m.ttlMs)) {
      room.ttlMs = Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.floor(m.ttlMs)));
      room.expiresAt = room.createdAt + room.ttlMs;
    }
    rooms.set(roomId, room);
  }

  // existing slot?
  let restored = null;
  if (room.slots.A?.passwordHash === m.passwordHash) restored = 'A';
  else if (room.slots.B?.passwordHash === m.passwordHash) restored = 'B';

  if (restored) {
    return {
      result: {
        type: 'claim-result', ok: true, slot: restored, mode: 'restored',
        createdAt: room.createdAt, expiresAt: room.expiresAt, ttlMs: room.ttlMs,
        slots: room.occupants(), paired: room.isPaired(),
      },
      batch: room.history.slice(),
      room, slot: restored, justPaired: false,
    };
  }

  let slot = null;
  if (!room.slots.A) slot = 'A';
  else if (!room.slots.B) slot = 'B';
  else return { result: { type: 'claim-result', ok: false, reason: 'locked' } };

  room.slots[slot] = { passwordHash: m.passwordHash, sealed: true };
  const justPaired = room.isPaired() && !room.pairedAt;
  if (justPaired) room.pairedAt = Date.now();

  return {
    result: {
      type: 'claim-result', ok: true, slot, mode: 'claimed',
      createdAt: room.createdAt, expiresAt: room.expiresAt, ttlMs: room.ttlMs,
      slots: room.occupants(), paired: room.isPaired(),
    },
    batch: room.history.slice(),
    room, slot, justPaired,
  };
}

// ─── HTTP server: static files + /r/* endpoints ─────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // Yandex CDN strips POST (returns 405 before reaching the origin) but forwards
  // PUT. Accept both verbs so the client can pick whichever one survives the CDN.
  const isWrite = req.method === 'POST' || req.method === 'PUT';
  if (isWrite && p === '/r/claim')  return handleClaim(req, res);
  if (isWrite && p === '/r/send')   return handleSend(req, res);
  if (req.method === 'GET' && p === '/r/poll')   return handlePoll(req, res, url);
  if (req.method === 'GET' && p === '/r/stream') return handleStream(req, res, url);

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

  const out = performClaim(room, body);
  if (!out.result.ok) return sendJSON(res, 200, out.result);

  // create HTTP session
  const token = crypto.randomBytes(16).toString('hex');
  const sess = {
    token, roomId: room, slot: out.slot,
    lastSeen: Date.now(),
    pendingEvents: [],
    pollWaiter: null,
    wasOnline: true,
  };
  out.room.sessions.set(token, sess);
  tokenIndex.set(token, { sess, room: out.room });

  // tell peers a slot is now online + (maybe) state changed
  broadcastAll(out.room,
    { type: 'peer-state', slots: out.room.occupants(), paired: out.room.isPaired() },
    { token });
  broadcastAll(out.room,
    { type: 'peer-online', peer: out.slot, online: true },
    { token });
  if (out.justPaired) {
    broadcastAll(out.room, { type: 'paired', pairedAt: out.room.pairedAt }, null);
  }

  const reply = { ...out.result, sessionToken: token };
  if (out.batch && out.batch.length) reply.batch = out.batch;
  if (out.room.isPaired()) reply.pairedAt = out.room.pairedAt;
  sendJSON(res, 200, reply);
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
  if (t === 'msg' || t === 'typing' || t === 'delete') {
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

// Process one item (msg or typing). Pushes to peer and returns msg id (or null).
function handleOne(sess, room, item) {
  if (item.type === 'msg') {
    if (typeof item.iv !== 'string' || typeof item.ct !== 'string') return null;
    const id = item.id || crypto.randomBytes(8).toString('hex');
    const other = sess.slot === 'A' ? 'B' : 'A';
    const stored = {
      id, from: sess.slot, iv: item.iv, ct: item.ct,
      time: item.time || nowHHMM(),
      bytes: item.iv.length + item.ct.length + 64,
    };
    appendHistory(room, stored);
    for (const s of room.sessions.values()) {
      if (s.slot === other) pushEvent(s, { type: 'msg', ...stored });
    }
    for (const s of room.sockets) {
      if (s.slot === other) {
        try { s.ws.send(JSON.stringify({ type: 'msg', ...stored })); } catch {}
      }
    }
    return id;
  }
  if (item.type === 'typing') {
    const other = sess.slot === 'A' ? 'B' : 'A';
    for (const s of room.sessions.values()) {
      if (s.slot === other) pushEvent(s, { type: 'typing', on: !!item.on });
    }
    for (const s of room.sockets) {
      if (s.slot === other) {
        try { s.ws.send(JSON.stringify({ type: 'typing', on: !!item.on })); } catch {}
      }
    }
    return null;
  }
  if (item.type === 'delete') {
    // Allow either side to delete from the shared log (own messages by design,
    // but we don't enforce — both sides have already seen it anyway).
    const idx = room.history.findIndex(x => x.id === item.id);
    if (idx >= 0) {
      const dropped = room.history.splice(idx, 1)[0];
      room.historyBytes -= dropped.bytes;
    }
    const other = sess.slot === 'A' ? 'B' : 'A';
    const ev = { type: 'msg-delete', id: item.id };
    for (const s of room.sessions.values()) {
      if (s.slot === other) pushEvent(s, ev);
    }
    for (const s of room.sockets) {
      if (s.slot === other) { try { s.ws.send(JSON.stringify(ev)); } catch {} }
    }
    return null;
  }
  return null;
}

function handleSessionGone(sess, room, notify) {
  room.sessions.delete(sess.token);
  tokenIndex.delete(sess.token);
  if (notify && !room.isSlotOnline(sess.slot)) {
    broadcastAll(room, { type: 'peer-online', peer: sess.slot, online: false }, null);
  }
  if (sess.pollWaiter) {
    clearTimeout(sess.pollWaiter.timeout);
    sess.pollWaiter.resolve(sess.pendingEvents.splice(0));
    sess.pollWaiter = null;
  }
}

async function handlePoll(req, res, url) {
  const token = url.searchParams.get('token');
  if (!token) return sendJSON(res, 400, { ok: false, reason: 'no-token' });

  const entry = tokenIndex.get(token);
  if (!entry) return sendJSON(res, 401, { ok: false, reason: 'bad-token' });
  const { sess } = entry;
  sess.lastSeen = Date.now();

  if (sess.pendingEvents.length) {
    const events = sess.pendingEvents.splice(0);
    return sendJSON(res, 200, { ok: true, events });
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { sess.pollWaiter = null; resolve(); }, POLL_HOLD_MS);
    sess.pollWaiter = { resolve: (events) => { resolve(events); }, timeout };
  });
  const events = sess.pendingEvents.splice(0);
  sendJSON(res, 200, { ok: true, events });
}

// SSE — a single long-lived connection. Server flushes each event the moment
// it happens, so multi-message bursts arrive with zero per-event gap.
function handleStream(req, res, url) {
  const token = url.searchParams.get('token');
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

// ─── WebSocket transport (kept for direct/dev use) ──────────
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const roomId = url.searchParams.get('room');
  if (!roomId || !/^[a-f0-9]{32}$/.test(roomId)) { socket.destroy(); return; }

  wss.handleUpgrade(req, socket, head, (ws) => {
    let mySlot = null;
    let myRoom = rooms.get(roomId) || null;
    if (myRoom && myRoom.expiresAt <= Date.now()) { destroyRoom(roomId); myRoom = null; }

    const safeSend = (obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };

    if (!myRoom) safeSend({ type: 'room-state', exists: false });
    else safeSend({
      type: 'room-state', exists: true,
      createdAt: myRoom.createdAt, expiresAt: myRoom.expiresAt, ttlMs: myRoom.ttlMs,
      slots: myRoom.occupants(), paired: myRoom.isPaired(),
    });

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m.type !== 'string') return;

      if (m.type === 'claim') {
        const out = performClaim(roomId, m);
        if (!out.result.ok) return safeSend(out.result);
        mySlot = out.slot;
        myRoom = out.room;
        myRoom.sockets.add({ ws, slot: mySlot });
        safeSend(out.result);
        if (out.batch && out.batch.length) safeSend({ type: 'msg-batch', items: out.batch });
        broadcastAll(myRoom, {
          type: 'peer-state', slots: myRoom.occupants(), paired: myRoom.isPaired(),
        }, { ws });
        broadcastAll(myRoom, { type: 'peer-online', peer: mySlot, online: true }, { ws });
        if (out.justPaired) {
          broadcastAll(myRoom, { type: 'paired', pairedAt: myRoom.pairedAt }, null);
          safeSend({ type: 'paired', pairedAt: myRoom.pairedAt });
        } else if (myRoom.isPaired()) {
          safeSend({ type: 'paired', pairedAt: myRoom.pairedAt });
        }
        return;
      }

      if (!myRoom || !mySlot) return;

      if (m.type === 'msg') {
        if (typeof m.iv !== 'string' || typeof m.ct !== 'string') return;
        const id = m.id || crypto.randomBytes(8).toString('hex');
        const other = mySlot === 'A' ? 'B' : 'A';
        const item = {
          id, from: mySlot, iv: m.iv, ct: m.ct,
          time: m.time || nowHHMM(),
          bytes: m.iv.length + m.ct.length + 64,
        };
        appendHistory(myRoom, item);
        for (const s of myRoom.sockets) {
          if (s.slot === other) { try { s.ws.send(JSON.stringify({ type: 'msg', ...item })); } catch {} }
        }
        for (const s of myRoom.sessions.values()) {
          if (s.slot === other) pushEvent(s, { type: 'msg', ...item });
        }
        safeSend({ type: 'msg-stored', id });
        return;
      }

      if (m.type === 'ack') {
        // no-op (see HTTP handler comment)
        return;
      }

      if (m.type === 'typing') {
        const other = mySlot === 'A' ? 'B' : 'A';
        for (const s of myRoom.sockets) {
          if (s.slot === other) { try { s.ws.send(JSON.stringify({ type: 'typing', on: !!m.on })); } catch {} }
        }
        for (const s of myRoom.sessions.values()) {
          if (s.slot === other) pushEvent(s, { type: 'typing', on: !!m.on });
        }
        return;
      }

      if (m.type === 'leave') { try { ws.close(); } catch {}; return; }
    });

    ws.on('close', () => {
      if (!myRoom) return;
      for (const s of [...myRoom.sockets]) if (s.ws === ws) myRoom.sockets.delete(s);
      if (mySlot && !myRoom.isSlotOnline(mySlot)) {
        broadcastAll(myRoom, { type: 'peer-online', peer: mySlot, online: false }, null);
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
    const slotStillOnlineBefore = { A: room.isSlotOnline('A'), B: room.isSlotOnline('B') };
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
    for (const slot of ['A', 'B']) {
      const isOnlineNow = room.isSlotOnline(slot);
      if (slotStillOnlineBefore[slot] && !isOnlineNow) {
        broadcastAll(room, { type: 'peer-online', peer: slot, online: false }, null);
      }
    }
  }
}, SESSION_GC_INTERVAL);

server.listen(PORT, HOST, () => {
  console.log(`hush. running at http://${HOST}:${PORT}`);
});
