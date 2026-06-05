// p2p-session.js — WebRTC peer session with PQ handshake for Mode 2 (Direct P2P).
//
// Extracted from lite/nee2p-lite.html. Uses Nee2PCrypto (from crypto.js) for primitives.
// PSK-MAC over SDP prevents tracker MITM. Hybrid X25519 + ML-KEM handshake on the
// DataChannel. No Nee2P server involved.
//
// Usage:
//   const sess = new P2PSession({ masterKey, psk, isInitiator, logger });
//   sess.onPhase = (phase) => { ... };       // 'connecting' | 'handshake' | 'ready' | 'failed'
//   sess.onIceState = (state) => { ... };
//   sess.onMessage = (text) => { ... };
//   const offer = await sess.createOffer();
//   // ...exchange via rendezvous...
//   await sess.acceptAnswer(answer);
//   sess.send(text);
//   sess.close();
//
// Public globals:
//   window.P2PSession         — the session class
//   window.P2PSessionHelpers  — { signSdp, verifySdp, STUN_SERVERS }
//
// Dependencies (must be loaded first):
//   - crypto.js  (exposes window.Nee2PCrypto)

(function (g) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ── ICE servers (extracted from lite/nee2p-lite.html STUN list) ──────────
  const STUN_SERVERS = Object.freeze([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]);

  // ── byte / binary-string helpers (private to this module) ───────────────
  function randBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function bytesToBinStr(b) {
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  function binStrToBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  // HMAC-SHA-256 / HKDF-SHA-256 / raw X25519 ECDH all come from Nee2PCrypto
  // (crypto.js) under the "Mode 2 primitives" group. Local reimplementations
  // were removed once those exports landed.

  async function importAesKey(rawKey) {
    return crypto.subtle.importKey(
      'raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  // ── PSK-MAC over SDP ─────────────────────────────────────────────────────
  // The signed payload is the SDP text + a 16-byte nonce. We append two
  // custom attributes to the SDP body that the tracker passes through
  // transparently:
  //   a=x-nee2p-nonce:<base64(nonce)>
  //   a=x-nee2p-mac:<base64(hmac_sha256(psk, sdp || nonce))>
  // The MAC covers the CLEAN sdp (without the two custom attribute lines).
  //
  // signSdp(sdpClean, psk, nonce?) → sdpWithAuth
  // verifySdp(sdpWithAuth, psk)    → { ok, cleanSdp }
  //
  // Extracted from the class for unit testability.
  async function signSdp(sdpClean, psk, nonce) {
    const n = nonce || randBytes(16);
    if (n.length !== 16) throw new Error('signSdp: nonce must be 16 bytes');
    const data = new Uint8Array(sdpClean.length + n.length);
    data.set(enc.encode(sdpClean), 0);
    data.set(n, sdpClean.length);
    const mac = await g.Nee2PCrypto.hmacSha256(psk, data);
    return sdpClean +
      `a=x-nee2p-nonce:${btoa(bytesToBinStr(n))}\r\n` +
      `a=x-nee2p-mac:${btoa(bytesToBinStr(mac))}\r\n`;
  }

  async function verifySdp(sdpWithAuth, psk) {
    const nonceMatch = sdpWithAuth.match(/a=x-nee2p-nonce:([^\r\n]+)/);
    const macMatch = sdpWithAuth.match(/a=x-nee2p-mac:([^\r\n]+)/);
    if (!nonceMatch || !macMatch) return { ok: false, cleanSdp: sdpWithAuth };
    let nonce, expectedMac;
    try {
      nonce = binStrToBytes(atob(nonceMatch[1]));
      expectedMac = binStrToBytes(atob(macMatch[1]));
    } catch {
      return { ok: false, cleanSdp: sdpWithAuth };
    }
    if (nonce.length !== 16) return { ok: false, cleanSdp: sdpWithAuth };
    const cleanSdp = sdpWithAuth.replace(/a=x-nee2p-(?:nonce|mac):[^\r\n]+\r?\n/g, '');
    const data = new Uint8Array(cleanSdp.length + nonce.length);
    data.set(enc.encode(cleanSdp), 0);
    data.set(nonce, cleanSdp.length);
    const actual = await g.Nee2PCrypto.hmacSha256(psk, data);
    if (actual.length !== expectedMac.length) return { ok: false, cleanSdp };
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expectedMac[i];
    return { ok: diff === 0, cleanSdp };
  }

  // ── Phase timeouts (verbatim from lite) ─────────────────────────────────
  const ICE_GATHER_CAP_MS = 8000;     // safety cap on waiting for icegatheringstate=complete
  const ICE_CHECK_HARD_FAIL_MS = 25000; // ICE checking → failed if no progress
  const WAITING_PEER_HINT_MS = 10000;   // emit 'waitingPeer' hint after 10s

  // ── P2PSession ──────────────────────────────────────────────────────────
  class P2PSession {
    constructor(opts) {
      opts = opts || {};
      this.psk = opts.psk;                      // Uint8Array, 32 bytes
      this.masterKey = opts.masterKey || null;  // optional, not directly used here
      this.isInitiator = !!opts.isInitiator;
      this.logger = opts.logger || function () {};

      this.pc = null;
      this.dc = null;

      // Public callbacks
      this.onMessage = null;   // (text) => {}
      this.onPhase = null;     // (phase) => {}  — 'connecting'|'handshake'|'ready'|'failed'|'closed'
      this.onIceState = null;  // (state) => {}
      this.onClose = null;     // (reason?) => {}
      this.onKeys = null;      // ({ myKemPub, theirKemPub, myX25519Pub, theirX25519Pub }) => {}

      this.sessionKey = null;          // CryptoKey (AES-GCM 256)
      this.handshakeState = 'pending';
      this.phase = null;

      this._x25519 = null;
      this._mlkem = null;
      this._theirX25519Pub = null;
      this._theirKemPub = null;
      this._myKemPub = null;
      this._myX25519Pub = null;

      this._ssEcdh = null;
      this._ssSender = null;
      this._ssReceiver = null;

      this._candCount = 0;
      this._iceCheckTimer = null;
      this._waitingPeerTimer = null;
    }

    // ─── PSK-MAC wrappers (so callers can stay class-only if they prefer)
    async signSdp(sdpClean, nonce) { return signSdp(sdpClean, this.psk, nonce); }
    async verifySdp(sdpWithAuth)   { return verifySdp(sdpWithAuth, this.psk); }

    _log(tag, msg, level) {
      try { this.logger(tag, msg, level || ''); } catch {}
    }

    _setPhase(phase) {
      if (this.phase === phase) return;
      this.phase = phase;
      if (typeof this.onPhase === 'function') {
        try { this.onPhase(phase); } catch {}
      }
    }

    // Optional helper for callers that want to arm the lite "waiting for peer"
    // hint timer. Caller is free to ignore this and drive its own UI timers.
    armWaitingPeerHint(cb) {
      if (this._waitingPeerTimer) clearTimeout(this._waitingPeerTimer);
      this._waitingPeerTimer = setTimeout(() => {
        if (typeof cb === 'function') { try { cb(); } catch {} }
      }, WAITING_PEER_HINT_MS);
    }

    _setupPc() {
      this.pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
      this._setPhase('connecting');

      this.pc.oniceconnectionstatechange = () => {
        const s = this.pc.iceConnectionState;
        const level = (s === 'connected' || s === 'completed') ? 'ok'
                    : (s === 'failed' || s === 'disconnected') ? 'err' : '';
        this._log('webrtc', 'ice: ' + s, level);

        // 25s hard fail when stuck in 'checking'
        if (s === 'checking') {
          if (this._iceCheckTimer) clearTimeout(this._iceCheckTimer);
          this._iceCheckTimer = setTimeout(() => {
            if (this.pc && this.pc.iceConnectionState === 'checking') {
              this._log('webrtc', 'ICE stuck in checking for 25s — failing', 'err');
              this._setPhase('failed');
              if (typeof this.onClose === 'function') {
                try { this.onClose('ice-timeout'); } catch {}
              }
            }
          }, ICE_CHECK_HARD_FAIL_MS);
        } else if (this._iceCheckTimer) {
          clearTimeout(this._iceCheckTimer);
          this._iceCheckTimer = null;
        }

        if (typeof this.onIceState === 'function') {
          try { this.onIceState(s); } catch {}
        }
        if (['failed', 'disconnected', 'closed'].includes(s)) {
          if (typeof this.onClose === 'function') {
            try { this.onClose(s); } catch {}
          }
        }
      };

      this.pc.onconnectionstatechange = () => {
        this._log('webrtc', 'pc: ' + this.pc.connectionState,
          this.pc.connectionState === 'connected' ? 'ok'
          : this.pc.connectionState === 'failed' ? 'err' : '');
      };
      this.pc.onsignalingstatechange = () => {
        this._log('webrtc', 'sig: ' + this.pc.signalingState);
      };

      this._candCount = 0;
      this.pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          this._candCount++;
          const c = evt.candidate.candidate || '';
          const typ = (c.match(/typ (\w+)/) || [, '?'])[1];
          if (this._candCount <= 6) this._log('webrtc', `cand ${this._candCount}: ${typ}`);
        } else {
          this._log('webrtc', `gathered ${this._candCount} candidates`,
            this._candCount > 0 ? 'ok' : 'warn');
        }
      };
    }

    _awaitIceComplete() {
      return new Promise((resolve) => {
        if (this.pc.iceGatheringState === 'complete') return resolve();
        const check = () => {
          if (this.pc.iceGatheringState === 'complete') {
            this.pc.removeEventListener('icegatheringstatechange', check);
            resolve();
          }
        };
        this.pc.addEventListener('icegatheringstatechange', check);
        // safety cap — 8s gives STUN time even on slow networks
        setTimeout(resolve, ICE_GATHER_CAP_MS);
      });
    }

    // Initiator: create offer SDP (already wrapped with PSK-MAC).
    async createOffer() {
      this._setupPc();
      this.dc = this.pc.createDataChannel('nee2p', { ordered: true });
      this._wireDc();
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this._awaitIceComplete();
      const cleanSdp = this.pc.localDescription.sdp;
      return await signSdp(cleanSdp, this.psk);
    }

    // Responder: take a (signed) remote offer, verify, build a (signed) answer.
    async createAnswer(remoteSdpWithAuth) {
      const { ok, cleanSdp } = await verifySdp(remoteSdpWithAuth, this.psk);
      if (!ok) throw new Error('createAnswer: PSK-MAC verification failed');
      this._setupPc();
      this.pc.ondatachannel = (evt) => {
        this.dc = evt.channel;
        this._wireDc();
      };
      await this.pc.setRemoteDescription({ type: 'offer', sdp: cleanSdp });
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this._awaitIceComplete();
      const ansClean = this.pc.localDescription.sdp;
      return await signSdp(ansClean, this.psk);
    }

    // Initiator: accept the responder's (signed) answer.
    async acceptAnswer(remoteSdpWithAuth) {
      const { ok, cleanSdp } = await verifySdp(remoteSdpWithAuth, this.psk);
      if (!ok) throw new Error('acceptAnswer: PSK-MAC verification failed');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: cleanSdp });
    }

    _wireDc() {
      this.dc.binaryType = 'arraybuffer';
      this.dc.onopen = () => {
        this._log('webrtc', 'DataChannel open', 'ok');
        this._setPhase('handshake');
        this._startPqHandshake();
      };
      this.dc.onclose = () => {
        this._log('webrtc', 'DataChannel closed');
        this._setPhase('closed');
        if (typeof this.onClose === 'function') {
          try { this.onClose('dc-close'); } catch {}
        }
      };
      this.dc.onmessage = (evt) => this._onDcMessage(evt.data);
    }

    // ─── PQ handshake over the DataChannel ──────────────────────────────
    // 1) Both sides generate X25519 + ML-KEM ephemeral keypairs.
    // 2) Both send: { t:'hello', x25519Pub, kemPub }
    // 3) On peer hello: encap against their kemPub → {ct, ssSender}; send
    //    { t:'kem', ct }; ECDH against their x25519Pub → ssEcdh.
    // 4) On peer kem ct: decap → ssReceiver.
    // 5) Both: session_key = HKDF(ssEcdh || ssSender || ssReceiver || PSK,
    //                              salt=PSK, info='nee2p-lite.v1.session', 32).
    // 6) Send { t:'ready' }. Both must receive 'ready' to flip to chat.
    async _startPqHandshake() {
      try {
        const C = g.Nee2PCrypto;
        if (!C) throw new Error('Nee2PCrypto missing — load crypto.js first');

        const x = await C.generateEphemeralKeypair();   // { pubKey, privKey }
        const k = await C.generateKemKeypair();         // { pubKey, secretKey }
        // Internal naming kept consistent with lite (pub/priv) for callers.
        this._x25519 = { pub: x.pubKey, priv: x.privKey };
        this._mlkem  = { pub: k.pubKey, priv: k.secretKey };
        this._myX25519Pub = this._x25519.pub;
        this._myKemPub    = this._mlkem.pub;

        this._send({
          t: 'hello',
          x25519: bytesToBinStr(this._x25519.pub),
          kem: bytesToBinStr(this._mlkem.pub),
        });
        this.handshakeState = 'sent-hello';
        this._log('handshake', 'hello sent (X25519+MLKEM)', 'ok');
      } catch (e) {
        this._log('handshake', 'init failed: ' + e.message, 'err');
        this._setPhase('failed');
      }
    }

    _send(obj) {
      if (this.dc && this.dc.readyState === 'open') {
        this.dc.send(JSON.stringify(obj));
      }
    }

    async _onDcMessage(data) {
      const C = g.Nee2PCrypto;
      let raw = data;
      if (data instanceof ArrayBuffer) raw = dec.decode(new Uint8Array(data));
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.t === 'hello' && this.handshakeState === 'sent-hello') {
        try {
          this._theirX25519Pub = binStrToBytes(msg.x25519);
          this._theirKemPub = binStrToBytes(msg.kem);
          this._log('handshake', 'peer hello received', 'ok');

          // ECDH against peer's x25519 pubkey via Nee2PCrypto.rawEcdh, which
          // is a thin wrapper over crypto.js's internal _ecdh — derivePeerKey
          // would have HKDF'd it away (wrong shape for our IKM concat).
          this._ssEcdh = await C.rawEcdh(this._x25519.priv, this._theirX25519Pub);

          // Encap against peer's KEM pubkey
          const { sharedSecret, ct } = await C.kemEncapsulate(this._theirKemPub);
          this._ssSender = sharedSecret;

          this._send({ t: 'kem', ct: bytesToBinStr(ct) });
          this.handshakeState = 'sent-kem';
          this._log('handshake', 'KEM ciphertext sent', 'ok');
          await this._maybeDeriveKey();
        } catch (e) {
          this._log('handshake', 'hello-handler failed: ' + e.message, 'err');
          this._setPhase('failed');
        }
        return;
      }

      if (msg.t === 'kem') {
        try {
          const ct = binStrToBytes(msg.ct);
          this._ssReceiver = await C.kemDecapsulate(this._mlkem.priv, ct);
          this._log('handshake', 'KEM ciphertext received, decap ok', 'ok');
          await this._maybeDeriveKey();
        } catch (e) {
          this._log('handshake', 'kem-handler failed: ' + e.message, 'err');
          this._setPhase('failed');
        }
        return;
      }

      if (msg.t === 'ready') {
        this.handshakeState = 'ready';
        this._setPhase('ready');
        this._log('handshake', 'peer ready, channel unlocked', 'ok');
        return;
      }

      if (msg.t === 'msg' && this.sessionKey) {
        try {
          const iv = binStrToBytes(msg.iv);
          const ct = binStrToBytes(msg.ct);
          const ptBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv }, this.sessionKey, ct
          );
          const text = dec.decode(ptBuf);
          if (typeof this.onMessage === 'function') {
            try { this.onMessage(text); } catch {}
          }
        } catch (e) {
          this._log('chat', 'decrypt failed: ' + e.message, 'err');
        }
      }
    }

    async _maybeDeriveKey() {
      if (!this._ssEcdh || !this._ssSender || !this._ssReceiver) return;
      if (this.sessionKey) return;

      // IKM = ECDH || ssSender || ssReceiver || PSK
      const ikm = new Uint8Array(
        this._ssEcdh.length + this._ssSender.length + this._ssReceiver.length + this.psk.length
      );
      let off = 0;
      ikm.set(this._ssEcdh, off);    off += this._ssEcdh.length;
      ikm.set(this._ssSender, off);  off += this._ssSender.length;
      ikm.set(this._ssReceiver, off); off += this._ssReceiver.length;
      ikm.set(this.psk, off);

      const rawKey = await g.Nee2PCrypto.hkdf(ikm, this.psk /* salt */, 'nee2p-lite.v1.session', 32);
      this.sessionKey = await importAesKey(rawKey);
      this._log('handshake', 'session key derived (HKDF over X25519+MLKEM+PSK)', 'ok');

      this._send({ t: 'ready' });
      if (typeof this.onKeys === 'function') {
        try {
          this.onKeys({
            myKemPub: this._myKemPub,
            theirKemPub: this._theirKemPub,
            myX25519Pub: this._myX25519Pub,
            theirX25519Pub: this._theirX25519Pub,
          });
        } catch {}
      }
      if (this.handshakeState !== 'ready') this.handshakeState = 'sent-ready';
    }

    // Send a UTF-8 string over the encrypted DataChannel.
    async send(text) {
      if (!this.sessionKey) throw new Error('session not established');
      const iv = randBytes(12);
      const ctBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, this.sessionKey, enc.encode(String(text))
      );
      this._send({
        t: 'msg',
        iv: bytesToBinStr(iv),
        ct: bytesToBinStr(new Uint8Array(ctBuf)),
      });
    }

    close() {
      if (this._iceCheckTimer)    { clearTimeout(this._iceCheckTimer); this._iceCheckTimer = null; }
      if (this._waitingPeerTimer) { clearTimeout(this._waitingPeerTimer); this._waitingPeerTimer = null; }
      try { if (this.dc) this.dc.close(); } catch {}
      try { if (this.pc) this.pc.close(); } catch {}
      this._setPhase('closed');
    }
  }

  // ── Exports ──────────────────────────────────────────────────────────────
  g.P2PSession = P2PSession;
  g.P2PSessionHelpers = Object.freeze({
    signSdp,
    verifySdp,
    STUN_SERVERS,
    ICE_GATHER_CAP_MS,
    ICE_CHECK_HARD_FAIL_MS,
    WAITING_PEER_HINT_MS,
  });
})(typeof window !== 'undefined' ? window : globalThis);
