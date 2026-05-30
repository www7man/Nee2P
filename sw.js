// sw.js — Nee2P. service worker.
//
// Responsibilities:
//   1. Precache the app shell + the three unpkg CDN scripts so the UI boots
//      offline (cache-first for static assets).
//   2. Pass-through for /2Pee/r/* endpoints — SSE / long-poll / write traffic
//      must never be intercepted.
//   3. Web Push: render notifications from the relay; on click, focus an
//      existing window or open the app.
//
// Bump CACHE_VERSION to invalidate the precache after deploys.

const CACHE_VERSION = 'nee2p-v26-full-precache';

// All paths are relative to the SW scope (which is /2Pee/ in production).
const PRECACHE_URLS = [
  './',
  './index.html',
  './updates.html',
  './trust.html',
  './admin.html',
  './manifest.json',
  './md5.js',
  './crypto.js',
  './http-client.js',
  './ws-client.js',
  './push.js',
  './version.js',
  './webrtc.js',
  './i18n.js',
  './nee2p-ui.jsx',
  './nee2p-screens.jsx',
  './nee2p-app.jsx',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Vendored crypto + UI libraries (previously CDN, now self-hosted)
  './vendor/react.production.min.js',
  './vendor/react-dom.production.min.js',
  './vendor/babel.min.js',
  './vendor/argon2-bundled.min.js',
  './vendor/noble-ed25519.bundle.mjs',
  './vendor/mlkem.bundle.mjs',
  './vendor/bip39-en.js',
  './vendor/qrcode.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll is atomic — if any URL fails, the whole install fails. Use
    // individual add()s so a missing optional file doesn't break the SW.
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload', credentials: 'omit', mode: 'no-cors' });
        const res = await fetch(req);
        // For opaque (no-cors CDN) responses, status is 0 but we can still cache.
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res.clone());
      } catch (e) {
        // best-effort — first runtime fetch will repopulate
      }
    }));
    // activate immediately on first install
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Always pass through relay traffic — SSE streams, long-poll, claims, sends.
  // Intercepting would buffer chunks and break /r/stream entirely.
  if (url.pathname.includes('/2Pee/r/') || url.pathname.startsWith('/r/')) return;
  // Don't intercept WebSocket-related requests either
  if (url.pathname.includes('/ws')) return;

  // Cache-first applies to:
  //   • cross-origin GETs we explicitly precached (unpkg CDN scripts)
  //   • same-origin requests inside our scope (the app shell + assets)
  // Anything else: pass through to the network untouched.
  const scopePath = new URL(self.registration.scope).pathname; // e.g. "/2Pee/"
  const sameOrigin = url.origin === self.location.origin;
  const isCDN = !sameOrigin;
  const inScope = sameOrigin && url.pathname.startsWith(scopePath);
  if (!isCDN && !inScope) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);

    // Network-first for navigations and the app shell itself. Stale-while-
    // revalidate was wrong here: a returning user always got the OLD index
    // (with stale <script> versions) on first paint and only saw new code
    // on the next-next reload. For the entry point we always prefer the
    // freshest copy when online, and only fall back to cache offline.
    const scopeP = new URL(self.registration.scope).pathname;
    const isShell = req.mode === 'navigate'
                 || url.pathname === scopeP
                 || url.pathname === scopeP + 'index.html';
    if (isShell) {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        const shell = await cache.match('./index.html') || await cache.match('./');
        if (shell) return shell;
        throw new Error('offline-and-no-cache');
      }
    }

    const cached = await cache.match(req, { ignoreSearch: false });
    if (cached) {
      // refresh in the background so the next load gets the new version
      fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (e) {
      // last-resort: try the cached app shell so navigations still work offline
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html') || await cache.match('./');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});

// ─── Web Push ───────────────────────────────────────────────────────────
//
// The relay forwards each msg event as a Web Push payload of the form:
//   { title, body, tag, url, enc?: { roomId, iv, ct, ivCt?, from, epoch,
//                                    time, id, blob? } }
// `body` is the generic fallback ("новое сообщение"). If `enc` is present AND
// the persistence feature has cached a non-extractable AES-GCM sessionKey for
// `enc.roomId` in IndexedDB (`hush.persist` v1, store `sessions`), we unwrap
// the inner ciphertext here and replace `body` with a real preview. Otherwise
// (no enc field from an older relay, no IndexedDB record, expired key, decode
// failure) we silently fall back to the generic body — never user-visible
// error, never reveals whether persistence is enabled.
self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch {
    try { data = { body: event.data ? event.data.text() : '' }; } catch {}
  }
  const title = data.title || 'Nee2P.';
  const tag   = data.tag   || 'nee2p';
  const url   = data.url   || '/2Pee/';
  const enc   = data.enc   || null;
  let body    = data.body  || 'новое сообщение';

  if (enc && typeof enc.roomId === 'string' && typeof enc.iv === 'string' && typeof enc.ct === 'string') {
    try {
      const preview = await tryDecrypt(enc);
      if (preview) body = preview;
    } catch {
      // swallow — fall back to generic body
    }
  }

  await self.registration.showNotification(title, {
    body,
    tag,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url, roomId: enc && enc.roomId ? enc.roomId : null },
    renotify: false,
    requireInteraction: false,
    silent: false,
  });
}

async function tryDecrypt(enc) {
  const db = await openNee2PDB();
  if (!db) return null;
  let rec = null;
  try {
    const tx = db.transaction('sessions', 'readonly');
    rec = await idbGet(tx.objectStore('sessions'), enc.roomId);
  } catch {
    rec = null;
  }
  try { db.close(); } catch {}
  if (!rec || !rec.sessionKey) return null;

  let plaintext;
  try {
    const iv = base64ToBytes(enc.iv);
    const ct = base64ToBytes(enc.ct);
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, rec.sessionKey, ct);
  } catch {
    return null;
  }
  const str = new TextDecoder().decode(plaintext);

  // Plaintext may be JSON (new wire format {text, time, blobMeta?}) or a raw
  // string (legacy). For blob bubbles the text bubble part is the meta.
  let text = str;
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed.text === 'string') {
      text = parsed.text;
    } else if (parsed && parsed.blobMeta) {
      text = parsed.blobMeta.name
          || (enc.blob && enc.blob.kind === 'voice' ? 'голосовое' : 'файл');
    }
  } catch {
    // not JSON — treat as raw string
  }

  // Friendly prefix: SW only knows the slot number; the page can map slot →
  // nickname when the user actually opens it.
  const prefix = (enc.from != null && enc.from !== '') ? (enc.from + ': ') : '';
  // Notification body length cap — browsers truncate ~150-200 chars anyway.
  return (prefix + text).slice(0, 200);
}

function openNee2PDB() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('hush.persist', 1);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      // If our SW hits this and the DB doesn't exist yet, the upgrade fires.
      // We never create the schema here — that's the page-side persistence
      // module's job. Return null so caller falls back to the generic body.
      req.onupgradeneeded = () => {
        try { req.transaction && req.transaction.abort(); } catch {}
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGet(store, key) {
  return new Promise((resolve) => {
    try {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/2Pee/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer focusing an existing window on this app
    for (const client of all) {
      try {
        const u = new URL(client.url);
        if (u.pathname.startsWith('/2Pee/') || u.pathname === targetUrl) {
          await client.focus();
          return;
        }
      } catch {}
    }
    // No matching window — open one
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
