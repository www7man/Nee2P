// transport.js — unified transport interface for Nee2P's 3 connection modes.
//
// Mode 1 (relay):  wraps existing ws-client + http-client. Current behaviour.
// Mode 2 (direct): tracker-rendezvous + p2p-session. No Nee2P server.
// Mode 3 (local):  MultipeerConnectivity via Nee2PBridge (iOS only). No internet.
//
// Phrase is the rendezvous token in every mode; crypto.js handshake runs on top.
//
// Usage:
//   const t = await Nee2PTransport.open('direct', phrase, { logger, role: 'initiator' });
//   t.onMessage = (m) => ...;
//   t.send({ type: 'chat', body: '...' });
//
// ─── Wire envelope ───────────────────────────────────────────────────────────
// All three transports carry the same envelope shape used by the current relay
// WebSocket client. See nee2p-app.jsx:1953 — `sendMessage` constructs:
//     { type: 'msg', iv, ct, id, senderKeyEpoch?, replyTo?, expireSecAfterRead? }
// and other call-sites use envelopes like `{ type: 'ack', ids }`,
// `{ type: 'react', msgId, emoji }`, `{ type: 'typing', on }`, etc. The common
// invariant: every message is a JSON object whose `type` field names the verb
// (kebab-case on the wire, lowerCamelCase'd as `on<Type>` for the handler
// dispatch in ws-client.js). transport.js does NOT inspect this shape — it
// forwards verbatim — so the app's message reducer is transport-agnostic.

(function (g) {
  'use strict';

  // ─── small helpers ─────────────────────────────────────────────────────────
  function hexBytes(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
    return s;
  }
  function randBytes(n) {
    const b = new Uint8Array(n);
    (g.crypto || g.msCrypto).getRandomValues(b);
    return b;
  }
  function noopLogger() {}

  // Compute md5(phrase) → first 16 hex chars. Used as the LAN-Local discovery
  // payload. md5 is fine here: the payload is just a rendezvous tag, not a
  // secret — the secret phrase still has to authenticate the handshake on top.
  async function md5First16Hex(phrase) {
    // window.md5 is the synchronous md5.js bundle already shipped with the app.
    if (typeof g.md5 === 'function') {
      const full = String(g.md5(String(phrase || '')));
      return full.slice(0, 16);
    }
    // Fallback: SHA-256 truncated. NOT md5, but discovery is best-effort and
    // we'd rather have a tag than crash. Matches between two peers running
    // the same fallback build, so still functional.
    const enc = new TextEncoder().encode(String(phrase || ''));
    const buf = await g.crypto.subtle.digest('SHA-256', enc);
    return hexBytes(new Uint8Array(buf)).slice(0, 16);
  }

  // ─── shared TransportHandle scaffold ───────────────────────────────────────
  // All three modes construct a handle with the same skeleton; the differences
  // live in `send`/`close` and which phases are emitted.
  function makeHandle(mode) {
    const metrics = { bytesIn: 0, bytesOut: 0, latencyMs: null };
    const handle = {
      mode,
      send: () => {},
      close: () => {},
      onMessage: null,
      onPhase: null,
      onDrop: null,
      metrics: {
        get bytesIn() { return metrics.bytesIn; },
        get bytesOut() { return metrics.bytesOut; },
        get latencyMs() { return metrics.latencyMs; },
      },
      _metrics: metrics,                  // private — for the transport impl
      _phase: 'connecting',
      _emitPhase(p) {
        this._phase = p;
        try { this.onPhase && this.onPhase(p); } catch {}
      },
      _emitMessage(m) {
        try { this.onMessage && this.onMessage(m); } catch {}
      },
      _emitDrop(reason) {
        try { this.onDrop && this.onDrop(reason); } catch {}
      },
    };
    return handle;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mode 1: Relay (wraps Nee2PWS.createClient — which itself is either the
  // WebSocket client or HTTP/SSE fallback depending on which of ws-client.js /
  // http-client.js was loaded last; both expose `g.Nee2PWS.createClient` with
  // the same signature).
  //
  // For relay mode we expect opts.room (the room hash) and opts.handlers to be
  // passed through verbatim. The relay protocol has its own per-message-type
  // dispatch (`onClaimResult`, `onMsgBatch`, etc.) which the app already wires
  // up at the call-site in nee2p-app.jsx. Wrapping it again here would mean
  // duplicating that whole handler map — instead, transport.js exposes the
  // underlying client as `_client` for the relay-mode handle, and the legacy
  // call-site can keep using its current handlers map. `onMessage` fires on
  // EVERY inbound message (via the existing `handlers.onAny` hook) so new
  // call-sites that prefer the uniform interface can use it.
  // ───────────────────────────────────────────────────────────────────────────
  function openRelay(phrase, opts) {
    const log = (opts && opts.logger) || noopLogger;
    const handle = makeHandle('relay');

    const room = (opts && opts.room) || null;
    if (!room) {
      // Relay needs a room hash, not just a phrase — the caller derives it
      // (sha256 of phrase+password). Fail loudly so misuse is obvious.
      handle._emitPhase('failed');
      handle._emitDrop('relay-needs-room');
      handle.send = () => {};
      handle.close = () => {};
      return handle;
    }

    const Nee2PWS = g.Nee2PWS;
    if (!Nee2PWS || typeof Nee2PWS.createClient !== 'function') {
      handle._emitPhase('failed');
      handle._emitDrop('relay-client-missing');
      return handle;
    }

    // Merge caller handlers with our phase/message hooks. We don't replace
    // their handlers — we layer on `onAny` (for transport-level onMessage)
    // and wrap onOpen/onClose to drive the phase machine.
    const userHandlers = (opts && opts.handlers) || {};
    const wrapped = Object.assign({}, userHandlers, {
      onOpen: () => {
        handle._emitPhase('ready');
        try { userHandlers.onOpen && userHandlers.onOpen(); } catch {}
      },
      onClose: () => {
        if (handle._phase !== 'failed') handle._emitPhase('dropped');
        handle._emitDrop('relay-close');
        try { userHandlers.onClose && userHandlers.onClose(); } catch {}
      },
      onError: () => {
        try { userHandlers.onError && userHandlers.onError(); } catch {}
      },
      onPermanentClose: () => {
        handle._emitPhase('failed');
        handle._emitDrop('relay-permanent-close');
        try { userHandlers.onPermanentClose && userHandlers.onPermanentClose(); } catch {}
      },
      onAny: (m) => {
        try {
          if (typeof m === 'object' && m) {
            // best-effort byte count for diagnostics
            handle._metrics.bytesIn += JSON.stringify(m).length;
          }
        } catch {}
        handle._emitMessage(m);
        try { userHandlers.onAny && userHandlers.onAny(m); } catch {}
      },
    });

    let dropped = false;
    const client = Nee2PWS.createClient({ room, handlers: wrapped });

    handle.send = (msg) => {
      if (dropped) return;
      try {
        const s = JSON.stringify(msg);
        handle._metrics.bytesOut += s.length;
      } catch {}
      try { client.send(msg); } catch (e) { log('relay-send-failed', e && e.message); }
    };
    handle.close = () => {
      dropped = true;
      try { client.close(); } catch {}
    };
    handle._client = client;     // escape hatch — see comment above
    // Forward the relay client's blob helpers onto the handle. The app calls
    // `wsRef.current.uploadBlob(…)` / `.downloadBlob(…)` directly (nee2p-app.jsx
    // ~2413/2433/2584), but `wsRef.current` is THIS handle, which otherwise only
    // exposes send/close — so attachments threw 'no-client' and images never
    // uploaded or rendered. Bind only what the client actually has (the WS
    // transport has no blob API).
    if (typeof client.uploadBlob === 'function') handle.uploadBlob = client.uploadBlob.bind(client);
    if (typeof client.downloadBlob === 'function') handle.downloadBlob = client.downloadBlob.bind(client);
    handle._emitPhase('connecting');
    // Relay has no separate "paired" phase distinct from "ready"; the relay's
    // own claim-result/paired messages drive the app's logical pairing state.
    return handle;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mode 2: Direct P2P (tracker-rendezvous + p2p-session).
  //
  // Wire path:
  //   phrase → masterKey → { infoHash (sha1), psk (hkdf) }
  //   TrackerSwarm discovers a peer with the same infoHash.
  //   P2PSession runs WebRTC offer/answer with PSK-MAC on SDP attributes.
  //   DataChannel carries app messages (same JSON envelope as relay).
  //
  // Role tie-breaker: peer with the LOWER peerId becomes the initiator
  // (creates the offer, waits for an answer). The peer with the HIGHER peerId
  // ignores its own outgoing offer and answers the lower peer's offer. This
  // mirrors lite/nee2p-lite.html:1481-1494 — the rule that keeps both sides
  // from orphaning their own PCs and stalling forever at "connecting…".
  //
  // The `role` in opts is only a HINT for diagnostics; the actual role is
  // decided from the peerId comparison once an offer is observed.
  // ───────────────────────────────────────────────────────────────────────────
  async function openDirect(phrase, opts) {
    const log = (opts && opts.logger) || noopLogger;
    const handle = makeHandle('direct');
    handle._emitPhase('connecting');

    const Crypto = g.Nee2PCrypto;
    const TR = g.TrackerRendezvous;
    const P2P = g.P2PSession;
    if (!Crypto || !TR || !P2P
        || typeof Crypto.deriveMasterKey !== 'function'
        || typeof Crypto.hkdf !== 'function'
        || typeof Crypto.sha1 !== 'function'
        || !TR.TrackerSwarm) {
      handle._emitPhase('failed');
      handle._emitDrop('direct-deps-missing');
      handle.send = () => {};
      handle.close = () => {};
      throw new Error('Nee2PTransport: direct mode requires Nee2PCrypto.{deriveMasterKey,hkdf,sha1}, TrackerRendezvous.TrackerSwarm and P2PSession to be loaded');
    }

    // 1. Derive infoHash + psk from the phrase.
    const masterKey = await Crypto.deriveMasterKey(String(phrase));
    const infoHash = await Crypto.sha1(masterKey);                         // 20 bytes
    const enc = new TextEncoder();
    const psk = await Crypto.hkdf(masterKey, enc.encode('nee2p.v1.psk'), 'psk', 32);
    const peerId = randBytes(20);

    log('direct-setup', { infoHashHex: hexBytes(infoHash).slice(0, 16) });

    // 2. Start the swarm.
    const swarm = new TR.TrackerSwarm({ infoHash, peerId, logger: log });
    let session = null;
    let dropped = false;
    let paired = false;

    function teardown(reason) {
      if (dropped) return;
      dropped = true;
      try { swarm.stop(); } catch {}
      try { session && session.close && session.close(); } catch {}
      if (!paired) {
        handle._emitPhase('failed');
        handle._emitDrop(reason || 'direct-teardown');
      } else {
        handle._emitPhase('dropped');
        handle._emitDrop(reason || 'direct-teardown');
      }
    }

    // 3. Build the p2p session. We start as initiator and may flip to
    //    responder when an incoming offer arrives with a lower peerId.
    function buildSession(role) {
      const s = new P2P({
        psk,
        role,
        logger: log,
        onOpen:    () => { paired = true; handle._emitPhase('ready'); },
        onMessage: (m) => {
          try {
            if (typeof m === 'string') handle._metrics.bytesIn += m.length;
            else if (m && typeof m === 'object') handle._metrics.bytesIn += JSON.stringify(m).length;
          } catch {}
          handle._emitMessage(m);
        },
        onClose:   () => { teardown('direct-session-close'); },
        onError:   (e) => { log('direct-session-error', e && e.message); },
      });
      return s;
    }

    session = buildSession('initiator');

    // Compare peer ids in the same binary-string form TrackerSwarm uses.
    let myPidStr = '';
    for (let i = 0; i < peerId.length; i++) myPidStr += String.fromCharCode(peerId[i]);

    // Helper: deterministically lex-compare two binary peerId strings.
    function lower(a, b) { return a < b; }

    // 4. Hook the swarm.
    let myOfferId = null;

    swarm.onOffer = async (o) => {
      if (paired) return;
      // Tie-breaker: if the incoming peer has a HIGHER peerId, WE are the
      // initiator and ignore their offer (they'll switch to responder when
      // they see ours). If they have a LOWER peerId, WE answer.
      if (!lower(o.fromPeerId, myPidStr)) {
        log('direct-offer-ignored', 'higher-or-equal-peer-id');
        return;
      }
      log('direct-offer-accepted', 'remote-peer-lower');
      try {
        // Swap out the initiator session for a responder one.
        try { session && session.close && session.close(); } catch {}
        session = buildSession('responder');
        // p2p-session is expected to expose acceptOffer → returns answer SDP.
        // We pass the PSK-bound SDP verbatim; p2p-session.js owns the MAC
        // verify (it has the psk in its constructor).
        const answer = await session.acceptOffer(o.sdp, { fromPeerId: o.fromPeerId, offerId: o.offerId });
        if (answer && typeof answer === 'string') {
          swarm.sendAnswer(o.viaTracker, o.fromPeerId, o.offerId, answer);
        }
        handle._emitPhase('paired');
      } catch (e) {
        log('direct-accept-offer-failed', e && e.message);
      }
    };

    swarm.onAnswer = async (a) => {
      if (paired) return;
      if (a.offerId !== myOfferId) return;
      try {
        await session.acceptAnswer(a.sdp, { fromPeerId: a.fromPeerId });
        handle._emitPhase('paired');
      } catch (e) {
        log('direct-accept-answer-failed', e && e.message);
      }
    };

    swarm.start();

    // 5. Announce our offer. p2p-session must expose createOffer() → SDP string
    //    and a unique 20-byte offer id (we generate it here; either side is fine).
    try {
      const offerSdp = await session.createOffer();
      const offerIdBytes = randBytes(20);
      myOfferId = '';
      for (let i = 0; i < offerIdBytes.length; i++) myOfferId += String.fromCharCode(offerIdBytes[i]);
      swarm.announceOffer(offerIdBytes, offerSdp);
    } catch (e) {
      log('direct-create-offer-failed', e && e.message);
      teardown('direct-create-offer-failed');
      throw e;
    }

    // 6. AbortSignal wiring.
    if (opts && opts.signal) {
      if (opts.signal.aborted) { teardown('aborted'); }
      else opts.signal.addEventListener('abort', () => teardown('aborted'), { once: true });
    }

    handle.send = (msg) => {
      if (dropped || !session) return;
      let s;
      try { s = JSON.stringify(msg); } catch { return; }
      handle._metrics.bytesOut += s.length;
      try { session.send(s); } catch (e) { log('direct-send-failed', e && e.message); }
    };
    handle.close = () => teardown('explicit-close');

    return handle;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mode 3: LAN-Local (MultipeerConnectivity via Nee2PBridge).
  //
  // Discovery payload = first 16 hex chars of md5(phrase). Two peers running
  // the same phrase compute the same tag, advertise/browse with service type
  // 'nee2p', and pair when they see a matching discovery tag.
  //
  // Nee2PBridge is a WKWebView ↔ Swift bridge implemented by the iOS host app.
  // It is absent in plain Safari / desktop browsers — in that case we return a
  // handle that immediately reports 'failed' with reason 'mpc-not-available'.
  // ───────────────────────────────────────────────────────────────────────────
  async function openLocal(phrase, opts) {
    const log = (opts && opts.logger) || noopLogger;
    const handle = makeHandle('local');
    handle._emitPhase('connecting');

    const bridge = g.Nee2PBridge;
    const hasMpc = bridge
      && typeof bridge.mpcStart === 'function'
      && typeof bridge.mpcSend === 'function'
      && typeof bridge.mpcStop === 'function';
    if (!hasMpc) {
      // Fail synchronously-ish: caller awaits open(), then sees onPhase('failed').
      Promise.resolve().then(() => {
        handle._emitPhase('failed');
        handle._emitDrop('mpc-not-available');
      });
      handle.send = () => {};
      handle.close = () => {};
      return handle;
    }

    const tag = await md5First16Hex(phrase);
    let dropped = false;

    // The bridge dispatches inbound events via window-level callbacks. We
    // install named handlers, and uninstall them in close(). Multiple
    // concurrent local transports aren't supported (MPC is a single-session
    // resource on iOS) — opening a second one will replace the first.
    g.Nee2PBridge._onMpcPaired = () => {
      if (dropped) return;
      handle._emitPhase('paired');
      handle._emitPhase('ready');
    };
    g.Nee2PBridge._onMpcMessage = (raw) => {
      if (dropped) return;
      let m = raw;
      if (typeof raw === 'string') {
        try { m = JSON.parse(raw); } catch { m = raw; }
        try { handle._metrics.bytesIn += raw.length; } catch {}
      }
      handle._emitMessage(m);
    };
    g.Nee2PBridge._onMpcDrop = (reason) => {
      if (dropped) return;
      handle._emitPhase('dropped');
      handle._emitDrop(reason || 'mpc-drop');
    };
    g.Nee2PBridge._onMpcError = (reason) => {
      if (dropped) return;
      handle._emitPhase('failed');
      handle._emitDrop(reason || 'mpc-error');
    };

    try {
      bridge.mpcStart({
        serviceType: 'nee2p',
        discoveryTag: tag,
        role: (opts && opts.role) || 'initiator',
      });
    } catch (e) {
      log('mpc-start-failed', e && e.message);
      Promise.resolve().then(() => {
        handle._emitPhase('failed');
        handle._emitDrop('mpc-start-failed');
      });
      return handle;
    }

    if (opts && opts.signal) {
      if (opts.signal.aborted) {
        try { bridge.mpcStop(); } catch {}
        dropped = true;
        handle._emitDrop('aborted');
      } else {
        opts.signal.addEventListener('abort', () => {
          if (dropped) return;
          dropped = true;
          try { bridge.mpcStop(); } catch {}
          handle._emitDrop('aborted');
        }, { once: true });
      }
    }

    handle.send = (msg) => {
      if (dropped) return;
      let s;
      try { s = JSON.stringify(msg); } catch { return; }
      handle._metrics.bytesOut += s.length;
      try { bridge.mpcSend(s); } catch (e) { log('mpc-send-failed', e && e.message); }
    };
    handle.close = () => {
      if (dropped) return;
      dropped = true;
      try { bridge.mpcStop(); } catch {}
      // Detach the singleton callbacks so a subsequent open() starts clean.
      try {
        if (g.Nee2PBridge._onMpcPaired) g.Nee2PBridge._onMpcPaired = null;
        if (g.Nee2PBridge._onMpcMessage) g.Nee2PBridge._onMpcMessage = null;
        if (g.Nee2PBridge._onMpcDrop) g.Nee2PBridge._onMpcDrop = null;
        if (g.Nee2PBridge._onMpcError) g.Nee2PBridge._onMpcError = null;
      } catch {}
    };

    return handle;
  }

  // ─── public dispatcher ─────────────────────────────────────────────────────
  async function open(mode, phrase, opts) {
    opts = opts || {};
    if (typeof phrase !== 'string' || phrase.length === 0) {
      throw new Error('Nee2PTransport.open: phrase must be a non-empty string');
    }
    switch (mode) {
      case 'relay':  return openRelay(phrase, opts);
      case 'direct': return await openDirect(phrase, opts);
      case 'local':  return await openLocal(phrase, opts);
      default:
        throw new Error('Nee2PTransport.open: unknown mode ' + String(mode));
    }
  }

  g.Nee2PTransport = { open };
})(typeof window !== 'undefined' ? window : globalThis);
