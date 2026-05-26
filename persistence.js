// persistence.js — opt-in "Remember me on this device" persistence for Nee2P.
//
// THREAT MODEL (read this before reaching for it):
//   • This is CONVENIENCE PERSISTENCE, NOT VAULT-GRADE STORAGE.
//   • The deviceKey is an AES-GCM-256 CryptoKey created with extractable=false
//     and stays in this origin's IndexedDB. The browser refuses to export the
//     raw bytes. Phrase + password are wrapped under it (AES-GCM, per-record
//     IV) before being written; sessionKey is also non-extractable.
//   • An attacker with PHYSICAL or ADMIN access to the browser profile can
//     still mount our origin's JS and call Nee2PPersist.load(), so they can
//     read the room state. The deviceKey only prevents:
//       — trivial dump of phrase/pw from the profile directory,
//       — cross-origin XSS (because key is bound to this origin), and
//       — extension code that lacks WebCrypto access to our DB.
//   • Sensitive bits (phrase + password) are encrypted UNDER deviceKey because
//     they enable rejoining the room after `expiresAt` (whereas sessionKey
//     alone only decrypts live-history relayed within the current epoch).
//   • Default behaviour is unchanged — persistence is opt-in. Call enable()
//     once per device to opt in; disable() wipes EVERYTHING (deviceKey and
//     every stored session) and brings the device back to ephemeral mode.
//
// DB SCHEMA (agreed with the SW-push agent):
//   name: 'hush.persist', version: 1
//   stores:
//     'sessions' — keyPath: 'roomId' (md5 hex, 32 chars). Record shape:
//        { roomId, slot, phrase: {iv,ct}, password: {iv,ct},
//          sessionKey: CryptoKey (non-extractable, AES-GCM, current epoch),
//          epoch, groupMax, ttlMs, expiresAt, updatedAt }
//        IndexedDB's structured clone supports CryptoKey directly — the SW
//        can read it back and call crypto.subtle.decrypt() against push
//        payloads without round-tripping through raw bytes.
//     '_meta'    — { key: 'deviceKey', value: CryptoKey }
//
// API surface (window.Nee2PPersist):
//   isEnabled()                                       → boolean
//   enable()                                          → void  (idempotent)
//   disable()                                         → void  (nukes everything)
//   save({roomId, slot, phrase, password, sessionKey,
//         epoch, groupMax, ttlMs, expiresAt})         → bool
//   load(roomId)                                      → record | null
//                                                       (phrase + password
//                                                        come back DECRYPTED)
//   listRooms()                                       → Array<{roomId, slot,
//                                                              updatedAt,
//                                                              expiresAt,
//                                                              groupMax}>
//   forget(roomId)                                    → bool
//
// Every method is defensive: catches IDB errors and resolves to null/false
// rather than throwing, so the caller can always do `if (!await persist.save())`.
(function (g) {
  const DB_NAME    = 'hush.persist';
  const DB_VERSION = 1;
  const STORE_SES  = 'sessions';
  const STORE_META = '_meta';
  const DEVICE_KEY_ID = 'deviceKey';

  // ── tiny IDB idiom (no library) ──────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SES)) {
          db.createObjectStore(STORE_SES, { keyPath: 'roomId' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function tx(db, store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }
  function asPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function withStore(storeName, mode, fn) {
    let db;
    try { db = await openDB(); }
    catch { return null; }
    try {
      const s = tx(db, storeName, mode);
      const out = await fn(s);
      // Wait for the transaction to commit before closing so we don't lose
      // a write on a race with db.close().
      await new Promise((resolve, reject) => {
        s.transaction.oncomplete = () => resolve();
        s.transaction.onerror    = () => reject(s.transaction.error);
        s.transaction.onabort    = () => reject(s.transaction.error || new Error('aborted'));
      }).catch(() => {});
      return out;
    } catch {
      return null;
    } finally {
      try { db.close(); } catch {}
    }
  }

  // ── device key cache ─────────────────────────────────────
  // We cache the CryptoKey in memory so we don't hit IndexedDB on every
  // save/load. Cleared on disable().
  let _deviceKeyCache = null;

  async function _readDeviceKey() {
    if (_deviceKeyCache) return _deviceKeyCache;
    const rec = await withStore(STORE_META, 'readonly', async (s) => {
      return await asPromise(s.get(DEVICE_KEY_ID));
    });
    if (rec && rec.value) {
      _deviceKeyCache = rec.value;
      return _deviceKeyCache;
    }
    return null;
  }

  async function isEnabled() {
    try { return !!(await _readDeviceKey()); } catch { return false; }
  }

  async function enable() {
    // Idempotent — return existing key if one already exists.
    const existing = await _readDeviceKey();
    if (existing) return true;
    const HC = g.Nee2PCrypto;
    if (!HC || typeof HC.generateDeviceKey !== 'function') {
      console.warn('Nee2PPersist.enable: Nee2PCrypto.generateDeviceKey missing');
      return false;
    }
    let key;
    try { key = await HC.generateDeviceKey(); }
    catch (e) {
      console.warn('Nee2PPersist.enable: generateDeviceKey failed:', e && e.message);
      return false;
    }
    const ok = await withStore(STORE_META, 'readwrite', async (s) => {
      return await asPromise(s.put({ key: DEVICE_KEY_ID, value: key }));
    });
    if (ok != null) {
      _deviceKeyCache = key;
      return true;
    }
    return false;
  }

  async function disable() {
    _deviceKeyCache = null;
    // Wipe both stores — sessions become unreadable without the deviceKey
    // anyway, but we don't want stale records lingering after the user opts
    // out (they'd contribute to storage quota and appear in dev tools).
    await withStore(STORE_SES, 'readwrite', async (s) => {
      return await asPromise(s.clear());
    });
    await withStore(STORE_META, 'readwrite', async (s) => {
      return await asPromise(s.clear());
    });
    return true;
  }

  // ── save / load / list / forget ──────────────────────────
  async function save(rec) {
    if (!rec || typeof rec !== 'object' || !rec.roomId) return false;
    const HC = g.Nee2PCrypto;
    if (!HC || typeof HC.wrapWithDeviceKey !== 'function') return false;
    const dk = await _readDeviceKey();
    if (!dk) return false;
    let phraseEnv = null, passwordEnv = null;
    try {
      // Phrase + password are stored as the original strings — they're not
      // hashes, because the caller (nee2p-app) needs to be able to feed them
      // back into the join flow (which itself runs deriveKey + passwordSlotHash).
      phraseEnv   = await HC.wrapWithDeviceKey(dk, String(rec.phrase   || ''));
      passwordEnv = await HC.wrapWithDeviceKey(dk, String(rec.password || ''));
    } catch (e) {
      console.warn('Nee2PPersist.save: wrap failed:', e && e.message);
      return false;
    }
    const out = {
      roomId:     String(rec.roomId),
      slot:       typeof rec.slot === 'number' ? rec.slot : 0,
      phrase:     phraseEnv,           // {iv: base64, ct: base64}
      password:   passwordEnv,         // {iv: base64, ct: base64}
      // sessionKey is the CryptoKey from epochKeysRef — IndexedDB structured-
      // clones CryptoKeys directly, so we can just stash it. If the caller
      // didn't pass one (e.g. very early in the handshake) we drop the field.
      sessionKey: rec.sessionKey instanceof CryptoKey ? rec.sessionKey : null,
      epoch:      typeof rec.epoch === 'number' ? rec.epoch : 0,
      groupMax:   typeof rec.groupMax === 'number' ? rec.groupMax : 2,
      ttlMs:      typeof rec.ttlMs === 'number' ? rec.ttlMs : 0,
      expiresAt:  typeof rec.expiresAt === 'number' ? rec.expiresAt : 0,
      updatedAt:  Date.now(),
    };
    const ok = await withStore(STORE_SES, 'readwrite', async (s) => {
      return await asPromise(s.put(out));
    });
    return ok !== null;
  }

  async function load(roomId) {
    if (!roomId) return null;
    const HC = g.Nee2PCrypto;
    if (!HC || typeof HC.unwrapWithDeviceKey !== 'function') return null;
    const dk = await _readDeviceKey();
    if (!dk) return null;
    const raw = await withStore(STORE_SES, 'readonly', async (s) => {
      return await asPromise(s.get(String(roomId)));
    });
    if (!raw) return null;
    let phrase = '', password = '';
    try {
      if (raw.phrase && raw.phrase.iv && raw.phrase.ct) {
        phrase = await HC.unwrapWithDeviceKey(dk, raw.phrase.iv, raw.phrase.ct);
      }
      if (raw.password && raw.password.iv && raw.password.ct) {
        password = await HC.unwrapWithDeviceKey(dk, raw.password.iv, raw.password.ct);
      }
    } catch (e) {
      // Mismatched deviceKey (extremely unlikely — would mean someone wrote
      // the record under a different key, e.g. after disable()/enable() cycle
      // without forget()). Return null so the caller doesn't half-restore.
      console.warn('Nee2PPersist.load: unwrap failed:', e && e.message);
      return null;
    }
    return {
      roomId:     raw.roomId,
      slot:       raw.slot,
      phrase, password,
      sessionKey: raw.sessionKey || null,
      epoch:      raw.epoch || 0,
      groupMax:   raw.groupMax || 2,
      ttlMs:      raw.ttlMs || 0,
      expiresAt:  raw.expiresAt || 0,
      updatedAt:  raw.updatedAt || 0,
    };
  }

  async function listRooms() {
    const out = [];
    const dk = await _readDeviceKey();
    if (!dk) return out;
    await withStore(STORE_SES, 'readonly', async (s) => {
      return await new Promise((resolve) => {
        const req = s.openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve();
          const v = cur.value;
          if (v && v.roomId) {
            out.push({
              roomId:    v.roomId,
              slot:      v.slot || 0,
              updatedAt: v.updatedAt || 0,
              expiresAt: v.expiresAt || 0,
              groupMax:  v.groupMax || 2,
            });
          }
          cur.continue();
        };
        req.onerror = () => resolve();
      });
    });
    return out;
  }

  async function forget(roomId) {
    if (!roomId) return false;
    const ok = await withStore(STORE_SES, 'readwrite', async (s) => {
      return await asPromise(s.delete(String(roomId)));
    });
    return ok !== null;
  }

  g.Nee2PPersist = {
    isEnabled, enable, disable,
    save, load, listRooms, forget,
    // Exposed for tests / diagnostics — DO NOT use from app code.
    _internals: { openDB, _readDeviceKey, DB_NAME, STORE_SES, STORE_META },
  };
})(typeof window !== 'undefined' ? window : globalThis);
