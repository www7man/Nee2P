// ws-client.js — thin WebSocket client. Dispatches typed messages from the
// relay to named handlers. See server.js for the full protocol.
(function (g) {
  function createClient({ room, handlers = {} }) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = location.pathname.replace(/[^/]*$/, '');
    const url = `${proto}//${location.host}${basePath}ws?room=${encodeURIComponent(room)}`;
    const ws = new WebSocket(url);

    let open = false;
    const queue = [];

    function handlerName(type) {
      // 'claim-result' → 'onClaimResult', 'peer-online' → 'onPeerOnline'
      return 'on' + type.split('-').map(p => p ? p[0].toUpperCase() + p.slice(1) : '').join('');
    }

    ws.addEventListener('open', () => {
      open = true;
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
      handlers.onOpen && handlers.onOpen();
    });
    ws.addEventListener('close', () => {
      open = false;
      handlers.onClose && handlers.onClose();
    });
    ws.addEventListener('error', () => {
      handlers.onError && handlers.onError();
    });
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m.type !== 'string') return;
      const fn = handlers[handlerName(m.type)];
      if (typeof fn === 'function') fn(m);
      else if (handlers.onAny) handlers.onAny(m);
    });

    function send(obj) {
      if (open && ws.readyState === 1) ws.send(JSON.stringify(obj));
      else queue.push(obj);
    }
    function close() { try { ws.close(); } catch {} }

    return { send, close, isOpen: () => open, _ws: ws };
  }

  g.Nee2PWS = { createClient };
})(typeof window !== 'undefined' ? window : globalThis);
