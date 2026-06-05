// tracker-rendezvous.js — WebTorrent-tracker-based rendezvous for Mode 2 (Direct P2P).
//
// Extracted from lite/nee2p-lite.html (TrackerSwarm class). Two peers that share
// the same secret phrase derive identical infoHash and discover each other via
// public WSS trackers. No Nee2P server involved.
//
// Usage:
//   const swarm = new TrackerRendezvous.TrackerSwarm({ infoHash, peerId, logger });
//   swarm.onOffer = ({ offer, offer_id, peer_id }) => { ... };
//   swarm.onAnswer = ({ answer, offer_id, peer_id }) => { ... };
//   await swarm.start();
//   swarm.announceOffer(offerId, sdpOffer);
//   swarm.sendAnswer(toPeerId, offerId, sdpAnswer);
//   swarm.stop();
//
// Health check: swarm.aliveCount() — count of currently-connected trackers.
(function (g) {
  // Pool of public WebTorrent WSS trackers — discovery layer.
  // Multi-tracker is intentional: if one drops, others carry. Replace any
  // dead tracker by probing candidates first (see lite/build/probe-trackers.js
  // or run inline in browser console — see lite/README.md "tracker pool").
  //
  // Verified 2026-05-28: each accepts WebSocket announce + returns JSON
  // with action:"announce", info_hash, complete/incomplete counts.
  //
  // Replaced wss://tracker.files.fm:7073/announce (offline since 2026-05-28)
  // with wss://tracker.novage.com.ua (probed: open 737ms, announce 805ms).
  // 2026-05-30: live QA showed 3/4 trackers alive (webtorrent.dev intermittently
  // down). Kept webtorrent.dev in the pool (well-known, may recover) and added
  // tracker.files.fm back for redundancy — pool now has 5 entries so a single
  // outage degrades to 4/5 instead of 3/4.
  const TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.webtorrent.dev',
    'wss://tracker.novage.com.ua',
    'wss://tracker.files.fm:7073/announce',
  ];

  // Inlined from lite/nee2p-lite.html (line 661) — converts Uint8Array to a
  // binary string (each byte = one char code). WebTorrent tracker wire format
  // requires info_hash, peer_id, offer_id as 20-byte binary strings.
  function bytesToBinStr(b) {
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  function shortHost(url) {
    try { return new URL(url).host.replace(/^tracker\./, ''); }
    catch { return url; }
  }

  class TrackerSwarm {
    constructor({ infoHash, peerId, logger } = {}) {
      this.infoHash = bytesToBinStr(infoHash);
      this.peerId = bytesToBinStr(peerId);
      this.onOffer = null;     // ({fromPeerId, offerId, sdp, viaTracker})
      this.onAnswer = null;    // ({fromPeerId, offerId, sdp, viaTracker})
      this.log = logger || (() => {});
      this.conns = [];
      this.connected = 0;
    }

    start() {
      for (const url of TRACKERS) this._connectOne(url);
    }

    _connectOne(url) {
      let ws;
      try { ws = new WebSocket(url); }
      catch (e) { this.log('tracker', `${url}: ${e.message}`, 'err'); return; }

      const entry = { url, ws, alive: false, reconnectTimer: null };
      this.conns.push(entry);

      ws.onopen = () => {
        entry.alive = true;
        this.connected++;
        this.log('tracker', `${shortHost(url)} ✓`, 'ok');
      };
      ws.onerror = () => { this.log('tracker', `${shortHost(url)} ✗`, 'warn'); };
      ws.onclose = () => {
        if (entry.alive) this.connected--;
        entry.alive = false;
        this.log('tracker', `${shortHost(url)} closed`, 'warn');
      };
      ws.onmessage = (evt) => this._onMessage(entry, evt);
    }

    _onMessage(entry, evt) {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (!msg || msg.action !== 'announce') return;
      // ignore messages for other info-hashes (shouldn't happen, but tracker may forward)
      if (msg.info_hash && msg.info_hash !== this.infoHash) return;
      // Ignore our own peer_id echoes
      if (msg.peer_id === this.peerId) return;

      if (msg.offer && msg.offer.sdp) {
        if (this.onOffer) this.onOffer({
          fromPeerId: msg.peer_id,
          offerId: msg.offer_id,
          sdp: msg.offer.sdp,
          viaTracker: entry,
        });
      } else if (msg.answer && msg.answer.sdp) {
        if (this.onAnswer) this.onAnswer({
          fromPeerId: msg.peer_id,
          offerId: msg.offer_id,
          sdp: msg.answer.sdp,
          viaTracker: entry,
        });
      }
    }

    // Broadcast our offer to ALL connected trackers — the first peer to answer wins,
    // others get dropped silently.
    announceOffer(offerId20, sdp) {
      const offerIdStr = bytesToBinStr(offerId20);
      const payload = JSON.stringify({
        action: 'announce',
        info_hash: this.infoHash,
        peer_id: this.peerId,
        uploaded: 0,
        downloaded: 0,
        left: 0,
        numwant: 5,
        offers: [{ offer_id: offerIdStr, offer: { type: 'offer', sdp } }],
      });
      let sent = 0;
      for (const c of this.conns) {
        if (c.alive && c.ws.readyState === WebSocket.OPEN) {
          try { c.ws.send(payload); sent++; } catch {}
        }
      }
      return sent;
    }

    // Reply to someone's offer with our answer, sent ONLY to the tracker that
    // forwarded it (otherwise other trackers reject "to_peer_id" they don't know).
    sendAnswer(viaTrackerEntry, toPeerId, offerId, sdp) {
      const payload = JSON.stringify({
        action: 'announce',
        info_hash: this.infoHash,
        peer_id: this.peerId,
        to_peer_id: toPeerId,
        offer_id: offerId,
        answer: { type: 'answer', sdp },
      });
      try { viaTrackerEntry.ws.send(payload); return true; } catch { return false; }
    }

    // Health check — how many trackers are currently connected. Used by
    // net-probe.js to report "tracker reachable" status.
    aliveCount() {
      let n = 0;
      for (const c of this.conns) if (c.alive) n++;
      return n;
    }

    close() {
      for (const c of this.conns) {
        try { c.ws.close(); } catch {}
      }
      this.conns = [];
      this.connected = 0;
    }

    // Alias matching the docstring usage example.
    stop() { this.close(); }
  }

  g.TrackerRendezvous = { TRACKERS, TrackerSwarm, shortHost };
})(typeof window !== 'undefined' ? window : globalThis);
