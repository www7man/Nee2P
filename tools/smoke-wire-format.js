// smoke-wire-format.js — bare-bones end-to-end check that the relay's
// post-refactor wire format does what the audit asked for:
//   1) Two clients claim a room and exchange a text msg
//   2) Receiver gets the AES-GCM-encrypted JSON wrapper, decrypts, reads `text`
//   3) Sender ships a "voice" envelope where waveform lives INSIDE the
//      encrypted ct (not on the blob descriptor). Verify relay strips
//      name/thumb/waveform from the envelope blob.
//   4) GET /r/blob returns blob bytes
//   5) Legacy msg (plain text, no JSON wrapper) still surfaces as text on the
//      receiver — we mimic by sending a plaintext-as-string and applying the
//      same receiver-side JSON.parse-with-fallback logic.
//
// All crypto is done with Node's webcrypto and both clients share one AES-GCM
// key. The relay is agnostic to which key is in use — it only sees opaque
// {iv, ct} strings — so the relay-side assertions remain meaningful.

const crypto = require('crypto');
const http = require('http');
const subtle = crypto.webcrypto.subtle;

const HOST = '127.0.0.1';
const PORT = 9787;

function b64(bytes) { return Buffer.from(bytes).toString('base64'); }
function unb64(s) { return new Uint8Array(Buffer.from(s, 'base64')); }

async function sha256Hex(s) {
  const h = await subtle.digest('SHA-256', Buffer.from(s));
  return Buffer.from(h).toString('hex');
}
async function passwordSlotHash(roomId, password) {
  return sha256Hex(roomId + '|' + password);
}

async function genSessionKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function exportRaw(key) { return new Uint8Array(await subtle.exportKey('raw', key)); }
async function importRaw(bytes) {
  return subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
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
async function encryptBytes(key, bytes) {
  const iv = crypto.randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv, ct };
}

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

async function postJSON(path, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const r = await httpRequest({
    host: HOST, port: PORT, method: 'POST', path,
    headers: { 'content-type': 'application/json', 'content-length': body.length },
  }, body);
  let j; try { j = JSON.parse(r.body.toString()); } catch { j = null; }
  return { status: r.status, json: j };
}

async function getEvents(token) {
  // Short-poll: one call drains pendingEvents. If empty, it hangs up to ~25s;
  // we don't need long-poll here so a small timeout works.
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

async function putBlob(token, bytes) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST, port: PORT, method: 'PUT',
      path: '/r/blob?token=' + token,
      headers: { 'content-type': 'application/octet-stream', 'content-length': bytes.length },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let j; try { j = JSON.parse(Buffer.concat(chunks).toString()); } catch { j = null; }
        resolve({ status: res.statusCode, json: j });
      });
    });
    req.on('error', reject);
    req.write(bytes);
    req.end();
  });
}

async function getBlob(token, blobId) {
  // GET /r/blob/:id — needs token (same session model as upload).
  return httpRequest({ host: HOST, port: PORT, method: 'GET',
    path: '/r/blob/' + blobId + '?token=' + token });
}

async function main() {
  const room = crypto.randomBytes(16).toString('hex');  // 32 hex chars
  console.log('room =', room);

  const key = await genSessionKey();
  const keyRawA = await exportRaw(key);
  const keyB = await importRaw(keyRawA);

  // ─── HTTP claim for A and B (2-party) ───────────────────────
  const hashA = await passwordSlotHash(room, 'pw-alice');
  const hashB = await passwordSlotHash(room, 'pw-bob');
  const cA = await postJSON('/r/claim', { room, passwordHash: hashA, ttlMs: 60 * 60 * 1000 });
  if (!cA.json || !cA.json.ok) throw new Error('A claim failed: ' + JSON.stringify(cA));
  const tokenA = cA.json.sessionToken;
  const cB = await postJSON('/r/claim', { room, passwordHash: hashB });
  if (!cB.json || !cB.json.ok) throw new Error('B claim failed: ' + JSON.stringify(cB));
  const tokenB = cB.json.sessionToken;
  console.log('  claim OK (A slot=' + cA.json.slot + ', B slot=' + cB.json.slot + ')');

  // ─── Test 1: A → B text msg ─────────────────────────────────
  const wrap1 = JSON.stringify({ text: 'hello from alice', time: '12:34' });
  const enc1 = await encryptStr(key, wrap1);
  const s1 = await postJSON('/r/send', {
    token: tokenA, type: 'msg', iv: enc1.iv, ct: enc1.ct, id: 'msg1',
  });
  if (!s1.json || !s1.json.ok) throw new Error('send msg1 failed: ' + JSON.stringify(s1));
  const got1 = await pollUntil(tokenB, ev => ev.type === 'msg' && ev.id === 'msg1');
  if (!got1) throw new Error('B never received msg1');
  // Verify relay didn't leak an `ivCt` we didn't send
  if (got1.ivCt) throw new Error('relay invented ivCt: ' + JSON.stringify(got1));
  const plain1 = await decryptStr(keyB, got1.iv, got1.ct);
  const parsed1 = JSON.parse(plain1);
  if (parsed1.text !== 'hello from alice') throw new Error('text mismatch: ' + plain1);
  if (parsed1.time !== '12:34') throw new Error('inner time mismatch: ' + plain1);
  console.log('  test 1 OK — text inside JSON wrapper decrypts');

  // ─── Test 2: A → B voice msg ────────────────────────────────
  // waveform/name/thumb live inside the encrypted JSON; envelope blob ONLY
  // carries blobId/mime/size/kind/durationMs.
  const audioBytes = crypto.randomBytes(2048);
  const audioCt = await encryptBytes(key, audioBytes);
  const up = await putBlob(tokenA, Buffer.from(audioCt.ct));
  if (!up.json || !up.json.ok) throw new Error('blob upload failed: ' + JSON.stringify(up));
  const audioIvB64 = b64(audioCt.iv);
  const waveform = Array.from({ length: 48 }, (_, i) => +Math.sin(i / 5).toFixed(3));
  const wrap2 = JSON.stringify({
    text: '', time: '12:35',
    blobMeta: { name: 'secret-recording.webm', thumb: '', waveform },
  });
  const enc2 = await encryptStr(key, wrap2);
  const evilBlob = {
    blobId: up.json.blobId,
    mime: 'audio/webm',
    size: audioBytes.length,
    kind: 'voice',
    durationMs: 4000,
    // These three SHOULD be stripped by the relay:
    name: 'leaky-name.webm',
    thumb: 'data:image/jpeg;base64,leakyleakyleaky',
    waveform: [1, 2, 3, 4],
  };
  const s2 = await postJSON('/r/send', {
    token: tokenA, type: 'msg', iv: audioIvB64, ct: enc2.ct, ivCt: enc2.iv,
    id: 'msg2', blob: evilBlob,
  });
  if (!s2.json || !s2.json.ok) throw new Error('send msg2 failed: ' + JSON.stringify(s2));
  const got2 = await pollUntil(tokenB, ev => ev.type === 'msg' && ev.id === 'msg2');
  if (!got2) throw new Error('B never received msg2');
  const sanitizedKeys = Object.keys(got2.blob || {}).sort();
  const expectKeys = ['blobId', 'durationMs', 'kind', 'mime', 'size'];
  const leakedKeys = sanitizedKeys.filter(k => !expectKeys.includes(k));
  if (leakedKeys.length) throw new Error('relay leaked blob keys: ' + leakedKeys.join(','));
  if (sanitizedKeys.join(',') !== expectKeys.join(',')) {
    throw new Error('relay blob shape unexpected: ' + sanitizedKeys.join(','));
  }
  if (!got2.ivCt) throw new Error('relay dropped ivCt');
  const plain2 = await decryptStr(keyB, got2.ivCt, got2.ct);
  const parsed2 = JSON.parse(plain2);
  if (!parsed2.blobMeta || !Array.isArray(parsed2.blobMeta.waveform)
      || parsed2.blobMeta.waveform.length !== 48) {
    throw new Error('waveform missing from decrypted payload');
  }
  if (parsed2.blobMeta.name !== 'secret-recording.webm') {
    throw new Error('encrypted name not preserved');
  }
  console.log('  test 2 OK — relay stripped name/thumb/waveform; waveform survived inside ct');

  // ─── Test 3: GET /r/blob round-trip ─────────────────────────
  const dl = await getBlob(tokenB, up.json.blobId);
  if (dl.status !== 200 || dl.body.length !== audioCt.ct.length) {
    throw new Error('blob GET wrong status/length: ' + dl.status + ' / ' + dl.body.length);
  }
  console.log('  test 3 OK — GET /r/blob returned ciphertext');

  // ─── Test 4: legacy plain-text encrypted payload ────────────
  const legacyPlain = 'plain text from a legacy client';
  const encLegacy = await encryptStr(key, legacyPlain);
  const s3 = await postJSON('/r/send', {
    token: tokenA, type: 'msg', iv: encLegacy.iv, ct: encLegacy.ct,
    id: 'msg3', time: '12:36',
  });
  if (!s3.json || !s3.json.ok) throw new Error('send msg3 failed: ' + JSON.stringify(s3));
  const got3 = await pollUntil(tokenB, ev => ev.type === 'msg' && ev.id === 'msg3');
  if (!got3) throw new Error('B never received msg3');
  const plain3 = await decryptStr(keyB, got3.iv, got3.ct);
  // Apply the receiver's JSON-parse-with-fallback policy: try parse, if it
  // fails or has no `text` field, use the whole string AS text.
  let interpreted;
  try {
    const j = JSON.parse(plain3);
    interpreted = (j && typeof j.text === 'string') ? j.text : plain3;
  } catch { interpreted = plain3; }
  if (interpreted !== legacyPlain) throw new Error('legacy fallback mismatch: ' + interpreted);
  console.log('  test 4 OK — legacy plaintext-as-string survives the receiver fallback');

  console.log('ALL SMOKE TESTS PASSED');
  process.exit(0);
}

main().catch(e => { console.error('SMOKE FAILED:', e); process.exit(1); });
