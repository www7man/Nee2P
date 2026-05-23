// http-client.js — POST + long-poll transport for hush.
//
// Exposes window.HushWS with the same shape as the WebSocket client adapter,
// so hush-app.jsx doesn't care which transport it uses. Works through any HTTP
// proxy / CDN that doesn't pass the WebSocket Upgrade header.
//
// Protocol:
//   POST  {basePath}r/claim  {room, passwordHash, ttlMs?}
//   POST  {basePath}r/send   {token, type, ...payload}
//   GET   {basePath}r/poll?token=…       (long-poll, 25s hold)
(function (g) {
  function createClient({ room, handlers = {} }) {
    const basePath = location.pathname.replace(/[^/]*$/, '');
    const origin = location.origin;
    const queue = [];                  // queued sends until we have a token
    let token = null;
    let stopped = false;
    let claimSent = false;

    function handlerName(type) {
      return 'on' + type.split('-').map(p => p ? p[0].toUpperCase() + p.slice(1) : '').join('');
    }

    function dispatch(m) {
      if (!m || typeof m.type !== 'string') return;
      const fn = handlers[handlerName(m.type)];
      if (typeof fn === 'function') fn(m);
      else if (handlers.onAny) handlers.onAny(m);
    }

    // fetch with hard timeout so a stuck network request can never deadlock
    // the serial send chain. AbortController cancels at the OS level.
    async function fetchWithTimeout(url, opts, timeoutMs) {
      const ctrl = new AbortController();
      const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, timeoutMs);
      try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    }

    async function post(path, body) {
      try {
        const r = await fetchWithTimeout(origin + basePath + 'r/' + path, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'omit',
          cache: 'no-store',
        }, 12000);
        if (!r.ok) {
          let err;
          try { err = await r.json(); } catch { err = { ok: false }; }
          return err;
        }
        return r.json();
      } catch (e) {
        return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'network' };
      }
    }

    // Batch outgoing payloads inside an 80ms window into one PUT request.
    // Yandex CDN throttles burst PUTs aggressively (3 in parallel → next 7
    // get TCP-reset), so coalescing 10 quick messages into a single round-
    // trip is dramatically faster than even a serial chain.
    const BATCH_WINDOW_MS = 80;
    const pendingItems = [];
    let batchTimer = null;
    let batchInFlight = false;

    function flushBatch() {
      batchTimer = null;
      if (batchInFlight || pendingItems.length === 0) return;
      const items = pendingItems.splice(0);
      batchInFlight = true;
      const body = items.length === 1
        ? { token, ...items[0] }
        : { token, items };
      post('send', body)
        .catch(() => {})
        .finally(() => {
          batchInFlight = false;
          if (pendingItems.length) scheduleFlush(0);
        });
    }
    function scheduleFlush(delay) {
      if (batchTimer) return;
      batchTimer = setTimeout(flushBatch, delay);
    }
    function enqueueSend(obj) {
      pendingItems.push(obj);
      // schedule flush — but if a batch is already in-flight, the .finally
      // above will trigger a follow-up immediately when it lands.
      if (!batchInFlight) scheduleFlush(BATCH_WINDOW_MS);
    }

    async function send(obj) {
      // The first thing sent is always `claim` — that's how we get a token.
      if (obj.type === 'claim') {
        if (claimSent) return;
        claimSent = true;
        const out = await post('claim', { room, passwordHash: obj.passwordHash, ttlMs: obj.ttlMs });
        if (!out || !out.ok) {
          dispatch({ type: 'claim-result', ok: false, reason: out?.reason || 'failed' });
          return;
        }
        token = out.sessionToken;
        dispatch({
          type: 'room-state', exists: true,
          createdAt: out.createdAt, expiresAt: out.expiresAt, ttlMs: out.ttlMs,
          slots: out.slots, paired: out.paired,
        });
        const { sessionToken: _t, batch: _b, ...claimResult } = out;
        dispatch(claimResult);
        if (out.paired && out.pairedAt) dispatch({ type: 'paired', pairedAt: out.pairedAt });
        if (out.batch && out.batch.length) dispatch({ type: 'msg-batch', items: out.batch });
        handlers.onOpen && handlers.onOpen();
        streamLoop();
        while (queue.length) enqueueSend(queue.shift());
        return;
      }
      if (!token) { queue.push(obj); return; }
      enqueueSend(obj);
    }

    // SSE: one long-lived GET, server pushes each event the moment it
    // happens. Replaces the old long-poll loop (which had a ~100ms gap
    // between events due to closing and re-opening the connection).
    let activeEs = null;
    function streamLoop() {
      if (stopped || !token) return;
      const url = origin + basePath + 'r/stream?token=' + encodeURIComponent(token);
      const es = new EventSource(url);
      activeEs = es;
      es.onmessage = (e) => {
        try { dispatch(JSON.parse(e.data)); } catch {}
      };
      es.onerror = () => {
        // EventSource auto-reconnects, but if the relay 401'd us we want to
        // stop and surface room-expired instead of looping forever.
        if (es.readyState === EventSource.CLOSED) {
          activeEs = null;
          if (stopped) return;
          // attempt a probe poll to learn whether the session is dead
          fetchWithTimeout(origin + basePath + 'r/poll?token=' + encodeURIComponent(token),
            { method: 'GET', cache: 'no-store' }, 5000)
            .then(r => {
              if (r.status === 401) {
                dispatch({ type: 'room-expired' });
                stopped = true;
                handlers.onClose && handlers.onClose();
              } else {
                setTimeout(streamLoop, 1000);
              }
            })
            .catch(() => setTimeout(streamLoop, 1500));
        }
      };
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function close() {
      stopped = true;
      if (activeEs) { try { activeEs.close(); } catch {} activeEs = null; }
      if (token) {
        // fire-and-forget leave so the relay marks us offline immediately.
        // sendBeacon would use POST, which Yandex CDN drops — fetch PUT works.
        try {
          fetch(origin + basePath + 'r/send', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, type: 'leave' }),
            keepalive: true,
          });
        } catch {}
      }
      handlers.onClose && handlers.onClose();
    }

    // best-effort: tell the server we're gone when the tab unloads
    const unloadHandler = () => { try { close(); } catch {} };
    window.addEventListener('pagehide', unloadHandler);
    window.addEventListener('beforeunload', unloadHandler);

    // HTTP has no "connect" handshake — but the caller (hush-app.jsx) waits for
    // onOpen before sending the initial `claim`. Fire it on the next tick so
    // the WS-shaped contract is preserved.
    Promise.resolve().then(() => {
      if (!stopped && handlers.onConnect) handlers.onConnect();
      if (!stopped && handlers.onOpen) handlers.onOpen();
    });

    return {
      send,
      close: () => {
        window.removeEventListener('pagehide', unloadHandler);
        window.removeEventListener('beforeunload', unloadHandler);
        close();
      },
      isOpen: () => !!token,
    };
  }

  g.HushWS = { createClient };
})(typeof window !== 'undefined' ? window : globalThis);
