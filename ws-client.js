// ws-client.js — thin WebSocket client. Dispatches typed messages from the
// relay to named handlers. See server.js for the full protocol.
//
// Auto-reconnect + send-queue (CRIT-1, 2026-05-30):
// The single-WS-instance design used to die forever on the first network
// hiccup — the consumer would see onClose/onError and have to tear the whole
// chat down. We now wrap a single logical "client" around N successive
// WebSocket instances, with exponential backoff between attempts and a small
// in-memory send queue that survives a reconnect.
//
// Mirror of http-client.js conventions: callback-style handlers passed in
// `handlers`, returned plain object exposes { send, close, isOpen, _ws }.
// The constructor signature ({ room, handlers }) is unchanged so existing
// callers (nee2p-app.jsx) keep working without modification.
(function (g) {
  // Backoff schedule, in ms. Last value repeats forever (capped at 30s).
  const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 15000, 30000];
  const MAX_RETRIES = 10;
  const SEND_QUEUE_CAP = 50;
  // We only consider a connection "stable" once we've seen at least one
  // message round-trip after open. Without this, a server that accepts the
  // socket then immediately drops it would reset our backoff counter and we'd
  // hot-loop forever.
  // (handlers.onOpen still fires on every successful WS 'open' so the host
  // app can re-claim — only the *backoff counter* waits for the round-trip.)

  function createClient({ room, handlers = {} }) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = location.pathname.replace(/[^/]*$/, '');
    const url = `${proto}//${location.host}${basePath}ws?room=${encodeURIComponent(room)}`;

    let ws = null;
    let open = false;
    let destroyed = false;       // close()/destroy() called — stop everything
    let retries = 0;             // consecutive failed attempts
    let sawRoundTrip = false;    // got ≥1 message after the most recent open
    let reconnectTimer = null;
    const queue = [];            // pending sends while disconnected, cap 50

    function handlerName(type) {
      // 'claim-result' → 'onClaimResult', 'peer-online' → 'onPeerOnline'
      return 'on' + type.split('-').map(p => p ? p[0].toUpperCase() + p.slice(1) : '').join('');
    }

    function flushQueue() {
      while (queue.length && ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify(queue.shift())); }
        catch { break; }
      }
    }

    function scheduleReconnect() {
      if (destroyed) return;
      if (reconnectTimer) return;
      if (retries >= MAX_RETRIES) {
        // Give up. Tell the host app so it can show "reconnect" UI.
        try { handlers.onPermanentClose && handlers.onPermanentClose(); } catch {}
        return;
      }
      const idx = Math.min(retries, BACKOFF_SCHEDULE_MS.length - 1);
      const delay = BACKOFF_SCHEDULE_MS[idx];
      retries += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (destroyed) return;
        connect();
      }, delay);
    }

    function connect() {
      if (destroyed) return;
      sawRoundTrip = false;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        // Synchronous throw (rare, bad URL etc.) — schedule retry.
        try { handlers.onError && handlers.onError(); } catch {}
        scheduleReconnect();
        return;
      }

      ws.addEventListener('open', () => {
        if (destroyed) { try { ws.close(); } catch {} return; }
        open = true;
        // NOTE: do NOT reset `retries` here. We wait for the first inbound
        // message (round-trip) to confirm the connection is actually usable.
        flushQueue();
        try { handlers.onOpen && handlers.onOpen(); } catch {}
      });

      ws.addEventListener('close', () => {
        open = false;
        try { handlers.onClose && handlers.onClose(); } catch {}
        if (destroyed) return;
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        // 'error' is always followed by 'close' per the WS spec, so the
        // reconnect path is driven by the close handler. We just forward
        // the event to the host.
        try { handlers.onError && handlers.onError(); } catch {}
      });

      ws.addEventListener('message', (ev) => {
        // First inbound message → connection is genuinely up. Reset backoff.
        if (!sawRoundTrip) {
          sawRoundTrip = true;
          retries = 0;
        }
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || typeof m.type !== 'string') return;
        const fn = handlers[handlerName(m.type)];
        if (typeof fn === 'function') {
          try { fn(m); } catch {}
        } else if (handlers.onAny) {
          try { handlers.onAny(m); } catch {}
        }
      });
    }

    function send(obj) {
      if (destroyed) return;
      if (open && ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify(obj)); return; }
        catch { /* fall through to enqueue */ }
      }
      // Disconnected (or send threw) — queue with drop-oldest cap.
      queue.push(obj);
      while (queue.length > SEND_QUEUE_CAP) queue.shift();
    }

    function close() {
      destroyed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) { try { ws.close(); } catch {} }
      open = false;
    }

    // Kick off the first connection attempt.
    connect();

    return {
      send,
      close,
      destroy: close,                       // alias for symmetry with other agents
      isOpen: () => open,
      get _ws() { return ws; },             // current underlying socket (may change)
    };
  }

  g.Nee2PWS = { createClient };
})(typeof window !== 'undefined' ? window : globalThis);
