// http-client.js — POST + long-poll transport for Nee2P.
//
// Exposes window.Nee2PWS with the same shape as the WebSocket client adapter,
// so nee2p-app.jsx doesn't care which transport it uses. Works through any HTTP
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
          // 'same-origin' (not 'omit') so that tunnel-service bypass cookies
          // (e.g. pinggy's PinggyFreeValidationCookie) are sent with every
          // API request.  All our requests are same-origin by construction, so
          // this never leaks credentials to a third-party host.
          credentials: 'same-origin',
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
        const payload = { room, passwordHash: obj.passwordHash };
        if (obj.ttlMs)     payload.ttlMs     = obj.ttlMs;
        if (obj.pubKey)    payload.pubKey    = obj.pubKey;
        if (obj.kemPubKey) payload.kemPubKey = obj.kemPubKey;
        const out = await post('claim', payload);
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
        // IMPORTANT ordering: deliver peer-pubkey BEFORE the history batch so
        // the app already has the session key when it starts decrypting. The
        // app awaits the peer-pubkey handler before processing onMsgBatch.
        if (out.peerPubKey || out.peerKemPubKey) {
          dispatch({
            type: 'peer-pubkey',
            peer: out.slot === 'A' ? 'B' : 'A',
            pubKey: out.peerPubKey || null,
            kemPubKey: out.peerKemPubKey || null,
            epoch: typeof out.epoch === 'number' ? out.epoch : 0,
          });
        }
        if (out.batch && out.batch.length) dispatch({ type: 'msg-batch', items: out.batch });
        handlers.onOpen && handlers.onOpen();
        // Best-effort: wire up Web Push so the inactive tab can still nudge
        // the user when the peer sends something. Errors are swallowed —
        // push is an enhancement, not a hard requirement.
        try {
          window.Nee2PPush && window.Nee2PPush.init && window.Nee2PPush.init(basePath);
          if (window.Nee2PPush && window.Nee2PPush.enable) {
            await window.Nee2PPush.enable(token, basePath);
          }
        } catch {}
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
    //
    // Connection-status telemetry (FIX 6): we fire handlers.onConnectionStatus
    // with one of 'live' | 'reconnecting' | 'lost' so the UI can surface a
    // banner. 'lost' is set after > 5s of being disconnected, so we don't
    // flash the banner on a 1-packet hiccup. SSE is also where the
    // session-token leaks into Caddy access logs as ?token=… — EventSource
    // doesn't support custom headers (browser limitation), so we keep the
    // URL form here. Mitigated by the short relay session TTL.
    let activeEs = null;
    let lastConnStatus = null;
    let lostTimer = null;
    function emitConnStatus(state) {
      if (state === lastConnStatus) return;
      lastConnStatus = state;
      try { handlers.onConnectionStatus && handlers.onConnectionStatus(state); } catch {}
    }
    function streamLoop() {
      if (stopped || !token) return;
      // EventSource doesn't accept custom headers — token MUST stay in the
      // URL here. This is a known privacy/log-hygiene tradeoff documented in
      // FIX 9; mitigated by short session TTL and Caddy log scrubbing.
      const url = origin + basePath + 'r/stream?token=' + encodeURIComponent(token);
      const es = new EventSource(url);
      activeEs = es;
      es.onopen = () => {
        if (lostTimer) { clearTimeout(lostTimer); lostTimer = null; }
        emitConnStatus('live');
      };
      es.onmessage = (e) => {
        // First message implies open; fire 'live' as a fallback for browsers
        // that don't reliably trigger onopen on every reconnect.
        if (lastConnStatus !== 'live') {
          if (lostTimer) { clearTimeout(lostTimer); lostTimer = null; }
          emitConnStatus('live');
        }
        try { dispatch(JSON.parse(e.data)); } catch {}
      };
      es.onerror = () => {
        // Tell the UI we're trying to reconnect; if it lasts > 5s, escalate
        // to 'lost'. Both states render the orange/red banner above the
        // chat list in ChatScreen.
        emitConnStatus('reconnecting');
        if (!lostTimer) {
          lostTimer = setTimeout(() => emitConnStatus('lost'), 5000);
        }
        // EventSource auto-reconnects, but if the relay 401'd us we want to
        // stop and surface room-expired instead of looping forever.
        if (es.readyState === EventSource.CLOSED) {
          activeEs = null;
          if (stopped) return;
          // attempt a probe poll to learn whether the session is dead
          fetchWithTimeout(origin + basePath + 'r/poll?token=' + encodeURIComponent(token),
            { method: 'GET', cache: 'no-store',
              headers: { 'Authorization': 'Bearer ' + token } }, 5000)
            .then(r => {
              if (r.status === 401) {
                dispatch({ type: 'room-expired' });
                stopped = true;
                if (lostTimer) { clearTimeout(lostTimer); lostTimer = null; }
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
        // Token in body kept for back-compat; header is the new path (FIX 9).
        try {
          fetch(origin + basePath + 'r/send', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token,
            },
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

    // HTTP has no "connect" handshake — but the caller (nee2p-app.jsx) waits for
    // onOpen before sending the initial `claim`. Fire it on the next tick so
    // the WS-shaped contract is preserved.
    Promise.resolve().then(() => {
      if (!stopped && handlers.onConnect) handlers.onConnect();
      if (!stopped && handlers.onOpen) handlers.onOpen();
    });

    // ── Encrypted blob upload / download ────────────────────
    //
    // Bypasses the 80ms batching queue (different shape, different cap, and we
    // want the round-trip latency to be one fetch). 60s timeout per blob op —
    // enough headroom for a 5MB image over a flaky mobile connection.
    // FIX 9: send the session token in the Authorization header so it doesn't
    // hit Caddy access.log as ?token=…. We KEEP `?token=` in the URL too so
    // an older server (or a request handler that hasn't been updated yet)
    // keeps working — the relay accepts either. Drop the URL form once every
    // deployed server reads the header.
    async function uploadBlob(bytes, mime) {
      if (!token) throw new Error('not-claimed');
      const body = bytes instanceof Uint8Array ? bytes
        : (bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes));
      const u = origin + basePath + 'r/blob'
        + '?token=' + encodeURIComponent(token)
        + '&mime='  + encodeURIComponent(mime || 'application/octet-stream')
        + '&size='  + String(body.length);
      const r = await fetchWithTimeout(u, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': 'Bearer ' + token,
        },
        body,
        credentials: 'same-origin',
        cache: 'no-store',
      }, 60000);
      if (!r.ok) {
        let err;
        try { err = await r.json(); } catch { err = { ok: false, reason: 'http-' + r.status }; }
        throw new Error(err && err.reason ? err.reason : ('http-' + r.status));
      }
      return r.json();
    }

    async function downloadBlob(blobId) {
      if (!token) throw new Error('not-claimed');
      const u = origin + basePath + 'r/blob/' + encodeURIComponent(blobId)
        + '?token=' + encodeURIComponent(token);
      const r = await fetchWithTimeout(u, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token },
        credentials: 'same-origin',
        cache: 'no-store',
      }, 60000);
      if (!r.ok) throw new Error('http-' + r.status);
      return r.arrayBuffer();
    }

    return {
      send,
      close: () => {
        window.removeEventListener('pagehide', unloadHandler);
        window.removeEventListener('beforeunload', unloadHandler);
        close();
      },
      isOpen: () => !!token,
      uploadBlob,
      downloadBlob,
    };
  }

  g.Nee2PWS = { createClient };

  // Standalone peek — read-only probe asking the relay whether a room exists
  // and how many of its slots are currently online. Used by the Join screen to
  // surface "1/2 online · истекает через X" before the user finishes entering
  // their password. No claim, no session token, no side effects on the room.
  async function peekRoom(hash) {
    if (!/^[a-f0-9]{32}$/i.test(String(hash || ''))) return { ok: false, reason: 'bad-room' };
    const basePath = location.pathname.replace(/[^/]*$/, '');
    const origin = location.origin;
    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, 6000);
    try {
      const r = await fetch(origin + basePath + 'r/peek', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: String(hash).toLowerCase() }),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!r.ok) return { ok: false, reason: 'http-' + r.status };
      return await r.json();
    } catch (e) {
      return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(t);
    }
  }
  g.Nee2PPeek = { peekRoom };
})(typeof window !== 'undefined' ? window : globalThis);
