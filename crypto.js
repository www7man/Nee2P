// crypto.js — WebCrypto helpers for Nee2P. messenger.
//
// Three layers of secrets (the session key is mixed from all three):
//   • phrase     → "phrase key" (Argon2id, fallback PBKDF2) — long-term,
//                  knowable by anyone who knows the phrase. Used both as a
//                  fallback AES key AND as one of the HKDF inputs. The KDF
//                  salt mixes in the room seed (`hush.v3.argon2id:<seed>` /
//                  `hush.v3.pbkdf2:<seed>`) so a global precomputed table on
//                  the static salt no longer helps — each room gets its own
//                  derivation domain. PBKDF2 fallback uses 600k iterations
//                  (OWASP 2023 for SHA-256).
//   • X25519     → ephemeral keypair per connect. The ECDH shared secret is
//                  mixed with the phrase key via HKDF-SHA256 to produce the
//                  AES-GCM session key. Recorded ciphertext can't be decrypted
//                  later even if the phrase leaks, because the private keys
//                  are discarded after the session ends.
//   • ML-KEM-768 → post-quantum KEM (FIPS 203). Each side generates a KEM
//                  keypair; the peer encapsulates against the public key and
//                  ships the 1088-byte ciphertext back. Both sides arrive at
//                  the same 32-byte shared secret. Mixed into the same HKDF
//                  so the session key is secure as long as EITHER X25519 OR
//                  ML-KEM holds — a future CRQC that breaks X25519 still
//                  can't decrypt recorded ciphertext.
//
// HKDF IKM = ECDH_shared || phraseKeyRaw || (optionally) KEM_shared
//   salt = roomIdBytes      info = "hush.v3.session" / "hush.v3.session.pq"
//
// What the server sees per msg envelope:
//   { iv, ct, id, from, epoch, replyTo?, expireSecAfterRead?,
//     blob{blobId, mime, size, kind, durationMs}? }
// The relay no longer sees `time` (was a client-supplied HH:MM that leaked
// timezone), `blob.name` (filename), `blob.thumb` (jpeg preview) or
// `blob.waveform` (audio energy curve) — those fields now live INSIDE the
// AES-GCM payload as a JSON wrapper `{text, time?, blobMeta?}`.
//
// Library posture is surfaced in the SafetyNumbersModal so users see what
// actually fired for their session:
//   window.Nee2PCrypto.kdfMode       = 'argon2id' | 'pbkdf2'
//   window.Nee2PCrypto.x25519Source  = 'subtle' | 'noble' | 'stablelib' | 'unavailable'
//   window.Nee2PCrypto.kemAvailable  = true | false
//
// The server never sees plaintext — it only relays {iv, ct} blobs, public keys,
// KEM public keys, KEM ciphertexts, and SHA-256 passwordHashes.
(function (g) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ── helpers ───────────────────────────────────────────────
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ── deriveKey: phrase → 32 raw bytes + AES-GCM CryptoKey ──
  //
  // Argon2id (time=3, mem=64MiB, p=1, len=32) when the WASM library is loaded;
  // PBKDF2-SHA256 600k as a fallback (OWASP 2023 recommendation for SHA-256).
  // Both produce 32 bytes that we use BOTH as the legacy phrase-only AES-GCM
  // key (for the historical no-pubKey path) AND as the HKDF salt-like input
  // for the ECDH session key.
  //
  // Salt mixes in the room seed: `hush.v3.argon2id:<seed>` / `hush.v3.pbkdf2:<seed>`.
  // This is a deliberate one-way migration — old (v2-static-salt) sessions
  // cannot be restored — but the relay's in-RAM history TTL is ≤7d so old
  // data washes out naturally. The benefit is that a precomputed rainbow
  // table on the static `hush.v2.argon2id` salt no longer helps an attacker
  // even if they captured all relayed ciphertext.
  //
  // Sets `g.Nee2PCrypto.kdfMode = 'argon2id' | 'pbkdf2'` so the safety modal
  // can show users whether the strong KDF actually fired.
  async function deriveKey(seed) {
    const seedStr = String(seed || '');
    let raw = null;
    let mode = null;
    const argon = g.argon2 || g.Argon2 || (typeof window !== 'undefined' && (window.argon2 || window.Argon2));
    if (argon && typeof argon.hash === 'function') {
      try {
        // argon2-browser exposes { hash(): {hash: Uint8Array, hashHex, encoded} }.
        // Constants: type=2 (Argon2id), time=3, mem=65536 KiB, parallelism=1.
        const ArgonType = (argon.ArgonType && argon.ArgonType.Argon2id != null) ? argon.ArgonType.Argon2id : 2;
        const r = await argon.hash({
          pass: seedStr,
          salt: 'hush.v3.argon2id:' + seedStr,  // domain-separate per room
          type: ArgonType,
          time: 3,
          mem: 65536,
          parallelism: 1,
          hashLen: 32,
        });
        if (r && r.hash && r.hash.length === 32) {
          raw = new Uint8Array(r.hash);
          mode = 'argon2id';
        }
      } catch (e) {
        console.warn('argon2 hash failed, falling back to PBKDF2:', e && e.message ? e.message : e);
      }
    } else {
      console.warn('argon2 library unavailable, falling back to PBKDF2-600k');
    }

    if (!raw) {
      const baseKey = await crypto.subtle.importKey(
        'raw', enc.encode(seedStr),
        { name: 'PBKDF2' }, false, ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2',
          salt: enc.encode('hush.v3.pbkdf2:' + seedStr),
          iterations: 600000,
          hash: 'SHA-256' },
        baseKey,
        256
      );
      raw = new Uint8Array(bits);
      mode = 'pbkdf2';
    }

    // Public flag so SafetyNumbersModal can show "Argon2id ✓" vs PBKDF2-fallback.
    try { if (g.Nee2PCrypto) g.Nee2PCrypto.kdfMode = mode; } catch {}

    const key = await crypto.subtle.importKey(
      'raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return { key, rawBytes: raw, kdfMode: mode };
  }

  async function encrypt(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, enc.encode(String(plaintext))
    );
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }

  async function decrypt(key, ivB64, ctB64) {
    const iv = unb64(ivB64);
    const ct = unb64(ctB64);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  }

  // ── raw-byte AES-GCM (for blobs / files / voice) ──────────
  // Identical primitives as encrypt/decrypt above, but the plaintext is an
  // arbitrary Uint8Array and the iv/ct stay raw bytes (NOT base64) so we can
  // shovel them through PUT body / fetch without inflating to ~33% overhead.
  async function encryptBytes(key, uint8) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, uint8);
    return { iv, ct: new Uint8Array(ctBuf) };
  }

  async function decryptBytes(key, iv, ct) {
    const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new Uint8Array(ptBuf);
  }

  // SHA-256 hex of an arbitrary string. Used to derive the per-slot
  // passwordHash the relay uses for slot ownership: hex(SHA-256(roomId + '|' + password)).
  // The server never sees the plaintext password.
  async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(s || '')));
    const a = new Uint8Array(buf);
    let h = '';
    for (let i = 0; i < a.length; i++) h += a[i].toString(16).padStart(2, '0');
    return h;
  }

  async function passwordSlotHash(roomId, password) {
    return sha256Hex(String(roomId || '') + '|' + String(password || ''));
  }

  // ── X25519 ephemeral keypair ──────────────────────────────
  //
  // Try WebCrypto first (Chrome 133+, Safari 18.4+, Firefox 130+ with flag).
  // Fall back to @stablelib/x25519 / @noble/curves x25519 if loaded from CDN.
  let _subtleX25519 = null;             // null = unknown, true/false after probe
  async function probeSubtleX25519() {
    if (_subtleX25519 !== null) return _subtleX25519;
    try {
      const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
      _subtleX25519 = !!(kp && kp.publicKey && kp.privateKey);
    } catch (_) {
      _subtleX25519 = false;
    }
    return _subtleX25519;
  }

  function _getStablelibX25519() {
    // UMD globals from CDN. @stablelib/x25519 exposes window.x25519 (named export
    // via UMD wrapper); some bundles expose window.stablelib or @stablelib.
    const c = g;
    const cand =
      (c.nacl && c.nacl.box && c.nacl.box.keyPair && c.nacl) ||
      c.x25519 ||
      (c.stablelib && c.stablelib.x25519) ||
      (c['@stablelib'] && c['@stablelib'].x25519) ||
      null;
    if (!cand) return null;
    // Normalise to {generateKeyPair, sharedKey} shape from @stablelib/x25519.
    if (typeof cand.generateKeyPair === 'function' && typeof cand.sharedKey === 'function') return cand;
    // tweetnacl-style fallback (.box.keyPair / .box.before): not what we want
    // for raw X25519, skip.
    return null;
  }

  function _getNobleX25519() {
    const c = g;
    // @noble/curves UMD ships as window.nobleCurves with .ed25519 / .x25519,
    // OR via a one-shot dynamic ESM import (preferred — no UMD globals needed).
    const cand =
      c.__nee2pX25519 ||
      (c.nobleCurves && c.nobleCurves.x25519) ||
      (c.noble && c.noble.curves && c.noble.curves.x25519) ||
      c.x25519noble ||
      null;
    if (!cand) return null;
    // @noble/curves x25519 API: utils.randomPrivateKey(), getPublicKey(priv), getSharedSecret(priv, pub), scalarMult
    if (typeof cand.getPublicKey === 'function' && typeof cand.getSharedSecret === 'function') return cand;
    return null;
  }

  // Lazily import vendor/noble-ed25519.bundle.mjs via ESM dynamic import.
  // The vendor bundle is self-contained (no further network fetches).
  //
  // VENDOR-ONLY, fail-closed: we deliberately do NOT chase any CDN here so
  // the loader cannot fetch JS from a remote origin under a hostile network.
  // If the vendor file is missing we surface a clear error and let WebCrypto
  // Subtle X25519 (Chrome 133+, Safari 18.4+, Firefox 130+) carry the session.
  let _nobleLoadPromise = null;
  function _loadNobleX25519() {
    if (g.__nee2pX25519) return Promise.resolve(g.__nee2pX25519);
    if (_nobleLoadPromise) return _nobleLoadPromise;
    _nobleLoadPromise = (async () => {
      const here = (typeof location !== 'undefined') ? location.pathname.replace(/[^/]*$/, '') : '';
      const url = here + 'vendor/noble-ed25519.bundle.mjs';
      try {
        // eslint-disable-next-line no-new-func
        const mod = await (new Function('u', 'return import(u)'))(url);
        if (mod && mod.x25519 && typeof mod.x25519.getPublicKey === 'function') {
          g.__nee2pX25519 = mod.x25519;
          return mod.x25519;
        }
        throw new Error('noble bundle loaded but missing x25519 export');
      } catch (e) {
        console.error('vendor/noble-ed25519.bundle.mjs unavailable — falling back to WebCrypto Subtle X25519 only:',
          e && e.message ? e.message : e);
        throw e;
      }
    })();
    return _nobleLoadPromise;
  }

  // ── ML-KEM-768 (post-quantum hybrid) ──────────────────────
  //
  // Lazy ESM import of vendor/mlkem.bundle.mjs (21KB, fully self-contained
  // build of the `mlkem` npm package). API:
  //   const r = new MlKem768();
  //   const [pk, sk]   = await r.generateKeyPair();   // pk=1184B, sk=2400B
  //   const [ct, ssS]  = await sender.encap(pk);      // ct=1088B, ss=32B
  //   const ssR        = await r.decap(ct, sk);       // ss=32B
  // We wrap each call in our existing b64 helpers so the wire format stays a
  // string. The sk is opaque — we never need to serialize it; it lives in
  // memory for the lifetime of the session and is dropped on cleanup.
  let _kemLoadPromise = null;
  function _loadKem() {
    if (g.__nee2pMlKem) return Promise.resolve(g.__nee2pMlKem);
    if (_kemLoadPromise) return _kemLoadPromise;
    _kemLoadPromise = (async () => {
      const here = (typeof location !== 'undefined') ? location.pathname.replace(/[^/]*$/, '') : '';
      const urls = [
        here + 'vendor/mlkem.bundle.mjs',
      ];
      let lastErr = null;
      for (const u of urls) {
        try {
          // eslint-disable-next-line no-new-func
          const mod = await (new Function('u', 'return import(u)'))(u);
          if (mod && typeof mod.MlKem768 === 'function') {
            g.__nee2pMlKem = mod;
            return mod;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('mlkem ESM import failed');
    })();
    return _kemLoadPromise;
  }

  // generateKemKeypair() → {pubKey: Uint8Array(1184), secretKey: opaque}
  // The secretKey carries both the raw bytes AND a reference to the MlKem768
  // instance that created it so decap() can use the same internal state.
  // Stamps `g.Nee2PCrypto.kemAvailable` so the safety modal can show whether
  // post-quantum coverage is actually in effect for this session.
  async function generateKemKeypair() {
    try {
      const mod = await _loadKem();
      const kem = new mod.MlKem768();
      const [pk, sk] = await kem.generateKeyPair();
      try { if (g.Nee2PCrypto) g.Nee2PCrypto.kemAvailable = true; } catch {}
      return {
        pubKey: new Uint8Array(pk),
        secretKey: { kind: 'mlkem768', kem, sk: new Uint8Array(sk) },
      };
    } catch (e) {
      try { if (g.Nee2PCrypto) g.Nee2PCrypto.kemAvailable = false; } catch {}
      throw e;
    }
  }

  // kemEncapsulate(peerKemPubBytes) → {sharedSecret: Uint8Array(32), ct: Uint8Array(1088)}
  // Uses a fresh MlKem768 instance — the encap side doesn't need to remember
  // any state after this call.
  async function kemEncapsulate(peerKemPubBytes) {
    const mod = await _loadKem();
    const sender = new mod.MlKem768();
    const [ct, ss] = await sender.encap(peerKemPubBytes instanceof Uint8Array
      ? peerKemPubBytes : new Uint8Array(peerKemPubBytes));
    return { sharedSecret: new Uint8Array(ss), ct: new Uint8Array(ct) };
  }

  // kemDecapsulate(myKemSecret, ctBytes) → Uint8Array(32) shared secret.
  // myKemSecret is the opaque object returned by generateKemKeypair().
  async function kemDecapsulate(myKemSecret, ctBytes) {
    if (!myKemSecret || myKemSecret.kind !== 'mlkem768') {
      throw new Error('invalid mlkem secret');
    }
    const ct = ctBytes instanceof Uint8Array ? ctBytes : new Uint8Array(ctBytes);
    const ss = await myKemSecret.kem.decap(ct, myKemSecret.sk);
    return new Uint8Array(ss);
  }

  // Tiny setter so we can stamp the actual X25519 source on the public
  // Nee2PCrypto object. Surfaced in SafetyNumbersModal so users can see
  // whether they got WebCrypto Subtle (preferred) or a vendor fallback.
  function _setX25519Source(src) {
    try { if (g.Nee2PCrypto) g.Nee2PCrypto.x25519Source = src; } catch {}
  }

  async function generateEphemeralKeypair() {
    if (await probeSubtleX25519()) {
      const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
      const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
      _setX25519Source('subtle');
      return { pubKey: pubRaw, privKey: { kind: 'subtle', priv: kp.privateKey } };
    }
    const sl = _getStablelibX25519();
    if (sl) {
      const kp = sl.generateKeyPair();
      _setX25519Source('stablelib');
      return { pubKey: new Uint8Array(kp.publicKey), privKey: { kind: 'stablelib', priv: new Uint8Array(kp.secretKey) } };
    }
    let noble = _getNobleX25519();
    if (!noble) {
      // Lazy ESM import — works in any modern browser regardless of script type.
      try { noble = await _loadNobleX25519(); } catch (e) {
        console.warn('noble x25519 ESM load failed:', e && e.message ? e.message : e);
      }
    }
    if (noble) {
      // @noble/curves 2.x renamed randomPrivateKey → randomSecretKey. Probe
      // both names, fall back to webcrypto-random bytes if neither exists.
      const priv = (noble.utils && typeof noble.utils.randomSecretKey === 'function')
        ? noble.utils.randomSecretKey()
        : (noble.utils && typeof noble.utils.randomPrivateKey === 'function')
          ? noble.utils.randomPrivateKey()
          : crypto.getRandomValues(new Uint8Array(32));
      const pub = noble.getPublicKey(priv);
      _setX25519Source('noble');
      return { pubKey: new Uint8Array(pub), privKey: { kind: 'noble', priv: new Uint8Array(priv) } };
    }
    _setX25519Source('unavailable');
    throw new Error('no X25519 implementation available (no Subtle, no vendor noble)');
  }

  async function _ecdh(privKey, peerPubBytes) {
    if (privKey.kind === 'subtle') {
      const peer = await crypto.subtle.importKey(
        'raw', peerPubBytes, { name: 'X25519' }, true, []
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'X25519', public: peer }, privKey.priv, 256
      );
      return new Uint8Array(bits);
    }
    if (privKey.kind === 'stablelib') {
      const sl = _getStablelibX25519();
      if (!sl) throw new Error('stablelib x25519 disappeared mid-session');
      return new Uint8Array(sl.sharedKey(privKey.priv, peerPubBytes));
    }
    if (privKey.kind === 'noble') {
      const noble = _getNobleX25519();
      if (!noble) throw new Error('noble x25519 disappeared mid-session');
      return new Uint8Array(noble.getSharedSecret(privKey.priv, peerPubBytes));
    }
    throw new Error('unknown private key kind: ' + privKey.kind);
  }

  // derivePeerKey: HKDF-SHA256 of (ECDH || phraseRaw [|| KEM_shared])
  //
  //   IKM   = ECDH_shared || phraseRaw [|| KEM_shared]
  //   salt  = roomIdBytes
  //   info  = "hush.v3.session.pq" when KEM_shared is provided (post-quantum
  //           hybrid), else "hush.v3.session" (pre-quantum). The label bump
  //           from v2 → v3 mirrors the Argon2id/PBKDF2 salt change so all
  //           three KDF anchors move in lockstep.
  //   length = 32 bytes → AES-GCM key
  //
  // Both sides reach the same session key as long as:
  //   • they agree on roomId,
  //   • they hold the same phraseRaw (derived from the same phrase),
  //   • the ECDH exchange produced the same shared secret,
  //   • and (in PQ mode) both sides plugged in the SAME KEM shared secret.
  //     One side gets KEM_shared via encapsulate() against the peer's KEM
  //     pubkey; the other side gets it via decapsulate() against the KEM
  //     ciphertext relayed back. The two MUST match (FIPS 203 correctness).
  async function derivePeerKey(privKey, peerPubBytes, phraseRawBytes, roomIdString, kemSharedBytes) {
    const shared = await _ecdh(privKey, peerPubBytes);
    const haveKem = kemSharedBytes && kemSharedBytes.length > 0;
    const ikmLen = shared.length + phraseRawBytes.length + (haveKem ? kemSharedBytes.length : 0);
    const ikm = new Uint8Array(ikmLen);
    ikm.set(shared, 0);
    ikm.set(phraseRawBytes, shared.length);
    if (haveKem) ikm.set(kemSharedBytes, shared.length + phraseRawBytes.length);

    const baseKey = await crypto.subtle.importKey(
      'raw', ikm, { name: 'HKDF' }, false, ['deriveKey']
    );
    const sessionKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: enc.encode(String(roomIdString || '')),
        info: enc.encode(haveKem ? 'hush.v3.session.pq' : 'hush.v3.session'),
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    // Zero out the shared-secret copies we held — best-effort, JS doesn't
    // really give us guarantees about memory hygiene but it doesn't hurt.
    try { shared.fill(0); ikm.fill(0); } catch {}
    return sessionKey;
  }

  function exportPub(pubKeyBytes) {
    return b64(pubKeyBytes);
  }
  function importPub(b64Str) {
    return unb64(String(b64Str || ''));
  }

  // ── Safety numbers (trust verification) ──────────────────
  //
  // Returns a 12-word BIP-39 fingerprint that both peers can read aloud over
  // a trusted channel (voice call, in-person) to detect a MITM that swapped
  // pubkeys mid-session. The fingerprint is symmetric — we sort the per-side
  // (ECDH || KEM) buffers before hashing so both peers compute the same words
  // regardless of which side is "me".
  //
  //   fp = SHA-256( sort([ myPubBytes||myKemPubBytes,
  //                        peerPubBytes||peerKemPubBytes ]) )
  //
  // 12 words × 11 bits/word = 132 bits of entropy → take the high 132 bits
  // of the 256-bit hash, which is more than enough to spot any practical
  // collision attack (preimage at 132 bits is way out of reach).
  //
  // If KEM bytes are missing (legacy peer / PQ unavailable) we fall back to
  // ECDH-only and the caller surfaces a "post-quantum verification unavailable"
  // note in the UI.
  function _concatBytes(a, b) {
    const out = new Uint8Array((a ? a.length : 0) + (b ? b.length : 0));
    if (a) out.set(a, 0);
    if (b) out.set(b, a ? a.length : 0);
    return out;
  }
  function _cmpBytes(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  }
  function _bytesToHex(a) {
    let h = '';
    for (let i = 0; i < a.length; i++) h += a[i].toString(16).padStart(2, '0');
    return h;
  }
  async function safetyNumber(myPubBytes, myKemPubBytes, peerPubBytes, peerKemPubBytes) {
    const wl = g.Nee2PBip39English;
    if (!Array.isArray(wl) || wl.length !== 2048) {
      throw new Error('BIP-39 wordlist not loaded (vendor/bip39-en.js)');
    }
    const mine = _concatBytes(myPubBytes || new Uint8Array(0), myKemPubBytes || new Uint8Array(0));
    const peer = _concatBytes(peerPubBytes || new Uint8Array(0), peerKemPubBytes || new Uint8Array(0));
    if (mine.length === 0 || peer.length === 0) {
      throw new Error('safetyNumber: empty pubkey input');
    }
    const ordered = _cmpBytes(mine, peer) <= 0 ? [mine, peer] : [peer, mine];
    const concat = _concatBytes(ordered[0], ordered[1]);
    const hashBuf = await crypto.subtle.digest('SHA-256', concat);
    const hash = new Uint8Array(hashBuf);
    // Extract 12 × 11-bit indices (high 132 bits, big-endian).
    const words = [];
    let acc = 0n;
    for (let i = 0; i < 17; i++) acc = (acc << 8n) | BigInt(hash[i]);   // 136 bits
    acc >>= 4n;                                                          // top 132 bits
    for (let i = 11; i >= 0; i--) {
      const idx = Number((acc >> BigInt(11 * i)) & 2047n);
      words.push(wl[idx]);
    }
    return {
      words,                       // length 12
      hex: _bytesToHex(hash),      // full 64-char hex (small caption in UI)
      hasKem: !!(myKemPubBytes && peerKemPubBytes
        && myKemPubBytes.length && peerKemPubBytes.length),
    };
  }

  // ── Group chat: sender-keys protocol ─────────────────────
  //
  // Each member generates a 32-byte SENDER KEY at claim time (and rotates it
  // whenever the room's epoch advances — i.e. when any pubkey changes). They
  // encrypt all OUTGOING messages with their own sender key (AES-GCM) and
  // ship the key itself to every other peer via a wrapped envelope encrypted
  // with that pair's PAIRWISE key (the existing X25519+KEM+phrase HKDF output
  // from derivePeerKey). Receivers cache `{peerSlot → senderKey}` and use the
  // appropriate sender key when decrypting incoming msgs (looked up via the
  // msg envelope's `from` field).
  //
  // Why not MLS?  MLS gives us cheaper rekeys (logN), forward secrecy AFTER
  // sender removal, and post-compromise security with a single epoch update.
  // We don't need any of that for a 2–8 person ephemeral chat: simple sender
  // keys give the right E2EE guarantees with ~80 LOC and no tree state to
  // synchronize. We bump the sender key on every epoch (any pubkey change)
  // which keeps things tight without the MLS complexity.

  function generateSenderKey() {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  // Import a raw 32-byte AES-GCM key. The pairwise-key produced by
  // derivePeerKey() is already a CryptoKey, but the sender key we ship over
  // the wire arrives as raw bytes — wrap it here before encrypt/decrypt.
  async function _importAesKey(rawBytes) {
    if (rawBytes instanceof CryptoKey) return rawBytes;
    const u8 = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    if (u8.length !== 32) throw new Error('sender key must be 32 bytes');
    return crypto.subtle.importKey(
      'raw', u8, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  // Encrypt a UTF-8 string with the sender's sender key. Output identical
  // shape to encrypt() — {iv:b64, ct:b64} — so wire/UI code stays the same.
  async function encryptWithSenderKey(senderKeyBytes, plaintext) {
    const key = await _importAesKey(senderKeyBytes);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, enc.encode(String(plaintext))
    );
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }

  async function decryptWithSenderKey(senderKeyBytes, ivB64, ctB64) {
    const key = await _importAesKey(senderKeyBytes);
    const iv = unb64(ivB64);
    const ct = unb64(ctB64);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  }

  // Wrap a sender key (32 raw bytes) under a PAIRWISE key (CryptoKey from
  // derivePeerKey). Output is the wire envelope that gets shipped via the
  // server's `sender-key` event:  {iv: b64, ct: b64}.
  async function wrapSenderKey(pairwiseKey, senderKeyBytes) {
    const u8 = senderKeyBytes instanceof Uint8Array ? senderKeyBytes : new Uint8Array(senderKeyBytes);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, pairwiseKey, u8);
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }

  async function unwrapSenderKey(pairwiseKey, ivB64, ctB64) {
    const iv = unb64(ivB64);
    const ct = unb64(ctB64);
    const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, pairwiseKey, ct);
    const u8 = new Uint8Array(ptBuf);
    if (u8.length !== 32) throw new Error('unwrapped sender key has wrong length');
    return u8;
  }

  // ── deviceKey: "Remember me on this device" persistence ──
  //
  // The persistence layer (persistence.js) wraps phrase + password under a
  // stable per-device AES-GCM key before stashing them in IndexedDB. The key
  // itself is generated with extractable=false so the raw bytes never leave
  // WebCrypto — only the wrapped envelopes ({iv, ct} base64 strings) end up
  // on disk. See persistence.js's top-of-file threat model for what this
  // does and does not protect against.
  async function generateDeviceKey() {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  // wrapWithDeviceKey(deviceKey, plaintext: string) → {iv, ct}  (base64 strings)
  // Fresh 12-byte IV per call. The plaintext is a small string (phrase / pw)
  // so we don't bother with raw-byte variants.
  async function wrapWithDeviceKey(deviceKey, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, deviceKey, enc.encode(String(plaintext == null ? '' : plaintext))
    );
    return { iv: b64(iv), ct: b64(new Uint8Array(ctBuf)) };
  }

  async function unwrapWithDeviceKey(deviceKey, ivB64, ctB64) {
    const iv = unb64(ivB64);
    const ct = unb64(ctB64);
    const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, deviceKey, ct);
    return dec.decode(ptBuf);
  }

  g.Nee2PCrypto = {
    deriveKey,
    encrypt, decrypt,
    encryptBytes, decryptBytes,
    sha256Hex, passwordSlotHash,
    generateEphemeralKeypair, derivePeerKey,
    // ML-KEM-768 post-quantum hybrid
    generateKemKeypair, kemEncapsulate, kemDecapsulate,
    // Group chat: sender-keys protocol
    generateSenderKey,
    encryptWithSenderKey, decryptWithSenderKey,
    wrapSenderKey, unwrapSenderKey,
    // safety numbers / trust verification
    safetyNumber,
    exportPub, importPub,
    // Persistence: device-key wrap/unwrap for phrase+pw in IndexedDB
    generateDeviceKey, wrapWithDeviceKey, unwrapWithDeviceKey,
    // Surfaced library posture for the safety modal. These start `null`
    // (unknown) and get stamped by deriveKey() / generateEphemeralKeypair() /
    // generateKemKeypair() once each library actually fires.
    kdfMode: null,           // 'argon2id' | 'pbkdf2'
    x25519Source: null,      // 'subtle' | 'noble' | 'stablelib' | 'unavailable'
    kemAvailable: null,      // true | false
    // exposed for diagnostics / tests
    _b64: b64, _unb64: unb64,
  };
})(typeof window !== 'undefined' ? window : globalThis);
