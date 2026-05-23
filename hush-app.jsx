// hush-app.jsx — real e2e orchestrator with persistent rooms.
//
// Two flows:
//   • create: phrase + ttl + password → claim slot A → share code
//   • join:   phrase/hash + password → claim slot (B if free, restore A or B if hash matches)
// Third connection with a non-matching password → 'locked' → bounced to a 'locked' screen.
// Either side can close the tab and come back — passwordHash is the key.

const {
  GradientMesh,
  WelcomeScreen, CreatedScreen, JoinScreen, ShareScreen,
  WaitingScreen, ChatScreen, InfoScreen, ExpiredScreen, LockedScreen,
} = window;
const md5 = window.md5;
const HushCrypto = window.HushCrypto;
const HushWS = window.HushWS;

const PALETTE = 'steel';
const HASH_RE = /^[a-f0-9]{32}$/i;

const TTL_OPTIONS = [
  { id: '1h',  label: '1 час',    ms: 1 * 3600 * 1000 },
  { id: '6h',  label: '6 часов',  ms: 6 * 3600 * 1000 },
  { id: '24h', label: '24 часа',  ms: 24 * 3600 * 1000 },
  { id: '3d',  label: '3 дня',    ms: 3 * 24 * 3600 * 1000 },
  { id: '7d',  label: '7 дней',   ms: 7 * 24 * 3600 * 1000 },
];

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function App() {
  // ── navigation ────────────────────────────────────────────
  const [screen, setScreen] = React.useState('welcome');
  const [expiredReason, setExpiredReason] = React.useState(null);

  // ── creator input state ───────────────────────────────────
  const [createMode, setCreateMode] = React.useState('auto');  // 'auto' | 'phrase'
  const [phrase, setPhrase] = React.useState('');
  const [autoSeed] = React.useState(() =>
    'hush-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
  );
  const [ttlId, setTtlId] = React.useState('24h');

  // ── join input state ──────────────────────────────────────
  const [joinValue, setJoinValue] = React.useState('');

  // ── shared (both flows) ──────────────────────────────────
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [flowError, setFlowError] = React.useState(null);

  // ── live connection state ─────────────────────────────────
  const wsRef = React.useRef(null);
  const aesKeyRef = React.useRef(null);
  const ackQueueRef = React.useRef([]);
  const ackTimerRef = React.useRef(null);
  const [activeHash, setActiveHash] = React.useState('');
  const [mySlot, setMySlot] = React.useState(null);          // 'A' | 'B'
  const [slots, setSlots] = React.useState({ A: { claimed: false, sealed: false }, B: { claimed: false, sealed: false } });
  const [paired, setPaired] = React.useState(false);
  const [pairedAt, setPairedAt] = React.useState(null);
  const [createdAt, setCreatedAt] = React.useState(null);
  const [expiresAt, setExpiresAt] = React.useState(null);
  const [partnerOnline, setPartnerOnline] = React.useState(false);
  const [partnerTyping, setPartnerTyping] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [chatBanner, setChatBanner] = React.useState(null);

  // ── derived ───────────────────────────────────────────────
  const createHash = React.useMemo(() => {
    const src = createMode === 'phrase' ? (phrase || '') : autoSeed;
    return src ? md5(src) : '';
  }, [createMode, phrase, autoSeed]);

  const joinHash = React.useMemo(() => {
    const t = (joinValue || '').trim();
    if (!t) return '';
    return HASH_RE.test(t) ? t.toLowerCase() : md5(t);
  }, [joinValue]);

  const peerSlot = mySlot === 'A' ? 'B' : 'A';

  // ── chat countdown ────────────────────────────────────────
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (screen !== 'chat' && screen !== 'share') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [screen]);

  const ttlMs = (TTL_OPTIONS.find(t => t.id === ttlId) || TTL_OPTIONS[2]).ms;
  const expirySeconds = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
  const totalSeconds = (expiresAt && createdAt) ? Math.floor((expiresAt - createdAt) / 1000) : 86400;

  // ── helpers ───────────────────────────────────────────────
  const cleanupConnection = React.useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    aesKeyRef.current = null;
    setActiveHash(''); setMySlot(null);
    setSlots({ A: { claimed: false, sealed: false }, B: { claimed: false, sealed: false } });
    setPaired(false); setPairedAt(null);
    setCreatedAt(null); setExpiresAt(null);
    setPartnerOnline(false); setPartnerTyping(false);
    setMessages([]); setChatBanner(null);
    ackQueueRef.current = [];
    if (ackTimerRef.current) { clearTimeout(ackTimerRef.current); ackTimerRef.current = null; }
  }, []);

  const resetAll = React.useCallback((reason) => {
    cleanupConnection();
    setPassword(''); setJoinValue(''); setPhrase('');
    setCreateMode('auto'); setTtlId('24h');
    setFlowError(null); setBusy(false);
    setExpiredReason(reason || null);
    setScreen(reason ? 'expired' : 'welcome');
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
  }, []);

  // process an incoming encrypted item (from msg or msg-batch)
  const ingestMessage = React.useCallback(async (item) => {
    if (!aesKeyRef.current) return;
    try {
      const text = await HushCrypto.decrypt(aesKeyRef.current, item.iv, item.ct);
      setMessages(prev => {
        if (prev.some(m => m.id === item.id)) return prev;
        return [...prev, { id: item.id, side: item.from, text, time: item.time || nowHHMM() }];
      });
      queueAck(item.id);
    } catch (err) {
      // unable to decrypt — wrong key? drop
    }
  }, []);

  // open WS + claim. Returns the claim-result message.
  const connectAndClaim = React.useCallback(async (hash, pwd, opts = {}) => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    aesKeyRef.current = await HushCrypto.deriveKey(hash);
    const passwordHash = await HushCrypto.passwordSlotHash(hash, pwd);

    return await new Promise((resolve) => {
      let resolved = false;
      const claimRequest = { type: 'claim', passwordHash };
      if (opts.ttlMs) claimRequest.ttlMs = opts.ttlMs;

      const client = HushWS.createClient({
        room: hash,
        handlers: {
          onOpen: () => {
            client.send(claimRequest);
          },
          onClaimResult: (m) => {
            if (!resolved) { resolved = true; resolve(m); }
          },
          onRoomState: (m) => {
            // informational only — we'll get claim-result after our claim
            if (m.exists) {
              setCreatedAt(m.createdAt);
              setExpiresAt(m.expiresAt);
              setSlots(m.slots);
              setPaired(!!m.paired);
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
            setPartnerOnline(m.online);
            if (!m.online) setPartnerTyping(false);
          },
          onMsg: (m) => { ingestMessage(m); },
          onMsgBatch: (m) => {
            if (Array.isArray(m.items)) m.items.forEach(ingestMessage);
          },
          onTyping: (m) => { setPartnerTyping(!!m.on); },
          onMsgDelete: (m) => { ingestDelete(m.id); },
          onRoomExpired: () => {
            resetAll('Таймер обнулился. Все сообщения и ключи стёрты.');
          },
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
  }, [ingestMessage, resetAll]);

  // ── flow actions ──────────────────────────────────────────
  const goCreate = () => {
    cleanupConnection();
    setFlowError(null);
    setPassword('');
    setPhrase('');
    setCreateMode('auto');
    setTtlId('24h');
    setScreen('created');
  };

  const goJoin = () => {
    cleanupConnection();
    setFlowError(null);
    setPassword('');
    setJoinValue('');
    setScreen('join');
  };

  const goInfo = () => setScreen('info');
  const backToWelcome = () => resetAll();

  const submitCreate = async () => {
    if (!createHash || password.length < 4 || busy) return;
    setBusy(true); setFlowError(null);
    const r = await connectAndClaim(createHash, password, { ttlMs });
    setBusy(false);
    if (!r.ok) {
      setFlowError(r.reason === 'locked'
        ? 'Эту фразу уже использует другая пара. Возьми другую.'
        : 'Не удалось создать сессию.');
      return;
    }
    setActiveHash(createHash);
    setMySlot(r.slot);
    if (r.slots) setSlots(r.slots);
    if (r.createdAt) setCreatedAt(r.createdAt);
    if (r.expiresAt) setExpiresAt(r.expiresAt);
    setPaired(!!r.paired);
    setScreen('chat');
  };

  const submitJoin = async () => {
    if (!joinHash || password.length < 4 || busy) return;
    setBusy(true); setFlowError(null);
    const r = await connectAndClaim(joinHash, password);
    setBusy(false);
    if (!r.ok) {
      if (r.reason === 'locked') setScreen('locked');
      else setFlowError('Не удалось подключиться. Проверь фразу и пароль.');
      return;
    }
    setActiveHash(joinHash);
    setMySlot(r.slot);
    if (r.slots) setSlots(r.slots);
    if (r.createdAt) setCreatedAt(r.createdAt);
    if (r.expiresAt) setExpiresAt(r.expiresAt);
    setPaired(!!r.paired);
    setScreen('chat');
  };

  const enterChat = () => setScreen('chat');

  // when paired transitions, route the user
  React.useEffect(() => {
    if (!paired) return;
    if (screen === 'waiting') setScreen('chat');
  }, [paired, screen]);

  const sendMessage = async (text) => {
    if (!wsRef.current || !aesKeyRef.current) return;
    const { iv, ct } = await HushCrypto.encrypt(aesKeyRef.current, text);
    const id = 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const time = nowHHMM();
    wsRef.current.send({ type: 'msg', iv, ct, time, id });
    setMessages(prev => [...prev, { id, side: mySlot, text, time }]);
  };

  const deleteMessage = (id) => {
    if (!wsRef.current) return;
    wsRef.current.send({ type: 'delete', id });
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  // typing signal exposed via window for the chat input handler
  React.useEffect(() => {
    window.__hushTypingSend = (on) => {
      if (wsRef.current) wsRef.current.send({ type: 'typing', on: !!on });
    };
    return () => { delete window.__hushTypingSend; };
  }, []);

  // unmount cleanup
  React.useEffect(() => () => cleanupConnection(), [cleanupConnection]);

  // ── chat banner: partner online indicator ─────────────────
  React.useEffect(() => {
    if (screen !== 'chat') { setChatBanner(null); return; }
    if (!slots[peerSlot]?.claimed) {
      setChatBanner('Партнёр ещё не вошёл по своему паролю. Сообщения сохранятся и придут ему при входе.');
    } else if (!partnerOnline) {
      setChatBanner('Партнёр сейчас оффлайн. Сообщения придут ему как только он вернётся.');
    } else {
      setChatBanner(null);
    }
  }, [screen, slots, peerSlot, partnerOnline]);

  // ── render ────────────────────────────────────────────────
  let body;
  switch (screen) {
    case 'welcome':
      body = <WelcomeScreen palette={PALETTE} onCreate={goCreate} onJoin={goJoin} onInfo={goInfo} />;
      break;
    case 'info':
      body = <InfoScreen palette={PALETTE} onBack={backToWelcome} />;
      break;
    case 'created':
      body = <CreatedScreen palette={PALETTE}
        mode={createMode} setMode={setCreateMode}
        phrase={phrase} setPhrase={setPhrase}
        autoSeed={autoSeed}
        ttlOptions={TTL_OPTIONS} ttlId={ttlId} setTtlId={setTtlId}
        password={password} setPassword={setPassword}
        busy={busy} error={flowError}
        onCancel={backToWelcome} onSubmit={submitCreate} />;
      break;
    case 'join':
      body = <JoinScreen palette={PALETTE}
        value={joinValue} setValue={(v) => { setJoinValue(v); setFlowError(null); }}
        password={password} setPassword={setPassword}
        busy={busy} error={flowError}
        onBack={backToWelcome}
        onContinue={submitJoin} />;
      break;
    case 'share':
      body = <ShareScreen palette={PALETTE}
        hash={activeHash}
        phrase={createMode === 'phrase' ? phrase : ''}
        expiresAt={expiresAt}
        nowMs={now}
        slots={slots} mySlot={mySlot} paired={paired}
        onEnterChat={enterChat}
        onCancel={() => {
          if (!confirm('Закрыть сессию? Сообщения исчезнут навсегда.')) return;
          resetAll();
        }} />;
      break;
    case 'waiting':
      body = <WaitingScreen palette={PALETTE}
        peerSealed={!!slots[peerSlot]?.sealed}
        peerClaimed={!!slots[peerSlot]?.claimed} />;
      break;
    case 'chat':
      body = <ChatScreen palette={PALETTE} perspective={mySlot}
        expirySeconds={expirySeconds}
        totalSeconds={totalSeconds}
        partnerOnline={!!slots[peerSlot]?.claimed && partnerOnline}
        partnerClaimed={!!slots[peerSlot]?.claimed}
        partnerTyping={partnerTyping}
        paired={paired}
        messages={messages}
        sessionHash={activeHash}
        sharePhrase={createMode === 'phrase' ? phrase : ''}
        onSend={sendMessage}
        onDelete={deleteMessage}
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
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('stage')).render(<App />);
