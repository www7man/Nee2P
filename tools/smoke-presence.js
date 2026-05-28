// smoke-presence.js — regression test for asymmetric peer-online + verifies
// bi-directional msg delivery at the wire level.
//
// Bug (pre-fix): when a second user joins a room, the relay broadcast tells
// the incumbent peer "the new slot is online", but the relay never informs
// the new joiner about peers already in the room. The joiner's client
// (nee2p-app.jsx) starts with peerOnline = new Map() and only updates on
// peer-online events, so the new joiner shows the incumbent as offline
// forever — even though messages flow both ways at the wire level.
//
// Fix: handleClaim (HTTP) + WS upgrade block push peer-online events for
//      every already-online slot into the new session's queue, mirroring the
//      "broadcast to others" path.
//
// This test spawns its OWN server.js on a non-conflicting port so it can run
// side-by-side with a launchd-managed prod relay on 9787.

const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const subtle = crypto.webcrypto.subtle;

const HOST = '127.0.0.1';
const PORT = 9888;
const ROOT_DIR  = path.resolve(__dirname, '..');
const SERVER_JS = path.join(ROOT_DIR, 'server.js');

// ── tiny crypto helpers (shared AES-GCM key is enough — relay treats payload
//    as opaque base64). Mirrors the smoke-wire-format.js style.
function b64(bytes) { return Buffer.from(bytes).toString('base64'); }
function unb64(s)   { return new Uint8Array(Buffer.from(s, 'base64')); }
async function sha256Hex(s) {
  const h = await subtle.digest('SHA-256', Buffer.from(s));
  return Buffer.from(h).toString('hex');
}
async function passwordSlotHash(roomId, password) {
  return sha256Hex(roomId + '|' + password);
}
async function genKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function encryptStr(key, plain) {
  const iv = crypto.randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(plain)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decryptStr(key, ivB64, ctB64) {
  const iv = unb64(ivB64);
  const ct = unb64(ctB64);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return Buffer.from(pt).toString('utf8');
}

// ── HTTP helpers ───────────────────────────────────────────────
function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
async function putJSON(p, obj) {
  // Yandex CDN strips POST → the relay accepts PUT for /r/* writes. Mirror
  // the production client (http-client.js).
  const body = Buffer.from(JSON.stringify(obj));
  const r = await httpRequest({
    host: HOST, port: PORT, method: 'PUT', path: '/r/' + p,
    headers: { 'content-type': 'application/json', 'content-length': body.length },
  }, body);
  let j; try { j = JSON.parse(r.body.toString()); } catch { j = null; }
  return { status: r.status, json: j };
}
async function getEvents(token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST, port: PORT, method: 'GET',
      path: '/r/poll?token=' + token,
      timeout: 3000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let j; try { j = JSON.parse(Buffer.concat(chunks).toString()); } catch { j = null; }
        resolve(j);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); resolve({ ok: true, events: [] }); });
    req.end();
  });
}
async function pollUntil(token, predicate, maxTries = 6) {
  for (let i = 0; i < maxTries; i++) {
    const r = await getEvents(token);
    if (r && Array.isArray(r.events)) {
      for (const ev of r.events) {
        if (predicate(ev)) return ev;
      }
    }
  }
  return null;
}

// ── child server management ────────────────────────────────────
let child = null;
function shutdown() {
  if (child && !child.killed) {
    try { child.kill('SIGTERM'); } catch {}
  }
}
process.on('exit', shutdown);
process.on('SIGINT',  () => { shutdown(); process.exit(130); });
process.on('SIGTERM', () => { shutdown(); process.exit(143); });

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await httpRequest({ host: HOST, port: PORT, method: 'GET', path: '/' });
      if (r.status === 200 || r.status === 404) return true; // 404 also means "responsive"
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  child = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, PORT: String(PORT), HOST, ADMIN_KEY: 'smoke-presence' },
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Surface server stderr only on failure — capture into a buffer so we can
  // dump it if the test asserts.
  let stderrBuf = '';
  child.stderr.on('data', d => { stderrBuf += d.toString(); });
  child.on('exit', (code, sig) => {
    if (code !== null && code !== 0) {
      console.error('child server exited code=' + code + ' sig=' + sig);
      if (stderrBuf) console.error('--- child stderr ---\n' + stderrBuf);
    }
  });

  if (!await waitForServer(8000)) {
    if (stderrBuf) console.error('--- child stderr ---\n' + stderrBuf);
    throw new Error('child server did not boot within 8s on ' + HOST + ':' + PORT);
  }
  console.log('child relay up on', HOST + ':' + PORT);

  const room = crypto.randomBytes(16).toString('hex');
  console.log('room =', room);
  const hashA = await passwordSlotHash(room, 'pw-alice');
  const hashB = await passwordSlotHash(room, 'pw-bob');

  // ─── 1. A claims (creates room, slot 0) ────────────────────
  const cA = await putJSON('claim', { room, passwordHash: hashA, ttlMs: 60 * 60 * 1000 });
  if (!cA.json || !cA.json.ok) throw new Error('A claim failed: ' + JSON.stringify(cA));
  const tokenA = cA.json.sessionToken;
  if (cA.json.slot !== 'A') throw new Error('expected A slot="A", got ' + cA.json.slot);
  console.log('  ✓ A claimed slot=A');

  // ─── 2. B claims (joins, slot 1) ──────────────────────────
  const cB = await putJSON('claim', { room, passwordHash: hashB });
  if (!cB.json || !cB.json.ok) throw new Error('B claim failed: ' + JSON.stringify(cB));
  const tokenB = cB.json.sessionToken;
  if (cB.json.slot !== 'B') throw new Error('expected B slot="B", got ' + cB.json.slot);
  if (cB.json.paired !== true) throw new Error('expected paired=true after B claim');
  console.log('  ✓ B claimed slot=B, paired=true');

  // ─── 3. A polls → expect peer-online B (the sanity baseline) ─
  const aSawB = await pollUntil(tokenA,
    ev => ev.type === 'peer-online' && ev.peer === 'B' && ev.online === true);
  if (!aSawB) throw new Error('A never received peer-online B (sanity baseline failed)');
  console.log('  ✓ A received peer-online B');

  // ─── 4. B polls → expect peer-online A (THE BUG REGRESSION CHECK) ─
  // Pre-fix: this event never fires because broadcastAll(peer-online,
  // except:{token:B}) excludes B, and there is no symmetric loop that
  // tells B about incumbents.
  const bSawA = await pollUntil(tokenB,
    ev => ev.type === 'peer-online' && ev.peer === 'A' && ev.online === true);
  if (!bSawA) {
    throw new Error(
      'REGRESSION: B never received peer-online A. The relay informed the ' +
      'incumbent (A) that B came online but failed to inform the new joiner ' +
      '(B) about the incumbent (A). UI will show A as offline indefinitely.'
    );
  }
  console.log('  ✓ B received peer-online A (regression check — primary bug)');

  // ─── 5. Bi-directional msg flow ─────────────────────────────
  // The relay treats {iv, ct} as opaque base64 — we share one AES-GCM key
  // so this test doesn't have to model the sender-key handshake (that's
  // covered by smoke-wire-format.js). Goal here is to verify that
  // handleOne's broadcastToOthers reaches BOTH directions.
  const key = await genKey();

  const m1 = await encryptStr(key, 'hello B, this is A');
  const s1 = await putJSON('send',
    { token: tokenA, type: 'msg', iv: m1.iv, ct: m1.ct, id: 'a1' });
  if (!s1.json || !s1.json.ok) throw new Error('A → B send failed: ' + JSON.stringify(s1));
  const got1 = await pollUntil(tokenB, ev => ev.type === 'msg' && ev.id === 'a1');
  if (!got1) throw new Error('B never received A → B msg (one-way delivery regression)');
  const plain1 = await decryptStr(key, got1.iv, got1.ct);
  if (plain1 !== 'hello B, this is A') throw new Error('A → B payload corrupted: ' + plain1);
  if (got1.from !== 'A') throw new Error('A → B msg `from` wrong: ' + got1.from);
  console.log('  ✓ A → B msg delivered, from=A');

  const m2 = await encryptStr(key, 'hi A, this is B');
  const s2 = await putJSON('send',
    { token: tokenB, type: 'msg', iv: m2.iv, ct: m2.ct, id: 'b1' });
  if (!s2.json || !s2.json.ok) throw new Error('B → A send failed: ' + JSON.stringify(s2));
  const got2 = await pollUntil(tokenA, ev => ev.type === 'msg' && ev.id === 'b1');
  if (!got2) throw new Error('A never received B → A msg (one-way delivery regression)');
  const plain2 = await decryptStr(key, got2.iv, got2.ct);
  if (plain2 !== 'hi A, this is B') throw new Error('B → A payload corrupted: ' + plain2);
  if (got2.from !== 'B') throw new Error('B → A msg `from` wrong: ' + got2.from);
  console.log('  ✓ B → A msg delivered, from=B');

  // ─── 6. Already-online presence delivered to RESTORED claim too ──
  // When a peer reconnects with the same passwordHash, performClaim returns
  // mode:'restored'. The new joiner-presence fix must apply to that path
  // too — otherwise a flaky network producing a reclaim cycle would leave
  // the peerOnline map stuck.
  const cBagain = await putJSON('claim', { room, passwordHash: hashB });
  if (!cBagain.json || !cBagain.json.ok) throw new Error('B restore failed: ' + JSON.stringify(cBagain));
  if (cBagain.json.mode !== 'restored') {
    throw new Error('expected B restore mode=restored, got ' + cBagain.json.mode);
  }
  const tokenB2 = cBagain.json.sessionToken;
  const bAgainSawA = await pollUntil(tokenB2,
    ev => ev.type === 'peer-online' && ev.peer === 'A' && ev.online === true);
  if (!bAgainSawA) {
    throw new Error('REGRESSION: restored B never received peer-online A — incumbent presence not replayed on reclaim');
  }
  console.log('  ✓ restored B also received peer-online A');

  console.log('\nALL PRESENCE / BI-DIRECTIONAL DELIVERY SMOKE TESTS PASSED');
}

main()
  .then(() => { shutdown(); process.exit(0); })
  .catch(e => {
    console.error('\nSMOKE FAILED:', (e && e.message) || e);
    shutdown();
    process.exit(1);
  });
