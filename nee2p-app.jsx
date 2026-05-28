// nee2p-app.jsx — real e2e orchestrator with persistent rooms.
//
// Two flows:
//   • create: phrase + ttl + password [+ groupMax 2|3|4|6|8] → claim slot 0
//             → share code, others join with their own passwords.
//   • join:   phrase/hash + password → claim first free slot (or restore by
//             passwordHash if it matches an existing slot).
// A claim with a non-matching password AFTER the room is full → 'locked'.
// Any participant can close the tab and come back — passwordHash is the key.
//
// Group chat (2–8): when groupMax > 2 the wire format switches from 'A'/'B'
// strings to numeric slot ids (0..groupMax-1). Crypto uses the SENDER KEYS
// protocol: each member encrypts outgoing msgs with their own AES-GCM key and
// distributes it to every other peer wrapped under the pairwise key (HKDF of
// X25519+ML-KEM+phrase). See crypto.js for the primitives.
//
// Backward compat for 2-party rooms: server still emits 'A'/'B' wire ids and
// the legacy claim-result fields (peerPubKey, peerKemPubKey). New clients
// always coerceSlot() inbound; the actual mySlot ref is a NUMBER (0/1/.../N).

const {
  GradientMesh,
  WelcomeScreen, CreatedScreen, JoinScreen, ShareScreen,
  WaitingScreen, ChatScreen, InfoScreen, ExpiredScreen, LockedScreen,
} = window;
const md5 = window.md5;
const Nee2PCrypto = window.Nee2PCrypto;
const Nee2PWS = window.Nee2PWS;

const PALETTE = 'steel';
const HASH_RE = /^[a-f0-9]{32}$/i;

// Parse `#join=<phrase>` deep-link from the URL hash fragment. The fragment
// is local-only — it never reaches the relay or any CDN. Used both to set
// the initial screen state and to pre-fill the joinValue input.
function parseDeepLink() {
  try {
    if (typeof location === 'undefined' || !location.hash) return '';
    const m = location.hash.match(/(?:^#|&)join=([^&]+)/);
    if (!m) return '';
    return decodeURIComponent(m[1]);
  } catch { return ''; }
}

const TTL_OPTIONS = [
  { id: '1h',  label: '1 час',    ms: 1 * 3600 * 1000 },
  { id: '6h',  label: '6 часов',  ms: 6 * 3600 * 1000 },
  { id: '24h', label: '24 часа',  ms: 24 * 3600 * 1000 },
  { id: '3d',  label: '3 дня',    ms: 3 * 24 * 3600 * 1000 },
  { id: '7d',  label: '7 дней',   ms: 7 * 24 * 3600 * 1000 },
];

const GROUP_OPTIONS = [2, 3, 4, 6, 8];
const DEFAULT_GROUP_MAX = 2;

// Wire slot id (string 'A'/'B' for 2-party, number for groups) → internal
// numeric index. Tolerant: accepts both forms regardless of room size.
function coerceSlot(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v | 0;
  if (typeof v === 'string') {
    if (v === 'A') return 0;
    if (v === 'B') return 1;
    if (/^\d+$/.test(v)) return parseInt(v, 10);
  }
  return null;
}

// Internal numeric slot → outbound wire id. For 2-party rooms we send 'A'/'B'
// to stay bit-compatible with old clients that might still parse letters.
function slotForWire(slotNum, groupMax) {
  if (groupMax === 2) return slotNum === 0 ? 'A' : 'B';
  return slotNum;
}

// Display label shown to the user. 2-party stays 'A'/'B' (matches existing
// design); groups become 'Участник N' (1-indexed for humans).
function slotLabel(slotNum, groupMax) {
  if (groupMax === 2) return slotNum === 0 ? 'A' : 'B';
  return 'Участник ' + (slotNum + 1);
}

// Stable per-slot accent hue (HSL, no palette dependency). Used to color
// "from: Участник N" headers on incoming bubbles in groups.
function slotHue(slotNum) {
  // Golden-angle spaced hues so adjacent slots are visually distinct.
  return Math.round(((slotNum || 0) * 137.508) % 360);
}

// ── Friendly display names (OnionShare-style) ─────────────
// Each participant in a room gets a deterministic two-word Russian display
// name derived from (roomId, slotIndex). Both peers compute the same name
// for the same slot (since roomId is the same on both sides). Nothing is
// persisted — derived per render. Used in the chat header, group bubble
// sender labels, safety-modal tab labels, and reaction-pill tooltips.
const FRIENDLY_ADJECTIVES = [
  'тихий', 'белый', 'медный', 'лунный', 'сонный', 'синий', 'краткий',
  'ласковый', 'ясный', 'дальний', 'снежный', 'тёплый', 'строгий',
  'звёздный', 'седой', 'нежный', 'острый', 'мягкий', 'хрупкий', 'дикий',
];
const FRIENDLY_NOUNS = [
  'шёпот', 'ветер', 'странник', 'пёс', 'путник', 'лебедь', 'голос',
  'кит', 'мост', 'рассвет', 'дым', 'парус', 'свет', 'снег', 'омут',
  'дождь', 'ручей', 'камень', 'остров', 'фонарь',
];
// Cheap deterministic 32-bit hash over a string (FNV-1a). Not crypto, just
// "spread these inputs across a small word list with no obvious clumping".
function _friendlyHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
function friendlyName(roomId, slotNum) {
  if (slotNum == null || slotNum < 0) return '';
  const seed = String(roomId || '') + '::' + slotNum;
  const h1 = _friendlyHash('adj:' + seed);
  const h2 = _friendlyHash('noun:' + seed);
  const adj = FRIENDLY_ADJECTIVES[h1 % FRIENDLY_ADJECTIVES.length];
  const noun = FRIENDLY_NOUNS[h2 % FRIENDLY_NOUNS.length];
  return adj + ' ' + noun;
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Make slot helpers available to nee2p-screens.jsx (e.g. Bubble color, header
// label). The screens module is loaded before this file, so it reads them
// lazily via window.Nee2PSlotUtil.
window.Nee2PSlotUtil = { coerceSlot, slotForWire, slotLabel, slotHue, friendlyName };

function App() {
  // ── navigation ────────────────────────────────────────────
  // If opened via a #join=<phrase> deep-link (e.g. from a QR code), jump
  // straight to the join screen so the user sees session info immediately.
  const [screen, setScreen] = React.useState(() => parseDeepLink() ? 'join' : 'welcome');
  const [expiredReason, setExpiredReason] = React.useState(null);

  // ── creator input state ───────────────────────────────────
  // Phrase is the single source of truth. The CreatedScreen "случайный код"
  // button calls generateSeed() to fill this with a random readable token.
  // We always lowercase here so the same MD5 falls out regardless of caps —
  // ("Pushkin-22" and "pushkin-22" must derive the same room id).
  const [phrase, setPhrase] = React.useState('');
  const generateSeed = React.useCallback(() => {
    const seed = 'nee2p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    setPhrase(seed);
  }, []);
  const [ttlId, setTtlId] = React.useState('24h');
  // Group chat size — 2 (default, current behaviour) up to 8. Only used on
  // create; joiners pick up groupMax from the claim-result.
  const [createGroupMax, setCreateGroupMax] = React.useState(DEFAULT_GROUP_MAX);

  // ── join input state ──────────────────────────────────────
  // Pre-fill from `#join=<phrase>` deep link if present, then strip the
  // fragment so a reload doesn't re-trigger (and the URL stays clean).
  const [joinValue, setJoinValue] = React.useState(() => parseDeepLink());
  React.useEffect(() => {
    if (location.hash && parseDeepLink()) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    }
  }, []);

  // ── shared (both flows) ──────────────────────────────────
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [flowError, setFlowError] = React.useState(null);

  // "Remember me on this device" opt-in flag. Defaults to false — persistence
  // is OFF until the user explicitly ticks the checkbox on Create/Join.
  // Surfaced to CreatedScreen + JoinScreen as a prop. When true at the moment
  // a claim succeeds we call Nee2PPersist.enable() (idempotent) + save() so
  // subsequent visits can auto-restore the session.
  const [rememberMe, setRememberMe] = React.useState(false);
  // Snapshot of Nee2PPersist.isEnabled() for THIS render (so SafetyModal can
  // show the "Персистентность: включена" line without an async call mid-render).
  const [persistEnabled, setPersistEnabled] = React.useState(false);
  // Array<{roomId, slot, updatedAt, expiresAt, groupMax}> — rooms we can offer
  // to auto-restore from WelcomeScreen. Refreshed on mount + on resetAll().
  const [savedRooms, setSavedRooms] = React.useState([]);
  // Guard so we only auto-restore once per mount (prevents flicker if a render
  // re-runs the effect).
  const autoRestoreFiredRef = React.useRef(false);
  // Track the room we last persisted so post-handshake epoch bumps can update
  // the same record without re-reading deviceKey state.
  const persistedRoomIdRef = React.useRef(null);

  // ── live connection state ─────────────────────────────────
  const wsRef = React.useRef(null);
  // aesKeyRef = phrase-only fallback key (legacy, used when there's no peer
  // pubKey yet — keeps backward-compat with peers running the old client).
  const aesKeyRef = React.useRef(null);
  // Forward-secrecy + post-quantum + sender-keys refs.
  //
  //   myKeyPair            — { pubKey: Uint8Array, privKey: opaque } X25519 for this connect
  //   myKemKeypair         — { pubKey: Uint8Array(1184), secretKey: opaque }  ML-KEM-768
  //   mySenderKey          — Uint8Array(32) — the symmetric key we encrypt
  //                          ALL outgoing msgs with. Rotated on every epoch
  //                          bump (any pubkey change). Distributed via the
  //                          `sender-key` envelope wrapped under per-peer
  //                          pairwise keys.
  //   mySenderKeyEpoch     — bumps each time mySenderKey is regenerated, ships
  //                          on every msg so receivers can spot rotations.
  //   peerKeysRef          — Map<peerSlotNum, {
  //                             pubKey?: Uint8Array,       // X25519
  //                             kemPub?: Uint8Array,       // ML-KEM-768
  //                             kemShared?: Uint8Array(32),// pairwise PQ shared (current epoch)
  //                             pairwiseKey?: CryptoKey,   // HKDF output (current epoch)
  //                             senderKey?: Uint8Array(32),// peer's sender key
  //                             senderKeyEpoch?: number,   // their senderKeyEpoch
  //                             pairwiseEpoch?: number,    // epoch the pairwiseKey was derived for
  //                             sentSenderKey?: number,    // last room-epoch we shipped our SK to this peer
  //                          }>
  //   pendingDecryptRef    — Map<senderSlotNum, [item, ...]> — encrypted msgs
  //                          we received before the sender's key arrived. We
  //                          retry on each `sender-key` ingest.
  //   phraseKeyRaw         — 32 raw bytes from Argon2id (mixed into HKDF)
  //   currentEpoch         — number — last epoch we've seen from any pubkey
  //                          event; used to tag outbound messages.
  const myKeyPairRef = React.useRef(null);
  const myKemKeypairRef = React.useRef(null);
  const mySenderKeyRef = React.useRef(null);
  const mySenderKeyEpochRef = React.useRef(0);
  const peerKeysRef = React.useRef(new Map());
  const pendingDecryptRef = React.useRef(new Map());
  const phraseKeyRawRef = React.useRef(null);
  const roomIdRef = React.useRef('');
  const [currentEpoch, setCurrentEpoch] = React.useState(0);
  const currentEpochRef = React.useRef(0);
  // safetyFingerprint: Array<{ slot: number, label: string, words: string[12],
  //                            hex: string, hasKem: boolean }>  | null
  const [safetyFingerprint, setSafetyFingerprint] = React.useState(null);
  const ackQueueRef = React.useRef([]);
  const ackTimerRef = React.useRef(null);
  const [activeHash, setActiveHash] = React.useState('');
  // mySlot is now a NUMBER 0..groupMax-1. The wire format can still be 'A'/'B'
  // for 2-party rooms — see slotForWire().
  const [mySlot, setMySlot] = React.useState(null);
  const mySlotRef = React.useRef(null);
  const [groupMax, setGroupMax] = React.useState(DEFAULT_GROUP_MAX);
  const groupMaxRef = React.useRef(DEFAULT_GROUP_MAX);
  // For groupMax=2 we keep the legacy {A,B} occupant shape; for >2 it's an Array.
  const [slots, setSlots] = React.useState({ A: { claimed: false, sealed: false }, B: { claimed: false, sealed: false } });
  const [paired, setPaired] = React.useState(false);
  const [pairedAt, setPairedAt] = React.useState(null);
  const [createdAt, setCreatedAt] = React.useState(null);
  const [expiresAt, setExpiresAt] = React.useState(null);
  // Online + typing per peer slot. Map<slotNum, bool>. Replaces the old
  // single-peer scalars. Derived helpers below preserve the old API names.
  const [peerOnline, setPeerOnline] = React.useState(new Map());
  const [peerTyping, setPeerTyping] = React.useState(new Map());
  const [messages, setMessages] = React.useState([]);
  const [chatBanner, setChatBanner] = React.useState(null);
  // SSE connection status surfaced from http-client.js. 'live' = normal,
  // 'reconnecting' = onerror fired and we're retrying, 'lost' = >5s offline.
  // ChatScreen renders an orange/red bar above the message list when not 'live'.
  const [connStatus, setConnStatus] = React.useState('live');
  // Two-tabs detection via BroadcastChannel — fires when a second tab opens
  // the same Nee2P. origin so the user can close one before slot conflicts.
  const [twoTabsWarning, setTwoTabsWarning] = React.useState(false);

  // ─── WebRTC call orchestration state (owner: webrtc-calls) ───
  // Drives the peer-to-peer audio call UI. Audio only on MVP.
  // callState: idle | outgoing | incoming | active | ended | failed
  // callPeer:  slot number of the other side once known.
  // callError: structured code from NeeCall (mic-denied, ice-failed, peer-busy, etc.)
  // callToast: transient banner for peer-side outcomes (rejected/missed/ended)
  //            shown in the chat for ~3s after the call concludes.
  const [callState, setCallState] = React.useState('idle');
  const [callPeer, setCallPeer] = React.useState(null);
  const [callMuted, setCallMuted] = React.useState(false);
  const [callOnSpeaker, setCallOnSpeaker] = React.useState(false);
  const [callError, setCallError] = React.useState(null);
  const [callToast, setCallToast] = React.useState(null);
  const callToastTimerRef = React.useRef(null);
  const neeCallRef = React.useRef(null);

  // Show a transient (3s) toast in the chat for a peer-side call outcome.
  const flashCallToast = React.useCallback((text) => {
    if (callToastTimerRef.current) clearTimeout(callToastTimerRef.current);
    setCallToast(text);
    callToastTimerRef.current = setTimeout(() => {
      setCallToast(null);
      callToastTimerRef.current = null;
    }, 3500);
  }, []);

  // FIX 8 — two-tabs detection via BroadcastChannel. If two tabs of Nee2P.
  // are open at the same origin, both will try to claim the same slot →
  // server-side conflicts. We can't HARD-stop the second tab (the user may
  // have legitimately opened a second room), so we just surface a warning
  // banner the user can dismiss. Best-effort: BroadcastChannel isn't on
  // older Safari (<15.4) and is missing in some private-mode contexts.
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let ch;
    try { ch = new BroadcastChannel('nee2p.session.lock'); } catch { return; }
    const myId = Math.random().toString(36).slice(2);
    let warned = false;
    ch.onmessage = (e) => {
      const d = e && e.data;
      if (!d || d.id === myId) return;
      if (d.type === 'hello' && !warned) {
        warned = true;
        setTwoTabsWarning(true);
        // Respond so the OTHER tab also knows about us (it may have loaded
        // first and missed our hello). Idempotent — they'll also early-out
        // on their own warned flag.
        try { ch.postMessage({ type: 'hello', id: myId }); } catch {}
      }
    };
    try { ch.postMessage({ type: 'hello', id: myId }); } catch {}
    return () => { try { ch.close(); } catch {} };
  }, []);

  // ── persistence: auto-restore on mount ────────────────────
  //
  // 1. Check global state: Nee2PPersist.isEnabled() — does deviceKey exist?
  // 2. List rooms with non-expired expiresAt.
  // 3. If exactly one → auto-restore (only if no other tab is already on it).
  // 4. Otherwise → expose the list to WelcomeScreen for explicit pick.
  //
  // The "another tab on the same room" check uses a per-room BroadcastChannel
  // (`nee2p.session.<roomId>`): on auto-restore we post `hello` and wait briefly
  // for a peer-tab response; if anyone answers we DON'T restore (the other tab
  // owns the slot). This prevents two tabs from both auto-claiming the same
  // slot and stepping on each other's epoch bumps.
  React.useEffect(() => {
    if (autoRestoreFiredRef.current) return;
    autoRestoreFiredRef.current = true;
    if (!window.Nee2PPersist) return;
    (async () => {
      try {
        const enabled = await window.Nee2PPersist.isEnabled();
        setPersistEnabled(!!enabled);
        if (!enabled) return;
        const now = Date.now();
        const rooms = (await window.Nee2PPersist.listRooms())
          .filter(r => r.expiresAt && r.expiresAt > now);
        setSavedRooms(rooms);
        if (rooms.length !== 1) return;
        // Probe via BroadcastChannel — bail if another tab is already on it.
        const target = rooms[0];
        if (typeof BroadcastChannel !== 'undefined') {
          let busy = false;
          try {
            const subCh = new BroadcastChannel('nee2p.session.' + target.roomId);
            await new Promise(resolve => {
              subCh.onmessage = (e) => {
                if (e && e.data && e.data.type === 'hello-ack') { busy = true; resolve(); }
              };
              subCh.postMessage({ type: 'hello' });
              setTimeout(resolve, 220);
            });
            try { subCh.close(); } catch {}
          } catch {}
          if (busy) return;
        }
        const rec = await window.Nee2PPersist.load(target.roomId);
        if (!rec || !rec.phrase || !rec.password) return;
        // Prime the join flow with the decrypted phrase + password and fire
        // submitJoin (which will run the full claim handshake — exactly the
        // same path as a manual login).
        setJoinValue(rec.phrase);
        setPassword(rec.password);
        setRememberMe(true);
        // Defer submitJoin to the next tick so the state updates settle.
        setTimeout(() => {
          // The two useState calls above may not have flushed when submitJoin
          // reads them, so call connectAndClaim directly with the values
          // we just decrypted.
          (async () => {
            setBusy(true);
            const r = await connectAndClaim(target.roomId, rec.password);
            setBusy(false);
            if (!r.ok) {
              // Auto-restore failed (room probably expired server-side or the
              // password was rotated server-side). Drop the stale record and
              // fall back to the welcome screen — the user can re-enter.
              await window.Nee2PPersist.forget(target.roomId);
              setSavedRooms(prev => prev.filter(x => x.roomId !== target.roomId));
              return;
            }
            setActiveHash(target.roomId);
            const myNum = coerceSlot(r.slot);
            setMySlot(myNum);
            mySlotRef.current = myNum;
            const gm = typeof r.groupMax === 'number' ? r.groupMax : DEFAULT_GROUP_MAX;
            setGroupMax(gm);
            groupMaxRef.current = gm;
            if (r.slots) setSlots(r.slots);
            if (r.createdAt) setCreatedAt(r.createdAt);
            if (r.expiresAt) setExpiresAt(r.expiresAt);
            setPaired(!!r.paired);
            persistedRoomIdRef.current = target.roomId;
            setScreen('chat');
            // Refresh the snapshot so the latest expiresAt + sessionKey land.
            await persistSessionSnapshot(rec.phrase, rec.password, rec.ttlMs);
          })();
        }, 0);
      } catch (e) {
        console.warn('persistence auto-restore failed:', e && e.message);
      }
    })();
    // connectAndClaim/persistSessionSnapshot are stable refs once mounted;
    // the eslint-disable below would lint-clean if we had eslint configured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-room cross-tab coordination — once we're inside a room, answer any
  // `hello` from another tab so it knows to skip auto-restore. Also surface
  // a warning if a second tab tries to enter the SAME room (slot conflict).
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const rid = roomIdRef.current;
    if (!rid || screen !== 'chat') return;
    let ch;
    try { ch = new BroadcastChannel('nee2p.session.' + rid); }
    catch { return; }
    ch.onmessage = (e) => {
      const d = e && e.data;
      if (!d) return;
      if (d.type === 'hello') {
        try { ch.postMessage({ type: 'hello-ack' }); } catch {}
        setTwoTabsWarning(true);
      }
    };
    // Announce ourselves so an existing tab on this room flips its warning
    // (and any auto-restore probe in flight gets the ack).
    try { ch.postMessage({ type: 'hello-ack' }); } catch {}
    return () => { try { ch.close(); } catch {} };
  }, [screen, activeHash]);

  // ── derived ───────────────────────────────────────────────
  const createHash = React.useMemo(() => {
    const src = (phrase || '').trim().toLowerCase();
    return src ? md5(src) : '';
  }, [phrase]);

  const joinHash = React.useMemo(() => {
    const t = (joinValue || '').trim().toLowerCase();
    if (!t) return '';
    return HASH_RE.test(t) ? t : md5(t);
  }, [joinValue]);

  // In 2-party rooms there is exactly one peer slot. In groups we use the
  // peerKeysRef map instead and don't reference a single peerSlot.
  const peerSlot = groupMax === 2 ? (mySlot === 0 ? 1 : 0) : null;

  // Keep refs in sync with state so async event handlers can read the current
  // value without going through React's stale-closure dance.
  React.useEffect(() => { mySlotRef.current = mySlot; }, [mySlot]);
  React.useEffect(() => { groupMaxRef.current = groupMax; }, [groupMax]);

  // Build the participants list passed to ChatScreen for header rendering /
  // typing-by-name in groups. Recomputed when slots / online / typing change.
  const participants = React.useMemo(() => {
    if (mySlot === null) return [];
    const out = [];
    const isArray = Array.isArray(slots);
    const length = isArray ? slots.length : (groupMax === 2 ? 2 : groupMax);
    for (let i = 0; i < length; i++) {
      if (i === mySlot) continue;
      let occ;
      if (isArray) occ = slots[i];
      else if (groupMax === 2) occ = i === 0 ? slots.A : slots.B;
      else occ = null;
      out.push({
        slot: i,
        label: slotLabel(i, groupMax),
        friendly: friendlyName(roomIdRef.current, i),
        hue: slotHue(i),
        claimed: !!(occ && occ.claimed),
        sealed: !!(occ && occ.sealed),
        online: !!peerOnline.get(i),
        typing: !!peerTyping.get(i),
      });
    }
    return out;
  }, [slots, mySlot, groupMax, peerOnline, peerTyping]);

  // Backward-compat scalars that ChatScreen still reads for the 2-party
  // single-avatar header. In groups these reflect "any peer typing / online".
  const partnerOnline = groupMax === 2
    ? !!peerOnline.get(peerSlot)
    : participants.some(p => p.online);
  const partnerTyping = groupMax === 2
    ? !!peerTyping.get(peerSlot)
    : participants.some(p => p.typing);
  const partnerClaimed = (() => {
    if (groupMax === 2) {
      const occ = peerSlot === 0 ? slots.A : slots.B;
      return !!(occ && occ.claimed);
    }
    return participants.some(p => p.claimed);
  })();

  // ── chat countdown ────────────────────────────────────────
  // The 1-Hz `now` ticker used to live here and re-render the entire App
  // (and therefore every chat bubble) every second. Each screen that needs
  // a live clock owns its own ticker now: ChatScreen derives expirySeconds
  // from (expiresAt, useNow()), ShareScreen does the same for nowMs. App
  // itself no longer re-renders just to advance a clock.
  const ttlMs = (TTL_OPTIONS.find(t => t.id === ttlId) || TTL_OPTIONS[2]).ms;
  const totalSeconds = (expiresAt && createdAt) ? Math.floor((expiresAt - createdAt) / 1000) : 86400;

  // ── self-destructing message timers ───────────────────────
  // Map<msgId, timeoutId>. Both sender and receiver use this single Map so we
  // can cancel reliably on cleanup. See maybeArmReceiverBurn / maybeArmSenderBurn
  // below for the arming logic. PLAINTEXT TTL metadata travels on the wire as
  // expireSecAfterRead (10|60|3600) — that's a deliberate usability/metadata
  // tradeoff, same shape as replyTo.
  const burnTimersRef = React.useRef(new Map());
  // Map<msgId, expireSecAfterRead>. Senders register here until peerLastReadId
  // catches up, then we move the entry into burnTimersRef as a live timeout.
  const pendingSenderBurnRef = React.useRef(new Map());

  // ── helpers ───────────────────────────────────────────────
  const cleanupConnection = React.useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    // Tear down any in-flight WebRTC call; the relay session is gone, so the
    // peer connection has no chance of negotiating ICE renewal anyway.
    if (neeCallRef.current) {
      try { neeCallRef.current.destroy(); } catch {}
      neeCallRef.current = null;
    }
    setCallState('idle');
    setCallPeer(null);
    setCallMuted(false);
    setCallOnSpeaker(false);
    setCallError(null);
    if (callToastTimerRef.current) {
      clearTimeout(callToastTimerRef.current);
      callToastTimerRef.current = null;
    }
    setCallToast(null);
    // Revoke any blob object URLs we minted so the browser can free the
    // backing Blob memory. (Closures inside this callback can't reference
    // refs declared later in the component without a guard — null-check just
    // in case the cleanup fires before they exist.)
    try {
      if (blobUrlCacheRef && blobUrlCacheRef.current) {
        for (const url of blobUrlCacheRef.current.values()) {
          try { URL.revokeObjectURL(url); } catch {}
        }
        blobUrlCacheRef.current.clear();
      }
      if (blobUrlPromisesRef && blobUrlPromisesRef.current) blobUrlPromisesRef.current.clear();
      if (ownBlobBytesRef && ownBlobBytesRef.current) ownBlobBytesRef.current.clear();
    } catch {}
    aesKeyRef.current = null;
    myKeyPairRef.current = null;
    // Best-effort zero-fill of the ML-KEM-768 secret-key bytes before we drop
    // the reference. JS doesn't guarantee memory hygiene (GC may have already
    // copied), but for the live reference at least we overwrite. Wrapped in
    // try/catch because the secret object may have been torn down already.
    try {
      if (myKemKeypairRef.current
          && myKemKeypairRef.current.secretKey
          && myKemKeypairRef.current.secretKey.sk
          && typeof myKemKeypairRef.current.secretKey.sk.fill === 'function') {
        myKemKeypairRef.current.secretKey.sk.fill(0);
      }
    } catch {}
    myKemKeypairRef.current = null;
    // Zero-fill our own sender key bytes too — same best-effort policy.
    try {
      if (mySenderKeyRef.current && typeof mySenderKeyRef.current.fill === 'function') {
        mySenderKeyRef.current.fill(0);
      }
    } catch {}
    mySenderKeyRef.current = null;
    mySenderKeyEpochRef.current = 0;
    // Walk each peer entry and zero the shared-secret / sender-key bytes we
    // captured during the handshake before we drop the Map.
    try {
      for (const peer of peerKeysRef.current.values()) {
        if (!peer) continue;
        if (peer.kemShared && typeof peer.kemShared.fill === 'function') {
          try { peer.kemShared.fill(0); } catch {}
        }
        if (peer.senderKey && typeof peer.senderKey.fill === 'function') {
          try { peer.senderKey.fill(0); } catch {}
        }
        peer.kemShared = null;
        peer.senderKey = null;
      }
    } catch {}
    peerKeysRef.current = new Map();
    pendingDecryptRef.current = new Map();
    try {
      if (phraseKeyRawRef.current && typeof phraseKeyRawRef.current.fill === 'function') {
        phraseKeyRawRef.current.fill(0);
      }
    } catch {}
    phraseKeyRawRef.current = null;
    roomIdRef.current = '';
    currentEpochRef.current = 0;
    setCurrentEpoch(0);
    setSafetyFingerprint(null);
    setActiveHash(''); setMySlot(null);
    mySlotRef.current = null;
    setGroupMax(DEFAULT_GROUP_MAX);
    groupMaxRef.current = DEFAULT_GROUP_MAX;
    setSlots({ A: { claimed: false, sealed: false }, B: { claimed: false, sealed: false } });
    setPaired(false); setPairedAt(null);
    setCreatedAt(null); setExpiresAt(null);
    setPeerOnline(new Map());
    setPeerTyping(new Map());
    setMessages([]); setChatBanner(null);
    setConnStatus('live');
    setPeerLastReadIds(new Map());
    ackQueueRef.current = [];
    if (ackTimerRef.current) { clearTimeout(ackTimerRef.current); ackTimerRef.current = null; }
    try {
      if (burnTimersRef && burnTimersRef.current) {
        for (const t of burnTimersRef.current.values()) clearTimeout(t);
        burnTimersRef.current.clear();
      }
      if (pendingSenderBurnRef && pendingSenderBurnRef.current) pendingSenderBurnRef.current.clear();
    } catch {}
  }, []);

  const resetAll = React.useCallback((reason) => {
    cleanupConnection();
    setPassword(''); setJoinValue(''); setPhrase('');
    setTtlId('24h');
    setFlowError(null); setBusy(false);
    setExpiredReason(reason || null);
    setScreen(reason ? 'expired' : 'welcome');
    // Reset the per-room persistence pointer — the session is over from
    // this tab's perspective. We DO NOT touch Nee2PPersist itself (deviceKey
    // stays, savedRooms stays) so the user can return.
    persistedRoomIdRef.current = null;
    setRememberMe(false);
    // Refresh the saved-rooms list so WelcomeScreen reflects any room we
    // just forgot via the "close session forever" dialog.
    if (window.Nee2PPersist) {
      (async () => {
        try {
          const en = await window.Nee2PPersist.isEnabled();
          setPersistEnabled(!!en);
          if (en) {
            const now = Date.now();
            const rooms = (await window.Nee2PPersist.listRooms())
              .filter(r => r.expiresAt && r.expiresAt > now);
            setSavedRooms(rooms);
          } else {
            setSavedRooms([]);
          }
        } catch {}
      })();
    }
  }, [cleanupConnection]);

  // ack helper: batch acks every 200ms
  const queueAck = (id) => {
    ackQueueRef.current.push(id);
    if (ackTimerRef.current) return;
    ackTimerRef.current = setTimeout(() => {
      const ids = ackQueueRef.current;
      ackQueueRef.current = [];
      ackTimerRef.current = null;
      if (ids.length && wsRef.current) wsRef.current.send({ type: 'ack', ids });
    }, 200);
  };

  // remote deletion arriving via SSE / poll
  const ingestDelete = React.useCallback((id) => {
    setMessages(prev => prev.filter(m => m.id !== id));
    // Cancel any pending burn timer for this id — nothing left to burn.
    const t = burnTimersRef.current.get(id);
    if (t) { clearTimeout(t); burnTimersRef.current.delete(id); }
    pendingSenderBurnRef.current.delete(id);
  }, []);

  // Server-pushed reaction event from the peer. Applies the toggle authoritatively.
  // Declared above connectAndClaim because the onReact handler closes over it.
  // `fromSlot` is the wire-form slot id ('A'/'B'/number); we normalise to a
  // number for comparison against our own.
  const ingestReact = React.useCallback((msgId, emoji, fromSlot, op) => {
    if (!msgId || !emoji || fromSlot == null) return;
    const fromNum = coerceSlot(fromSlot);
    if (fromNum === null) return;
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const reactions = { ...(m.reactions || {}) };
      const list = Array.isArray(reactions[emoji]) ? reactions[emoji].slice() : [];
      // The reactions list on the wire mixes legacy letters and modern numbers
      // (since older 2-party servers send 'A'/'B'). Coerce everything to
      // numbers internally so toggle math doesn't trip over the format diff.
      const norm = list.map(s => coerceSlot(s)).filter(s => s !== null);
      let next;
      if (op === 'add') {
        next = norm.includes(fromNum) ? norm : [...norm, fromNum];
      } else {
        next = norm.filter(s => s !== fromNum);
      }
      if (next.length === 0) delete reactions[emoji];
      else reactions[emoji] = next;
      return { ...m, reactions };
    }));
  }, []);

  // Toggle a reaction on a message. PLAINTEXT metadata — the relay sees the
  // emoji and the msgId. Same tradeoff as replyTo / expireSecAfterRead. We
  // mutate local state OPTIMISTICALLY so the UI feels instant, then trust the
  // server-canonical {type:'react'} echo from the peer for everything else.
  // mySlot may be null briefly before claim resolves; we still wire send.
  const sendReaction = React.useCallback((msgId, emoji) => {
    if (!wsRef.current || !msgId || !emoji) return;
    wsRef.current.send({ type: 'react', msgId, emoji });
    const myNum = mySlot == null ? 0 : mySlot;
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const reactions = { ...(m.reactions || {}) };
      const list = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
      const norm = list.map(s => coerceSlot(s)).filter(s => s !== null);
      const had = norm.includes(myNum);
      const next = had ? norm.filter(s => s !== myNum) : [...norm, myNum];
      if (next.length === 0) delete reactions[emoji];
      else reactions[emoji] = next;
      return { ...m, reactions };
    }));
  }, [mySlot]);

  // Burn helpers — see the comment on burnTimersRef. Defined here (above
  // ingestMessage) so the closure binds them before ingestMessage runs.
  //
  // RECEIVER side: arm the moment a TTL msg lands AND the tab is focused (we
  // already mark-read on focus). On fire, drop the message locally AND tell
  // the peer to drop it too — covers the race where the sender had the tab
  // closed and never saw our read receipt to start their own timer.
  const maybeArmReceiverBurn = React.useCallback((msgId, fromSlot, ttlSec) => {
    if (!msgId || !ttlSec) return;
    // Only arm for msgs we received from any peer (not our own echoes).
    const fromNum = coerceSlot(fromSlot);
    if (fromNum === null || fromNum === mySlot) return;
    if (burnTimersRef.current.has(msgId)) return;
    // Defer the actual countdown until the tab is focused — that's when we'd
    // also fire the read receipt. If we're not focused, just stash the args
    // and (re)check on visibility/messages effect.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const t = setTimeout(() => {
      burnTimersRef.current.delete(msgId);
      setMessages(prev => prev.filter(m => m.id !== msgId));
      if (wsRef.current) {
        try { wsRef.current.send({ type: 'delete', id: msgId }); } catch {}
      }
    }, ttlSec * 1000);
    burnTimersRef.current.set(msgId, t);
  }, [mySlot]);

  // SENDER side: arm the moment we learn the peer has read our msg (the
  // peerLastReadId watcher in the effect below calls this).
  const maybeArmSenderBurn = React.useCallback((msgId, ttlSec) => {
    if (!msgId || !ttlSec) return;
    if (burnTimersRef.current.has(msgId)) return;
    const t = setTimeout(() => {
      burnTimersRef.current.delete(msgId);
      pendingSenderBurnRef.current.delete(msgId);
      // deleteMessage does the round-trip + local cleanup. Inline-equivalent
      // here so we don't capture a stale closure of deleteMessage.
      if (wsRef.current) {
        try { wsRef.current.send({ type: 'delete', id: msgId }); } catch {}
      }
      setMessages(prev => prev.filter(m => m.id !== msgId));
    }, ttlSec * 1000);
    burnTimersRef.current.set(msgId, t);
  }, []);

  // Pick the right key & decrypt fn for an incoming item. Three paths:
  //
  //   1. Sender-keys protocol (default for new clients): item carries
  //      senderKeyEpoch (or just `from` matches a peer we have a sender key
  //      for). Decrypt with that peer's cached sender key (32 raw bytes).
  //      If the sender key hasn't arrived yet → buffer for retry on the next
  //      `sender-key` ingest.
  //   2. Own echo (item.from === mySlot, for batch-on-restore): decrypt with
  //      our own sender key.
  //   3. Legacy fallback (old 2-party peer that hasn't been updated): use the
  //      per-epoch pairwise key for that peer's slot (held in
  //      peerKeysRef.get(from).pairwiseKey) — that's the same key we used to
  //      derive in v3-pre-group.
  //   4. Final fallback: phrase-only key (oldest clients before X25519).
  //
  // Returns one of:
  //   { kind: 'sender', bytes: Uint8Array }   — use Nee2PCrypto.decryptWithSenderKey
  //   { kind: 'subtle', key:  CryptoKey }     — use Nee2PCrypto.decrypt
  //   { kind: 'pending' }                     — buffer & wait
  //   null                                    — undecryptable (no key path)
  function pickKeyForItem(item) {
    const fromNum = coerceSlot(item.from);
    const mySlotNum = mySlotRef.current;

    // Path 2: own echo on history restore. We may have just regenerated
    // mySenderKey, so this only works for items from the current epoch.
    // Otherwise (older epoch) → undecryptable (forward secrecy by design).
    if (fromNum !== null && fromNum === mySlotNum) {
      if (mySenderKeyRef.current
          && typeof item.senderKeyEpoch === 'number'
          && item.senderKeyEpoch === mySenderKeyEpochRef.current) {
        return { kind: 'sender', bytes: mySenderKeyRef.current };
      }
      // No senderKeyEpoch tag → legacy own-msg from the pre-group epoch.
      // Try the pre-group epoch key for our own slot (kept as fallback).
      // If nothing matches, we surface a placeholder — losing our own old
      // sent text on reload is acceptable for ephemeral chats.
      if (aesKeyRef.current && typeof item.senderKeyEpoch !== 'number'
          && typeof item.epoch !== 'number') {
        return { kind: 'subtle', key: aesKeyRef.current };
      }
      return null;
    }

    // Path 1 & 3: from a peer.
    if (fromNum !== null) {
      const peer = peerKeysRef.current.get(fromNum);
      if (typeof item.senderKeyEpoch === 'number') {
        // Modern sender-keys path. Match epoch when we know what the peer's
        // current SK epoch is, but also try the cached key when the epoch
        // tag matches our cached `senderKeyEpoch`. We only ever cache one
        // sender key per peer (the latest one shipped to us).
        if (peer && peer.senderKey
            && (peer.senderKeyEpoch == null || peer.senderKeyEpoch === item.senderKeyEpoch)) {
          return { kind: 'sender', bytes: peer.senderKey };
        }
        return { kind: 'pending' };
      }
      // Legacy peer (no senderKeyEpoch). Use the pairwise key for this
      // peer & epoch (2-party clients before the group rollout shipped one
      // pairwise key per room-epoch).
      if (peer && peer.pairwiseKey
          && (typeof item.epoch !== 'number'
              || peer.pairwiseEpoch == null
              || peer.pairwiseEpoch === item.epoch)) {
        return { kind: 'subtle', key: peer.pairwiseKey };
      }
      // No key for this peer yet — buffer; the next pubkey / sender-key event
      // may unblock us. Same applies to legacy fallback (peer hasn't published
      // their pubKey yet on the new connection).
      return { kind: 'pending' };
    }

    // No `from` field at all (extremely old item) → fall back to phrase key.
    if (typeof item.epoch !== 'number' && aesKeyRef.current) {
      return { kind: 'subtle', key: aesKeyRef.current };
    }
    return null;
  }

  // ingestMessage is the gateway for every incoming msg. We may need to buffer
  // when the sender's sender-key hasn't arrived yet — that buffer lives in
  // pendingDecryptRef. Whenever a new sender-key is unwrapped we replay the
  // buffer for that slot.
  const ingestMessage = React.useCallback(async (item) => {
    const hasText = typeof item.ct === 'string' && item.ct.length > 0;
    const blob = item.blob && typeof item.blob === 'object' ? item.blob : null;
    const ttl = (item.expireSecAfterRead === 10 || item.expireSecAfterRead === 60 || item.expireSecAfterRead === 3600)
      ? item.expireSecAfterRead
      : null;
    // Reactions can arrive on the live `msg` event (always empty initially)
    // OR on a restore-batch (carries whatever state the relay knows).
    const reactions = (item.reactions && typeof item.reactions === 'object') ? item.reactions : {};
    const fromNum = coerceSlot(item.from);
    const pick = pickKeyForItem(item);

    if (pick && pick.kind === 'pending') {
      // Buffer until the sender-key arrives. De-dup by id so a replay doesn't
      // queue twice. If the room never gets the key (e.g. peer left before
      // distributing it), the message stays buffered until the room expires;
      // that's fine — better than a noisy placeholder we'd have to retract.
      if (fromNum === null) return;
      const list = pendingDecryptRef.current.get(fromNum) || [];
      if (!list.some(x => x.id === item.id)) {
        list.push(item);
        pendingDecryptRef.current.set(fromNum, list);
      }
      return;
    }

    if (!pick) {
      // Forward-secrecy placeholder: item came from an older epoch whose
      // key we no longer have (the ephemeral private was discarded). This
      // is the expected outcome after a reconnect that bumped the epoch.
      setMessages(prev => {
        if (prev.some(m => m.id === item.id)) return prev;
        return [...prev, {
          id: item.id, side: fromNum,
          text: '[зашифровано прежним ключом — недоступно]',
          time: item.time || nowHHMM(),
          // `at` is a CLIENT-side ingest timestamp (Date.now()) — used only by
          // ChatScreen for the cluster grouping + "10-minute gap" time-divider
          // UX. Not synced with the sender's actual clock (the wire format
          // doesn't carry an authoritative timestamp), so it's the moment of
          // arrival on THIS device. Good enough for reading-flow dividers,
          // not accurate enough for history reconstruction.
          at: Date.now(),
          replyTo: item.replyTo || null,
          blob: blob ? { ...blob, undecryptable: true } : null,
          undecryptable: true,
          expireSecAfterRead: ttl,
          reactions,
        }];
      });
      queueAck(item.id);
      if (ttl) maybeArmReceiverBurn(item.id, item.from, ttl);
      return;
    }

    try {
      let plainStr = '';
      if (hasText) {
        // Wire-format refactor: blob bubbles use `ivCt` (a separate iv for the
        // wrapper ciphertext) so the bytes-iv on `iv` stays free for blob
        // download decryption. Plain text bubbles still use the envelope iv.
        const ctIv = (typeof item.ivCt === 'string' && item.ivCt.length > 0)
          ? item.ivCt : item.iv;
        if (pick.kind === 'sender') {
          plainStr = await Nee2PCrypto.decryptWithSenderKey(pick.bytes, ctIv, item.ct);
        } else {
          plainStr = await Nee2PCrypto.decrypt(pick.key, ctIv, item.ct);
        }
      }
      // Wire-format refactor: decrypted plaintext may be either a JSON wrapper
      // `{text, time?, blobMeta?}` (new clients) or a plain string (legacy
      // clients that encrypted just the text). Probe JSON first and fall back.
      let text = '';
      let innerTime = null;
      let innerBlobMeta = null;
      if (plainStr) {
        let parsed = null;
        if (plainStr.length > 0 && plainStr.charCodeAt(0) === 0x7B /* '{' */) {
          try { parsed = JSON.parse(plainStr); } catch { parsed = null; }
        }
        if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
          text = parsed.text;
          if (typeof parsed.time === 'string') innerTime = parsed.time;
          if (parsed.blobMeta && typeof parsed.blobMeta === 'object') innerBlobMeta = parsed.blobMeta;
        } else {
          // Legacy: the whole plaintext IS the text.
          text = plainStr;
        }
      }
      // Merge any blob metadata that was inside the encrypted payload on top
      // of the envelope blob descriptor (which only carries routing-required
      // fields after the wire-format refactor: blobId/mime/size/kind/durationMs).
      let mergedBlob = blob;
      if (blob && innerBlobMeta) {
        mergedBlob = { ...blob };
        if (typeof innerBlobMeta.name === 'string') mergedBlob.name = innerBlobMeta.name;
        if (typeof innerBlobMeta.thumb === 'string') mergedBlob.thumb = innerBlobMeta.thumb;
        if (Array.isArray(innerBlobMeta.waveform)) mergedBlob.waveform = innerBlobMeta.waveform;
      }
      // Prefer the encrypted-inside time over the server-stamped envelope time
      // (which is only there for legacy compat). Fall back to item.time, then
      // local clock as a last resort.
      const displayTime = innerTime || item.time || nowHHMM();
      setMessages(prev => {
        if (prev.some(m => m.id === item.id)) return prev;
        return [...prev, {
          id: item.id, side: fromNum, text,
          time: displayTime,
          at: Date.now(),                    // client-side ingest ts; see comment above
          replyTo: item.replyTo || null,
          blob: mergedBlob || null,
          // Remember the iv + epoch so getBlobObjectURL can pick the same key
          // and iv the sender used to encrypt the blob ciphertext.
          _iv: mergedBlob ? item.iv : null,
          _epoch: typeof item.epoch === 'number' ? item.epoch : null,
          _senderKeyEpoch: typeof item.senderKeyEpoch === 'number' ? item.senderKeyEpoch : null,
          _from: fromNum,
          expireSecAfterRead: ttl,
          reactions,
        }];
      });
      queueAck(item.id);
      if (ttl) maybeArmReceiverBurn(item.id, item.from, ttl);
    } catch (err) {
      // AES-GCM tag mismatch — wrong key (e.g. picked the legacy pairwise key
      // for a sender-key msg from a freshly-rotated sender). Surface as
      // undecryptable so the user sees SOMETHING rather than a silent gap.
      setMessages(prev => {
        if (prev.some(m => m.id === item.id)) return prev;
        return [...prev, {
          id: item.id, side: fromNum,
          text: '[зашифровано прежним ключом — недоступно]',
          time: item.time || nowHHMM(),
          at: Date.now(),                    // client-side ingest ts; see comment above
          replyTo: item.replyTo || null,
          blob: blob ? { ...blob, undecryptable: true } : null,
          undecryptable: true,
          expireSecAfterRead: ttl,
          reactions,
        }];
      });
      queueAck(item.id);
      if (ttl) maybeArmReceiverBurn(item.id, item.from, ttl);
    }
  }, []);

  // Retry the buffered items for `slotNum` — called whenever we either land a
  // new sender-key for that peer OR derive a new pairwise key (legacy path).
  const replayPendingFor = React.useCallback(async (slotNum) => {
    if (slotNum === null || slotNum === undefined) return;
    const list = pendingDecryptRef.current.get(slotNum);
    if (!list || list.length === 0) return;
    pendingDecryptRef.current.delete(slotNum);
    for (const item of list) await ingestMessage(item);
  }, [ingestMessage]);

  // Stable ref to ingestMessage so callbacks declared earlier in the file
  // (e.g. recomputePairwiseKey's sk:N drain in FIX 11) can call the latest
  // version without re-creating themselves whenever ingestMessage changes.
  const ingestMessageRef = React.useRef(ingestMessage);
  React.useEffect(() => { ingestMessageRef.current = ingestMessage; }, [ingestMessage]);

  // ─── WebRTC call: signal ingest (owner: webrtc-calls) ───
  // Decrypt + dispatch a 'signal' wire envelope (WebRTC signalling). Mirrors
  // the key-selection of ingestMessage but never touches chat history.
  //
  // Race: a peer can ship a 'call-offer' BEFORE their sender-key has reached
  // us (sender-key + signal travel over the same channel and the latter can
  // land on a faster path). If we drop, the call hangs forever. Instead we
  // buffer under `sig:<fromSlot>` in pendingDecryptRef and replay from
  // applySenderKey when the key arrives. Symmetric race for legacy/pairwise.
  const ingestSignal = React.useCallback(async (item) => {
    if (!item || typeof item.iv !== 'string' || typeof item.ct !== 'string') return;
    const fromNum = coerceSlot(item.from);
    if (fromNum === null) return;
    if (fromNum === mySlotRef.current) return; // ignore self-echo (shouldn't happen)

    const bufferIt = () => {
      const k = `sig:${fromNum}`;
      const list = pendingDecryptRef.current.get(k) || [];
      list.push(item);
      pendingDecryptRef.current.set(k, list);
    };

    // Pick key: prefer peer's sender-key when tagged; else legacy pairwise key.
    let plainStr = '';
    try {
      if (typeof item.senderKeyEpoch === 'number') {
        const peer = peerKeysRef.current.get(fromNum);
        if (!peer || !peer.senderKey) { bufferIt(); return; }
        plainStr = await Nee2PCrypto.decryptWithSenderKey(peer.senderKey, item.iv, item.ct);
      } else {
        const peer = peerKeysRef.current.get(fromNum);
        if (peer && peer.pairwiseKey) {
          plainStr = await Nee2PCrypto.decrypt(peer.pairwiseKey, item.iv, item.ct);
        } else if (aesKeyRef.current) {
          plainStr = await Nee2PCrypto.decrypt(aesKeyRef.current, item.iv, item.ct);
        } else {
          bufferIt(); return;
        }
      }
    } catch (e) {
      // Decryption failed: keep the bytes in case a new sender-key bumps in.
      // (Wrong key with right shape will fail GCM auth tag check.)
      bufferIt();
      return;
    }
    let payload;
    try { payload = JSON.parse(plainStr); }
    catch { return; }
    if (!payload || typeof payload.kind !== 'string') return;

    // For incoming offers in 2-party mode we surface the caller slot to UI.
    if (payload.kind === 'call-offer') setCallPeer(fromNum);

    // Lazily instantiate NeeCall if it hasn't been created yet (callee path).
    const inst = (function () {
      if (neeCallRef.current) return neeCallRef.current;
      if (!window.NeeCall || !window.NeeCall.isSupported || !window.NeeCall.isSupported()) {
        // Tell the caller we can't accept — they'll see 'ended'.
        try { sendSignal({ kind: 'call-reject', reason: 'unsupported' }); } catch {}
        return null;
      }
      const created = window.NeeCall.create({
        sendSignal: (p) => { sendSignal(p); },
        onRemoteStream: () => {},
        onStateChange: (s) => { setCallState(s); },
        onError: (e) => {
          const code = (e && e.code) ? e.code : (e && e.message) ? e.message : 'call-error';
          setCallError(code);
          const toast = callToastForCode(code);
          if (toast) flashCallToast(toast);
        },
      });
      neeCallRef.current = created;
      return created;
    })();
    if (!inst) return;
    inst.handleSignal(payload);
  }, [sendSignal]);

  // Stable ref so applySenderKey can replay buffered signals without taking
  // ingestSignal as a dep (which would re-create the connectAndClaim closure
  // every time sendSignal does).
  const ingestSignalRef = React.useRef(ingestSignal);
  React.useEffect(() => { ingestSignalRef.current = ingestSignal; }, [ingestSignal]);

  // Replay buffered signals for `slotNum` (called from applySenderKey).
  const replayPendingSignalsFor = React.useCallback(async (slotNum) => {
    if (slotNum === null || slotNum === undefined) return;
    const k = `sig:${slotNum}`;
    const list = pendingDecryptRef.current.get(k);
    if (!list || list.length === 0) return;
    pendingDecryptRef.current.delete(k);
    for (const item of list) {
      try { await ingestSignalRef.current(item); } catch {}
    }
  }, []);

  // Get-or-create the per-peer state object held in peerKeysRef.
  function ensurePeer(slotNum) {
    let entry = peerKeysRef.current.get(slotNum);
    if (!entry) {
      entry = {};
      peerKeysRef.current.set(slotNum, entry);
    }
    return entry;
  }

  // Recompute the PAIRWISE key with peer `slotNum` for the current epoch.
  // Idempotent: same inputs → same key (within an epoch). Mixes our own
  // ephemeral X25519 + the peer's pubKey + phrase + (optional) PQ shared.
  // Stored on peerKeysRef[slot].pairwiseKey for the current epoch.
  const recomputePairwiseKey = React.useCallback(async (slotNum, epoch) => {
    if (!myKeyPairRef.current || !phraseKeyRawRef.current) return null;
    const peer = peerKeysRef.current.get(slotNum);
    if (!peer || !peer.pubKey) return null;
    try {
      const kemShared = peer.kemShared || null;
      const k = await Nee2PCrypto.derivePeerKey(
        myKeyPairRef.current.privKey,
        peer.pubKey,
        phraseKeyRawRef.current,
        roomIdRef.current,
        kemShared,
      );
      peer.pairwiseKey = k;
      peer.pairwiseEpoch = epoch;
      // FIX 11: drain any sender-key envelopes that arrived BEFORE the
      // pairwise key was ready. applySenderKey buffers under 'sk:N' but
      // replayPendingFor(N) only looks at the bare N key — so those entries
      // were stranded. Unwrap each one now and cache the most-recent SK per
      // peer (newer senderKeyEpoch wins). Drained on every pairwise refresh.
      const pendingKey = 'sk:' + slotNum;
      const pendingSks = pendingDecryptRef.current.get(pendingKey);
      if (pendingSks && pendingSks.length) {
        pendingDecryptRef.current.delete(pendingKey);
        for (const env of pendingSks) {
          try {
            const raw = await Nee2PCrypto.unwrapSenderKey(k, env.ivB64, env.ctB64);
            if (peer.senderKeyEpoch == null
                || typeof env.senderKeyEpoch !== 'number'
                || env.senderKeyEpoch >= peer.senderKeyEpoch) {
              peer.senderKey = raw;
              if (typeof env.senderKeyEpoch === 'number') peer.senderKeyEpoch = env.senderKeyEpoch;
            }
          } catch (e) {
            console.warn('drain unwrapSenderKey failed:', e && e.message ? e.message : e);
          }
        }
        // Now retry buffered MSGs from this peer — they may decrypt with
        // the freshly-cached sender key.
        try {
          const list = pendingDecryptRef.current.get(slotNum);
          if (list && list.length) {
            pendingDecryptRef.current.delete(slotNum);
            for (const item of list) await ingestMessageRef.current(item);
          }
        } catch {}
      }
      return k;
    } catch (e) {
      console.warn('derivePeerKey failed', e && e.message ? e.message : e);
      return null;
    }
  }, []);

  // Generate (or rotate) our sender key. Bumps mySenderKeyEpochRef so
  // receivers can tell when the rotation happened. Doesn't ship anything —
  // the caller is responsible for distributing the key to every peer (via
  // distributeSenderKeyToAll() or shipSenderKeyToPeer()).
  const rotateMySenderKey = React.useCallback(() => {
    mySenderKeyRef.current = Nee2PCrypto.generateSenderKey();
    mySenderKeyEpochRef.current += 1;
    return mySenderKeyEpochRef.current;
  }, []);

  // Ship our current sender key to `slotNum` wrapped under the pairwise key
  // for that peer. No-op if we have nothing to send or no key yet. Idempotent
  // per epoch — we mark peer.sentSenderKey so a flood of peer-pubkey events
  // doesn't trigger N duplicate sends.
  const shipSenderKeyToPeer = React.useCallback(async (slotNum, epoch) => {
    if (!wsRef.current) return;
    if (!mySenderKeyRef.current) return;
    const peer = peerKeysRef.current.get(slotNum);
    if (!peer || !peer.pairwiseKey) return;
    if (peer.sentSenderKey === epoch
        && peer.sentSenderKeyEpoch === mySenderKeyEpochRef.current) return;
    try {
      const env = await Nee2PCrypto.wrapSenderKey(peer.pairwiseKey, mySenderKeyRef.current);
      wsRef.current.send({
        type: 'sender-key',
        toSlot: slotForWire(slotNum, groupMaxRef.current),
        iv: env.iv, ct: env.ct,
        epoch,
        senderKeyEpoch: mySenderKeyEpochRef.current,
      });
      peer.sentSenderKey = epoch;
      peer.sentSenderKeyEpoch = mySenderKeyEpochRef.current;
    } catch (e) {
      console.warn('wrapSenderKey failed:', e && e.message ? e.message : e);
    }
  }, []);

  // Ship our current sender key to every peer we have a pairwise key with.
  const distributeSenderKeyToAll = React.useCallback(async (epoch) => {
    const slots = Array.from(peerKeysRef.current.keys());
    for (const s of slots) await shipSenderKeyToPeer(s, epoch);
  }, [shipSenderKeyToPeer]);

  // Recompute the safety-numbers fingerprints shown in the chat header modal.
  // Returns an Array of {slot, label, words, hex, hasKem} — one per peer we
  // currently have keys for. The modal renders tabs.
  const recomputeSafetyFingerprint = React.useCallback(async () => {
    const myPub = myKeyPairRef.current && myKeyPairRef.current.pubKey;
    if (!myPub) { setSafetyFingerprint(null); return; }
    const myKem = myKemKeypairRef.current && myKemKeypairRef.current.pubKey;
    const out = [];
    const gm = groupMaxRef.current;
    const slotsList = Array.from(peerKeysRef.current.entries())
      .filter(([, p]) => p && p.pubKey);
    slotsList.sort((a, b) => a[0] - b[0]);
    for (const [slotNum, peer] of slotsList) {
      try {
        const fp = await Nee2PCrypto.safetyNumber(
          myPub, myKem || null, peer.pubKey, peer.kemPub || null
        );
        out.push({
          slot: slotNum,
          label: slotLabel(slotNum, gm),
          friendly: friendlyName(roomIdRef.current, slotNum),
          words: fp.words,
          hex: fp.hex,
          hasKem: fp.hasKem,
        });
      } catch (e) {
        console.warn('safetyNumber failed for slot', slotNum, e && e.message ? e.message : e);
      }
    }
    setSafetyFingerprint(out.length ? out : null);
  }, []);

  // peer-pubkey event handler: store the peer's X25519 + KEM pubkey, derive
  // the pairwise key, then (because this is an epoch boundary — any pubkey
  // change bumps `epoch`) ROTATE our sender key and re-distribute to every
  // peer we know. Also kick off the KEM round-trip when the deterministic
  // initiator rule says we should.
  //
  // Initiator rule for KEM: the LOWER-NUMBERED slot encapsulates against the
  // higher-numbered slot's pubkey. Generalises slot-A-canonical from 2-party:
  // for each pair, exactly one side does encap and ships the ct, the other
  // waits for it. Symmetric so both arrive at the same shared.
  const applyPeerPubKey = React.useCallback(async (peerSlotId, peerPubB64, peerKemPubB64, epoch) => {
    if (typeof epoch !== 'number') return;
    const slotNum = coerceSlot(peerSlotId);
    if (slotNum === null) return;
    if (slotNum === mySlotRef.current) return;          // ignore self-echoes
    const peer = ensurePeer(slotNum);

    let changed = false;
    if (peerPubB64) {
      try {
        const buf = Nee2PCrypto.importPub(peerPubB64);
        if (!peer.pubKey || !sameBytes(peer.pubKey, buf)) { peer.pubKey = buf; changed = true; }
      } catch {}
    }
    if (peerKemPubB64) {
      try {
        const buf = Nee2PCrypto.importPub(peerKemPubB64);
        if (!peer.kemPub || !sameBytes(peer.kemPub, buf)) { peer.kemPub = buf; changed = true; }
      } catch {}
    }

    // Bump the room epoch tracker — currentEpoch is used to tag outbound
    // messages and to label sender-key distributions.
    if (epoch > currentEpochRef.current) {
      currentEpochRef.current = epoch;
      setCurrentEpoch(epoch);
      // First time we hit this epoch → rotate our own sender key so the new
      // joiner (or anyone whose pubkey changed) gets a fresh key tied to the
      // new HKDF. Skip if we haven't initialised one yet.
      if (mySenderKeyRef.current) rotateMySenderKey();
    } else if (!mySenderKeyRef.current) {
      // First sender key for this connection.
      rotateMySenderKey();
    }

    // First pass: derive the pre-quantum pairwise key so we can ship our SK
    // even before the KEM round-trip completes.
    await recomputePairwiseKey(slotNum, epoch);

    // Refresh the per-peer safety fingerprint.
    recomputeSafetyFingerprint();

    // KEM round-trip — generalised initiator rule (lower slot encaps).
    // FIX 10: set `peer.kemSentEpoch = epoch` AFTER a successful send. If
    // kemEncapsulate or the wire send throws, leaving the marker set would
    // permanently poison this peer/epoch (next applyPeerPubKey call early-
    // outs on the marker and never retries). Order now: encapsulate → store
    // shared → recompute pairwise → send → THEN mark the epoch as shipped.
    const iAmInitiator = mySlotRef.current !== null && mySlotRef.current < slotNum;
    if (iAmInitiator
        && myKemKeypairRef.current
        && peer.kemPub
        && wsRef.current
        && peer.kemSentEpoch !== epoch) {
      try {
        const { sharedSecret, ct } = await Nee2PCrypto.kemEncapsulate(peer.kemPub);
        peer.kemShared = sharedSecret;
        await recomputePairwiseKey(slotNum, epoch);
        const ctB64 = Nee2PCrypto.exportPub(ct);
        wsRef.current.send({
          type: 'kem-ct',
          toSlot: slotForWire(slotNum, groupMaxRef.current),
          ct: ctB64, epoch,
        });
        peer.kemSentEpoch = epoch;
      } catch (e) {
        console.warn('kem encapsulate failed:', e && e.message ? e.message : e);
      }
    }

    // Ship our current sender key to this peer (now that we have a pairwise
    // key with them). If `changed` we also re-replay any buffered messages —
    // even if their sender-key has not arrived yet, a legacy-pairwise msg may
    // become decryptable now.
    await shipSenderKeyToPeer(slotNum, epoch);
    if (changed) await replayPendingFor(slotNum);

    // Persistence — if this room has an existing persisted record, refresh it
    // with the new sessionKey + epoch so the SW can decrypt push payloads from
    // the latest epoch. No-op when persistence isn't enabled for this device
    // OR when this room was never persisted (the user didn't tick "remember
    // me" on Create/Join). We pull phrase/password from the live record
    // already in IDB so we don't need to plumb them through every callsite.
    try {
      if (persistedRoomIdRef.current === roomIdRef.current && window.Nee2PPersist) {
        const existing = await window.Nee2PPersist.load(roomIdRef.current);
        if (existing) {
          const sessionKey = await _wrappedSessionKeyForPersist();
          await window.Nee2PPersist.save({
            roomId:     roomIdRef.current,
            slot:       mySlotRef.current == null ? 0 : mySlotRef.current,
            phrase:     existing.phrase,
            password:   existing.password,
            sessionKey,
            epoch:      currentEpochRef.current || 0,
            groupMax:   groupMaxRef.current || DEFAULT_GROUP_MAX,
            ttlMs:      existing.ttlMs || 0,
            expiresAt:  existing.expiresAt || 0,
          });
        }
      }
    } catch {}
  }, [recomputePairwiseKey, recomputeSafetyFingerprint, rotateMySenderKey,
      shipSenderKeyToPeer, replayPendingFor]);

  // kem-ct event handler. Only meaningful for the deterministic NON-initiator
  // (higher slot number). Decapsulate, store shared, recompute pairwise key,
  // re-ship our sender key (now over the upgraded PQ pairwise key), replay
  // any buffered msgs that might decrypt now.
  const applyKemCt = React.useCallback(async (ctB64, fromSlotId, epoch) => {
    if (typeof epoch !== 'number') return;
    if (!myKemKeypairRef.current) return;
    const fromNum = coerceSlot(fromSlotId);
    if (fromNum === null || fromNum === mySlotRef.current) return;
    // Only the higher slot consumes ct (lower slot initiated).
    if (mySlotRef.current !== null && mySlotRef.current < fromNum) return;
    const peer = ensurePeer(fromNum);
    try {
      const ct = Nee2PCrypto.importPub(ctB64);
      const shared = await Nee2PCrypto.kemDecapsulate(myKemKeypairRef.current.secretKey, ct);
      peer.kemShared = shared;
      await recomputePairwiseKey(fromNum, epoch);
      // Replay any buffered legacy-pairwise msgs.
      await replayPendingFor(fromNum);
      // Pairwise just upgraded pre-PQ → PQ-augmented. Our previous ship
      // (in applyPeerPubKey, before KEM ct arrived) was wrapped under the
      // pre-PQ pairwise, which the peer cannot unwrap because their pairwise
      // for us is the PQ-augmented version. Invalidate the dedup marker so
      // the guard in shipSenderKeyToPeer doesn't block the PQ re-ship.
      peer.sentSenderKey = null;
      peer.sentSenderKeyEpoch = null;
      // Re-ship our sender key now that we have a PQ-upgraded pairwise key.
      await shipSenderKeyToPeer(fromNum, epoch);
    } catch (e) {
      console.warn('kem decapsulate failed:', e && e.message ? e.message : e);
    }
  }, [recomputePairwiseKey, replayPendingFor, shipSenderKeyToPeer]);

  // sender-key event handler. Decrypt the wrapped key with our pairwise key
  // for the sender, cache it, and replay any buffered msgs from that slot.
  const applySenderKey = React.useCallback(async (fromSlotId, ivB64, ctB64, senderKeyEpoch, epoch) => {
    const fromNum = coerceSlot(fromSlotId);
    if (fromNum === null || fromNum === mySlotRef.current) return;
    const peer = ensurePeer(fromNum);
    if (!peer.pairwiseKey) {
      // We don't have a pairwise key for this peer yet (probably a race —
      // their pubkey hasn't been processed). Buffer the envelope and retry
      // when the pairwise key lands. We piggyback on pendingDecryptRef by
      // namespacing under a synthetic id.
      const pendingKey = '__sender_key__';
      const list = pendingDecryptRef.current.get(`sk:${fromNum}`) || [];
      list.push({ ivB64, ctB64, senderKeyEpoch, epoch });
      pendingDecryptRef.current.set(`sk:${fromNum}`, list);
      return;
    }
    try {
      const raw = await Nee2PCrypto.unwrapSenderKey(peer.pairwiseKey, ivB64, ctB64);
      // Only accept newer epochs (de-dup on retransmits / stale buffered).
      if (peer.senderKeyEpoch == null
          || typeof senderKeyEpoch !== 'number'
          || senderKeyEpoch >= peer.senderKeyEpoch) {
        peer.senderKey = raw;
        if (typeof senderKeyEpoch === 'number') peer.senderKeyEpoch = senderKeyEpoch;
        await replayPendingFor(fromNum);
        // Also drain any buffered WebRTC signals from this peer — they were
        // held back because we didn't have their sender-key yet.
        await replayPendingSignalsFor(fromNum);
      }
    } catch (e) {
      // Unwrap failed — most likely because our pairwise key changed
      // between the sender's wrap and our unwrap (pre-PQ ↔ PQ transition
      // during the KEM round-trip). Buffer the envelope under 'sk:N' so
      // the FIX 11 drain in recomputePairwiseKey can retry it the next
      // time our pairwise refreshes.
      const list = pendingDecryptRef.current.get(`sk:${fromNum}`) || [];
      list.push({ ivB64, ctB64, senderKeyEpoch, epoch });
      pendingDecryptRef.current.set(`sk:${fromNum}`, list);
      console.warn('unwrapSenderKey failed:', e && e.message ? e.message : e);
    }
  }, [replayPendingFor, replayPendingSignalsFor]);

  // Tiny byte-equality helper for the pubKey/kemPub change-detection above.
  function sameBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ── persistence helpers ───────────────────────────────────
  //
  // Wrap our current sender-key bytes as a NON-EXTRACTABLE AES-GCM CryptoKey
  // so the SW (push.js handler) can call crypto.subtle.decrypt() against push
  // payloads without ever holding the raw bytes. The key is structured-clone-
  // copied into IndexedDB by Nee2PPersist.save(). Returns null when there's no
  // current sender key (e.g. we're in legacy phrase-only mode).
  async function _wrappedSessionKeyForPersist() {
    const raw = mySenderKeyRef.current;
    if (raw && raw.length === 32) {
      try {
        return await crypto.subtle.importKey(
          'raw', raw, { name: 'AES-GCM', length: 256 },
          /*extractable*/ false, ['decrypt']
        );
      } catch (e) {
        console.warn('persistence: import sender key failed:', e && e.message);
      }
    }
    // Legacy fallback — phrase-derived AES key. Already non-extractable from
    // crypto.js's deriveKey(). Pass it through directly.
    if (aesKeyRef.current) return aesKeyRef.current;
    return null;
  }

  // Persist the current room snapshot. Pulls phrase/password/slot/epoch from
  // the live refs; the only argument is the original phrase string (whatever
  // the user typed) and the password — both need to be the ORIGINALS so the
  // restore path can re-derive the session from scratch via deriveKey +
  // passwordSlotHash. Idempotent: safe to call on every epoch bump.
  const persistSessionSnapshot = React.useCallback(async (phraseStr, pwdStr, ttlMs) => {
    if (!window.Nee2PPersist) return false;
    const enabled = await window.Nee2PPersist.isEnabled();
    if (!enabled) return false;
    const sessionKey = await _wrappedSessionKeyForPersist();
    const roomId = roomIdRef.current;
    if (!roomId) return false;
    const ok = await window.Nee2PPersist.save({
      roomId,
      slot:       mySlotRef.current == null ? 0 : mySlotRef.current,
      phrase:     phraseStr || '',
      password:   pwdStr || '',
      sessionKey,
      epoch:      currentEpochRef.current || 0,
      groupMax:   groupMaxRef.current || DEFAULT_GROUP_MAX,
      ttlMs:      typeof ttlMs === 'number' ? ttlMs : 0,
      expiresAt:  typeof expiresAt === 'number' ? expiresAt : 0,
    });
    if (ok) persistedRoomIdRef.current = roomId;
    return ok;
  }, [expiresAt]);

  // Forget the persisted record for a specific room. Used by:
  //   • the "close session forever" confirm dialog,
  //   • the room-expired handler.
  // Keeps the deviceKey intact — only removes this one session.
  const forgetSessionRecord = React.useCallback(async (roomId) => {
    if (!window.Nee2PPersist) return false;
    const id = roomId || roomIdRef.current;
    if (!id) return false;
    const ok = await window.Nee2PPersist.forget(id);
    if (persistedRoomIdRef.current === id) persistedRoomIdRef.current = null;
    return ok;
  }, []);

  // open WS + claim. Returns the claim-result message.
  const connectAndClaim = React.useCallback(async (hash, pwd, opts = {}) => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    const derived = await Nee2PCrypto.deriveKey(hash);
    aesKeyRef.current = derived.key;
    phraseKeyRawRef.current = derived.rawBytes;
    roomIdRef.current = hash;
    const passwordHash = await Nee2PCrypto.passwordSlotHash(hash, pwd);

    // Generate the ephemeral X25519 keypair for this connection. If the
    // X25519 stack is unavailable (no Subtle, no CDN libs loaded) we fall
    // through to phrase-only mode by omitting pubKey from the claim — the
    // server treats that as a legacy client.
    let pubKeyB64 = null;
    try {
      const kp = await Nee2PCrypto.generateEphemeralKeypair();
      myKeyPairRef.current = kp;
      pubKeyB64 = Nee2PCrypto.exportPub(kp.pubKey);
    } catch (e) {
      console.warn('X25519 unavailable, falling back to phrase-only encryption:', e && e.message ? e.message : e);
      myKeyPairRef.current = null;
    }

    // Generate the per-connection ML-KEM-768 keypair (post-quantum hybrid).
    // Same graceful-degradation policy: if mlkem fails to load the claim
    // still proceeds and the session uses pre-quantum X25519+phrase only.
    let kemPubKeyB64 = null;
    try {
      const kkp = await Nee2PCrypto.generateKemKeypair();
      myKemKeypairRef.current = kkp;
      kemPubKeyB64 = Nee2PCrypto.exportPub(kkp.pubKey);
    } catch (e) {
      console.warn('ML-KEM-768 unavailable, falling back to pre-quantum hybrid:', e && e.message ? e.message : e);
      myKemKeypairRef.current = null;
    }

    // Generate our SENDER KEY upfront so we can ship it the moment peer-pubkey
    // events land. mySenderKeyEpoch starts at 1 (rotateMySenderKey bumps it).
    rotateMySenderKey();

    // Inbound event processing is serialized through this promise chain so
    // that a peer-pubkey event (which derives the session key asynchronously)
    // always settles before the following sender-key / msg-batch / msg events
    // try to decrypt. Without this gate, the first restore would render a
    // screen full of "[зашифровано прежним ключом — недоступно]" placeholders
    // even though the key was about to land milliseconds later.
    let workQueue = Promise.resolve();
    const enqueue = (fn) => { workQueue = workQueue.then(fn, fn).catch(() => {}); };

    return await new Promise((resolve) => {
      let resolved = false;
      const claimRequest = { type: 'claim', passwordHash };
      if (opts.ttlMs)      claimRequest.ttlMs      = opts.ttlMs;
      if (opts.groupMax)   claimRequest.groupMax   = opts.groupMax;
      if (pubKeyB64)       claimRequest.pubKey     = pubKeyB64;
      if (kemPubKeyB64)    claimRequest.kemPubKey  = kemPubKeyB64;

      const client = Nee2PWS.createClient({
        room: hash,
        handlers: {
          onOpen: () => {
            client.send(claimRequest);
          },
          onClaimResult: (m) => {
            // Immediately seed peerKeysRef from the peers[] roster so we can
            // start the pairwise-key derivation + sender-key shipping the
            // moment the room is up — instead of waiting for individual
            // peer-pubkey events. The peer-pubkey events still fire and are
            // idempotent (applyPeerPubKey early-outs when nothing changed).
            if (m && m.ok && Array.isArray(m.peers)) {
              const gm = typeof m.groupMax === 'number' ? m.groupMax : DEFAULT_GROUP_MAX;
              const myNum = coerceSlot(m.slot);
              mySlotRef.current = myNum;
              groupMaxRef.current = gm;
              const epoch = typeof m.epoch === 'number' ? m.epoch : 0;
              if (epoch > currentEpochRef.current) currentEpochRef.current = epoch;
              enqueue(async () => {
                for (const p of m.peers) {
                  await applyPeerPubKey(p.slot, p.pubKey, p.kemPubKey, epoch);
                }
              });
            }
            // 2-party legacy fields: server still emits peerPubKey for old
            // clients. Route through the same handler so the peer at the OTHER
            // 2-party slot gets seeded.
            if (m && m.ok && m.peerPubKey
                && (!Array.isArray(m.peers) || m.peers.length === 0)) {
              const myNum = coerceSlot(m.slot);
              const peerNum = myNum === 0 ? 1 : 0;
              const epoch = typeof m.epoch === 'number' ? m.epoch : 0;
              mySlotRef.current = myNum;
              groupMaxRef.current = 2;
              if (epoch > currentEpochRef.current) currentEpochRef.current = epoch;
              enqueue(() => applyPeerPubKey(peerNum, m.peerPubKey, m.peerKemPubKey, epoch));
            }
            if (!resolved) { resolved = true; resolve(m); }
          },
          onRoomState: (m) => {
            // informational only — we'll get claim-result after our claim
            if (m.exists) {
              setCreatedAt(m.createdAt);
              setExpiresAt(m.expiresAt);
              setSlots(m.slots);
              setPaired(!!m.paired);
              if (typeof m.groupMax === 'number') {
                setGroupMax(m.groupMax);
                groupMaxRef.current = m.groupMax;
              }
            }
          },
          onPeerState: (m) => {
            setSlots(m.slots);
            setPaired(!!m.paired);
          },
          onPaired: (m) => {
            setPaired(true);
            setPairedAt(m.pairedAt);
          },
          onPeerOnline: (m) => {
            const slotNum = coerceSlot(m.peer);
            if (slotNum === null) return;
            setPeerOnline(prev => {
              const next = new Map(prev);
              next.set(slotNum, !!m.online);
              return next;
            });
            if (!m.online) {
              setPeerTyping(prev => {
                if (!prev.get(slotNum)) return prev;
                const next = new Map(prev);
                next.set(slotNum, false);
                return next;
              });
            }
          },
          onPeerPubkey: (m) => {
            // Derive a new pairwise key for this epoch & ship our sender key.
            // Serialized so any following msg/msg-batch waits.
            enqueue(() => applyPeerPubKey(m.peer, m.pubKey, m.kemPubKey, m.epoch));
          },
          onKemCt: (m) => {
            // Post-quantum: peer (initiator slot) shipped ML-KEM ciphertext.
            // Decap → store shared → recompute pairwise → reship sender key.
            enqueue(() => applyKemCt(m.ct, m.from, m.epoch));
          },
          onSenderKey: (m) => {
            // Group chat: peer shipped their AES sender key wrapped under our
            // pairwise key. Unwrap → cache → replay buffered msgs from them.
            enqueue(() => applySenderKey(m.from, m.iv, m.ct, m.senderKeyEpoch, m.epoch));
          },
          onSignal: (m) => {
            // WebRTC signalling envelope from a peer. Decrypt with the right
            // sender key (mirrors ingestMessage's pickKeyForItem path) and
            // hand to NeeCall.
            enqueue(() => ingestSignal(m));
          },
          onMsg: (m) => { enqueue(() => ingestMessage(m)); },
          onMsgBatch: (m) => {
            if (!Array.isArray(m.items)) return;
            enqueue(async () => {
              for (const it of m.items) await ingestMessage(it);
            });
          },
          onTyping: (m) => {
            // Legacy 2-party: no `from` field. Map to peerSlot for that case.
            let slotNum = coerceSlot(m.from);
            if (slotNum === null && groupMaxRef.current === 2 && mySlotRef.current !== null) {
              slotNum = mySlotRef.current === 0 ? 1 : 0;
            }
            if (slotNum === null) return;
            setPeerTyping(prev => {
              const next = new Map(prev);
              next.set(slotNum, !!m.on);
              return next;
            });
          },
          onMsgDelete: (m) => { ingestDelete(m.id); },
          onRead: (m) => {
            if (!m.upto) return;
            let slotNum = coerceSlot(m.peer);
            if (slotNum === null && groupMaxRef.current === 2 && mySlotRef.current !== null) {
              slotNum = mySlotRef.current === 0 ? 1 : 0;
            }
            if (slotNum === null) return;
            setPeerLastReadIds(prev => {
              const next = new Map(prev);
              next.set(slotNum, m.upto);
              return next;
            });
          },
          onReact: (m) => { ingestReact(m.msgId, m.emoji, m.from, m.op); },
          onRoomExpired: () => {
            // Drop the persisted record (if any) — the room is gone server-side
            // and nothing we have can re-enter it. Best-effort: forget() swallows
            // IDB errors. Then continue with the existing reset/expired flow.
            try { forgetSessionRecord(roomIdRef.current); } catch {}
            resetAll('Таймер обнулился. Все сообщения и ключи стёрты.');
          },
          onConnectionStatus: (state) => { setConnStatus(state); },
          onClose: () => {
            if (!resolved) { resolved = true; resolve({ ok: false, reason: 'closed' }); }
          },
          onError: () => {
            if (!resolved) { resolved = true; resolve({ ok: false, reason: 'error' }); }
          },
        },
      });
      wsRef.current = client;
    });
  }, [ingestMessage, ingestDelete, ingestReact, ingestSignal, resetAll,
      applyPeerPubKey, applyKemCt, applySenderKey, rotateMySenderKey,
      forgetSessionRecord]);

  // ── flow actions ──────────────────────────────────────────
  const goCreate = () => {
    cleanupConnection();
    setFlowError(null);
    setPassword('');
    setPhrase('');
    setTtlId('24h');
    setCreateGroupMax(DEFAULT_GROUP_MAX);
    setScreen('created');
  };

  const goJoin = () => {
    cleanupConnection();
    setFlowError(null);
    setPassword('');
    setJoinValue('');
    setScreen('join');
  };

  // Pivot from Join → Create with the typed phrase carried over. Triggered
  // when the live /r/peek probe on JoinScreen reports the room doesn't exist:
  // we offer the user to create it instead of silently turning the "join"
  // click into a creation. Password from Join is dropped — they'll pick a new
  // one (and TTL / group size) on CreatedScreen.
  const goCreateWithPhrase = React.useCallback((typed) => {
    cleanupConnection();
    setFlowError(null);
    setPassword('');
    setPhrase((typed || '').trim().toLowerCase());
    setTtlId('24h');
    setCreateGroupMax(DEFAULT_GROUP_MAX);
    setScreen('created');
  }, []);

  const goInfo = () => setScreen('info');
  const backToWelcome = () => resetAll();

  // Restore a specific saved room (from the WelcomeScreen multi-room list).
  // Same code path as the single-room auto-restore — just driven by user tap.
  const restoreSavedRoom = React.useCallback(async (roomId) => {
    if (!window.Nee2PPersist || busy) return;
    const rec = await window.Nee2PPersist.load(roomId);
    if (!rec || !rec.phrase || !rec.password) return;
    setJoinValue(rec.phrase);
    setPassword(rec.password);
    setRememberMe(true);
    setBusy(true);
    const r = await connectAndClaim(roomId, rec.password);
    setBusy(false);
    if (!r.ok) {
      await window.Nee2PPersist.forget(roomId);
      setSavedRooms(prev => prev.filter(x => x.roomId !== roomId));
      return;
    }
    setActiveHash(roomId);
    const myNum = coerceSlot(r.slot);
    setMySlot(myNum);
    mySlotRef.current = myNum;
    const gm = typeof r.groupMax === 'number' ? r.groupMax : DEFAULT_GROUP_MAX;
    setGroupMax(gm);
    groupMaxRef.current = gm;
    if (r.slots) setSlots(r.slots);
    if (r.createdAt) setCreatedAt(r.createdAt);
    if (r.expiresAt) setExpiresAt(r.expiresAt);
    setPaired(!!r.paired);
    persistedRoomIdRef.current = roomId;
    setScreen('chat');
    await persistSessionSnapshot(rec.phrase, rec.password, rec.ttlMs);
  }, [busy, connectAndClaim, persistSessionSnapshot]);

  const submitCreate = async () => {
    if (!createHash || password.length < 4 || busy) return;
    setBusy(true); setFlowError(null);
    let r;
    try {
      r = await connectAndClaim(createHash, password, {
        ttlMs,
        groupMax: createGroupMax,
      });
    } catch (e) {
      setBusy(false);
      setFlowError('Не удалось создать сессию. Попробуй ещё раз.');
      console.error('submitCreate error:', e);
      return;
    }
    setBusy(false);
    if (!r.ok) {
      setFlowError(r.reason === 'locked'
        ? 'Эту фразу уже использует другая группа. Возьми другую.'
        : (r.reason === 'groupMax-mismatch'
            ? 'По этой фразе уже есть комната с другим размером группы.'
            : 'Не удалось создать сессию.'));
      return;
    }
    setActiveHash(createHash);
    const myNum = coerceSlot(r.slot);
    setMySlot(myNum);
    mySlotRef.current = myNum;
    const gm = typeof r.groupMax === 'number' ? r.groupMax : DEFAULT_GROUP_MAX;
    setGroupMax(gm);
    groupMaxRef.current = gm;
    if (r.slots) setSlots(r.slots);
    if (r.createdAt) setCreatedAt(r.createdAt);
    if (r.expiresAt) setExpiresAt(r.expiresAt);
    setPaired(!!r.paired);
    setScreen('chat');
    // Persistence: opt-in. If the user ticked "remember me", enable() the
    // device (idempotent — first call generates the deviceKey) then save the
    // session snapshot. Subsequent epoch bumps refresh the sessionKey via
    // applyPeerPubKey. Store the ORIGINAL phrase (or the auto-seed if user
    // didn't supply one) so the restore path can re-derive everything.
    if (rememberMe && window.Nee2PPersist) {
      try {
        const enabledOk = await window.Nee2PPersist.enable();
        if (enabledOk) {
          const original = (phrase || '').trim().toLowerCase();
          await persistSessionSnapshot(original, password, ttlMs);
          setPersistEnabled(true);
        }
      } catch (e) { console.warn('persist on create failed:', e && e.message); }
    }
  };

  const submitJoin = async () => {
    if (!joinHash || password.length < 4 || busy) return;
    setBusy(true); setFlowError(null);
    let r;
    try {
      r = await connectAndClaim(joinHash, password);
    } catch (e) {
      setBusy(false);
      setFlowError('Не удалось подключиться. Попробуй ещё раз.');
      console.error('submitJoin error:', e);
      return;
    }
    setBusy(false);
    if (!r.ok) {
      if (r.reason === 'locked') setScreen('locked');
      else setFlowError('Не удалось подключиться. Проверь фразу и пароль.');
      return;
    }
    setActiveHash(joinHash);
    const myNum = coerceSlot(r.slot);
    setMySlot(myNum);
    mySlotRef.current = myNum;
    const gm = typeof r.groupMax === 'number' ? r.groupMax : DEFAULT_GROUP_MAX;
    setGroupMax(gm);
    groupMaxRef.current = gm;
    if (r.slots) setSlots(r.slots);
    if (r.createdAt) setCreatedAt(r.createdAt);
    if (r.expiresAt) setExpiresAt(r.expiresAt);
    setPaired(!!r.paired);
    setScreen('chat');
    if (rememberMe && window.Nee2PPersist) {
      try {
        const enabledOk = await window.Nee2PPersist.enable();
        if (enabledOk) {
          // For Join we don't know the original phrase string when the user
          // pasted a 32-char hash; in that case we store the hash itself,
          // because that's also a valid input on the JoinScreen.
          await persistSessionSnapshot(joinValue, password,
            (r.expiresAt && r.createdAt) ? (r.expiresAt - r.createdAt) : 0);
          setPersistEnabled(true);
        }
      } catch (e) { console.warn('persist on join failed:', e && e.message); }
    }
  };

  const enterChat = () => setScreen('chat');

  // when paired transitions, route the user
  React.useEffect(() => {
    if (!paired) return;
    if (screen === 'waiting') setScreen('chat');
  }, [paired, screen]);

  const sendMessage = async (text, optsOrReplyTo) => {
    if (!wsRef.current) return;
    // Backward-compat: old callsites pass a string replyTo as 2nd arg. Treat
    // a string as legacy replyTo; an object as the new opts bag.
    let replyTo = null;
    let expireSecAfterRead = null;
    if (typeof optsOrReplyTo === 'string') {
      replyTo = optsOrReplyTo;
    } else if (optsOrReplyTo && typeof optsOrReplyTo === 'object') {
      if (typeof optsOrReplyTo.replyTo === 'string') replyTo = optsOrReplyTo.replyTo;
      if (optsOrReplyTo.ttlSecAfterRead === 10
          || optsOrReplyTo.ttlSecAfterRead === 60
          || optsOrReplyTo.ttlSecAfterRead === 3600) {
        expireSecAfterRead = optsOrReplyTo.ttlSecAfterRead;
      }
    }
    // Encrypt with OUR sender key (group-chat default). Receivers look up the
    // sender's cached SK by `from` and decrypt; fallback to legacy phrase-only
    // if we never got an SK initialised (shouldn't happen after claim).
    const sk = mySenderKeyRef.current;
    if (!sk && !aesKeyRef.current) return;
    // Wire-format refactor: encrypt a JSON wrapper `{text, time}` instead of
    // the raw text so the relay no longer sees the HH:MM client clock (which
    // leaks the sender's timezone). The receiver tries JSON.parse first and
    // falls back to a plain string for legacy peers.
    const time = nowHHMM();
    const plaintextWrapped = JSON.stringify({ text: String(text == null ? '' : text), time });
    let iv, ct;
    let senderKeyEpoch = null;
    if (sk) {
      const enc = await Nee2PCrypto.encryptWithSenderKey(sk, plaintextWrapped);
      iv = enc.iv; ct = enc.ct;
      senderKeyEpoch = mySenderKeyEpochRef.current;
    } else {
      const enc = await Nee2PCrypto.encrypt(aesKeyRef.current, plaintextWrapped);
      iv = enc.iv; ct = enc.ct;
    }
    const id = 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    // Note: `time` is NOT sent in the envelope anymore — it lives inside the
    // encrypted JSON. Server stamps its own `time` on receive for legacy peers.
    const payload = { type: 'msg', iv, ct, id };
    if (senderKeyEpoch !== null) payload.senderKeyEpoch = senderKeyEpoch;
    if (replyTo) payload.replyTo = replyTo;
    if (expireSecAfterRead) payload.expireSecAfterRead = expireSecAfterRead;
    wsRef.current.send(payload);
    const local = { id, side: mySlot, text, time };
    if (replyTo) local.replyTo = replyTo;
    if (expireSecAfterRead) {
      local.expireSecAfterRead = expireSecAfterRead;
      pendingSenderBurnRef.current.set(id, expireSecAfterRead);
    }
    local.at = Date.now();                  // client-side ingest ts (see ingestMessage)
    setMessages(prev => [...prev, local]);
  };

  // ─── WebRTC call: signalling out (owner: webrtc-calls) ───
  // Encrypt + send a signalling payload (offer/answer/ICE/etc.) through the
  // same group sender-key the chat uses. Server stores nothing; broadcast only.
  const sendSignal = React.useCallback(async (payload) => {
    if (!wsRef.current) return;
    const sk = mySenderKeyRef.current;
    if (!sk && !aesKeyRef.current) return;
    let iv, ct, senderKeyEpoch = null;
    const plaintext = JSON.stringify(payload || {});
    try {
      if (sk) {
        const enc = await Nee2PCrypto.encryptWithSenderKey(sk, plaintext);
        iv = enc.iv; ct = enc.ct;
        senderKeyEpoch = mySenderKeyEpochRef.current;
      } else {
        const enc = await Nee2PCrypto.encrypt(aesKeyRef.current, plaintext);
        iv = enc.iv; ct = enc.ct;
      }
    } catch (e) {
      console.warn('signal encrypt failed:', e && e.message);
      return;
    }
    const wireMsg = { type: 'signal', iv, ct };
    if (senderKeyEpoch !== null) wireMsg.senderKeyEpoch = senderKeyEpoch;
    try { wsRef.current.send(wireMsg); } catch {}
  }, []);

  // ─── WebRTC call orchestration: peer-event toast copy (owner: webrtc-calls, i18n-wrapped) ───
  // Map a structured NeeCall error code → optional toast text. Returns null
  // when the code is best left to the overlay (e.g. ice-failed stays in the
  // overlay, doesn't pop a toast).
  const callToastForCode = (code) => {
    const tr = window.Nee2Pi18n && window.Nee2Pi18n.t;
    if (!tr) return null;
    if (code === 'peer-rejected')    return tr('call.toast.peer_rejected');
    if (code === 'peer-ended')       return tr('call.toast.peer_ended');
    if (code === 'peer-busy')        return tr('call.toast.peer_busy');
    if (code === 'peer-unsupported') return tr('call.toast.peer_unsupported');
    if (code === 'peer-missed')      return tr('call.toast.peer_missed');
    if (code === 'timeout')          return tr('call.toast.timeout');
    return null;
  };

  // Lazily instantiate NeeCall on first need. We don't create it eagerly so a
  // user who never opens a call doesn't pay the RTCPeerConnection import cost.
  const getNeeCall = React.useCallback(() => {
    if (neeCallRef.current) return neeCallRef.current;
    if (!window.NeeCall || !window.NeeCall.isSupported || !window.NeeCall.isSupported()) {
      return null;
    }
    const inst = window.NeeCall.create({
      sendSignal: (p) => { sendSignal(p); },
      onRemoteStream: () => {},  // NeeCall manages the hidden <audio> internally
      onStateChange: (s) => { setCallState(s); },
      onError: (e) => {
        const code = (e && e.code) ? e.code : (e && e.message) ? e.message : 'call-error';
        setCallError(code);
        const toast = callToastForCode(code);
        if (toast) flashCallToast(toast);
      },
    });
    neeCallRef.current = inst;
    return inst;
  }, [sendSignal, flashCallToast]);

  // ─── WebRTC call: outbound start + control actions (owner: webrtc-calls) ───
  // 2-party only on MVP. Pre-flight modal in ChatScreen gates this; we keep
  // a defensive isSecureContext check for the case where startCall is called
  // outside the pre-flight path (e.g. from a future debug command).
  const startCall = React.useCallback(async () => {
    setCallError(null);
    // Pre-flight: getUserMedia needs HTTPS (or localhost). Show a clear
    // message rather than silently failing inside webrtc.js.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setCallError('insecure-context');
      flashCallToast((window.Nee2Pi18n && window.Nee2Pi18n.t('call.toast.requires_https')) || 'Звонки требуют HTTPS');
      return;
    }
    const inst = getNeeCall();
    if (!inst) {
      setCallError('unsupported');
      flashCallToast((window.Nee2Pi18n && window.Nee2Pi18n.t('call.toast.unsupported_browser')) || 'Звонки не поддерживаются в этом браузере');
      return;
    }
    // 2-party only on MVP — callPeer is the single other slot.
    const ps = mySlotRef.current === 0 ? 1 : 0;
    setCallPeer(ps);
    await inst.startCall({ video: false });
  }, [getNeeCall, flashCallToast]);

  const answerCall = React.useCallback(async () => {
    const inst = neeCallRef.current;
    if (!inst) return;
    await inst.answer();
  }, []);

  const rejectCall = React.useCallback(() => {
    const inst = neeCallRef.current;
    if (!inst) return;
    inst.reject();
  }, []);

  const hangupCall = React.useCallback(() => {
    const inst = neeCallRef.current;
    if (!inst) return;
    inst.hangup();
  }, []);

  const toggleCallMute = React.useCallback(() => {
    const inst = neeCallRef.current;
    if (!inst) return;
    setCallMuted(inst.toggleMute());
  }, []);

  const toggleCallSpeaker = React.useCallback(() => {
    const inst = neeCallRef.current;
    if (!inst) return;
    setCallOnSpeaker(inst.toggleSpeaker());
  }, []);

  // When the call goes idle/ended/failed, reset peer + flags so the UI cleans up.
  React.useEffect(() => {
    if (callState === 'idle') {
      setCallPeer(null);
      setCallMuted(false);
      setCallOnSpeaker(false);
    }
    if (callState === 'incoming' && navigator.vibrate) {
      try { navigator.vibrate([300, 100, 300]); } catch {}
    }
  }, [callState]);

  // ── attachments / voice ───────────────────────────────────
  // Upload progress is a simple counter — every pending op +1, every settled
  // op -1. ChatScreen can render a dot whenever it's > 0.
  const [uploadProgress, setUploadProgress] = React.useState(0);

  // For locally-sent blobs we keep the decrypted bytes in memory so getBlob-
  // ObjectURL can hand them back without a server round-trip (and without
  // needing to remember the iv just for the local-echo path).
  const ownBlobBytesRef = React.useRef(new Map());      // id → Uint8Array (decrypted)
  const blobUrlCacheRef = React.useRef(new Map());      // id → objectURL
  const blobUrlPromisesRef = React.useRef(new Map());   // id → in-flight Promise

  // Generate an 80x80 JPEG thumbnail from an image File. Returns just the
  // base64 part (without the data:URL prefix) so we don't bloat the wire.
  async function makeImageThumb(file) {
    try {
      const buf = await file.arrayBuffer();
      const blob = new Blob([buf], { type: file.type });
      const url = URL.createObjectURL(blob);
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const c = document.createElement('canvas');
      c.width = 80; c.height = 80;
      const ctx = c.getContext('2d');
      // letterbox-cover: scale up so the shorter side fills the canvas
      const scale = Math.max(c.width / img.width, c.height / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      const dataUrl = c.toDataURL('image/jpeg', 0.55);
      URL.revokeObjectURL(url);
      const i = dataUrl.indexOf(',');
      return i >= 0 ? dataUrl.slice(i + 1) : '';
    } catch {
      return '';
    }
  }

  // Encrypt + upload `bytes`, then ship a `msg` envelope where:
  //   • iv  — the iv used to AES-GCM the blob bytes (raw → /r/blob)
  //   • ct  — the AES-GCM-encrypted JSON wrapper carrying time + private
  //           blobMeta (`name`, `thumb`, `waveform`). Empty for legacy peers,
  //           but on this codebase every send now carries the wrapper.
  //   • blob — ONLY the envelope-required fields the relay needs to route /
  //            the receiver needs BEFORE decryption (to decide whether to
  //            render as image vs file before the bytes land).
  //
  // Splits `extra` into:
  //   envelopeMeta = {mime, size, kind, durationMs}  → server-visible
  //   privateMeta  = {name, thumb, waveform}         → encrypted inside ct
  //
  // The bytes-iv and the text-iv are deliberately the SAME — the receiver
  // re-uses {iv, key} to decrypt the downloaded blob ciphertext (see
  // getBlobObjectURL). Reusing the iv across two messages under the same key
  // would be catastrophic IF those plaintexts shared structure — here they
  // don't (one is a small JSON wrapper, the other is arbitrary file bytes)
  // AND the receiver knows which one to feed into AES-GCM based on whether
  // we're decrypting the blob from /r/blob (bytes) or the msg envelope (JSON).
  // The previous version also reused the iv this way; this refactor keeps
  // the same trade-off but adds a real wrapper for blobs.
  async function _encryptAndUploadBlob(rawBuf, extra) {
    if (!wsRef.current || !wsRef.current.uploadBlob) throw new Error('no-client');
    const epoch = currentEpochRef.current;
    const u8 = rawBuf instanceof Uint8Array ? rawBuf : new Uint8Array(rawBuf);
    let iv, ct;
    let senderKeyEpoch = null;
    let sessionKey = null;
    if (mySenderKeyRef.current) {
      // Import the sender key once for encryptBytes (which expects a CryptoKey).
      sessionKey = await crypto.subtle.importKey(
        'raw', mySenderKeyRef.current, { name: 'AES-GCM', length: 256 },
        false, ['encrypt', 'decrypt']
      );
      ({ iv, ct } = await Nee2PCrypto.encryptBytes(sessionKey, u8));
      senderKeyEpoch = mySenderKeyEpochRef.current;
    } else if (aesKeyRef.current) {
      sessionKey = aesKeyRef.current;
      ({ iv, ct } = await Nee2PCrypto.encryptBytes(sessionKey, u8));
    } else {
      throw new Error('no-session-key');
    }
    const upRes = await wsRef.current.uploadBlob(ct, 'application/octet-stream');
    if (!upRes || !upRes.ok) throw new Error((upRes && upRes.reason) || 'upload-failed');
    const id = 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const time = nowHHMM();
    const ivB64 = Nee2PCrypto._b64(iv);
    // Split extras into envelope-visible vs encrypted-only.
    const envelopeMeta = { blobId: upRes.blobId };
    const privateMeta = {};
    if (extra) {
      if (typeof extra.mime === 'string')  envelopeMeta.mime = extra.mime;
      if (typeof extra.size === 'number')  envelopeMeta.size = extra.size;
      if (typeof extra.kind === 'string')  envelopeMeta.kind = extra.kind;
      if (typeof extra.durationMs === 'number') envelopeMeta.durationMs = extra.durationMs;
      if (typeof extra.name === 'string'   && extra.name)   privateMeta.name = extra.name;
      if (typeof extra.thumb === 'string'  && extra.thumb)  privateMeta.thumb = extra.thumb;
      if (Array.isArray(extra.waveform)    && extra.waveform.length) privateMeta.waveform = extra.waveform;
    }
    // Wire-format refactor: ct now carries the JSON wrapper (with time and
    // privateMeta) rather than being empty. Receiver JSON.parses, pulls the
    // blobMeta fields onto the local message, and merges with the envelope's
    // blob{blobId, mime, size, kind, durationMs}.
    const wrapperPlain = JSON.stringify({
      text: '', time,
      ...(Object.keys(privateMeta).length ? { blobMeta: privateMeta } : {}),
    });
    // Use a FRESH iv for the wrapper ciphertext so we don't reuse `iv` (which
    // already encrypted the file bytes) under the same key on different
    // plaintext — that would break AES-GCM's CTR-mode confidentiality.
    let wrapperEnc;
    if (mySenderKeyRef.current && senderKeyEpoch !== null) {
      wrapperEnc = await Nee2PCrypto.encryptWithSenderKey(mySenderKeyRef.current, wrapperPlain);
    } else {
      wrapperEnc = await Nee2PCrypto.encrypt(sessionKey, wrapperPlain);
    }
    // Envelope: relay sees iv=bytes-iv (so it/the receiver can find the blob
    // ciphertext), ct=wrapper ciphertext (which uses its own iv inside `wrapperEnc.iv`).
    // Receiver decrypts ct with wrapperEnc.iv and downloads blob bytes with
    // the envelope iv. We keep `iv` = bytes-iv on the envelope because that's
    // what getBlobObjectURL reads via msg._iv.
    const payload = {
      type: 'msg', iv: ivB64, ct: wrapperEnc.ct, ivCt: wrapperEnc.iv,
      id, epoch, blob: envelopeMeta,
    };
    if (senderKeyEpoch !== null) payload.senderKeyEpoch = senderKeyEpoch;
    wsRef.current.send(payload);
    // Local echo: keep the merged (envelope + private) meta so the bubble
    // renders the thumb/name/waveform immediately without round-tripping.
    const mergedBlob = { ...envelopeMeta, ...privateMeta };
    const local = {
      id, side: mySlot, text: '', time,
      at: Date.now(),                       // client-side ingest ts (see ingestMessage)
      blob: mergedBlob, _epoch: epoch, _iv: ivB64,
      _senderKeyEpoch: senderKeyEpoch, _from: mySlot,
    };
    // Cache the *plaintext* bytes so local-echo can render instantly without
    // round-tripping through /r/blob. Bounded by the relay's 50MB/room cap
    // already so this Map is naturally LRU-ish; we still drop old entries when
    // the cache holds more than 16 items to keep memory predictable.
    ownBlobBytesRef.current.set(id, u8);
    if (ownBlobBytesRef.current.size > 16) {
      const oldest = ownBlobBytesRef.current.keys().next().value;
      ownBlobBytesRef.current.delete(oldest);
    }
    setMessages(prev => [...prev, local]);
    return id;
  }

  const sendBlob = React.useCallback(async (file) => {
    if (!wsRef.current || !file) return;
    setUploadProgress(n => n + 1);
    try {
      const buf = await file.arrayBuffer();
      let thumb = '';
      if (file.type && file.type.startsWith('image/')) {
        thumb = await makeImageThumb(file);
      }
      await _encryptAndUploadBlob(buf, {
        mime: file.type || 'application/octet-stream',
        size: file.size,
        name: file.name || '',
        ...(thumb ? { thumb } : {}),
      });
    } catch (e) {
      console.warn('sendBlob failed:', e && e.message ? e.message : e);
    } finally {
      setUploadProgress(n => Math.max(0, n - 1));
    }
  }, [mySlot]);

  const sendVoice = React.useCallback(async (arrayBuf, mime, durationMs, waveform) => {
    if (!wsRef.current || !arrayBuf) return;
    setUploadProgress(n => n + 1);
    try {
      await _encryptAndUploadBlob(arrayBuf, {
        mime: mime || 'audio/webm',
        size: arrayBuf.byteLength,
        kind: 'voice',
        durationMs: Math.round(durationMs || 0),
        waveform: Array.isArray(waveform) ? waveform.slice(0, 64) : [],
      });
    } catch (e) {
      console.warn('sendVoice failed:', e && e.message ? e.message : e);
    } finally {
      setUploadProgress(n => Math.max(0, n - 1));
    }
  }, [mySlot]);

  // Download + decrypt a blob, cache the resulting object URL on the
  // message. The msg envelope's iv (b64) doubles as the blob IV; the key is
  // the session key for the msg's epoch (or phrase fallback for legacy).
  const getBlobObjectURL = React.useCallback(async (msg) => {
    if (!msg || !msg.blob || !msg.blob.blobId) return null;
    const cached = blobUrlCacheRef.current.get(msg.id);
    if (cached) return cached;
    const inFlight = blobUrlPromisesRef.current.get(msg.id);
    if (inFlight) return inFlight;
    const p = (async () => {
      // For locally-sent blobs the original bytes are still in memory →
      // skip the download + decrypt altogether.
      const ownBuf = ownBlobBytesRef.current.get(msg.id);
      let decrypted;
      if (ownBuf) {
        decrypted = ownBuf;
      } else {
        // Pick the right AES key. Mirror pickKeyForItem(): prefer the
        // sender's sender-key when the msg was tagged with senderKeyEpoch
        // (group-chat default); fall back to the pairwise key for the
        // msg's epoch (legacy 2-party); then phrase-only as last resort.
        let keyBytesOrKey = null;
        const fromNum = msg._from != null ? msg._from : coerceSlot(msg.side);
        const myNum = mySlotRef.current;
        if (typeof msg._senderKeyEpoch === 'number') {
          if (fromNum === myNum && mySenderKeyRef.current) {
            keyBytesOrKey = { raw: mySenderKeyRef.current };
          } else if (fromNum !== null) {
            const peer = peerKeysRef.current.get(fromNum);
            if (peer && peer.senderKey) keyBytesOrKey = { raw: peer.senderKey };
          }
        }
        if (!keyBytesOrKey && fromNum !== null && fromNum !== myNum) {
          const peer = peerKeysRef.current.get(fromNum);
          if (peer && peer.pairwiseKey) keyBytesOrKey = { key: peer.pairwiseKey };
        }
        if (!keyBytesOrKey && aesKeyRef.current) {
          keyBytesOrKey = { key: aesKeyRef.current };
        }
        if (!keyBytesOrKey) throw new Error('no-key');

        const ivB64 = msg._iv || msg.blob._iv;
        if (!ivB64) throw new Error('no-iv');
        const iv = Nee2PCrypto._unb64(ivB64);
        const ct = new Uint8Array(await wsRef.current.downloadBlob(msg.blob.blobId));
        // decryptBytes expects a CryptoKey. Wrap raw sender-key bytes first.
        let cryptoKey;
        if (keyBytesOrKey.raw) {
          cryptoKey = await crypto.subtle.importKey(
            'raw', keyBytesOrKey.raw, { name: 'AES-GCM', length: 256 },
            false, ['encrypt', 'decrypt']
          );
        } else {
          cryptoKey = keyBytesOrKey.key;
        }
        decrypted = await Nee2PCrypto.decryptBytes(cryptoKey, iv, ct);
      }
      const url = URL.createObjectURL(new Blob([decrypted], { type: msg.blob.mime || 'application/octet-stream' }));
      blobUrlCacheRef.current.set(msg.id, url);
      return url;
    })().finally(() => {
      blobUrlPromisesRef.current.delete(msg.id);
    });
    blobUrlPromisesRef.current.set(msg.id, p);
    return p;
  }, []);

  const deleteMessage = (id) => {
    if (!wsRef.current) return;
    wsRef.current.send({ type: 'delete', id });
    setMessages(prev => prev.filter(m => m.id !== id));
    const t = burnTimersRef.current.get(id);
    if (t) { clearTimeout(t); burnTimersRef.current.delete(id); }
    pendingSenderBurnRef.current.delete(id);
  };

  // Read receipts — peer tells us "I've seen everything up to <id>". For
  // groups: Map<slotNum, msgId>. "Read by all" = the latest msg id is in
  // peerLastReadIds for every CLAIMED peer slot.
  const [peerLastReadIds, setPeerLastReadIds] = React.useState(new Map());
  const markRead = React.useCallback((upto) => {
    if (!wsRef.current || !upto) return;
    wsRef.current.send({ type: 'read', upto });
  }, []);

  // SENDER-side burn arming: when ANY peer's lastReadId advances, walk our
  // pending map and arm timers for items that are now covered by all peers.
  // In 2-party that simplifies to "the single peer has read", same as before.
  // For groups we burn only once everybody who's currently online+claimed has
  // confirmed reading. (If a peer is offline → no burn yet; they'll burn on
  // catch-up when they ack.)
  //
  // Perf: this effect originally re-walked the entire pending map on every
  // `messages` change — i.e. every keystroke (typing-indicator) or live-now
  // tick. Two guards:
  //   1. If pending map is empty → nothing to arm. Bail before scanning.
  //   2. Track the previous peerLastReadIds "signature" and bail if unchanged
  //      AND no new pending entries were added since last run. (When pending
  //      grows we still re-scan, because a fresh send might already be read.)
  const lastPeerReadSigRef = React.useRef('');
  const lastPendingSizeRef = React.useRef(0);
  React.useEffect(() => {
    if (pendingSenderBurnRef.current.size === 0) {
      lastPendingSizeRef.current = 0;
      return;
    }
    if (peerLastReadIds.size === 0) return;
    // Build a cheap signature of peer read-pointers to detect "nothing
    // changed since last run" — skip when neither read-pointers nor pending
    // set size differ.
    const sig = Array.from(peerLastReadIds.entries())
      .map(([k, v]) => k + ':' + v).sort().join('|');
    const pendingSize = pendingSenderBurnRef.current.size;
    if (sig === lastPeerReadSigRef.current && pendingSize === lastPendingSizeRef.current) {
      return;
    }
    lastPeerReadSigRef.current = sig;
    lastPendingSizeRef.current = pendingSize;

    const myNum = mySlotRef.current;
    // Build the set of peer slots we need ACK from. Default: everyone we
    // have a read-pointer for. (A safer model would require ALL claimed
    // peers including silent ones, but that'd never burn if anyone left.)
    const needAck = Array.from(peerLastReadIds.keys()).filter(s => s !== myNum);
    if (needAck.length === 0) return;
    for (const [id, ttl] of pendingSenderBurnRef.current) {
      const mineIdx = messages.findIndex(x => x.id === id);
      if (mineIdx < 0) continue;
      let allRead = true;
      for (const peerSlot of needAck) {
        const upto = peerLastReadIds.get(peerSlot);
        const readIdx = upto ? messages.findIndex(x => x.id === upto) : -1;
        if (readIdx < 0 || readIdx < mineIdx) { allRead = false; break; }
      }
      if (allRead) {
        pendingSenderBurnRef.current.delete(id);
        maybeArmSenderBurn(id, ttl);
      }
    }
    // Update size after possible deletions so the next run's "did pending
    // grow?" check is accurate.
    lastPendingSizeRef.current = pendingSenderBurnRef.current.size;
  }, [peerLastReadIds, messages, maybeArmSenderBurn]);

  // Backward-compat single-peer read id used by ChatScreen's existing read-
  // receipt math. For 2-party rooms this is just the peer's value; for groups
  // we return the LAST id that ALL peers have ack'd (sliding "read by all"
  // pointer), enabling the ✓✓ blue marker only when truly read by everyone.
  const peerLastReadIdAggregate = React.useMemo(() => {
    if (peerLastReadIds.size === 0) return null;
    if (groupMax === 2) {
      // single peer
      const v = peerLastReadIds.values().next().value;
      return v || null;
    }
    // group: find the highest-indexed msg in `messages` that every peer in
    // peerLastReadIds has read up to (or past).
    const myNum = mySlotRef.current;
    const peers = Array.from(peerLastReadIds.keys()).filter(s => s !== myNum);
    if (peers.length === 0) return null;
    let best = null;
    let bestIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i].id;
      if (!id) continue;
      let everyone = true;
      for (const ps of peers) {
        const upto = peerLastReadIds.get(ps);
        const readIdx = upto ? messages.findIndex(x => x.id === upto) : -1;
        if (readIdx < 0 || readIdx < i) { everyone = false; break; }
      }
      if (everyone) { best = id; bestIdx = i; break; }
    }
    return best;
  }, [peerLastReadIds, messages, groupMax]);

  // RECEIVER-side burn arming: when the tab becomes visible (or new TTL msgs
  // arrive while it's already visible), arm timers for any TTL msgs from the
  // peer that don't already have one.
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      for (const m of messages) {
        const sideNum = coerceSlot(m.side);
        if (m.expireSecAfterRead && sideNum !== mySlot && !burnTimersRef.current.has(m.id)) {
          maybeArmReceiverBurn(m.id, m.side, m.expireSecAfterRead);
        }
      }
    };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [messages, mySlot, maybeArmReceiverBurn]);

  // Drop all live burn timers on unmount / room teardown.
  React.useEffect(() => () => {
    for (const t of burnTimersRef.current.values()) clearTimeout(t);
    burnTimersRef.current.clear();
    pendingSenderBurnRef.current.clear();
  }, []);

  // typing signal exposed via window for the chat input handler
  React.useEffect(() => {
    window.__nee2pTypingSend = (on) => {
      if (wsRef.current) wsRef.current.send({ type: 'typing', on: !!on });
    };
    return () => { delete window.__nee2pTypingSend; };
  }, []);

  // unmount cleanup
  React.useEffect(() => () => cleanupConnection(), [cleanupConnection]);

  // ── chat banner: partner online indicator ─────────────────
  React.useEffect(() => {
    if (screen !== 'chat') { setChatBanner(null); return; }
    if (groupMax === 2) {
      const occ = peerSlot === 0 ? slots.A : slots.B;
      if (!occ?.claimed) {
        setChatBanner('Партнёр ещё не вошёл по своему паролю. Сообщения сохранятся и придут ему при входе.');
      } else if (!partnerOnline) {
        setChatBanner('Партнёр сейчас оффлайн. Сообщения придут ему как только он вернётся.');
      } else {
        setChatBanner(null);
      }
    } else {
      // Group: count missing / offline participants.
      const totalPeers = groupMax - 1;
      const claimedPeers = participants.filter(p => p.claimed).length;
      const onlinePeers = participants.filter(p => p.online).length;
      if (claimedPeers < totalPeers) {
        setChatBanner(`Ещё ${totalPeers - claimedPeers} из ${totalPeers} участников не вошли. Сообщения дойдут после входа.`);
      } else if (onlinePeers < totalPeers) {
        setChatBanner(`${totalPeers - onlinePeers} из ${totalPeers} участников оффлайн.`);
      } else {
        setChatBanner(null);
      }
    }
  }, [screen, slots, peerSlot, partnerOnline, groupMax, participants]);

  // ── render ────────────────────────────────────────────────
  let body;
  switch (screen) {
    case 'welcome':
      body = <WelcomeScreen palette={PALETTE} onCreate={goCreate} onJoin={goJoin} onInfo={goInfo}
        savedRooms={savedRooms} onRestoreSaved={restoreSavedRoom} />;
      break;
    case 'info':
      body = <InfoScreen palette={PALETTE} onBack={backToWelcome} />;
      break;
    case 'created':
      body = <CreatedScreen palette={PALETTE}
        phrase={phrase} setPhrase={setPhrase}
        onGenerateSeed={generateSeed}
        ttlOptions={TTL_OPTIONS} ttlId={ttlId} setTtlId={setTtlId}
        groupOptions={GROUP_OPTIONS} groupMax={createGroupMax} setGroupMax={setCreateGroupMax}
        password={password} setPassword={setPassword}
        rememberMe={rememberMe} setRememberMe={setRememberMe}
        busy={busy} error={flowError}
        onCancel={backToWelcome} onSubmit={submitCreate} />;
      break;
    case 'join':
      body = <JoinScreen palette={PALETTE}
        value={joinValue} setValue={(v) => { setJoinValue(v); setFlowError(null); }}
        password={password} setPassword={setPassword}
        rememberMe={rememberMe} setRememberMe={setRememberMe}
        busy={busy} error={flowError}
        onBack={backToWelcome}
        onContinue={submitJoin}
        onCreateInstead={goCreateWithPhrase} />;
      break;
    case 'share':
      body = <ShareScreen palette={PALETTE}
        hash={activeHash}
        phrase={phrase || ''}
        expiresAt={expiresAt}
        slots={slots} mySlot={mySlot} paired={paired}
        groupMax={groupMax} participants={participants}
        onEnterChat={enterChat}
        onCancel={() => {
          if (!confirm('Закрыть сессию? Сообщения исчезнут навсегда.')) return;
          // Explicit "close session forever" — also forget the persisted record
          // so the auto-restore on next visit doesn't bring this room back.
          try { forgetSessionRecord(roomIdRef.current); } catch {}
          resetAll();
        }} />;
      break;
    case 'waiting':
      body = <WaitingScreen palette={PALETTE}
        peerSealed={groupMax === 2 ? !!(peerSlot === 0 ? slots.A : slots.B)?.sealed
                                   : participants.every(p => p.sealed)}
        peerClaimed={groupMax === 2 ? !!(peerSlot === 0 ? slots.A : slots.B)?.claimed
                                    : participants.every(p => p.claimed)} />;
      break;
    case 'chat':
      body = <ChatScreen palette={PALETTE} perspective={mySlot}
        groupMax={groupMax}
        participants={participants}
        expiresAt={expiresAt}
        totalSeconds={totalSeconds}
        partnerOnline={partnerOnline}
        partnerClaimed={partnerClaimed}
        partnerTyping={partnerTyping}
        paired={paired}
        messages={messages}
        sessionHash={activeHash}
        sharePhrase={phrase || ''}
        peerLastReadId={peerLastReadIdAggregate}
        safetyFingerprint={safetyFingerprint}
        persistEnabled={persistEnabled && persistedRoomIdRef.current === roomIdRef.current}
        onSend={sendMessage}
        onDelete={deleteMessage}
        onMarkRead={markRead}
        onReact={sendReaction}
        onAttach={sendBlob}
        onVoice={sendVoice}
        onBlobUrl={getBlobObjectURL}
        uploadProgress={uploadProgress}
        connStatus={connStatus}
        callState={callState}
        callPeer={callPeer}
        callMuted={callMuted}
        callOnSpeaker={callOnSpeaker}
        callError={callError}
        callToast={callToast}
        callSupported={!!(window.NeeCall && window.NeeCall.isSupported && window.NeeCall.isSupported())}
        onCall={startCall}
        onAnswerCall={answerCall}
        onRejectCall={rejectCall}
        onHangup={hangupCall}
        onToggleMute={toggleCallMute}
        onToggleSpeaker={toggleCallSpeaker}
        onBack={() => {
          if (!confirm('Выйти из чата? Сессия останется активной — сможешь вернуться по фразе+паролю.')) return;
          cleanupConnection();
          setScreen('welcome');
        }} banner={chatBanner} />;
      break;
    case 'locked':
      body = <LockedScreen palette={PALETTE} onBack={backToWelcome} />;
      break;
    case 'expired':
      body = <ExpiredScreen palette={PALETTE} reason={expiredReason}
        onRestart={() => { setExpiredReason(null); setScreen('welcome'); }} />;
      break;
    default:
      body = <WelcomeScreen palette={PALETTE} onCreate={goCreate} onJoin={goJoin} onInfo={goInfo} />;
  }

  return (
    <div className="app-frame">
      <GradientMesh palette={PALETTE} intensity={0.85} variant={screen === 'chat' ? 'chat' : 'home'} />
      <div style={{ position: 'relative', height: '100%', zIndex: 1 }} data-screen={screen}>
        {body}
      </div>
      {twoTabsWarning && (
        <div style={{
          position: 'absolute', top: 8, left: 8, right: 8, zIndex: 50,
          padding: '8px 12px', borderRadius: 12,
          background: 'rgba(210, 140, 60, 0.85)',
          color: '#fff', fontSize: 12, letterSpacing: 0.2, textAlign: 'center',
          boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <div style={{ flex: 1, textAlign: 'left' }}>
            Nee2P. уже открыт в другой вкладке. Закройте одну для нормальной работы.
          </div>
          <button onClick={() => setTwoTabsWarning(false)}
            style={{
              border: 'none', background: 'rgba(0,0,0,0.25)', color: '#fff',
              borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
            }}>Скрыть</button>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('stage')).render(<App />);
