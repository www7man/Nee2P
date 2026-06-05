/*
 * net-probe.js — Network-condition probes for the three Nee2P connection modes.
 *
 * Purpose
 * -------
 * Runs a battery of pre-flight network checks that tell the user which of the
 * three transports is likely to work right now:
 *
 *   • Relay     — server-mediated (HTTPS + WSS to our origin)
 *   • Direct    — WebRTC P2P (STUN reachable, NAT not symmetric, trackers up)
 *   • Local     — same-Wi-Fi / Multipeer / Bluetooth (via the iOS native bridge)
 *
 * Each probe is bounded by a 2s timeout and never throws. Results are surfaced
 * as a row-per-check structure the UI renders as a checklist (green / yellow /
 * red). Aggregate per-mode status is computed from the rows.
 *
 * Reuse policy
 * ------------
 *   • STUN reachability and NAT classification are delegated to webrtc.js
 *     (`NeeCall.diagnose` + DIAG_STUN_URLS via `probeSingleStun`) — we do not
 *     re-implement them here.
 *   • Relay URL is derived the same way ws-client.js / http-client.js do
 *     (`location.origin + basePath`). When loaded from `file://` (iOS
 *     WKWebView with a custom scheme) we fall back to a hardcoded origin
 *     until a config plumb-through exists.
 *
 * Globals: depends on `window.NeeCall` (webrtc.js) and optionally
 * `window.Nee2PBridge` (iOS WKWebView bridge). Exposes `window.Nee2PProbe`.
 */
(function (g) {
  'use strict';

  // -- Constants ----------------------------------------------------------

  const PROBE_TIMEOUT_MS = 2000;
  const CACHE_TTL_MS = 30000;
  const SUBSCRIBE_INTERVAL_MS = 10000;

  // TODO: make the relay origin configurable (e.g. read from a `?relay_url=`
  // query param or an injected config object) so the iOS WKWebView build
  // doesn't have to hardcode the production host.
  const FALLBACK_RELAY_ORIGIN = 'https://letsmaketelegramgreatagain.com';

  // Top-two community WebTorrent trackers — we count how many accept a WSS
  // upgrade within 2s.
  const TRACKER_URLS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
  ];

  // -- URL helpers --------------------------------------------------------

  // Mirror of the basePath logic in ws-client.js / http-client.js.
  function getRelayBase() {
    if (location.protocol === 'file:' || !location.host) {
      return { origin: FALLBACK_RELAY_ORIGIN, basePath: '/', isFallback: true };
    }
    const basePath = location.pathname.replace(/[^/]*$/, '');
    return { origin: location.origin, basePath, isFallback: false };
  }

  // -- Generic helpers ----------------------------------------------------

  // Wrap any promise with a timeout — on expiry returns a "timeout" result
  // instead of rejecting, so callers can keep going.
  function withTimeout(promise, ms, timeoutValue) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(typeof timeoutValue === 'function' ? timeoutValue() : timeoutValue);
      }, ms);
      Promise.resolve(promise).then(
        (v) => { if (done) return; done = true; clearTimeout(t); resolve(v); },
        (_e) => {
          if (done) return; done = true; clearTimeout(t);
          resolve(typeof timeoutValue === 'function' ? timeoutValue() : timeoutValue);
        },
      );
    });
  }

  function row(label, status, detail, value) {
    const r = { label, status };
    if (detail !== undefined) r.detail = detail;
    if (value !== undefined) r.value = value;
    return r;
  }

  function bridgeUnavailableRow(label) {
    return row(label, 'red', 'iOS bridge not present');
  }

  function hasBridge(method) {
    return !!(g.Nee2PBridge && typeof g.Nee2PBridge[method] === 'function');
  }

  // -- Individual probes --------------------------------------------------

  // HEAD {origin}/healthz — falls back to HEAD on root path on 404.
  // TODO: server-side — add a cheap `/healthz` endpoint to server.js that
  // returns 200 with no body so this probe is unambiguous.
  async function probeRelayReachable() {
    const { origin, basePath } = getRelayBase();
    const t0 = (g.performance && performance.now) ? performance.now() : Date.now();
    async function tryHead(url) {
      try {
        const r = await fetch(url, { method: 'HEAD', cache: 'no-store', mode: 'cors' });
        return r;
      } catch {
        return null;
      }
    }
    return withTimeout(
      (async () => {
        let r = await tryHead(origin + basePath + 'healthz');
        if (!r || r.status === 404) {
          r = await tryHead(origin + basePath);
        }
        const t1 = (g.performance && performance.now) ? performance.now() : Date.now();
        const latencyMs = Math.round(t1 - t0);
        if (!r) return { status: 'red', latencyMs: null, detail: 'unreachable' };
        if (r.ok || r.status === 405 /* HEAD not allowed but server alive */) {
          return { status: 'green', latencyMs, detail: 'HTTP ' + r.status };
        }
        return { status: 'yellow', latencyMs, detail: 'HTTP ' + r.status };
      })(),
      PROBE_TIMEOUT_MS,
      () => ({ status: 'red', latencyMs: null, detail: 'timeout' }),
    );
  }

  // Synchronous-ish: we don't actually open a TLS socket here — we trust
  // that if the HEAD above succeeded over https, TLS is fine. Returns a row.
  async function probeRelayTls(reachable) {
    const proto = location.protocol || '';
    // iOS WKWebView uses a custom scheme (nee:, app:, file:) — the *relay* URL
    // is still hit over https inside probeRelayReachable. So treat any non-http:
    // origin as "TLS-clean" because the HEAD request itself was https.
    const isNativeScheme = proto !== 'http:' && proto !== 'https:' && proto !== '';
    const isHttps = proto === 'https:' || isNativeScheme || getRelayBase().isFallback;
    if (proto === 'http:') {
      return row('TLS (https)', 'red', 'page is served over plain http');
    }
    if (!isHttps) {
      return row('TLS (https)', 'yellow', 'unknown scheme');
    }
    if (!reachable || reachable.status === 'red') {
      return row('TLS (https)', 'yellow', 'cannot verify — relay not reachable');
    }
    return row('TLS (https)', 'green');
  }

  async function probeRelayLatency(reachable) {
    if (!reachable || reachable.latencyMs == null) {
      return row('Latency', 'red', 'no response', '—');
    }
    const ms = reachable.latencyMs;
    let status = 'red';
    if (ms <= 250) status = 'green';
    else if (ms <= 800) status = 'yellow';
    return row('Latency', status, undefined, ms + ' ms');
  }

  async function probeWebRtcSupport() {
    const ok = typeof g.RTCPeerConnection !== 'undefined';
    return { status: ok ? 'green' : 'red', detail: ok ? undefined : 'RTCPeerConnection missing' };
  }

  // Reuse webrtc.js — DIAG_STUN_URLS lives behind diagnose(). We call
  // diagnose() (cached internally for 60s) and derive a count from natType
  // + stunReachable. If diagnose isn't available, do a coarse fallback.
  async function probeStun() {
    if (!g.NeeCall || typeof g.NeeCall.diagnose !== 'function') {
      return { status: 'red', detail: 'webrtc.js not loaded', reachableCount: 0, natType: 'unknown' };
    }
    // diagnose() can take ~5s (STUN gather). We allow that — but if it
    // blows past PROBE_TIMEOUT_MS we accept a cached result if any.
    const cached = (typeof g.NeeCall.getCachedDiagnose === 'function')
      ? g.NeeCall.getCachedDiagnose() : null;
    const diag = await withTimeout(
      g.NeeCall.diagnose().catch(() => cached),
      PROBE_TIMEOUT_MS,
      () => cached,
    );
    if (!diag) {
      return { status: 'yellow', detail: 'STUN probe in progress', reachableCount: 0, natType: 'unknown' };
    }
    // We don't get a per-server pass/fail back, only the rolled-up
    // stunReachable flag and natType. Approximate: natType 'cone' means both
    // providers agreed → 2 reachable; 'symmetric' means both responded with
    // different ports → 2 reachable; 'unknown' + stunReachable=true → 1.
    let reachableCount;
    if (diag.natType === 'cone' || diag.natType === 'symmetric') reachableCount = 2;
    else if (diag.stunReachable) reachableCount = 1;
    else reachableCount = 0;
    let status = 'red';
    if (reachableCount >= 2) status = 'green';
    else if (reachableCount === 1) status = 'yellow';
    return { status, reachableCount, natType: diag.natType, diag };
  }

  async function probeNat(stunResult) {
    if (!stunResult || !stunResult.natType || stunResult.natType === 'unknown') {
      return row('NAT type', 'yellow', 'unknown');
    }
    if (stunResult.natType === 'symmetric') {
      return row('NAT type', 'yellow', 'symmetric — direct P2P unlikely', 'symmetric');
    }
    return row('NAT type', 'green', undefined, stunResult.natType);
  }

  // Probe top-2 trackers in parallel, 2s timeout each. Returns aliveCount.
  async function probeTracker() {
    const checks = TRACKER_URLS.map((url) => withTimeout(
      new Promise((resolve) => {
        let ws;
        try {
          ws = new WebSocket(url);
        } catch {
          resolve(false);
          return;
        }
        ws.onopen = () => { try { ws.close(); } catch {} resolve(true); };
        ws.onerror = () => { resolve(false); };
        ws.onclose = () => { resolve(false); };
      }),
      PROBE_TIMEOUT_MS,
      () => false,
    ));
    const results = await Promise.all(checks);
    const aliveCount = results.filter(Boolean).length;
    let status = 'red';
    if (aliveCount >= 2) status = 'green';
    else if (aliveCount === 1) status = 'yellow';
    return { status, aliveCount, total: TRACKER_URLS.length };
  }

  // -- Native-bridge probes (iOS) -----------------------------------------

  async function probeOnWifi() {
    if (!hasBridge('netInfo')) {
      return row('Wi-Fi', 'yellow', 'iOS bridge not present — assuming any network');
    }
    const info = await withTimeout(
      Promise.resolve().then(() => g.Nee2PBridge.netInfo()),
      PROBE_TIMEOUT_MS,
      () => null,
    );
    if (!info) return row('Wi-Fi', 'yellow', 'no response from bridge');
    const onWifi = !!(info && (info.wifi || info.type === 'wifi'));
    return row('Wi-Fi', onWifi ? 'green' : 'red', onWifi ? undefined : 'not on Wi-Fi');
  }

  async function probeLocalNetworkPermission() {
    if (!hasBridge('localNetworkAuth')) {
      return row('Local network permission', 'yellow', 'iOS bridge not present');
    }
    const state = await withTimeout(
      Promise.resolve().then(() => g.Nee2PBridge.localNetworkAuth()),
      PROBE_TIMEOUT_MS,
      () => null,
    );
    if (state === 'granted' || state === true) return row('Local network permission', 'green');
    if (state === 'denied' || state === false) return row('Local network permission', 'red', 'denied in Settings');
    return row('Local network permission', 'yellow', 'not determined');
  }

  async function probeMultipeer() {
    if (!hasBridge('mpcAvailable')) {
      return row('Multipeer Connectivity', 'yellow', 'iOS bridge not present');
    }
    const v = await withTimeout(
      Promise.resolve().then(() => g.Nee2PBridge.mpcAvailable()),
      PROBE_TIMEOUT_MS,
      () => null,
    );
    if (v === true || v === 'available') return row('Multipeer Connectivity', 'green');
    if (v === false || v === 'unavailable') return row('Multipeer Connectivity', 'red');
    return row('Multipeer Connectivity', 'yellow', 'unknown');
  }

  async function probeBluetooth() {
    if (!hasBridge('bluetoothState')) {
      return row('Bluetooth', 'yellow', 'iOS bridge not present');
    }
    const v = await withTimeout(
      Promise.resolve().then(() => g.Nee2PBridge.bluetoothState()),
      PROBE_TIMEOUT_MS,
      () => null,
    );
    if (v === 'poweredOn' || v === 'on' || v === true) return row('Bluetooth', 'green');
    if (v === 'poweredOff' || v === 'off' || v === false) return row('Bluetooth', 'red', 'off');
    if (v === 'unauthorized' || v === 'denied') return row('Bluetooth', 'red', 'permission denied');
    return row('Bluetooth', 'yellow', 'unknown');
  }

  // -- Mode aggregation ---------------------------------------------------

  function aggregate(rows, opts) {
    opts = opts || {};
    const ignore = new Set(opts.ignoreYellowFor || []);
    let hasRed = false;
    let hasYellow = false;
    for (const r of rows) {
      if (r.status === 'red') hasRed = true;
      else if (r.status === 'yellow' && !ignore.has(r.label)) hasYellow = true;
    }
    if (hasRed) return 'unavailable';
    if (hasYellow) return 'limited';
    return 'available';
  }

  function summaryFor(modeName, status) {
    if (status === 'available') return modeName + ': ready';
    if (status === 'limited') return modeName + ': limited';
    return modeName + ': unavailable';
  }

  // -- Top-level orchestration --------------------------------------------

  let _cache = null;       // { result, at }
  const _subscribers = new Set();
  let _subInterval = null;

  async function runAll() {
    // Kick everything off in parallel.
    const pReach = probeRelayReachable();
    const pWebRtc = probeWebRtcSupport();
    const pStun = probeStun();
    const pTracker = probeTracker();
    const pWifi = probeOnWifi();
    const pLocalPerm = probeLocalNetworkPermission();
    const pMpc = probeMultipeer();
    const pBt = probeBluetooth();

    const [reach, webrtcSup, stun, tracker, wifi, localPerm, mpc, bt] = await Promise.all([
      pReach, pWebRtc, pStun, pTracker, pWifi, pLocalPerm, pMpc, pBt,
    ]);

    // --- Relay mode rows -----------------------------------------------
    const relayReachRow = row(
      'Relay reachable',
      reach.status,
      reach.detail,
      reach.latencyMs != null ? reach.latencyMs + ' ms' : undefined,
    );
    const relayTlsRow = await probeRelayTls(reach);
    const relayLatRow = await probeRelayLatency(reach);
    const relayRows = [relayReachRow, relayTlsRow, relayLatRow];
    // Latency-yellow does not knock the mode down to "limited" — server
    // still works, just slower.
    const relayStatus = aggregate(relayRows, { ignoreYellowFor: ['Latency'] });

    // --- Direct mode rows ----------------------------------------------
    const webrtcRow = row('WebRTC support', webrtcSup.status, webrtcSup.detail);
    const stunRow = row(
      'STUN reachability',
      stun.status,
      stun.detail,
      stun.reachableCount != null ? (stun.reachableCount + '/2 servers') : undefined,
    );
    const natRow = await probeNat(stun);
    const trackerRow = row(
      'WebTorrent trackers',
      tracker.status,
      undefined,
      tracker.aliveCount + '/' + tracker.total + ' alive',
    );
    const directRows = [webrtcRow, stunRow, natRow, trackerRow];
    const directStatus = aggregate(directRows);

    // --- Local mode rows -----------------------------------------------
    const localRows = [wifi, localPerm, mpc, bt];
    const localStatus = aggregate(localRows);

    return {
      relay: {
        status: relayStatus,
        rows: relayRows,
        summary: summaryFor('Relay', relayStatus),
      },
      direct: {
        status: directStatus,
        rows: directRows,
        summary: summaryFor('Direct P2P', directStatus),
      },
      local: {
        status: localStatus,
        rows: localRows,
        summary: summaryFor('LAN / Local', localStatus),
      },
    };
  }

  async function probeAll() {
    if (_cache && (Date.now() - _cache.at) < CACHE_TTL_MS) return _cache.result;
    const result = await runAll();
    _cache = { result, at: Date.now() };
    return result;
  }

  async function refresh() {
    const result = await runAll();
    _cache = { result, at: Date.now() };
    for (const cb of _subscribers) {
      try { cb(result); } catch {}
    }
    return result;
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    _subscribers.add(callback);

    // Kick an initial probe immediately for the new subscriber.
    probeAll().then((r) => { try { callback(r); } catch {} });

    if (!_subInterval) {
      _subInterval = setInterval(() => {
        // Only re-probe while we have at least one listener.
        if (_subscribers.size === 0) return;
        refresh();
      }, SUBSCRIBE_INTERVAL_MS);
    }
    return function unsubscribe() {
      _subscribers.delete(callback);
      if (_subscribers.size === 0 && _subInterval) {
        clearInterval(_subInterval);
        _subInterval = null;
      }
    };
  }

  // -- Export -------------------------------------------------------------

  g.Nee2PProbe = {
    probeAll,
    refresh,
    subscribe,
    // Exported for testability:
    probeRelayReachable,
    probeRelayTls,
    probeRelayLatency,
    probeWebRtcSupport,
    probeStun,
    probeNat,
    probeTracker,
    probeOnWifi,
    probeLocalNetworkPermission,
    probeMultipeer,
    probeBluetooth,
  };
})(typeof window !== 'undefined' ? window : this);
