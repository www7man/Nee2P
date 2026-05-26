// push.js — thin Web Push helper. Exposes window.Nee2PPush.
//
// All operations are defensive: if the browser doesn't support SW + Push +
// Notifications, every method is a no-op so callers can call them blindly.
//
// API:
//   Nee2PPush.init(basePath)             → fetch + cache the VAPID public key
//   Nee2PPush.enable(sessionToken, basePath) → ask permission (once), subscribe,
//                                              PUT subscription to the relay
//   Nee2PPush.disable(sessionToken, basePath) → unsubscribe + tell relay
(function (g) {
  const supported = typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;

  let cachedVapidKey = null;          // raw URL-safe-base64 string from the server
  let cachedVapidKeyArr = null;       // Uint8Array form for applicationServerKey
  let initInFlight = null;

  function urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function putJSON(url, body) {
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
    });
  }

  async function getRegistration() {
    if (!supported) return null;
    // ready resolves once the SW reaches the activated state. If registration
    // hasn't happened yet (race with index.html script), wait politely.
    try {
      const reg = await navigator.serviceWorker.ready;
      return reg || null;
    } catch {
      return null;
    }
  }

  async function init(basePath) {
    if (!supported) return null;
    if (cachedVapidKey) return cachedVapidKey;
    if (initInFlight) return initInFlight;
    initInFlight = (async () => {
      try {
        const r = await fetch(basePath + 'r/vapid-pubkey', { cache: 'no-store' });
        if (!r.ok) return null;
        const key = (await r.text()).trim();
        if (!key) return null;
        cachedVapidKey = key;
        cachedVapidKeyArr = urlBase64ToUint8Array(key);
        return key;
      } catch {
        return null;
      } finally {
        initInFlight = null;
      }
    })();
    return initInFlight;
  }

  async function enable(sessionToken, basePath) {
    if (!supported || !sessionToken) return false;
    // Don't surprise users — only ask if they haven't decided yet.
    if (Notification.permission === 'denied') return false;
    if (Notification.permission === 'default') {
      let perm;
      try { perm = await Notification.requestPermission(); }
      catch { return false; }
      if (perm !== 'granted') return false;
    }

    if (!cachedVapidKeyArr) {
      await init(basePath);
      if (!cachedVapidKeyArr) return false;
    }

    const reg = await getRegistration();
    if (!reg || !reg.pushManager) return false;

    let subscription;
    try {
      subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: cachedVapidKeyArr,
        });
      }
    } catch (e) {
      return false;
    }

    try {
      const res = await putJSON(basePath + 'r/push-subscribe', {
        token: sessionToken,
        subscription: subscription.toJSON ? subscription.toJSON() : subscription,
      });
      return res && res.ok;
    } catch {
      return false;
    }
  }

  async function disable(sessionToken, basePath) {
    if (!supported) return false;
    try {
      if (sessionToken) {
        try { await putJSON(basePath + 'r/push-unsubscribe', { token: sessionToken }); }
        catch {}
      }
      const reg = await getRegistration();
      if (reg && reg.pushManager) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { try { await sub.unsubscribe(); } catch {} }
      }
      return true;
    } catch {
      return false;
    }
  }

  g.Nee2PPush = { init, enable, disable, supported };
})(typeof window !== 'undefined' ? window : globalThis);
