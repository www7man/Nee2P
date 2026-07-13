// webrtc-file.js — peer-to-peer file transfer over a WebRTC DataChannel for Nee2P.
//
// Owner: webrtc-files agent. Self-contained; external code talks to it only via
// the `window.NeeFile` global documented below. Stable public API.
//
// This module is a sibling of webrtc.js (NeeCall) — same signalling shape, same
// STUN pool, same IIFE/`window` pattern — but instead of media tracks it carries
// *file chunks* over a single ordered RTCDataChannel. The reason it's a separate
// file rather than a branch inside webrtc.js is that the two transports have
// very different liveness semantics: a voice call you simply end on disconnect;
// a file transfer you MUST be able to resume after a brief network blip without
// restarting from byte zero. That resume contract is the heart of this module.
//
// ─── Layering / security ──────────────────────────────────────────────────
// This module is a DUMB TRANSPORT. It does NOT encrypt the payload. The app
// layer (nee2p-app.jsx supervisor) calls crypto.encryptChunk() to produce
// {iv, ct} per chunk and hands those bytes to us. We only move them. WebRTC's
// DTLS gives the transport hop confidentiality + integrity; the app-layer
// AES-GCM on top is defense in depth (the relay never sees this — it's P2P
// after ICE). Keeping crypto OUT of this file means the crypto module stays
// the single source of truth for key handling.
//
// ─── Resume contract (the whole point) ────────────────────────────────────
// A DataChannel does NOT survive an ICE restart — `restart()` recreates the
// RTCPeerConnection and negotiates a fresh DC. So transfer state (which chunks
// were sent, which were acked, file total, transferId) lives in the APP
// supervisor, NOT here. This module owns only the pipe. On reconnect the
// supervisor re-sends from the last acked seq. We expose enough hooks
// (onControl for ack/resume-request/resume-response) for the supervisor to
// drive that policy without this module knowing anything about chunk numbers
// beyond passing them through.
//
// ─── Public API ───────────────────────────────────────────────────────────
//
// window.NeeFile.isSupported() → boolean
//   True if the browser can do RTCPeerConnection + RTCDataChannel, is in a
//   secure context (WebRTC + crypto.subtle both require HTTPS/localhost), and
//   exposes crypto.subtle (used by the app's chunk crypto — checked here so we
//   can fail fast before a transfer is half-staged).
//
// window.NeeFile.create(opts) → peerLink
//   Creates one per-transfer (or per-peer-session) controller.
//     sendSignal(payload)   — app wires this to the encrypted relay channel.
//                             Receives objects like {kind:'file-offer', sdp}.
//     onStateChange(state)  — state ∈ idle|connecting|connected|reconnecting|
//                             failed|closed.
//     onProgress(info)      — {transferId, sent, total} for the sender UI.
//     onChunk(...)          — inbound data chunk (see sendChunk arg list).
//     onControl(msg)        — control message from peer (ack / resume-* / cancel).
//     onComplete(transferId)
//     onError(reason)       — string reason code.
//     logger(tag, msg, lvl) — optional diagnostic sink.
//   Returns peerLink with:
//     handleSignal(payload) — page funnels every decrypted {kind:'file-*', ...}
//     startOffer()          — initiator: open DC + create offer + send it
//     setRemoteOffer(sdp), setRemoteAnswer(sdp), addIce(candidate)
//     sendChunk(transferId, seq, iv, ct, total, isLast)
//     sendControl(msg)      — JSON control message over the DC
//     restart()             — force ICE restart (resume path)
//     close()
//
// window.NeeFile.debug = true — opt-in verbose console logging (see webrtc.js).

(function (g) {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────

  // Same STUN pool as webrtc.js. Mix of independent providers (different
  // anycast networks) so if one is blocked or slow, others still respond. No
  // TURN by explicit product decision — if direct P2P fails we fall back to
  // relayed-bytes over the chat channel, not TURN. (TURN would need a
  // trusted server we don't operate.)
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' }, // TCP-friendly :443 for UDP-blocked nets
  ];

  const PC_CONFIG = {
    iceServers: ICE_SERVERS,
    bundlePolicy: 'max-bundle',     // one transport for everything (just SCTP here)
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 4,        // pre-gather -> faster first-packet on slow STUN
  };

  const DC_LABEL = 'nee2p-file';
  const DC_OPTS = { ordered: true, negotiated: false }; // ordered = in-order, reliable delivery

  // ── Flow control (CRITICAL for large files) ──────────────────────────────
  // A naive loop of dc.send(chunk) will happily buffer gigabytes in the DC's
  // send queue (browser RAM) and OOM the tab. We treat the DC like a bounded
  // socket: when the OS-backed send buffer exceeds THROTTLE_HIGH we stop
  // calling send() and queue chunks in a JS array; the browser fires
  // onbufferedamountlow once it drains past THROTTLE_LOW and we resume.
  //   256KB low watermark — coarse enough to avoid thrash, fine enough to keep
  //   the pipe full on fast links. 1MB high — empirical sweet spot: bigger and
  //   mobile Safari starts stuttering, smaller and we underutilise gigabit.
  const BUFFER_LOW = 262144;        // 256 KiB — also set as dc.bufferedAmountLowThreshold
  const THROTTLE_HIGH = 1048576;    // 1 MiB — pause sending above this

  // ── Resume / ICE restart timings ─────────────────────────────────────────
  // When ICE drops to 'disconnected' we DON'T give up — brief network blips
  // (WiFi handoff, cellular tower switch) self-heal in a few seconds. We grace
  // the connection for this long before forcing an ICE restart.
  const GRACE_MS = 10000;
  // Cap on auto-restart attempts. After this we surface 'failed' and let the
  // supervisor decide (it may fall back to relayed bytes or prompt the user).
  const MAX_RESTARTS = 3;
  // Backoff between restart attempts: 5s, 15s, 30s. Linear-ish growth keeps
  // recovery snappy on transient drops without hammering STUN on a hard outage.
  const RESTART_BACKOFF_MS = [5000, 15000, 30000];

  // ── Chunk frame ──────────────────────────────────────────────────────────
  // One DATA message on the wire is a fixed-layout binary ArrayBuffer so we
  // don't pay JSON-parse + base64 cost per chunk (a 64KiB chunk would become
  // ~88KiB of base64 + a multi-KB JSON header — unacceptable for big files).
  //
  // Layout (all little-endian):
  //   magic       u8    = 0x4E  ('N') — distinguishes data from control text
  //   ver         u8    = 1
  //   flags       u8    bit0 = isLast
  //   reserved    u8    = 0 (alignment / future use)
  //   transferId  u32   — supervisor's transfer id (linearised to int32)
  //   seq         u32   — chunk sequence number (monotonic per transfer)
  //   total       u64   — total file size in bytes ( informational; UI uses it)
  //   ivLen       u8    — length of IV in bytes (GCM = 12, but stay general)
  //   ctLen       u32   — length of ciphertext
  //   iv[ivLen]   …
  //   ct[ctLen]   …
  // Header = 1+1+1+1+4+4+8+1+4 = 25 bytes. ivLen/ctLen avoid a trailing parse.
  const FRAME_MAGIC = 0x4E;
  const FRAME_VER = 1;
  const FRAME_FLAG_LAST = 0x01;
  const HEADER_BYTES = 25;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function debug() {
    if (!g.NeeFile || !g.NeeFile.debug) return;
    try { console.log.apply(console, ['[NeeFile]'].concat([].slice.call(arguments))); } catch (_) {}
  }

  function isSupported() {
    try {
      return typeof RTCPeerConnection !== 'undefined'
          && typeof RTCDataChannel !== 'undefined'
          && !!g.isSecureContext
          && !!(g.crypto && g.crypto.subtle);
    } catch (_) { return false; }
  }

  // Pack a chunk into a single ArrayBuffer per the frame layout above.
  function encodeFrame(transferId, seq, iv, ct, total, isLast) {
    const ivB = iv instanceof Uint8Array ? iv : new Uint8Array(iv);
    const ctB = ct instanceof Uint8Array ? ct : new Uint8Array(ct);
    const buf = new ArrayBuffer(HEADER_BYTES + ivB.length + ctB.length);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let o = 0;
    u8[o++] = FRAME_MAGIC;
    u8[o++] = FRAME_VER;
    u8[o++] = isLast ? FRAME_FLAG_LAST : 0;
    u8[o++] = 0;                              // reserved
    dv.setUint32(o, transferId >>> 0, true); o += 4;
    dv.setUint32(o, seq >>> 0, true); o += 4;
    // total is u64; JS can't address >2^53 anyway, write low 32 + high 32.
    dv.setUint32(o, total >>> 0, true);       o += 4;
    dv.setUint32(o, Math.floor(total / 0x100000000) >>> 0, true); o += 4;
    u8[o++] = ivB.length;                     // ivLen (GCM: 12)
    dv.setUint32(o, ctB.length, true);        o += 4;
    u8.set(ivB, o); o += ivB.length;
    u8.set(ctB, o);
    return buf;
  }

  // Inverse of encodeFrame. Returns null on a malformed frame (so a corrupt
  // peer can't crash us — we just drop it and let the supervisor time out).
  function decodeFrame(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) return null;
    if (arrayBuffer.byteLength < HEADER_BYTES) return null;
    const dv = new DataView(arrayBuffer);
    const u8 = new Uint8Array(arrayBuffer);
    if (u8[0] !== FRAME_MAGIC || u8[1] !== FRAME_VER) return null;
    const flags = u8[2];
    let o = 4;
    const transferId = dv.getUint32(o, true); o += 4;
    const seq = dv.getUint32(o, true); o += 4;
    const totalLo = dv.getUint32(o, true); o += 4;
    const totalHi = dv.getUint32(o, true); o += 4;
    const total = totalHi * 0x100000000 + totalLo;
    const ivLen = u8[o++];                     // must be <= remaining bytes
    const ctLen = dv.getUint32(o, true); o += 4;
    if (HEADER_BYTES + ivLen + ctLen !== arrayBuffer.byteLength) return null;
    const iv = u8.subarray(o, o + ivLen); o += ivLen;
    const ct = u8.subarray(o, o + ctLen);
    return {
      transferId, seq, total,
      isLast: (flags & FRAME_FLAG_LAST) === FRAME_FLAG_LAST,
      iv: new Uint8Array(iv),   // copy out as standalone view (subarray aliases)
      ct: new Uint8Array(ct),
    };
  }

  // ── Factory ──────────────────────────────────────────────────────────────

  function create(opts) {
    opts = opts || {};
    const sendSignal = typeof opts.sendSignal === 'function' ? opts.sendSignal : function () {};
    const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : function () {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const onChunk = typeof opts.onChunk === 'function' ? opts.onChunk : function () {};
    const onControl = typeof opts.onControl === 'function' ? opts.onControl : function () {};
    const onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : function () {};
    const onError = typeof opts.onError === 'function' ? opts.onError : function () {};
    const logger = typeof opts.logger === 'function' ? opts.logger : function () {};

    function log(tag, msg, lvl) { try { logger(tag, msg, lvl || ''); } catch (_) {} debug(tag, msg, lvl || ''); }

    // ── Module state ──
    let pc = null;                  // RTCPeerConnection (recreated on restart)
    let dc = null;                  // current RTCDataChannel (does NOT survive restart)
    let state = 'idle';             // see onStateChange contract
    let isInitiator = false;        // who created the original DC (for restart role)
    let pendingIce = [];            // ICE candidates that arrived before remoteDescription
    let remoteDescSet = false;      // guards addIceCandidate
    // Outbound queue + throttle state. When the DC's send buffer exceeds
    // THROTTLE_HIGH we push further sendChunk() calls here and drain on
    // onbufferedamountlow. This is the only thing keeping the tab's RAM
    // bounded during a multi-GB transfer.
    const sendQueue = [];
    let draining = false;

    // Resume / restart bookkeeping
    let graceTimer = null;
    let restartTimer = null;
    let restartAttempts = 0;
    let closed = false;             // user-initiated close — stops all auto-retry

    function setState(next) {
      if (state === next || closed) return;
      state = next;
      try { onStateChange(state); } catch (_) {}
    }

    function emitError(reason) {
      try { onError(String(reason || 'unknown')); } catch (_) {}
    }

    function clearTimers() {
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    }

    // ── DataChannel wiring ──
    // Centralised so both the initiator path (createDataChannel) and the
    // responder path (ondatachannel) plus post-restart recreation all wire
    // handlers identically. Easy to miss a handler when copy-pasting.
    function wireDc(channel) {
      dc = channel;
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = BUFFER_LOW;

      dc.onopen = function () {
        debug('dc open, bufferedAmount=', dc.bufferedAmount);
        // A fresh DC may open on a restart; resume draining anything queued
        // while the previous DC was dead.
        setState('connected');
        drainQueue();
      };

      dc.onmessage = function (ev) {
        const data = ev.data;
        // Control messages are strings (JSON); data frames are ArrayBuffers.
        // RTCPeerConnection guarantees message-boundary preservation on an
        // SCTP DC, so we always get exactly one frame per message.
        if (typeof data === 'string') {
          let msg;
          try { msg = JSON.parse(data); } catch (_) { return; }
          if (!msg || typeof msg.kind !== 'string') return;
          try { onControl(msg); } catch (_) {}
          return;
        }
        const frame = decodeFrame(data);
        if (!frame) {
          log('frame', 'dropped malformed inbound frame', 'warn');
          return;
        }
        try {
          onChunk(frame.transferId, frame.seq, frame.iv, frame.ct,
                  frame.total, frame.isLast, /*fromPeer*/ true);
        } catch (_) {}
      };

      // onbufferedamountlow = the green light to resume sending after we
      // paused on THROTTLE_HIGH. Drains the queue until the buffer fills again.
      dc.onbufferedamountlow = function () {
        drainQueue();
      };

      // DC close/error are NOT fatal by themselves: the resume path will try
      // to bring up a fresh DC via ICE restart. We only surface 'failed' after
      // MAX_RESTARTS unsuccessful attempts (see oniceconnectionstatechange).
      dc.onerror = function (e) {
        log('dc', 'error: ' + (e && e.error ? e.error.message : '?'), 'warn');
      };

      dc.onclose = function () {
        debug('dc closed (current state=', state, ')');
        // If the PC itself is being restarted, a new DC will open shortly and
        // dc.onopen will flip us back to 'connected'. Only escalate if we're
        // not already mid-restart AND the user hasn't closed us.
        if (closed) { setState('closed'); return; }
        if (state === 'connected') {
          setState('reconnecting');
          // Nudge ICE: some browsers don't fire iceConnectionState 'disconnected'
          // synchronously with dc.onclose; this makes resume kick in promptly.
          scheduleRestart(0);
        }
      };
    }

    // ── Send path: throttle + queue ──
    // Public sendChunk encodes the frame and hands it to the queue pump. The
    // pump either sends immediately (buffer healthy) or buffers for the
    // onbufferedamountlow callback. We never block the caller.
    function sendChunk(transferId, seq, iv, ct, total, isLast) {
      if (closed) return false;
      if (!dc || dc.readyState !== 'open') {
        // DC not open yet (or mid-restart). Queue — drainQueue runs on open.
        sendQueue.push({ type: 'data', frame: encodeFrame(transferId, seq, iv, ct, total, isLast) });
        return true;
      }
      sendQueue.push({ type: 'data', frame: encodeFrame(transferId, seq, iv, ct, total, isLast) });
      drainQueue();
      return true;
    }

    function sendControl(msg) {
      if (closed || !msg || typeof msg.kind !== 'string') return false;
      const payload = JSON.stringify(msg);
      if (!dc || dc.readyState !== 'open') {
        // Buffer control messages too — an early 'cancel' must survive a
        // momentary DC gap, otherwise the peer keeps streaming into a dead
        // transfer. (Ordering within the queue preserves cause/effect.)
        sendQueue.push({ type: 'control', payload });
        return true;
      }
      sendQueue.push({ type: 'control', payload });
      drainQueue();
      return true;
    }

    // Pump the queue until either it's empty or the DC buffer fills. We honour
    // ordering by interleaving control + data in insertion order. The
    // `draining` re-entry guard prevents recursion via onbufferedamountlow.
    function drainQueue() {
      if (draining || !dc || dc.readyState !== 'open') return;
      draining = true;
      try {
        while (sendQueue.length > 0) {
          if (dc.bufferedAmount > THROTTLE_HIGH) {
            // Wait for onbufferedamountlow to call us back. This is the
            // backpressure mechanism that keeps RAM bounded.
            return;
          }
          const item = sendQueue.shift();
          try {
            if (item.type === 'data') dc.send(item.frame);
            else dc.send(item.payload);
          } catch (e) {
            // send() throws on a closing channel — requeue and let onclose
            // trigger restart. Drop to avoid an infinite requeue loop if the
            // item itself is the problem (it won't be, but be defensive).
            log('dc', 'send threw: ' + (e && e.message), 'warn');
            return;
          }
        }
      } finally {
        draining = false;
      }
    }

    // ── RTCPeerConnection wiring ──
    function buildPeerConnection() {
      const conn = new RTCPeerConnection(PC_CONFIG);

      // Trickle ICE: ship each candidate the instant we have it. Buffered on
      // the other side if the remote description isn't set yet (see handleSignal).
      conn.onicecandidate = function (e) {
        if (!e.candidate) return;
        const c = {
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        };
        try { sendSignal({ kind: 'file-ice', candidate: c }); } catch (_) {}
      };

      conn.oniceconnectionstatechange = function () {
        if (!pc || closed) return;
        const s = pc.iceConnectionState;
        debug('iceConnectionState =', s);

        if (s === 'connected' || s === 'completed') {
          // Healthy again — reset the restart budget and clear any grace timer
          // that was running from an earlier 'disconnected' wobble. Resetting
          // restartAttempts here is what lets a transfer survive MANY brief
          // drops over its lifetime (not just MAX_RESTARTS total).
          clearTimers();
          restartAttempts = 0;
          if (state !== 'connected') setState('connected');
          return;
        }

        if (s === 'disconnected') {
          // The CRITICAL resume branch. Do NOT immediately restart — most
          // 'disconnected' events self-heal (WiFi roam, brief packet loss).
          // Surface 'reconnecting' to the UI, arm a grace window, and only
          // escalate to a forced restart if we don't recover in time.
          if (state === 'connected') setState('reconnecting');
          if (!graceTimer) {
            graceTimer = setTimeout(function () {
              graceTimer = null;
              if (!pc || closed) return;
              if (pc.iceConnectionState !== 'connected' &&
                  pc.iceConnectionState !== 'completed') {
                log('ice', 'grace expired, forcing restart', 'warn');
                scheduleRestart(0);
              }
            }, GRACE_MS);
          }
          return;
        }

        if (s === 'failed') {
          // ICE checks hard-failed. Don't wait out the grace timer — restart
          // right away (subject to the attempt cap & backoff).
          clearTimers();
          scheduleRestart(0);
          return;
        }

        if (s === 'closed') {
          if (!closed) setState('closed');
        }
      };

      // We rely on iceConnectionState as the source of truth (matches the
      // webrtc.js convention and is more granular than connectionState for
      // our resume logic). Keep this handler for debug logging only.
      conn.onconnectionstatechange = function () {
        if (!pc) return;
        debug('connectionState =', pc.connectionState);
      };

      return conn;
    }

    // ── Resume: ICE restart orchestration ──
    // An ICE restart re-gathers candidates with fresh ports while reusing the
    // negotiated SCTP transport. BUT a DataChannel does not survive a
    // restart: after setLocalDescription({iceRestart}) + setRemoteDescription
    // the old dc.readyState goes to 'closed' and we MUST createDataChannel
    // again (initiator) or wait for ondatachannel (responder). The supervisor
    // re-sends from the last acked seq once it sees a fresh 'connected'.
    //
    // We honour a backoff and an attempt cap so a hard NAT failure doesn't
    // spin forever. After MAX_RESTARTS we give up and let the app fall back
    // (e.g. relayed-bytes via the chat channel).
    function scheduleRestart(delayMs) {
      if (closed) return;
      if (restartTimer) return; // already scheduled
      if (restartAttempts >= MAX_RESTARTS) {
        log('ice', 'exhausted restarts (' + MAX_RESTARTS + ') — failing', 'err');
        setState('failed');
        emitError('unrecoverable');
        return;
      }
      const attempt = restartAttempts;
      const delay = (delayMs != null && delayMs > 0) ? delayMs : RESTART_BACKOFF_MS[attempt];
      log('ice', 'restart scheduled in ' + delay + 'ms (attempt ' + (attempt + 1) + '/' + MAX_RESTARTS + ')', 'warn');
      restartTimer = setTimeout(function () {
        restartTimer = null;
        restartAttempts++;
        setState('reconnecting');
        restart().catch(function (e) {
          log('ice', 'restart threw: ' + (e && e.message), 'err');
          // If restart itself errors, try again with the next backoff slot.
          scheduleRestart(0);
        });
      }, delay);
    }

    async function restart() {
      if (closed) return;
      if (!pc) {
        // Nothing to restart — re-initiate the whole offer dance.
        await startOffer();
        return;
      }

      // 1) Re-create the DataChannel BEFORE createOffer so the new SDP
      //    advertises it. (Only the side that becomes the offerer creates it;
      //    the responder picks it up via ondatachannel.)
      // 2) setConfiguration with iceRestart — older browsers accept the flag
      //    via createOffer({iceRestart:true}) instead, so we pass it there too.
      try { pc.setConfiguration(Object.assign({}, PC_CONFIG, { iceTransportPolicy: 'all' })); } catch (_) {}
      if (isInitiator) {
        try { wireDc(pc.createDataChannel(DC_LABEL, DC_OPTS)); } catch (_) {}
      } else {
        pc.ondatachannel = function (e) { wireDc(e.channel); };
      }

      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      // Recreate = the remote desc is stale; flip remoteDescSet off so we
      // re-buffer any incoming ICE until the peer's answer lands.
      remoteDescSet = false;
      pendingIce = [];
      try { sendSignal({ kind: 'file-offer', sdp: offer.sdp, restart: true }); } catch (_) {}
      // Peer responds with file-answer; setRemoteAnswer flips remoteDescSet
      // and flushes pendingIce. Then dc.onopen fires on the fresh channel.
    }

    // ── Initiator entry point ──
    async function startOffer() {
      if (closed) return;
      if (!isSupported()) { emitError('unsupported'); setState('failed'); return; }
      isInitiator = true;
      pendingIce = [];
      remoteDescSet = false;
      setState('connecting');
      try {
        pc = buildPeerConnection();
        wireDc(pc.createDataChannel(DC_LABEL, DC_OPTS));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        try { sendSignal({ kind: 'file-offer', sdp: offer.sdp }); } catch (_) {}
      } catch (e) {
        log('pc', 'startOffer failed: ' + (e && e.message), 'err');
        emitError('offer-failed');
        setState('failed');
      }
    }

    // ── Responder: remote offer arrived (incoming transfer) ──
    async function setRemoteOffer(sdp) {
      if (closed) return;
      if (!isSupported()) { emitError('unsupported'); setState('failed'); return; }
      isInitiator = false;
      pendingIce = [];
      setState('connecting');
      try {
        pc = buildPeerConnection();
        // Responder receives the DC; wire it when it arrives.
        pc.ondatachannel = function (e) { wireDc(e.channel); };
        await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
        remoteDescSet = true;
        for (const c of pendingIce) { try { await pc.addIceCandidate(c); } catch (_) {} }
        pendingIce = [];
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        try { sendSignal({ kind: 'file-answer', sdp: ans.sdp }); } catch (_) {}
      } catch (e) {
        log('pc', 'setRemoteOffer failed: ' + (e && e.message), 'err');
        emitError('answer-failed');
        setState('failed');
      }
    }

    // ── Initiator (and restart-responder) gets the answer back ──
    async function setRemoteAnswer(sdp) {
      if (closed || !pc) return;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: sdp });
        remoteDescSet = true;
        for (const c of pendingIce) { try { await pc.addIceCandidate(c); } catch (_) {} }
        pendingIce = [];
      } catch (e) {
        log('pc', 'setRemoteAnswer failed: ' + (e && e.message), 'err');
        emitError('answer-invalid');
        setState('failed');
      }
    }

    // ── Inbound ICE candidate (trickled) ──
    async function addIce(candidate) {
      if (closed) return;
      if (!candidate) return;
      // Buffer until the remote description exists — trickle ICE candidates
      // can (and routinely do) arrive before the offer/answer.
      if (!pc || !remoteDescSet) { pendingIce.push(candidate); return; }
      try { await pc.addIceCandidate(candidate); } catch (_) {}
    }

    // ── Unified inbound signal dispatch ──
    // App funnels EVERY decrypted file-* signal here. We branch on kind.
    // SDP signalling kinds: file-offer / file-answer / file-ice.
    // (Control kinds file-resume-* / file-ack / file-cancel travel OVER the
    //  DC as JSON once it's up; before DC-up they may arrive here too, in
    //  which case we forward to onControl so the supervisor sees them.)
    async function handleSignal(payload) {
      if (!payload || typeof payload.kind !== 'string') return;
      switch (payload.kind) {
        case 'file-offer':
          if (payload.restart === true && pc) {
            // Peer initiated restart — apply as a fresh remote offer on the
            // existing PC. We DON'T recreate PC; the peer (offerer) did.
            try {
              await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
              remoteDescSet = true;
              for (const c of pendingIce) { try { await pc.addIceCandidate(c); } catch (_) {} }
              pendingIce = [];
              const ans = await pc.createAnswer();
              await pc.setLocalDescription(ans);
              try { sendSignal({ kind: 'file-answer', sdp: ans.sdp, restart: true }); } catch (_) {}
            } catch (e) {
              log('pc', 'restart-answer failed: ' + (e && e.message), 'err');
            }
          } else {
            await setRemoteOffer(payload.sdp);
          }
          return;
        case 'file-answer':
          await setRemoteAnswer(payload.sdp);
          return;
        case 'file-ice':
          await addIce(payload.candidate);
          return;
        // Control messages that arrived over the relay (pre-DC or as a
        // fallback). Forward verbatim to the supervisor.
        case 'file-resume-request':
        case 'file-resume-response':
        case 'file-ack':
        case 'file-cancel':
          try { onControl(payload); } catch (_) {}
          return;
        default:
          return; // ignore unknown kinds (forward-compat)
      }
    }

    // ── Teardown ──
    function close() {
      if (closed) return;
      closed = true;
      clearTimers();
      sendQueue.length = 0;
      try { if (dc) { dc.onopen = dc.onmessage = dc.onclose = dc.onerror = dc.onbufferedamountlow = null; dc.close(); } } catch (_) {}
      try {
        if (pc) {
          pc.ondatachannel = null;
          pc.onicecandidate = null;
          pc.oniceconnectionstatechange = null;
          pc.onconnectionstatechange = null;
          pc.close();
        }
      } catch (_) {}
      dc = null;
      pc = null;
      setState('closed');
    }

    return {
      // inbound (from app.handleSignal)
      handleSignal,
      setRemoteOffer,
      setRemoteAnswer,
      addIce,
      // outbound / lifecycle
      startOffer,
      sendChunk,
      sendControl,
      restart,
      close,
      // introspection
      getState: function () { return state; },
      isClosed: function () { return closed; },
      queueDepth: function () { return sendQueue.length; },
    };
  }

  g.NeeFile = { create: create, isSupported: isSupported };
})(typeof window !== 'undefined' ? window : globalThis);
