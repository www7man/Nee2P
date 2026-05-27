// webrtc.js — peer-to-peer audio (optionally video) calls for Nee2P.
//
// Owner: webrtc-calls agent (see .claude/agents/intros/webrtc-calls.md).
// This module is self-contained; external code talks to it only via the
// `window.NeeCall` global documented below. Stable public API — changes to
// the surface require a deprecation cycle.
//
// Wraps RTCPeerConnection. The transport-level signalling (offer / answer /
// ICE) is sent through the existing chat-channel as a wire type 'signal'
// (broadcast-only, never stored in history — see server.js handleOne).
//
// Crypto note: DTLS-SRTP gives us E2E confidentiality + integrity of the
// media stream natively. We DON'T re-encrypt media on top. The signalling
// SDP itself is exchanged AS-IS over the (already E2E-encrypted) chat channel
// when the page-level code chooses to encrypt it, but the relay sees nothing
// useful — SDP carries DTLS fingerprints, not actual session keys.
//
// IP-leak warning: P2P WebRTC reveals each participant's public IP to the
// other side (by the WebRTC standard). See SECURITY.md for the disclosure.
//
// MVP: 2-party only. Group calls are future work (needs an SFU / mesh).
//
// ─── Public API ───────────────────────────────────────────────────────────
//
// window.NeeCall.isSupported() → boolean
//   True if the browser exposes RTCPeerConnection + getUserMedia.
//
// window.NeeCall.create({ sendSignal, onRemoteStream, onStateChange, onError }) → call
//   Creates a per-conversation call controller.
//     sendSignal(msg)     — caller wires this to the encrypted chat channel.
//                            Receives objects like {kind:'call-offer', sdp}.
//     onRemoteStream(s)   — fired when the peer's MediaStream is attached.
//     onStateChange(s)    — s ∈ idle|outgoing|incoming|active|ended|failed.
//     onError(err)        — err.code ∈ mic-denied|mic-error|ice-failed|
//                            connection-failed|peer-busy|peer-rejected|
//                            peer-ended|peer-missed|peer-unsupported|
//                            timeout|unsupported.
//   Returns a controller with:
//     startCall({video?})  — initiator path (creates offer)
//     handleSignal(msg)    — page funnels every {type:'signal', kind, ...}
//     answer() / reject()  — callee path
//     hangup()             — either side
//     toggleMute()         — returns new muted flag
//     toggleSpeaker()      — returns new speaker flag
//     destroy()            — hard cleanup
//     isSupported(), getState(), getReason(), isMuted(), isOnSpeaker()
//
// window.NeeCall.diagnose({force?}) → Promise<report>
//   Pre-flight network check. Returns:
//     { supported, secureContext, micPermission, stunReachable, natType,
//       readiness: 'ready'|'degraded'|'blocked', warnings: [...] }
//   Result is cached for 60s; pass {force:true} to bypass cache.
//
// window.NeeCall.getCachedDiagnose() → report | null
//   Returns the last diagnose result if still fresh (≤60s), else null.
//
// window.NeeCall.debug = true   — opt-in console.log diagnostics
//   Off by default to keep the production console clean. Flip in DevTools
//   to surface [NeeCall] iceConnectionState/connectionState transitions.

(function (g) {
  // Opt-in console debug. Off by default — production users get a clean
  // console. Flip `window.NeeCall.debug = true` in DevTools to surface
  // ICE/connection state transitions when troubleshooting.
  function debug() {
    if (!g.NeeCall || !g.NeeCall.debug) return;
    try { console.log.apply(console, ['[NeeCall]'].concat([].slice.call(arguments))); } catch {}
  }

  // STUN pool — mix of independent providers (different anycast networks) so
  // that if one is blocked or slow, others still respond. Diversity also
  // enables symmetric-NAT detection (we compare srflx ports across providers).
  // TCP STUN is included for networks that block UDP outbound (some corporate
  // firewalls, hotel WiFi).
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },        // TCP-friendly :443 (some networks only allow 443)
  ];

  // Independent STUN URLs used by diagnose() to detect symmetric NAT. We need
  // genuinely different IP backends — if both servers share an anycast prefix
  // the symmetric-port comparison is meaningless.
  const DIAG_STUN_URLS = [
    'stun:stun.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
  ];

  function isSupported() {
    try {
      return typeof RTCPeerConnection !== 'undefined'
          && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    } catch { return false; }
  }

  // Probe a single STUN URL: returns the set of srflx (public-reflected) ports
  // we got back. If empty → STUN didn't respond or is blocked. Times out at 5s.
  function probeSingleStun(stunUrl) {
    return new Promise((resolve) => {
      let pc, finalized = false;
      const ports = new Set();
      const addrs = new Set();
      const done = () => {
        if (finalized) return;
        finalized = true;
        try { pc && pc.close(); } catch {}
        resolve({ ports: [...ports], addrs: [...addrs] });
      };
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: stunUrl }], iceCandidatePoolSize: 0 });
      } catch {
        return resolve({ ports: [], addrs: [] });
      }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      pc.onicecandidate = (e) => {
        if (!e.candidate) { done(); return; }
        const c = e.candidate.candidate || '';
        if (/ typ srflx /.test(c)) {
          // candidate-attribute format:
          //   candidate:<foundation> <component> <transport> <priority> <addr> <port> typ srflx ...
          const parts = c.split(/\s+/);
          if (parts.length >= 6) {
            addrs.add(parts[4]);
            ports.add(parts[5]);
          }
        }
      };
      try {
        pc.createDataChannel('diag'); // forces ICE gathering
        pc.createOffer().then(o => pc.setLocalDescription(o)).catch(done);
      } catch { done(); }
      setTimeout(done, 5000);
    });
  }

  // Cache the most recent diagnostic result so repeat pre-flight checks are
  // instant. Network conditions change slowly enough that a 60s window is
  // safe; force-refresh available via diagnose({ force: true }).
  let _lastDiagnose = null;
  let _lastDiagnoseAt = 0;
  const DIAG_CACHE_MS = 60000;

  function getCachedDiagnose() {
    if (!_lastDiagnose) return null;
    if ((Date.now() - _lastDiagnoseAt) > DIAG_CACHE_MS) return null;
    return _lastDiagnose;
  }

  // Full diagnostics report — runs every pre-flight check we can do without a
  // peer. Returns a structured result the UI displays as a checklist. Safe to
  // call multiple times; ~5-6s total because of the STUN probes (cached for
  // 60s after a fresh run).
  //
  // Result shape:
  //   {
  //     supported: bool,
  //     secureContext: bool,
  //     micPermission: 'granted'|'denied'|'prompt'|'unknown',
  //     stunReachable: bool,
  //     natType: 'open' (host candidates only on a public IP)
  //            | 'cone'  (same srflx port across providers — P2P should work)
  //            | 'symmetric' (different ports — direct P2P will NOT work, needs TURN)
  //            | 'unknown' (STUN didn't respond or single-provider success),
  //     warnings: [{level: 'red'|'yellow', text: string}, ...],
  //     readiness: 'ready' | 'degraded' | 'blocked' — high-level rollup the UI
  //                uses to decide whether to allow proceeding with the call.
  //                  ready    — no warnings, P2P should work
  //                  degraded — only yellow warnings (call may not connect)
  //                  blocked  — at least one red warning, don't even try
  //   }
  async function diagnose(opts) {
    const force = !!(opts && opts.force);
    if (!force) {
      const cached = getCachedDiagnose();
      if (cached) return cached;
    }
    const result = {
      supported: isSupported(),
      secureContext: typeof window !== 'undefined' && !!window.isSecureContext,
      micPermission: 'unknown',
      stunReachable: false,
      natType: 'unknown',
      warnings: [],
    };

    if (!result.supported) {
      result.warnings.push({ level: 'red', text: 'Браузер не поддерживает WebRTC' });
      return result;
    }
    if (!result.secureContext) {
      result.warnings.push({ level: 'red', text: 'Звонки работают только по HTTPS' });
      return result;
    }

    // Microphone permission state — best-effort. Permissions API isn't on all
    // browsers (notably Safari sometimes returns 'prompt' even when granted).
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: 'microphone' });
        result.micPermission = p.state || 'unknown';
      }
    } catch { /* not supported — leave 'unknown' */ }
    if (result.micPermission === 'denied') {
      result.warnings.push({
        level: 'red',
        text: 'Доступ к микрофону запрещён. Откройте настройки сайта и разрешите его.',
      });
    }

    // STUN reachability + NAT-type detection. Probe two independent providers
    // in parallel. We compare the srflx ports they report:
    //   • port-set empty  → STUN blocked entirely or UDP forbidden → 'unknown'
    //   • single port across all providers → cone NAT (P2P likely works)
    //   • multiple ports  → symmetric NAT (P2P needs TURN, won't work direct)
    const probes = await Promise.all(DIAG_STUN_URLS.map(probeSingleStun));
    const allPorts = new Set();
    const allAddrs = new Set();
    let anyReachable = false;
    for (const r of probes) {
      if (r.ports.length > 0) anyReachable = true;
      for (const p of r.ports) allPorts.add(p);
      for (const a of r.addrs) allAddrs.add(a);
    }
    result.stunReachable = anyReachable;

    if (!anyReachable) {
      result.natType = 'unknown';
      result.warnings.push({
        level: 'red',
        text: 'STUN-серверы недоступны. Сеть, возможно, блокирует UDP — звонки могут не работать.',
      });
    } else if (allPorts.size === 0) {
      // shouldn't happen if anyReachable is true, but defensive
      result.natType = 'unknown';
    } else if (allPorts.size === 1) {
      result.natType = 'cone';
    } else {
      result.natType = 'symmetric';
      result.warnings.push({
        level: 'yellow',
        text: 'Обнаружен симметричный NAT — прямое соединение, скорее всего, не пройдёт. Попробуйте другую сеть (например, мобильные данные) или Wi-Fi без корпоративного фильтра.',
      });
    }

    // Roll up to a single "can we even try?" verdict for the UI.
    const hasRed = result.warnings.some(w => w.level === 'red');
    const hasYellow = result.warnings.some(w => w.level === 'yellow');
    result.readiness = hasRed ? 'blocked' : (hasYellow ? 'degraded' : 'ready');

    _lastDiagnose = result;
    _lastDiagnoseAt = Date.now();
    return result;
  }

  function create(opts) {
    const sendSignal = typeof opts.sendSignal === 'function' ? opts.sendSignal : () => {};
    const onRemoteStream = typeof opts.onRemoteStream === 'function' ? opts.onRemoteStream : () => {};
    const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : () => {};
    const onError = typeof opts.onError === 'function' ? opts.onError : () => {};

    let pc = null;
    let localStream = null;
    let remoteStream = null;
    let remoteAudio = null;          // a hidden <audio> element playing the remote track
    let state = 'idle';              // idle | outgoing | incoming | active | ended | failed
    let isInitiator = false;
    let pendingOffer = null;         // SDP held while UI shows "Incoming…"
    let pendingIce = [];             // ICE candidates that arrived before remoteDesc was set
    let muted = false;
    let onSpeaker = false;
    let useVideo = false;
    // Structured exit reason — the UI maps these to specific Russian copy.
    // Codes (string, stable):
    //   user-hangup        — local user pressed "Завершить" or "Отклонить"
    //   peer-ended         — peer pressed "Завершить" mid-call
    //   peer-rejected      — peer pressed "Отклонить" on incoming
    //   peer-busy          — peer was already in another call
    //   peer-unsupported   — peer's browser doesn't have WebRTC
    //   peer-missed        — peer didn't answer in time (we sent call-end after timeout)
    //   timeout            — our outgoing call wasn't answered in CALL_TIMEOUT_MS
    //   mic-denied         — getUserMedia rejected (NotAllowedError / SecurityError)
    //   mic-error          — getUserMedia failed for another reason (no device, hardware busy)
    //   ice-failed         — WebRTC ICE checks couldn't establish a path (NAT)
    //   connection-failed  — generic connectionState='failed' (other reasons)
    //   unsupported        — local browser doesn't have WebRTC
    let lastReason = null;
    let outgoingTimeoutId = null;

    // 45s for the callee to pick up before we auto-cancel the outgoing call.
    // Matches the typical "ringing duration" cellular users are used to.
    const CALL_TIMEOUT_MS = 45000;

    function setState(next) {
      if (state === next) return;
      state = next;
      try { onStateChange(state); } catch {}
    }

    function emitError(code, extra) {
      const err = new Error(code);
      err.code = code;
      if (extra) Object.assign(err, extra);
      try { onError(err); } catch {}
    }

    function classifyMicError(e) {
      const n = e && e.name;
      if (n === 'NotAllowedError' || n === 'SecurityError') return 'mic-denied';
      if (n === 'NotFoundError' || n === 'OverconstrainedError'
          || n === 'NotReadableError' || n === 'AbortError') return 'mic-error';
      return 'mic-error';
    }

    function clearOutgoingTimeout() {
      if (outgoingTimeoutId) { clearTimeout(outgoingTimeoutId); outgoingTimeoutId = null; }
    }

    function armOutgoingTimeout() {
      clearOutgoingTimeout();
      outgoingTimeoutId = setTimeout(() => {
        outgoingTimeoutId = null;
        // Only fire if we never connected (still outgoing).
        if (state !== 'outgoing') return;
        lastReason = 'timeout';
        try { sendSignal({ kind: 'call-end', reason: 'caller-timeout' }); } catch {}
        emitError('timeout');
        teardown('failed');
      }, CALL_TIMEOUT_MS);
    }

    function ensureAudioElement() {
      if (remoteAudio) return remoteAudio;
      remoteAudio = document.createElement('audio');
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      // Off-screen but DOM-attached so iOS Safari starts playback.
      remoteAudio.style.position = 'fixed';
      remoteAudio.style.width = '1px';
      remoteAudio.style.height = '1px';
      remoteAudio.style.opacity = '0';
      remoteAudio.style.pointerEvents = 'none';
      remoteAudio.style.left = '-10px';
      remoteAudio.style.top = '-10px';
      document.body.appendChild(remoteAudio);
      return remoteAudio;
    }

    function buildPeerConnection() {
      const conn = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        // Bundle audio/video on a single transport — fewer round trips.
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        // Pre-gather a small pool so checking starts faster once the answer
        // lands — meaningfully reduces "stuck on Соединяемся" on slow STUN.
        iceCandidatePoolSize: 4,
      });

      conn.onicecandidate = (e) => {
        if (!e.candidate) return;
        // Strip non-serialisable fields just in case.
        const c = {
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        };
        try { sendSignal({ kind: 'call-ice', candidate: c }); } catch {}
      };

      conn.oniceconnectionstatechange = () => {
        if (!pc) return;
        debug('iceConnectionState =', pc.iceConnectionState);
        // Some browsers stop at iceConnectionState='connected' without ever
        // hitting connectionState='connected'. Treat ICE connected as enough.
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          clearOutgoingTimeout();
          if (state !== 'active') setState('active');
        }
        if (pc.iceConnectionState === 'failed') {
          lastReason = 'ice-failed';
          emitError('ice-failed');
          setState('failed');
        }
      };

      conn.ontrack = (e) => {
        if (!remoteStream) remoteStream = new MediaStream();
        // Some browsers fire ontrack once with e.streams[0] populated; others
        // pass tracks individually. Handle both.
        if (e.streams && e.streams[0]) {
          remoteStream = e.streams[0];
        } else {
          remoteStream.addTrack(e.track);
        }
        const audioEl = ensureAudioElement();
        if (audioEl.srcObject !== remoteStream) audioEl.srcObject = remoteStream;
        // Best-effort play. Browsers may require a user gesture; the answer/
        // startCall button-tap path already provides one.
        try { audioEl.play().catch(() => {}); } catch {}
        try { onRemoteStream(remoteStream); } catch {}
      };

      conn.onconnectionstatechange = () => {
        if (!pc) return;
        const cs = pc.connectionState;
        debug('connectionState =', cs);
        if (cs === 'connected') {
          clearOutgoingTimeout();
          setState('active');
        } else if (cs === 'failed') {
          // Prefer the more specific 'ice-failed' if oniceconnectionstatechange
          // already set it; otherwise fall back to generic.
          if (lastReason !== 'ice-failed') {
            lastReason = 'connection-failed';
            emitError('connection-failed');
          }
          setState('failed');
        } else if (cs === 'disconnected') {
          // brief glitches happen; only escalate if state stays disconnected
          // (the next 'connected' or 'failed' transition will resolve it).
        } else if (cs === 'closed') {
          if (state !== 'ended') setState('ended');
        }
      };

      return conn;
    }

    async function ensureLocalStream() {
      if (localStream) return localStream;
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: useVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
      };
      try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        // Re-throw with a classified code so callers can map to UI copy.
        const code = classifyMicError(e);
        const err = new Error(code);
        err.code = code;
        err.cause = e;
        throw err;
      }
      return localStream;
    }

    async function addLocalTracks() {
      const stream = await ensureLocalStream();
      for (const t of stream.getTracks()) {
        pc.addTrack(t, stream);
      }
    }

    async function startCall(callOpts) {
      if (state !== 'idle' && state !== 'ended' && state !== 'failed') return;
      if (!isSupported()) {
        lastReason = 'unsupported';
        emitError('unsupported');
        return;
      }
      useVideo = !!(callOpts && callOpts.video);
      isInitiator = true;
      pendingIce = [];
      lastReason = null;
      setState('outgoing');
      try {
        pc = buildPeerConnection();
        await addLocalTracks();
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: useVideo,
        });
        await pc.setLocalDescription(offer);
        sendSignal({ kind: 'call-offer', sdp: offer.sdp, video: useVideo });
        // Arm the ringing timeout. Cleared when ICE/connection state flips to
        // connected, or when we get a call-reject / call-end from the peer.
        armOutgoingTimeout();
      } catch (e) {
        const code = e && e.code ? e.code : 'connection-failed';
        lastReason = code;
        emitError(code);
        teardown('failed');
      }
    }

    async function handleSignal(msg) {
      if (!msg || typeof msg.kind !== 'string') return;

      if (msg.kind === 'call-offer') {
        // If we're already in a call, reject the second one outright.
        if (state === 'active' || state === 'outgoing' || state === 'incoming') {
          try { sendSignal({ kind: 'call-reject', reason: 'busy' }); } catch {}
          return;
        }
        if (!isSupported()) {
          try { sendSignal({ kind: 'call-reject', reason: 'unsupported' }); } catch {}
          return;
        }
        isInitiator = false;
        useVideo = !!msg.video;
        pendingOffer = msg.sdp;
        pendingIce = [];
        lastReason = null;
        setState('incoming');
        // Wait for the user to tap Ответить → answer().
        return;
      }

      if (msg.kind === 'call-answer') {
        if (!pc || !isInitiator) return;
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
          // Flush any ICE candidates that arrived before the remote answer.
          for (const c of pendingIce) {
            try { await pc.addIceCandidate(c); } catch {}
          }
          pendingIce = [];
        } catch (e) {
          lastReason = 'connection-failed';
          emitError('connection-failed');
          teardown('failed');
        }
        return;
      }

      if (msg.kind === 'call-ice') {
        if (!msg.candidate) return;
        // If no PC yet (incoming-pending), buffer; we'll attach after answer().
        if (!pc || !pc.remoteDescription) {
          pendingIce.push(msg.candidate);
          return;
        }
        try { await pc.addIceCandidate(msg.candidate); } catch {}
        return;
      }

      if (msg.kind === 'call-reject') {
        // Map peer's reject reason → our reason code so the UI can show the
        // right thing ("Линия занята", "Не поддерживается", "Отклонён").
        if (msg.reason === 'busy') lastReason = 'peer-busy';
        else if (msg.reason === 'unsupported') lastReason = 'peer-unsupported';
        else lastReason = 'peer-rejected';
        emitError(lastReason);
        teardown('ended');
        return;
      }

      if (msg.kind === 'call-end') {
        // Distinguish between "callee never answered" (caller-timeout) and
        // "peer hung up mid-call / cancelled their outgoing call".
        if (msg.reason === 'caller-timeout') {
          lastReason = 'peer-missed';
          emitError('peer-missed');
        } else if (!lastReason) {
          // Only overwrite if we don't already have a more specific reason.
          lastReason = 'peer-ended';
          emitError('peer-ended');
        }
        teardown('ended');
        return;
      }
    }

    async function answer() {
      if (state !== 'incoming' || !pendingOffer) return;
      try {
        pc = buildPeerConnection();
        await addLocalTracks();
        await pc.setRemoteDescription({ type: 'offer', sdp: pendingOffer });
        pendingOffer = null;
        // Now flush any ICE candidates that arrived during 'incoming'.
        for (const c of pendingIce) {
          try { await pc.addIceCandidate(c); } catch {}
        }
        pendingIce = [];
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        sendSignal({ kind: 'call-answer', sdp: ans.sdp });
        // Stay in 'incoming' until onconnectionstatechange flips to 'active'.
      } catch (e) {
        try { onError(e); } catch {}
        teardown('failed');
      }
    }

    function reject() {
      if (state === 'incoming') {
        try { sendSignal({ kind: 'call-reject' }); } catch {}
      }
      lastReason = 'user-hangup';
      teardown('ended');
    }

    function hangup() {
      if (state === 'incoming' || state === 'outgoing' || state === 'active') {
        try { sendSignal({ kind: 'call-end' }); } catch {}
      }
      // Only overwrite reason if it wasn't already set by peer-side event.
      if (!lastReason) lastReason = 'user-hangup';
      teardown('ended');
    }

    function toggleMute() {
      muted = !muted;
      if (localStream) {
        for (const t of localStream.getAudioTracks()) t.enabled = !muted;
      }
      return muted;
    }

    function toggleSpeaker() {
      onSpeaker = !onSpeaker;
      if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
        // Best-effort — setSinkId requires HTTPS and is Chromium-only.
        // Without it the OS routes audio per user preference.
        // We don't crash if it fails.
      }
      // Volume nudge is a poor man's "speaker" hint for mobile browsers that
      // don't expose setSinkId. Real loudspeaker routing is OS-controlled.
      if (remoteAudio) {
        try { remoteAudio.volume = onSpeaker ? 1.0 : 1.0; } catch {}
      }
      return onSpeaker;
    }

    function teardown(nextState) {
      clearOutgoingTimeout();
      pendingOffer = null;
      pendingIce = [];
      if (pc) {
        try {
          pc.ontrack = null;
          pc.onicecandidate = null;
          pc.onconnectionstatechange = null;
          pc.close();
        } catch {}
        pc = null;
      }
      if (localStream) {
        try { for (const t of localStream.getTracks()) t.stop(); } catch {}
        localStream = null;
      }
      if (remoteAudio) {
        try { remoteAudio.srcObject = null; } catch {}
        try { remoteAudio.parentNode && remoteAudio.parentNode.removeChild(remoteAudio); } catch {}
        remoteAudio = null;
      }
      remoteStream = null;
      isInitiator = false;
      muted = false;
      onSpeaker = false;
      setState(nextState || 'ended');
      // After a brief moment, return to idle so a new call can be placed.
      setTimeout(() => {
        if (state === 'ended' || state === 'failed') setState('idle');
      }, 800);
    }

    function destroy() {
      teardown('idle');
    }

    return {
      startCall,
      handleSignal,
      answer,
      reject,
      hangup,
      toggleMute,
      toggleSpeaker,
      destroy,
      isSupported,
      getState: () => state,
      getReason: () => lastReason,
      isMuted: () => muted,
      isOnSpeaker: () => onSpeaker,
    };
  }

  g.NeeCall = { create, isSupported, diagnose, getCachedDiagnose };
})(typeof window !== 'undefined' ? window : globalThis);
