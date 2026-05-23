// crypto.js — WebCrypto helpers: derive AES-GCM key from the shared secret, encrypt/decrypt.
// Both parties derive the same key from the same source (phrase or 32-hex hash).
// The server never sees plaintext: it only relays {iv, ct} blobs.
(function (g) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // Derive a 256-bit AES-GCM key from any string. Slow on purpose (PBKDF2 200k).
  async function deriveKey(seed) {
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(String(seed || '')),
      { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('hush.v1.salt'), iterations: 200000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
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

  g.HushCrypto = { deriveKey, encrypt, decrypt, sha256Hex, passwordSlotHash };
})(typeof window !== 'undefined' ? window : globalThis);
