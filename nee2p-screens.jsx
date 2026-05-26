// nee2p-screens.jsx — six flow screens. Visuals lifted from the design prototype.
// Differences from the prototype:
//   • simulate buttons removed (the server drives transitions, not buttons)
//   • CreatedScreen has a Cancel button instead of the "simulate" button
//   • Chat typing indicator only shows when the actual peer is typing
//   • ChatScreen receives a goBack handler for the back arrow

const { GradientMesh, Glass, GlassButton, Logo, StatusDot, HashDisplay, Icon, usePalette } = window;
const md5 = window.md5;

// ─────────────────────────────────────────────────────────────
function WelcomeScreen({ palette, onCreate, onJoin, onInfo,
                         savedRooms, onRestoreSaved }) {
  const p = usePalette(palette);

  const phrases = ['один код', 'один секрет', 'ключи стираются', 'ни следа'];
  const [phraseIdx, setPhraseIdx] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setPhraseIdx(i => (i + 1) % phrases.length), 2600);
    return () => clearInterval(id);
  }, []);

  // Friendly-name helper for the saved-rooms card. Mirrors nee2p-app.jsx's
  // friendlyName(roomId, slot) via window.Nee2PSlotUtil — we don't import it
  // statically because nee2p-app.jsx loads AFTER this file.
  const savedRoomsList = Array.isArray(savedRooms) ? savedRooms : [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '20px 22px 22px', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        animation: 'welcome-rise 0.7s ease both' }}>
        <Logo size={11} palette={palette} />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 9.5, fontWeight: 500, color: 'var(--tx-40)', letterSpacing: 1.6,
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          padding: '5px 10px', borderRadius: 9999,
          background: 'rgba(255,255,255,0.025)',
          boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.07)',
        }}>
          <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
            background: p.a, boxShadow: `0 0 6px ${p.a}` }} />
          без следов
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center', position: 'relative' }}>

        <div style={{ animation: 'welcome-rise 0.9s 0.1s ease both' }}>
          <ConnectOrb palette={palette} size={168} />
        </div>

        <h1 style={{
          margin: '14px 0 0',
          fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontWeight: 400, fontSize: 54, lineHeight: 0.9, letterSpacing: -1.8,
          textAlign: 'center', color: 'var(--tx-100)',
          animation: 'welcome-rise 0.9s 0.25s ease both',
        }}>
          Только свои.
        </h1>

        <div style={{
          marginTop: 10, height: 14, display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: 10,
          fontSize: 10.5, fontWeight: 500, color: 'var(--tx-60)',
          letterSpacing: 2.4, textTransform: 'uppercase', whiteSpace: 'nowrap',
          animation: 'welcome-rise 0.9s 0.4s ease both',
        }}>
          <span style={{ width: 16, height: 1, background: 'var(--tx-25)' }} />
          <span key={phraseIdx} style={{
            animation: 'glyph-cycle 2.6s ease-in-out both',
            minWidth: 110, textAlign: 'center',
          }}>{phrases[phraseIdx]}</span>
          <span style={{ width: 16, height: 1, background: 'var(--tx-25)' }} />
        </div>

        <p style={{
          margin: '18px 0 0', fontSize: 13, color: 'var(--tx-60)',
          textAlign: 'center', maxWidth: 290, lineHeight: 1.55, letterSpacing: -0.05,
          fontWeight: 400,
          animation: 'welcome-rise 0.9s 0.55s ease both',
        }}>
          Сессия живёт, пока вы рядом.<br/>
          И исчезает, когда вы уходите.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9,
        animation: 'welcome-rise 0.9s 0.7s ease both' }}>
        <GlassButton primary palette={palette} onClick={onCreate}
          icon={<Icon.Plus size={18} color={p.text} />}
          style={{ height: 54, borderRadius: 18 }}>
          Создать сессию
        </GlassButton>
        <GlassButton palette={palette} onClick={onJoin}
          icon={<Icon.Key size={16} color="rgba(255,255,255,0.85)" />}
          style={{ height: 54, borderRadius: 18 }}>
          Войти по коду
        </GlassButton>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          {[
            { icon: <Icon.Shield size={12} color="var(--tx-60)" />, label: 'Безопасность', href: 'trust.html' },
            { icon: <Icon.Bolt   size={12} color="var(--tx-60)" />, label: 'Что нового',   href: 'updates.html' },
          ].map(({ icon, label, href }) => (
            <a key={href} href={href} style={{
              flex: 1, height: 36, cursor: 'pointer',
              borderRadius: 12, background: 'transparent',
              textDecoration: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6,
              fontSize: 12, fontWeight: 500, color: 'var(--tx-60)', letterSpacing: 0.2,
              fontFamily: 'inherit',
            }}>
              {icon}
              <span>{label}</span>
              <Icon.Arrow size={11} color="var(--tx-60)" />
            </a>
          ))}
        </div>

        <div style={{
          marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 7, fontSize: 9, fontWeight: 500, color: 'var(--tx-40)',
          letterSpacing: 1.5, textTransform: 'uppercase',
          fontFamily: "var(--ff-mono)",
        }}>
          <span>X25519</span>
          <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'var(--tx-25)' }} />
          <span>ML-KEM-768</span>
          <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'var(--tx-25)' }} />
          <span>AES-256-GCM</span>
          <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'var(--tx-25)' }} />
          <span>Argon2id</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function ConnectOrb({ palette = 'mono', size = 168 }) {
  const p = usePalette(palette);
  // marble orbit radius — keep marbles ~10px from glass edge so they read as
  // ON the orb's surface, not floating inside empty glass
  const R = size * 0.36;
  const marble = size * 0.13;
  const ringR = R;

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div style={{
        position: 'absolute', inset: -20, borderRadius: '50%',
        background: `radial-gradient(circle, ${p.a}33, transparent 65%)`,
        filter: 'blur(22px)', animation: 'pulse-dot 4.5s ease-in-out infinite',
      }} />

      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'radial-gradient(circle at 30% 28%, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 50%, rgba(0,0,0,0.35) 100%)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        boxShadow: 'inset 0 4px 28px rgba(255,255,255,0.16), inset 0 -14px 40px rgba(255,255,255,0.06), 0 26px 50px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.18)',
      }} />

      <div style={{
        position: 'absolute', top: size * 0.07, left: size * 0.13,
        width: size * 0.38, height: size * 0.24,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(255,255,255,0.65), transparent 70%)',
        transform: 'rotate(-25deg)', filter: 'blur(5px)',
      }} />

      {[0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute', top: '50%', left: '50%',
          width: ringR * 2, height: ringR * 2, marginLeft: -ringR, marginTop: -ringR,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.45)',
          animation: `ring-expand 4.2s ease-out ${i * 1.4}s infinite`,
          pointerEvents: 'none',
        }} />
      ))}

      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 5, height: 5, marginLeft: -2.5, marginTop: -2.5,
        borderRadius: '50%', background: '#fff',
        boxShadow: '0 0 10px rgba(255,255,255,0.9)',
        animation: 'pulse-dot 1.8s ease-in-out infinite',
      }} />

      <div style={{
        position: 'absolute', inset: 0,
        animation: 'svg-orbit 24s linear infinite',
        transformOrigin: '50% 50%',
      }}>
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          width: R * 2 - 14, height: 1,
          transform: 'translate(-50%, -50%)',
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
          boxShadow: '0 0 6px rgba(255,255,255,0.35)',
        }} />

        <div style={{
          position: 'absolute', top: '50%', left: `calc(50% - ${R}px)`,
          width: marble, height: marble,
          marginTop: -marble / 2, marginLeft: -marble / 2,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 28%, #ffffff 0%, #ffffff 40%, #c8c8d0 100%)',
          boxShadow: '0 6px 14px rgba(0,0,0,0.45), 0 0 18px rgba(255,255,255,0.25), inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -2px 3px rgba(0,0,0,0.1)',
        }} />

        <div style={{
          position: 'absolute', top: '50%', left: `calc(50% + ${R}px)`,
          width: marble, height: marble,
          marginTop: -marble / 2, marginLeft: -marble / 2,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.10)',
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0 6px 14px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -1px 1px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(255,255,255,0.3)',
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function CreatedScreen({ palette, phrase, setPhrase, onGenerateSeed,
                         ttlOptions, ttlId, setTtlId,
                         groupOptions, groupMax, setGroupMax,
                         password, setPassword,
                         rememberMe, setRememberMe,
                         busy, error, onCancel, onSubmit }) {
  const p = usePalette(palette);
  const [step, setStep] = React.useState(1);
  const [showPwd, setShowPwd] = React.useState(false);

  const source = (phrase || '').trim().toLowerCase();
  const hash = source ? md5(source) : '';
  const canSubmit = hash && password.length >= 4 && !busy;

  // Back: step 1 exits, steps 2-3 go to previous step
  const handleBack = () => step === 1 ? onCancel() : setStep(s => s - 1);

  // Step 1 → 2: auto-generate phrase if empty, then advance
  const handleNext1 = () => {
    if (!(phrase || '').trim()) onGenerateSeed && onGenerateSeed();
    setStep(2);
  };

  // ── shared sub-components ──────────────────────────────────

  // Back button + logo header row
  const NavRow = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div onClick={handleBack} style={{
        width: 38, height: 38, borderRadius: 12,
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '0.5px solid rgba(255,255,255,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}>
        <Icon.Arrow size={16} color="#fff" dir="left" />
      </div>
      <Logo size={9} palette={palette} />
      <div style={{ width: 38 }} />
    </div>
  );

  // Progress pills: filled → active → empty
  const StepDots = () => (
    <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginTop: 10 }}>
      {[1, 2, 3].map(n => (
        <div key={n} style={{
          height: 5, borderRadius: 9999,
          width: n === step ? 22 : 6,
          background: n < step
            ? 'rgba(255,255,255,0.35)'
            : n === step
              ? (p.accent || '#7be0b1')
              : 'rgba(255,255,255,0.12)',
          transition: 'width 0.3s ease, background 0.3s ease',
        }} />
      ))}
    </div>
  );

  // Title block shared by all steps
  const TitleBlock = ({ title, hint }) => (
    <div style={{ textAlign: 'center', marginTop: 14 }}>
      <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
        fontSize: 30, lineHeight: 1.05, fontWeight: 400, letterSpacing: -0.5 }}>
        {title}
      </div>
      <StepDots />
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--tx-60)',
        lineHeight: 1.5, letterSpacing: -0.05, maxWidth: 280, margin: '10px auto 0' }}>
        {hint}
      </div>
    </div>
  );

  // Common page shell
  const Shell = ({ children }) => (
    <div className="no-scrollbar" style={{ height: '100%', display: 'flex',
      flexDirection: 'column', padding: '20px 18px 24px',
      position: 'relative', overflowY: 'auto' }}>
      <NavRow />
      {children}
    </div>
  );

  // ── STEP 1 — Секретная фраза ───────────────────────────────
  if (step === 1) return (
    <Shell>
      <TitleBlock
        title="Секретная фраза"
        hint="Фраза — ваш общий секрет. Она обрабатывается в браузере через Argon2id; на сервер уходит только MD5-хеш — восстановить фразу по нему невозможно."
      />

      <div style={{ marginTop: 20 }}>
        <Glass radius={18} padding="10px 14px" strong>
          <input
            autoFocus
            value={phrase}
            onChange={(e) => setPhrase((e.target.value || '').toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleNext1()}
            placeholder="например: пушкин-кафе-22"
            maxLength={120}
            inputMode="text"
            enterKeyHint="next"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--tx-100)', fontSize: 15, fontWeight: 500,
              letterSpacing: -0.1, padding: '4px 0', fontFamily: 'inherit',
            }}
          />
        </Glass>

        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 10 }}>
          <button onClick={() => onGenerateSeed && onGenerateSeed()}
            style={{
              height: 28, padding: '0 12px', border: 'none', cursor: 'pointer',
              borderRadius: 9999, background: 'rgba(255,255,255,0.06)',
              color: 'var(--tx-80)', fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6,
              fontFamily: 'inherit', textTransform: 'uppercase',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
            }}>
            ⤵ случайный код
          </button>
          <div style={{ fontSize: 10, color: 'var(--tx-40)',
            letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {(phrase || '').length} / 120
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 20 }} />

      <GlassButton primary palette={palette}
        icon={<Icon.Arrow size={15} color={p.text} dir="right" />}
        iconRight
        onClick={handleNext1}>
        {(phrase || '').trim() ? 'Далее' : 'Сгенерировать и продолжить'}
      </GlassButton>
    </Shell>
  );

  // ── STEP 2 — Параметры сессии ──────────────────────────────
  if (step === 2) return (
    <Shell>
      <TitleBlock
        title="Параметры сессии"
        hint="Срок жизни — когда сессия самоуничтожится. Число мест — сколько человек может подключиться. После создания изменить нельзя."
      />

      {/* TTL chooser */}
      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 10, color: 'var(--tx-40)', letterSpacing: 1.4,
          textTransform: 'uppercase', marginBottom: 10,
          fontFamily: "'Geist Mono', monospace", textAlign: 'center' }}>
          активна · сколько времени
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          {ttlOptions.map(o => (
            <button key={o.id} onClick={() => setTtlId(o.id)}
              style={{
                border: 'none', cursor: 'pointer',
                background: ttlId === o.id ? p.accent : 'rgba(255,255,255,0.06)',
                color: ttlId === o.id ? p.text : 'var(--tx-80)',
                padding: '8px 14px', borderRadius: 9999,
                fontSize: 13, fontWeight: 600, letterSpacing: 0.2, fontFamily: 'inherit',
                boxShadow: ttlId === o.id
                  ? `0 4px 12px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`
                  : 'inset 0 1px 0 rgba(255,255,255,0.12)',
                transition: 'background 0.25s ease, color 0.25s ease',
              }}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* Group size chooser */}
      {Array.isArray(groupOptions) && typeof setGroupMax === 'function' && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 10, color: 'var(--tx-40)', letterSpacing: 1.4,
            textTransform: 'uppercase', marginBottom: 10,
            fontFamily: "'Geist Mono', monospace", textAlign: 'center' }}>
            участников · максимум
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {groupOptions.map(n => (
              <button key={n} onClick={() => setGroupMax(n)}
                style={{
                  border: 'none', cursor: 'pointer',
                  background: groupMax === n ? p.accent : 'rgba(255,255,255,0.06)',
                  color: groupMax === n ? p.text : 'var(--tx-80)',
                  padding: '8px 16px', borderRadius: 9999, minWidth: 44,
                  fontSize: 14, fontWeight: 700, letterSpacing: 0.2,
                  fontFamily: "'Geist Mono', monospace",
                  boxShadow: groupMax === n
                    ? `0 4px 12px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`
                    : 'inset 0 1px 0 rgba(255,255,255,0.12)',
                  transition: 'background 0.25s ease, color 0.25s ease',
                }}>{n}</button>
            ))}
          </div>
          {groupMax === 2 && (
            <div style={{ marginTop: 8, textAlign: 'center',
              fontSize: 11, color: 'var(--tx-40)', letterSpacing: -0.05 }}>
              2 — личная переписка (по умолчанию)
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 20 }} />

      <GlassButton primary palette={palette}
        icon={<Icon.Arrow size={15} color={p.text} dir="right" />}
        iconRight
        onClick={() => setStep(3)}>
        Далее
      </GlassButton>
    </Shell>
  );

  // ── STEP 3 — Пароль ───────────────────────────────────────
  return (
    <Shell>
      <TitleBlock
        title="Пароль входа"
        hint="Защищает вход с этого устройства. Каждый участник задаёт свой пароль — по сети он не передаётся и не участвует в шифровании сообщений."
      />

      {/* Hash preview — subtle confirmation of the phrase */}
      {hash && (
        <div style={{ marginTop: 18 }}>
          <Glass radius={16} padding="10px 12px">
            <div style={{ fontSize: 9, color: 'var(--tx-30)', letterSpacing: 1.2,
              textTransform: 'uppercase', textAlign: 'center', marginBottom: 8,
              fontFamily: "'Geist Mono', monospace" }}>
              идентификатор сессии · MD5
            </div>
            <HashDisplay hash={hash} palette={palette} />
          </Glass>
        </div>
      )}

      {/* Password field */}
      <div style={{ marginTop: 14 }}>
        <Glass radius={18} padding="12px 14px" strong>
          <div style={{ fontSize: 10, color: 'var(--tx-40)', letterSpacing: 1.4,
            textTransform: 'uppercase', marginBottom: 6,
            fontFamily: "'Geist Mono', monospace" }}>
            твой пароль · мин 4 символа
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon.Lock size={16} color="rgba(255,255,255,0.7)" />
            <input
              autoFocus
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && onSubmit()}
              placeholder="придумай"
              enterKeyHint="go"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#fff', fontSize: 18, fontWeight: 600,
                fontFamily: showPwd ? 'Geist Mono, ui-monospace, monospace' : 'inherit',
                letterSpacing: showPwd ? 0.5 : 4, padding: '4px 0',
              }}
            />
            <button onClick={() => setShowPwd(!showPwd)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            }}>
              <Icon.Eye closed={!showPwd} size={16} color="rgba(255,255,255,0.7)" />
            </button>
          </div>
        </Glass>
      </div>

      <RememberMeToggle palette={palette}
        checked={!!rememberMe}
        onChange={(v) => setRememberMe && setRememberMe(v)} />

      {error && (
        <div style={{ marginTop: 12 }}>
          <Glass radius={14} padding="10px 14px">
            <div style={{ fontSize: 12, color: '#ff8a8a', textAlign: 'center', letterSpacing: -0.05 }}>
              {error}
            </div>
          </Glass>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 14 }} />

      <GlassButton primary={canSubmit} palette={palette} disabled={!canSubmit}
        icon={canSubmit
          ? <Icon.Plus size={16} color={p.text} />
          : <Icon.Lock size={14} color="var(--tx-40)" />}
        onClick={onSubmit}>
        {busy ? 'создаём…' : (canSubmit ? 'Создать сессию' : 'введите пароль')}
      </GlassButton>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────
// RememberMeToggle — opt-in checkbox for "Remember me on this device".
// Shared by CreatedScreen and JoinScreen so the wording / visual stay in
// lockstep. Includes the warning copy required by the persistence threat
// model: phrase + password are stored locally encrypted under a device key.
// Default off — the user has to actively check it.
function RememberMeToggle({ palette, checked, onChange }) {
  const p = usePalette(palette);
  return (
    <div style={{ marginTop: 10 }}>
      <Glass radius={14} padding="10px 12px">
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
          <input type="checkbox" checked={!!checked}
            onChange={(e) => onChange && onChange(!!e.target.checked)}
            style={{
              appearance: 'auto', WebkitAppearance: 'checkbox',
              width: 16, height: 16, marginTop: 2,
              accentColor: p.accent || '#7be0b1',
              cursor: 'pointer', flexShrink: 0,
            }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--tx-100)',
              letterSpacing: -0.1, lineHeight: 1.35,
            }}>
              Запомнить на этом устройстве
            </div>
            <div style={{
              marginTop: 4, fontSize: 11, color: 'var(--tx-60)',
              lineHeight: 1.45, letterSpacing: -0.05,
            }}>
              После закрытия вкладки сессия откроется автоматически.
              Фраза и пароль будут зашифрованы в браузере.
            </div>
          </div>
        </label>
      </Glass>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Live "is this room real?" badge shown under the phrase input on JoinScreen.
// Renders one of four states from the /r/peek probe:
//   • loading  — soft "проверяем…" while the debounced fetch is in flight
//   • exists   — green dot + "онлайн N / макс M · истекает через …"
//   • missing  — neutral "сессии с такой фразой нет — она будет создана"
//   • error    — quiet network hint
// Nothing renders when peek === null (no input yet).
function PeekBadge({ peek, palette }) {
  const p = usePalette(palette);
  if (!peek) return null;

  const wrap = (children, tone) => (
    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}>
      <Glass radius={9999} padding="6px 12px">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
          textTransform: 'uppercase', color: tone || 'var(--tx-80)',
          fontFamily: 'inherit',
        }}>
          {children}
        </div>
      </Glass>
    </div>
  );

  if (peek.state === 'loading') {
    return wrap(<><Dot color="var(--tx-40)" />проверяем…</>, 'var(--tx-60)');
  }
  if (peek.state === 'error') {
    return wrap(<><Dot color="var(--tx-40)" />проверить не вышло</>, 'var(--tx-60)');
  }
  if (peek.state === 'missing') {
    return wrap(<><Dot color="var(--tx-40)" />новой сессии нет · будет создана</>, 'var(--tx-60)');
  }
  // exists
  const ttlLeftMs = Math.max(0, (peek.expiresAt || 0) - Date.now());
  const ttlLabel = formatTtlShort(ttlLeftMs);
  const full = peek.groupMax > 0 && peek.claimed >= peek.groupMax;
  return wrap(
    <>
      <Dot color={full ? '#ff8a8a' : (p.a || '#7be0b1')} />
      онлайн {peek.online}/{peek.groupMax}
      <span style={{ color: 'var(--tx-40)' }}>·</span>
      {full ? 'мест нет' : `мест ${peek.groupMax - peek.claimed}`}
      {ttlLabel && (<><span style={{ color: 'var(--tx-40)' }}>·</span>{ttlLabel}</>)}
    </>,
    full ? '#ff8a8a' : 'var(--tx-80)'
  );
}

function Dot({ color }) {
  return <span style={{
    width: 6, height: 6, borderRadius: 9999, background: color,
    boxShadow: '0 0 8px ' + color, display: 'inline-block',
  }} />;
}

function formatTtlShort(ms) {
  if (!ms || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60)      return s + 'с';
  const m = Math.floor(s / 60);
  if (m < 60)      return m + ' мин';
  const h = Math.floor(m / 60);
  if (h < 24)      return h + ' ч';
  const d = Math.floor(h / 24);
  return d + ' дн';
}

function JoinScreen({ palette, value, setValue, password, setPassword,
                      rememberMe, setRememberMe,
                      onBack, onContinue, onCreateInstead, busy, error }) {
  const p = usePalette(palette);
  const [showPwd, setShowPwd] = React.useState(false);
  const trimmed = (value || '').trim();
  const hashRegex = /^[a-f0-9]{32}$/i;
  const isHash = hashRegex.test(trimmed);
  const finalHash = trimmed ? (isHash ? trimmed.toLowerCase() : md5(trimmed)) : '';
  const validInput = trimmed.length > 0;
  const valid = validInput && password.length >= 4 && !busy;

  // Probe the relay so the user sees, before entering a password, whether the
  // room is alive — and if so, how many slots are filled / online. Debounced
  // 350ms so a fast typist doesn't fire one peek per keystroke. We ignore
  // any peek result that lands after the input has changed (cancelled flag),
  // so the badge never flickers with stale state.
  const [peek, setPeek] = React.useState(null);
  React.useEffect(() => {
    if (!finalHash) { setPeek(null); return; }
    let cancelled = false;
    setPeek({ state: 'loading' });
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const r = (window.Nee2PPeek && window.Nee2PPeek.peekRoom)
        ? await window.Nee2PPeek.peekRoom(finalHash)
        : { ok: false };
      if (cancelled) return;
      if (!r || !r.ok)      { setPeek({ state: 'error' }); return; }
      if (!r.exists)        { setPeek({ state: 'missing' }); return; }
      setPeek({ state: 'exists',
        online: r.online | 0, claimed: r.claimed | 0,
        groupMax: r.groupMax | 0, expiresAt: r.expiresAt || 0,
        paired: !!r.paired });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [finalHash]);

  // When the live probe says "no such room", we flip the screen into a
  // create-offer: password / remember-me are hidden (CreatedScreen will collect
  // them) and the primary CTA pivots to "Создать сессию с этой фразой". Until
  // we have a confirmed missing state we keep the join UI exactly as-is so a
  // brief loading / network-error doesn't ping-pong the layout.
  const isMissing = !!(peek && peek.state === 'missing'
                       && validInput
                       && typeof onCreateInstead === 'function');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '24px 18px 24px', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div onClick={onBack} style={{
          width: 38, height: 38, borderRadius: 12,
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Icon.Arrow size={16} color="#fff" dir="left" />
        </div>
        <Logo size={9} palette={palette} />
        <div style={{ width: 38 }} />
      </div>

      <div style={{ textAlign: 'center', marginTop: 26 }}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontSize: 32, lineHeight: 1.0, fontWeight: 400, letterSpacing: -0.6 }}>
          Подключиться
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--tx-60)',
          letterSpacing: -0.05, maxWidth: 280, margin: '6px auto 0' }}>
          Введите секретную фразу или вставьте MD5-хеш — мы сами поймём что это.
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <Glass radius={20} padding="14px 16px" strong>
          <textarea
            value={value}
            onChange={(e) => setValue((e.target.value || '').toLowerCase())}
            placeholder="любая фраза или 32 символа хеша"
            rows={3}
            inputMode="text"
            enterKeyHint="next"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--tx-100)', fontSize: 16, fontWeight: 500,
              letterSpacing: -0.1, fontFamily: 'inherit',
              resize: 'none', minHeight: 64,
            }}
          />
        </Glass>

        {/* — live room status: exists? how many online of how many? — */}
        <PeekBadge peek={peek} palette={palette} />

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10, gap: 8 }}>
          {value && (
            <button onClick={() => setValue('')}
              style={{
                height: 32, padding: '0 12px', border: 'none', cursor: 'pointer',
                borderRadius: 12, background: 'rgba(255,255,255,0.06)',
                color: 'var(--tx-60)', fontSize: 11, fontWeight: 500,
                fontFamily: 'inherit', letterSpacing: 0.3, textTransform: 'uppercase',
              }}>
              стереть
            </button>
          )}
        </div>
      </div>

      {validInput && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 10, color: 'var(--tx-60)', letterSpacing: 1.4, textTransform: 'uppercase',
            marginBottom: 8 }}>
            {isHash ? (
              <>
                <Icon.Check size={11} color={p.a} />
                md5-хеш
              </>
            ) : (
              <>
                <Icon.Key size={11} color="var(--tx-60)" />
                фраза → md5
              </>
            )}
          </div>
          <Glass radius={14} padding="10px 8px">
            <HashDisplay hash={finalHash} palette={palette} />
          </Glass>
        </div>
      )}

      {/* — password field — hidden when we're pivoting to create-offer — */}
      {!isMissing && (
        <div style={{ marginTop: 14 }}>
          <Glass radius={18} padding="12px 14px" strong>
            <div style={{ fontSize: 10, color: 'var(--tx-40)', letterSpacing: 1.4,
              textTransform: 'uppercase', marginBottom: 6, fontFamily: "'Geist Mono', monospace" }}>
              твой пароль · мин 4 символа
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon.Lock size={16} color="rgba(255,255,255,0.7)" />
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && valid && onContinue()}
                placeholder="твой / новый, если ты первый"
                enterKeyHint="go"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: '#fff', fontSize: 18, fontWeight: 600,
                  fontFamily: showPwd ? 'Geist Mono, ui-monospace, monospace' : 'inherit',
                  letterSpacing: showPwd ? 0.5 : 4,
                  padding: '4px 0',
                }}
              />
              <button onClick={() => setShowPwd(!showPwd)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              }}>
                <Icon.Eye closed={!showPwd} size={16} color="rgba(255,255,255,0.7)" />
              </button>
            </div>
          </Glass>
        </div>
      )}

      {!isMissing && (
        <RememberMeToggle palette={palette}
          checked={!!rememberMe}
          onChange={(v) => setRememberMe && setRememberMe(v)} />
      )}

      {error && (
        <div style={{ marginTop: 12 }}>
          <Glass radius={14} padding="10px 14px">
            <div style={{ fontSize: 12, color: '#ff8a8a', textAlign: 'center', letterSpacing: -0.05 }}>
              {error}
            </div>
          </Glass>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 12 }} />

      {isMissing ? (
        <GlassButton primary palette={palette}
          icon={<Icon.Plus size={16} color={p.text} />}
          onClick={() => onCreateInstead(value)}>
          Создать сессию с этой фразой
        </GlassButton>
      ) : (
        <GlassButton primary={valid} palette={palette} disabled={!valid}
          icon={valid ? <Icon.Arrow size={16} color={p.text} /> : <Icon.Lock size={14} color="var(--tx-40)" />}
          onClick={onContinue}>
          {busy ? 'подключение…' : (valid ? 'Подключиться' : 'фраза и пароль нужны оба')}
        </GlassButton>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function PasswordScreen({ palette, perspective, password, setPassword, onBack, onContinue }) {
  const p = usePalette(palette);
  const [show, setShow] = React.useState(false);
  const strength = Math.min(4, Math.floor(password.length / 3));
  const strengthLabel = ['too short', 'weak', 'okay', 'good', 'strong'][strength];
  const valid = password.length >= 4;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '24px 22px 30px', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div onClick={onBack} style={{
          width: 38, height: 38, borderRadius: 12,
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Icon.Arrow size={16} color="#fff" dir="left" />
        </div>
        <Logo size={9} palette={palette} />
        <div style={{ width: 38 }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
        <Glass radius={9999} padding="6px 12px">
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.6,
            textTransform: 'uppercase' }}>
            step 2 of 2 · your secret
          </span>
        </Glass>
      </div>

      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontSize: 36, lineHeight: 1.05, fontWeight: 400, letterSpacing: -0.6 }}>
          Choose your<br/>
          <span style={{ background: p.accent, WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            secret word
          </span>
        </div>
        <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,0.55)',
          maxWidth: 260, margin: '10px auto 0', lineHeight: 1.45 }}>
          Only you will ever know this.<br/>If you forget it, the session is gone.
        </div>
      </div>

      <div style={{ marginTop: 26 }}>
        <Glass radius={22} padding="16px 18px" strong>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.6,
            textTransform: 'uppercase', marginBottom: 6 }}>
            you are {perspective === 'A' ? '⬤ side A' : '○ side B'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon.Lock size={18} color="rgba(255,255,255,0.7)" />
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && valid && onContinue()}
              placeholder="type your secret"
              autoFocus
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#fff', fontSize: 22, fontWeight: 600,
                fontFamily: show ? 'Geist Mono, ui-monospace, monospace' : 'inherit',
                letterSpacing: show ? 1 : 6,
                padding: '6px 0',
              }}
            />
            <button onClick={() => setShow(!show)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 6,
            }}>
              <Icon.Eye closed={!show} size={18} color="rgba(255,255,255,0.7)" />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: i < strength
                  ? (i < 2 ? '#ff5a5a' : i < 3 ? '#ffb13d' : p.a)
                  : 'rgba(255,255,255,0.08)',
                boxShadow: i < strength ? `0 0 8px ${i < 2 ? '#ff5a5a' : i < 3 ? '#ffb13d' : p.a}80` : 'none',
                transition: 'all 0.3s ease',
              }} />
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)',
            letterSpacing: 0.3, textTransform: 'uppercase' }}>
            {strengthLabel}
          </div>
        </Glass>
      </div>

      <div style={{ marginTop: 14 }}>
        <Glass radius={18} padding="12px 14px">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 9, flexShrink: 0,
              background: 'rgba(255,150,50,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon.Flame size={14} color="#ff9a4d" />
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
              <b style={{ color: '#fff', fontWeight: 600 }}>Nothing is stored.</b> Both secrets unlock the session. If either is lost, the conversation is gone forever.
            </div>
          </div>
        </Glass>
      </div>

      <div style={{ flex: 1 }} />

      <GlassButton primary={valid} palette={palette} disabled={!valid} onClick={onContinue}
        icon={valid ? <Icon.Arrow size={16} color={p.text} /> : <Icon.Lock size={16} color="rgba(255,255,255,0.5)" />}>
        {valid ? 'Seal & continue' : 'min 4 characters'}
      </GlassButton>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function WaitingScreen({ palette, perspective, peerSealed }) {
  const p = usePalette(palette);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '24px 22px 30px', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ width: 38 }} />
        <Logo size={9} palette={palette} />
        <div style={{ width: 38 }} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center' }}>

        <div style={{ position: 'relative', width: 240, height: 140, marginBottom: 32 }}>
          <div style={{
            position: 'absolute', top: '50%', left: 20, right: 20, height: 1,
            transform: 'translateY(-50%)',
            background: `linear-gradient(90deg, ${p.a}, ${p.b})`,
            boxShadow: `0 0 12px ${p.a}80`,
          }} />
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              position: 'absolute', top: '50%', width: 6, height: 6, borderRadius: '50%',
              background: '#fff', transform: 'translateY(-50%)',
              boxShadow: `0 0 10px ${p.a}`,
              animation: `scan-x 2s ease-in-out ${i * 0.6}s infinite`,
              left: 30,
            }} />
          ))}
          <style>{`
            @keyframes scan-x {
              0% { transform: translate(0, -50%); opacity: 0; }
              20% { opacity: 1; }
              80% { opacity: 1; }
              100% { transform: translate(170px, -50%); opacity: 0; }
            }
          `}</style>

          {/* my side — sealed */}
          <div style={{
            position: 'absolute', top: '50%', left: 0, transform: 'translateY(-50%)',
            width: 60, height: 60, borderRadius: '50%',
            background: p.accent,
            boxShadow: `0 8px 32px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon.Check size={22} color={p.text} />
          </div>
          {/* partner — sealed or pending */}
          <div style={{
            position: 'absolute', top: '50%', right: 0,
            transform: 'translateY(-50%)',
            width: 60, height: 60,
          }}>
            {peerSealed ? (
              <div style={{
                width: 60, height: 60, borderRadius: '50%',
                background: p.accent,
                boxShadow: `0 8px 32px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon.Check size={22} color={p.text} />
              </div>
            ) : (
              <div style={{
                width: 60, height: 60, borderRadius: '50%',
                background: 'rgba(255,255,255,0.05)',
                backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                border: '1px dashed rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'pulse-dot 1.8s ease-in-out infinite',
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  animation: 'spin 1s linear infinite',
                }} />
              </div>
            )}
          </div>
        </div>

        <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontSize: 28, lineHeight: 1.1, fontWeight: 400, letterSpacing: -0.4,
          textAlign: 'center' }}>
          Your secret is sealed.<br/>
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>
            {peerSealed ? 'Opening the session…' : 'Waiting on the other side…'}
          </span>
        </div>

        <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.5)',
          textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
          The session opens only when both passwords are set. We can't unlock it. They can't lose it.
        </div>
      </div>

      <Glass radius={18} padding="14px 16px" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 11,
            background: `linear-gradient(135deg, ${p.a}40, ${p.b}40)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon.Ghost size={18} color="#fff" />
          </div>
          <div style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>
            Не закрывайте приложение. Как только второй запечатает — откроется чат.
          </div>
        </div>
      </Glass>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function ShareCodeCard({ palette, hash, phrase, partnerClaimed }) {
  const p = usePalette(palette);
  const [copied, setCopied] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);
  const copyValue = phrase || hash;
  // hash-fragment deep link: the fragment NEVER reaches our origin nor any
  // CDN; only the local browser sees the phrase. Receiving tab parses it on
  // load and pre-fills the join screen.
  const deepLink = (() => {
    const origin = (typeof location !== 'undefined') ? (location.origin + location.pathname) : '';
    return origin + '#join=' + encodeURIComponent(copyValue);
  })();
  const doCopy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(copyValue); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const doShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Nee2P. session', text: copyValue, url: deepLink });
      else doCopy();
    } catch {}
  };
  return (
    <Glass radius={18} padding="12px 14px" style={{ alignSelf: 'stretch', margin: '0 4px' }} data-share-card>
      <div style={{ fontSize: 10, color: 'var(--tx-40)', letterSpacing: 1.4,
        textTransform: 'uppercase', textAlign: 'center', marginBottom: 8,
        fontFamily: "'Geist Mono', monospace" }}>
        {partnerClaimed ? 'партнёр зашёл — ждёт пароль' : 'отправь код партнёру'}
      </div>
      {phrase && (
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx-100)',
          textAlign: 'center', marginBottom: 8, wordBreak: 'break-word' }}>
          {phrase}
        </div>
      )}
      <HashDisplay hash={hash} palette={palette} />
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button onClick={doCopy}
          style={{
            flex: 1, height: 34, border: 'none', cursor: 'pointer',
            borderRadius: 10, background: 'rgba(255,255,255,0.08)',
            color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 0.5px rgba(255,255,255,0.10)',
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>
          {copied
            ? <><Icon.Check size={12} color={p.a} /> скопировано</>
            : <><Icon.Copy size={12} /> {phrase ? 'фразу' : 'хеш'}</>}
        </button>
        <button onClick={() => setQrOpen(true)} style={{
          width: 34, height: 34, border: 'none', cursor: 'pointer',
          borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 0.5px rgba(255,255,255,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} title="показать QR">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M20 14v3M14 20h3M20 20v.01" strokeLinecap="round"/>
          </svg>
        </button>
        <button onClick={doShare} style={{
          width: 34, height: 34, border: 'none', cursor: 'pointer',
          borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 0.5px rgba(255,255,255,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 3v13M12 3l-4 4M12 3l4 4M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5"
              stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {qrOpen && (
        <QrModal palette={palette} value={deepLink} label={phrase || hash} onClose={() => setQrOpen(false)} />
      )}
    </Glass>
  );
}

// QR modal — renders the deep-link via the vendored qrcode-generator lib.
// Showing the URL means scanner-app users land in their browser on the join
// screen with the phrase pre-filled — zero copy-paste handoff.
function QrModal({ palette, value, label, onClose }) {
  const p = usePalette(palette);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    try {
      // qrcode-generator: qrcode(typeNumber, errorCorrectLevel)
      const qr = window.qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      // 8px cells, 4-cell margin, foreground white on transparent
      ref.current.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
      const svg = ref.current.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.background = '#fff';
        svg.style.borderRadius = '14px';
      }
    } catch (e) {
      ref.current.textContent = 'QR render failed';
    }
  }, [value]);
  return (
    <div onPointerDown={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(6,6,10,0.72)', backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fade-up 0.16s ease', padding: 24,
    }}>
      <div onPointerDown={(e) => e.stopPropagation()} style={{
        width: 'calc(100% - 24px)', maxWidth: 320,
        borderRadius: 22, padding: 18,
        background: 'rgba(20,20,28,0.96)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 0.5px rgba(255,255,255,0.10)',
      }}>
        <div style={{ fontSize: 10, color: 'var(--tx-40)', letterSpacing: 1.4,
          textTransform: 'uppercase', textAlign: 'center', marginBottom: 10,
          fontFamily: "'Geist Mono', monospace" }}>
          сканируй с телефона
        </div>
        <div ref={ref} />
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--tx-60)',
          textAlign: 'center', wordBreak: 'break-word' }}>
          {label}
        </div>
        <button onClick={onClose} style={{
          width: '100%', marginTop: 14, padding: '10px 14px', border: 'none',
          cursor: 'pointer', borderRadius: 12, background: 'rgba(255,255,255,0.08)',
          color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
        }}>закрыть</button>
      </div>
    </div>
  );
}

// URL detector — turn http(s)://... runs into clickable <a>. The rest of the
// message is plain text wrapped in spans (so XSS isn't possible — React
// escapes children).
// IMPORTANT: keep URL_RE INSIDE renderText. As a module-level /g regex it
// retains `lastIndex` across calls — the second call on a shorter string
// silently skips the match, dropping links from every other bubble.
function renderText(text) {
  const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"',.!?)]/gi;
  const out = [];
  let last = 0;
  let m;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={out.length} href={m[0]} target="_blank" rel="noopener noreferrer"
         style={{ color: 'inherit', textDecoration: 'underline',
                  textDecorationColor: 'currentColor', wordBreak: 'break-all' }}>
        {m[0]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ── Cinny-style "time divider" chip ────────────────────────
// Renders a centered glass pill between two messages when their `at` (client-
// side ingest timestamp) gap is > 10 minutes or they fall on a different day.
// Label format follows Russian-natural phrasing: "сегодня в 03:14",
// "вчера в 21:30", "23 мая, 10:01". `now` is the current ms-since-epoch (used
// only to decide whether the divider's day is "today" / "yesterday").
const TIME_DIVIDER_MS = 10 * 60 * 1000;
const RU_MONTHS_GEN = [
  'января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря',
];
function _pad2(n) { return n < 10 ? '0' + n : '' + n; }
function _ymd(ts) {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function formatDividerLabel(ts, now) {
  if (!ts) return '';
  const d = new Date(ts);
  const hhmm = _pad2(d.getHours()) + ':' + _pad2(d.getMinutes());
  const today = _ymd(now);
  const ymd = _ymd(ts);
  if (ymd === today) return 'сегодня в ' + hhmm;
  // Yesterday = today minus one calendar day in local time.
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (ymd === _ymd(y.getTime())) return 'вчера в ' + hhmm;
  return d.getDate() + ' ' + RU_MONTHS_GEN[d.getMonth()] + ', ' + hhmm;
}

// Walk a chronological message list once and tag each item with cluster info:
//   isFirstInCluster   — true if this is the first bubble of a sender run
//   isLastInCluster    — true if this is the last bubble of a sender run
//                        (cluster footer — sender label / time / read receipt)
//   showTimeDivider    — true if we should render a chip BEFORE this message
//                        (gap > 10min from previous, or different calendar day)
// A "cluster" is a chain of consecutive same-side messages with no time
// divider between them. Reactions / replies / blobs still work inside.
// `slotUtil.coerceSlot` is required to normalise legacy 'A'/'B' sides.
function annotateClusters(list, coerceSlot) {
  const n = list.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const m = list[i];
    const prev = i > 0 ? list[i - 1] : null;
    const next = i + 1 < n ? list[i + 1] : null;
    const mSide = coerceSlot(m.side);
    const prevSide = prev ? coerceSlot(prev.side) : null;
    const nextSide = next ? coerceSlot(next.side) : null;
    const mAt = typeof m.at === 'number' ? m.at : 0;
    const prevAt = prev && typeof prev.at === 'number' ? prev.at : 0;
    const nextAt = next && typeof next.at === 'number' ? next.at : 0;
    // A divider FORCES the cluster to break — regardless of side equality.
    const showTimeDivider = !!prev && (
      (mAt && prevAt && (mAt - prevAt) > TIME_DIVIDER_MS) ||
      (mAt && prevAt && _ymd(mAt) !== _ymd(prevAt))
    );
    const breakBefore = !prev || showTimeDivider || prevSide !== mSide;
    const breakAfter  = !next || nextSide !== mSide ||
      (mAt && nextAt && (
        (nextAt - mAt) > TIME_DIVIDER_MS ||
        _ymd(mAt) !== _ymd(nextAt)
      ));
    out[i] = {
      msg: m,
      showTimeDivider,
      isFirstInCluster: breakBefore,
      isLastInCluster: breakAfter,
    };
  }
  return out;
}

// Small local 1-Hz hook. Lives inside each consumer (ChatScreen, ShareScreen)
// instead of in App, so re-rendering the clock no longer re-renders the whole
// app + every chat bubble. Returns Date.now() updated once per second while
// `enabled` is true (default true).
function useNow(enabled = true) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

function ChatScreen({ palette, perspective, groupMax = 2, participants = null,
                       expiresAt, totalSeconds,
                       partnerOnline, partnerClaimed, partnerTyping, paired,
                       messages, sessionHash, sharePhrase, peerLastReadId,
                       safetyFingerprint,
                       onSend, onDelete, onMarkRead, onReact, onBack, banner,
                       onAttach, onVoice, onBlobUrl, uploadProgress = 0,
                       connStatus = 'live' }) {
  // Local 1-Hz ticker — only ChatScreen re-renders, not all of App.
  const now = useNow(true);
  const expirySeconds = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
  // Slot helpers exposed by nee2p-app.jsx (Map/coerce/label/hue/friendly).
  // Fall back to letter-based labels when this file is loaded standalone.
  const slotUtil = window.Nee2PSlotUtil || {
    coerceSlot: (v) => (typeof v === 'number' ? v : (v === 'A' ? 0 : v === 'B' ? 1 : null)),
    slotLabel: (n, gm) => (gm === 2 ? (n === 0 ? 'A' : 'B') : 'Участник ' + (n + 1)),
    slotHue: (n) => Math.round(((n || 0) * 137.508) % 360),
    friendlyName: () => '',
  };
  // Convenience for friendly-name lookups against the current session id.
  // sessionHash uniquely identifies the room; both peers compute the same
  // hash, so friendlyName(sessionHash, slotNum) returns a label both see.
  const friendlyFor = (slotNum) => {
    if (slotNum == null || slotNum < 0) return '';
    if (typeof slotUtil.friendlyName !== 'function') return '';
    return slotUtil.friendlyName(sessionHash || '', slotNum) || '';
  };
  const p = usePalette(palette);
  const [input, setInput] = React.useState('');
  const inputRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const typingTimerRef = React.useRef(null);
  const typingStateRef = React.useRef({ on: false, lastSentAt: 0 });
  // long-press menu: { msg } | null
  const [menuMsg, setMenuMsg] = React.useState(null);
  // safety-numbers modal
  const [safetyOpen, setSafetyOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQ, setSearchQ] = React.useState('');
  const searchInputRef = React.useRef(null);
  React.useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current && searchInputRef.current.focus(), 50);
    else setSearchQ('');
  }, [searchOpen]);
  const longPressRef = React.useRef(null);
  const longPressFiredRef = React.useRef(false);
  // structured reply
  const [replyingTo, setReplyingTo] = React.useState(null);  // msg or null
  // burn-after-read TTL (per-msg). null = no auto-burn. One of 10|60|3600.
  const [burnTtl, setBurnTtl] = React.useState(null);
  // virtualization: render only the last N messages. At 1000+ msgs a typing
  // indicator state change would re-render every bubble; this caps the cost.
  // User can expand via the "Загрузить ещё" button at the top.
  const [renderWindow, setRenderWindow] = React.useState(200);
  const messagesById = React.useMemo(() => {
    const m = new Map();
    for (const x of messages) if (x.id) m.set(x.id, x);
    return m;
  }, [messages]);
  // fullscreen image overlay (click thumb to open)
  const [fullscreenUrl, setFullscreenUrl] = React.useState(null);

  // ── voice recording state ─────────────────────────────────
  const [recording, setRecording] = React.useState(null);
  // recording = null | { startMs, elapsed, cancel, dragDx }
  const recRef = React.useRef(null);
  // recRef.current = { mediaRecorder, chunks, stream, startMs, pointerStartX, mime }
  const micStreamRef = React.useRef(null);                 // cached MediaStream
  const [micDenied, setMicDenied] = React.useState(false);
  const [micToast, setMicToast] = React.useState(null);
  const recTimerRef = React.useRef(null);

  // Pick a MediaRecorder mime that the current browser actually supports.
  // Safari (iOS + macOS) does NOT do webm/opus — only mp4/aac. Pick the
  // first match; if none, hand MediaRecorder the empty string (browser
  // default) and trust it to produce SOMETHING playable.
  function pickRecorderMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/aac',
      'audio/ogg;codecs=opus',
    ];
    for (const c of candidates) {
      try { if (MediaRecorder.isTypeSupported(c)) return c; } catch {}
    }
    return '';
  }

  // Acquire (or reuse cached) microphone stream. Only prompts once per
  // ChatScreen mount; cached stream is released on unmount.
  async function ensureMicStream() {
    if (micStreamRef.current) return micStreamRef.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = s;
      setMicDenied(false);
      return s;
    } catch (e) {
      setMicDenied(true);
      setMicToast('Микрофон недоступен');
      setTimeout(() => setMicToast(null), 2500);
      throw e;
    }
  }

  // Release the mic stream on unmount so the OS-level red dot goes away.
  React.useEffect(() => () => {
    try {
      if (micStreamRef.current) {
        for (const t of micStreamRef.current.getTracks()) t.stop();
        micStreamRef.current = null;
      }
    } catch {}
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
  }, []);

  // Keyboard-aware scroll: on iOS Safari the soft keyboard slides in over
  // 350–500ms and shrinks visualViewport.height. Whenever that height drops
  // (keyboard up), pull the focused input into view. Falls back to the
  // setTimeout in input.onFocus when visualViewport isn't available.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    let lastH = vv.height;
    const onResize = () => {
      const h = vv.height;
      const shrunk = h < lastH - 40; // ignore noise; ~40px == keyboard event
      lastH = h;
      if (!shrunk) return;
      const active = document.activeElement;
      const ours = inputRef.current;
      if (active && ours && active === ours) {
        try { ours.scrollIntoView({ block: 'nearest' }); } catch {}
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  // mark messages as read when they appear and tab is focused. Dedupe by
  // remembering the last id we already acked — at high traffic the previous
  // effect would re-fire on every state update and flood the relay with
  // duplicate PUT {type:'read'} for the same msg id.
  const lastMarkedReadRef = React.useRef(null);
  React.useEffect(() => {
    if (!onMarkRead || messages.length === 0) return;
    const latestFromPeer = [...messages].reverse().find(m => {
      const sideNum = slotUtil.coerceSlot(m.side);
      return sideNum !== null && sideNum !== perspective;
    });
    if (!latestFromPeer) return;
    if (document.visibilityState !== 'visible') return;
    if (lastMarkedReadRef.current === latestFromPeer.id) return;
    lastMarkedReadRef.current = latestFromPeer.id;
    onMarkRead(latestFromPeer.id);
  }, [messages, perspective, onMarkRead]);

  const openMenu = (msg) => {
    setMenuMsg(msg);
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} }
  };
  const closeMenu = () => setMenuMsg(null);

  const onMsgPointerDown = (msg) => () => {
    longPressFiredRef.current = false;
    clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      openMenu(msg);
    }, 450);
  };
  const onMsgPointerEnd = () => {
    clearTimeout(longPressRef.current);
  };
  const onMsgPointerCancel = () => {
    clearTimeout(longPressRef.current);
  };
  const onMsgContextMenu = (msg) => (e) => {
    e.preventDefault();
    openMenu(msg);
  };

  const quoteMessage = (msg) => {
    setReplyingTo(msg);
    closeMenu();
    setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
  };
  const cancelReply = () => setReplyingTo(null);
  const deleteMessage = (msg) => {
    if (onDelete) onDelete(msg.id);
    closeMenu();
  };

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, partnerTyping]);

  // Debounced typing signal: only send `true` once per ~1s; always send `false`
  // when the user stops or sends. Avoids one PUT per keystroke (which used to
  // saturate the browser's per-host connection cap).
  const sendTyping = (on) => {
    if (!window.__nee2pTypingSend) return;
    const now = Date.now();
    const st = typingStateRef.current;
    if (on) {
      if (!st.on || now - st.lastSentAt > 4000) {
        st.on = true; st.lastSentAt = now;
        window.__nee2pTypingSend(true);
      }
    } else {
      if (st.on) {
        st.on = false; st.lastSentAt = now;
        window.__nee2pTypingSend(false);
      }
    }
  };

  const hh = String(Math.floor(expirySeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((expirySeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(expirySeconds % 60).padStart(2, '0');
  const lowTime = expirySeconds < 600;

  // For 2-party rooms we still show a single avatar with the peer's letter.
  // For groups we show a row of peer letters / numbers in the header instead.
  const isGroup = groupMax > 2;
  const partnerSlotNum = perspective === 0 ? 1 : 0;
  const partnerLetter = isGroup
    ? null
    : slotUtil.slotLabel(partnerSlotNum, groupMax);
  // OnionShare-style friendly display name for the OTHER side of a 2-party
  // chat. Both peers compute the same name from (sessionHash, slotNum), so no
  // sync needed. Empty string until sessionHash is available (during handshake).
  const partnerFriendly = isGroup ? '' : friendlyFor(partnerSlotNum);

  const send = () => {
    if (!input.trim()) return;
    onSend(input.trim(), {
      replyTo: replyingTo?.id || null,
      ttlSecAfterRead: burnTtl || null,
    });
    setInput('');
    setReplyingTo(null);
    // burnTtl stays "sticky" so multiple disappearing messages in a row don't
    // require re-tapping the chip. User taps "выкл" to disable.
    clearTimeout(typingTimerRef.current);
    sendTyping(false);
  };

  // ── attachments ─────────────────────────────────────────
  const onPaperclip = () => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';     // allow picking the same file twice
    fileInputRef.current.click();
  };
  const onFilePicked = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (onAttach) {
        try { await onAttach(f); } catch (err) { console.warn('attach failed', err); }
      }
    }
  };

  // ── voice recording ─────────────────────────────────────
  // 32-sample RMS waveform across the recorded buffer.
  async function computeWaveform(arrayBuf, mime) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return [];
      const tmp = new AC();
      const decoded = await tmp.decodeAudioData(arrayBuf.slice(0));
      tmp.close();
      const ch = decoded.getChannelData(0);
      const N = 32;
      const out = new Array(N).fill(0);
      const block = Math.max(1, Math.floor(ch.length / N));
      let max = 0;
      for (let i = 0; i < N; i++) {
        let sum = 0;
        const start = i * block;
        const end = Math.min(ch.length, start + block);
        for (let j = start; j < end; j++) sum += ch[j] * ch[j];
        const rms = Math.sqrt(sum / Math.max(1, end - start));
        out[i] = rms;
        if (rms > max) max = rms;
      }
      // normalize to 0..1
      if (max > 0) for (let i = 0; i < N; i++) out[i] = out[i] / max;
      return out.map(v => Math.round(v * 100) / 100);
    } catch (e) {
      return [];
    }
  }

  const startRecording = async () => {
    if (recRef.current) return;          // already recording
    try {
      const stream = await ensureMicStream();
      const mime = pickRecorderMime();
      const opts = mime ? { mimeType: mime } : undefined;
      const mr = new MediaRecorder(stream, opts);
      const chunks = [];
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
      const ctx = { mediaRecorder: mr, chunks, stream, startMs: Date.now(),
                    pointerStartX: 0, mime: mime || (mr.mimeType || 'audio/webm'),
                    cancelled: false };
      recRef.current = ctx;
      mr.start();
      setRecording({ startMs: ctx.startMs, elapsed: 0, dragDx: 0, cancel: false });
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      recTimerRef.current = setInterval(() => {
        setRecording(r => r ? { ...r, elapsed: Date.now() - r.startMs } : r);
      }, 200);
    } catch (e) {
      // ensureMicStream toasts already; nothing else to do.
    }
  };

  const finishRecording = async (commit) => {
    const ctx = recRef.current;
    if (!ctx) return;
    recRef.current = null;
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    const wasRecording = ctx.mediaRecorder.state !== 'inactive';
    const stopPromise = wasRecording ? new Promise(res => {
      ctx.mediaRecorder.addEventListener('stop', res, { once: true });
    }) : Promise.resolve();
    try { if (wasRecording) ctx.mediaRecorder.stop(); } catch {}
    await stopPromise;
    setRecording(null);
    if (!commit) return;
    const blob = new Blob(ctx.chunks, { type: ctx.mime });
    const durationMs = Date.now() - ctx.startMs;
    if (blob.size < 256 || durationMs < 350) return;       // discard tap-noise
    const arrayBuf = await blob.arrayBuffer();
    const waveform = await computeWaveform(arrayBuf, ctx.mime);
    if (onVoice) {
      try { await onVoice(arrayBuf, ctx.mime, durationMs, waveform); }
      catch (e) { console.warn('sendVoice failed', e); }
    }
  };

  // Pointer-down on mic = start recording. Pointer-move tracks dx for the
  // slide-to-cancel UI. Pointer-up = commit unless dragged left >80px.
  const onMicPointerDown = (e) => {
    if (recRef.current) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const startX = e.clientX;
    recRef.current = null;                                 // cleared inside startRecording on success
    startRecording().then(() => {
      const ctx = recRef.current;
      if (ctx) ctx.pointerStartX = startX;
    });
  };
  const onMicPointerMove = (e) => {
    const ctx = recRef.current;
    if (!ctx) return;
    const dx = e.clientX - ctx.pointerStartX;
    setRecording(r => r ? { ...r, dragDx: dx, cancel: dx < -80 } : r);
  };
  const onMicPointerUp = (e) => {
    const ctx = recRef.current;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (!ctx) { setRecording(null); return; }
    const dx = e.clientX - ctx.pointerStartX;
    finishRecording(dx >= -80);
  };
  const onMicPointerCancel = (e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (recRef.current) finishRecording(false);
    else setRecording(null);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      <div style={{ position: 'relative', zIndex: 5, paddingTop: 16 }}>
        <div style={{
          position: 'relative', margin: '0 10px',
          borderRadius: 24, overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 24,
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16), 0 8px 28px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.10)',
          }} />
          <div style={{ position: 'relative', padding: '12px 14px', display: 'flex',
            alignItems: 'center', gap: 12 }}>

            <div onClick={onBack} style={{ width: 32, height: 32, borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Icon.Arrow size={14} color="#fff" dir="left" />
            </div>

            {isGroup ? (
              // Group header: a row of small participant chips, max 4 visible
              // + "+N" overflow badge. Each chip carries its own online dot.
              (() => {
                const ppl = Array.isArray(participants) ? participants : [];
                const visible = ppl.slice(0, 4);
                const overflow = Math.max(0, ppl.length - visible.length);
                const onlineCount = ppl.filter(x => x.online).length;
                const typingPeer = ppl.find(x => x.typing);
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {visible.map(pp => (
                        <div key={pp.slot} style={{ position: 'relative' }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: '50%',
                            background: `linear-gradient(135deg, hsl(${pp.hue} 70% 55%), hsl(${(pp.hue + 30) % 360} 70% 45%))`,
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 6px rgba(0,0,0,0.25)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: 'Geist Mono, ui-monospace, monospace',
                            fontWeight: 700, fontSize: 12, color: '#fff',
                          }} title={pp.friendly ? (pp.friendly + ' · ' + pp.label) : pp.label}>{pp.slot + 1}</div>
                          <div style={{ position: 'absolute', bottom: -1, right: -1,
                            width: 9, height: 9, borderRadius: '50%',
                            background: '#06050c',
                            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <StatusDot online={pp.online} size={6} />
                          </div>
                        </div>
                      ))}
                      {overflow > 0 && (
                        <div style={{
                          width: 30, height: 30, borderRadius: '50%',
                          background: 'rgba(255,255,255,0.08)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'Geist Mono, ui-monospace, monospace',
                          fontWeight: 700, fontSize: 11, color: 'rgba(255,255,255,0.8)',
                          border: '0.5px solid rgba(255,255,255,0.12)',
                        }}>+{overflow}</div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.1 }}>
                        Группа · {groupMax}
                      </div>
                      <div style={{ fontSize: 11, color: onlineCount > 0 ? '#3dff9a' : 'rgba(255,255,255,0.5)',
                        lineHeight: 1.2, marginTop: 2, letterSpacing: 0.2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {typingPeer
                          ? `${typingPeer.friendly || typingPeer.label} печатает…`
                          : `online ${onlineCount} / ${ppl.length}`}
                      </div>
                    </div>
                  </>
                );
              })()
            ) : (
              <>
                <div style={{ position: 'relative' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: `linear-gradient(135deg, ${p.b}, ${p.a})`,
                    boxShadow: `0 4px 16px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Geist Mono, ui-monospace, monospace', fontWeight: 700, fontSize: 17, color: '#fff',
                  }}>{partnerLetter}</div>
                  <div style={{ position: 'absolute', bottom: -1, right: -1,
                    width: 12, height: 12, borderRadius: '50%',
                    background: '#06050c',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <StatusDot online={partnerOnline} size={8} />
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', lineHeight: 1.1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={partnerFriendly ? (partnerFriendly + ' · ' + partnerLetter) : ('anonymous · ' + partnerLetter)}>
                    {partnerFriendly || ('anonymous · ' + partnerLetter)}
                  </div>
                  <div style={{ fontSize: 11, color: partnerOnline ? '#3dff9a' : 'rgba(255,255,255,0.5)',
                    lineHeight: 1.2, marginTop: 2, letterSpacing: 0.2 }}>
                    {partnerOnline ? (partnerTyping ? 'online · печатает' : 'online') : 'offline'}
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/*
                Safety-numbers button. Opens a modal with the 12-word
                fingerprint computed in app.jsx from both sides' ECDH + KEM
                public keys. Greyed-out (but still clickable) when the
                fingerprint isn't ready yet so the user can see we're
                computing.
              */}
              <button
                onClick={() => setSafetyOpen(true)}
                title="Безопасность сессии"
                aria-label="Безопасность сессии"
                style={{
                  width: 32, height: 32, borderRadius: 10, padding: 0,
                  border: '0.5px solid rgba(255,255,255,0.12)',
                  background: safetyFingerprint
                    ? 'rgba(80,180,140,0.18)'
                    : 'rgba(255,255,255,0.06)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon.Shield size={14} color={safetyFingerprint ? '#7be0b1' : 'rgba(255,255,255,0.6)'} />
              </button>

              {/* Local search — opens an inline filter input above the message
                  list. Everything is already decrypted in memory; no server
                  round-trip needed, search stays private. */}
              <button
                onClick={() => setSearchOpen(v => !v)}
                title="Поиск по сообщениям"
                aria-label="Поиск"
                style={{
                  width: 32, height: 32, borderRadius: 10, padding: 0,
                  border: '0.5px solid rgba(255,255,255,0.12)',
                  background: searchOpen ? 'rgba(122,154,223,0.22)' : 'rgba(255,255,255,0.06)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="6" stroke="rgba(255,255,255,0.85)" strokeWidth="1.8"/>
                  <path d="M16 16l4 4" stroke="rgba(255,255,255,0.85)" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>

              <div style={{
                position: 'relative', borderRadius: 12, overflow: 'hidden',
                padding: '6px 10px',
              }}>
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 12,
                  background: lowTime
                    ? 'linear-gradient(135deg, rgba(255,90,90,0.25), rgba(255,150,50,0.15))'
                    : 'rgba(255,255,255,0.08)',
                  border: '0.5px solid rgba(255,255,255,0.12)',
                  boxShadow: lowTime ? '0 0 16px rgba(255,90,90,0.3)' : 'none',
                }} />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon.Flame size={12} color={lowTime ? '#ff7a4d' : '#fff'} />
                  <div style={{ fontFamily: 'var(--ff-mono)', fontWeight: 700,
                    fontSize: 12, color: lowTime ? '#ffb088' : '#fff', letterSpacing: -0.2 }}>
                    {hh}:{mm}:{ss}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '8px 22px 4px' }}>
          <div style={{
            height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)',
            overflow: 'hidden', position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${Math.max(2, (expirySeconds / Math.max(1, totalSeconds || 86400)) * 100)}%`,
              background: lowTime
                ? 'linear-gradient(90deg, #ff5a5a, #ff9a4d)'
                : p.accent,
              boxShadow: `0 0 8px ${lowTime ? '#ff5a5a' : p.a}`,
              borderRadius: 2,
              transition: 'width 1s linear',
            }} />
          </div>
        </div>

        {connStatus !== 'live' && (
          <div style={{ padding: '4px 16px 0' }}>
            <div style={{
              borderRadius: 12,
              padding: '6px 12px',
              textAlign: 'center',
              fontSize: 11,
              letterSpacing: 0.2,
              color: '#fff',
              background: connStatus === 'lost' ? 'rgba(210, 70, 70, 0.65)' : 'rgba(210, 140, 60, 0.55)',
              boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.18)',
            }}>
              {connStatus === 'lost'
                ? 'соединение потеряно — пробуем переподключиться…'
                : 'соединение нестабильно — переподключаемся…'}
            </div>
          </div>
        )}

        {banner && (
          <div style={{ padding: '4px 16px 0' }}>
            <Glass radius={14} padding="8px 12px">
              <div style={{ fontSize: 11, color: 'var(--tx-80)', textAlign: 'center', letterSpacing: 0.2 }}>
                {banner}
              </div>
            </Glass>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="no-scrollbar" style={{
        flex: 1, overflowY: 'auto', padding: '14px 16px 8px',
        display: 'flex', flexDirection: 'column', gap: 8,
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ alignSelf: 'center', marginBottom: 6 }}>
          <Glass radius={9999} padding="6px 12px">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
              color: 'rgba(255,255,255,0.55)', letterSpacing: 0.4 }}>
              <Icon.Lock size={11} color="rgba(255,255,255,0.55)" />
              <span>сессия открыта</span>
              <span style={{ fontFamily: "'Geist Mono', monospace", letterSpacing: 0.5,
                color: 'rgba(255,255,255,0.4)' }}>
                {sessionHash ? `${sessionHash.slice(0,4)}…${sessionHash.slice(-4)}` : ''}
              </span>
            </div>
          </Glass>
        </div>

        {!paired && sessionHash && (
          <ShareCodeCard
            palette={palette}
            hash={sessionHash}
            phrase={sharePhrase}
            partnerClaimed={partnerClaimed}
          />
        )}

        {searchOpen && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 4,
            margin: '-2px -4px 6px', padding: '8px 10px',
            borderRadius: 14, background: 'rgba(20,20,28,0.85)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 0 0 0.5px rgba(255,255,255,0.10)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="6" stroke="var(--tx-60)" strokeWidth="1.8"/>
              <path d="M16 16l4 4" stroke="var(--tx-60)" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <input
              ref={searchInputRef}
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
              placeholder="искать в чате"
              autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#fff', fontSize: 14, fontFamily: 'inherit',
              }}
            />
            {searchQ && (
              <span style={{ fontSize: 11, color: 'var(--tx-60)', fontFamily: "'Geist Mono', monospace" }}>
                {messages.filter(m => (m.text || '').toLowerCase().includes(searchQ.toLowerCase())).length}
              </span>
            )}
            <button onClick={() => setSearchOpen(false)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--tx-60)', fontSize: 14, padding: 4,
            }}>×</button>
          </div>
        )}

        {/* "Load more" header — only when there are unrendered older msgs and
            we're not in search (search has its own globally-filtered view). */}
        {!searchQ && messages.length > renderWindow && (
          <div style={{ alignSelf: 'center', margin: '4px 0 8px' }}>
            <button
              type="button"
              onClick={() => setRenderWindow(w => w + 200)}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: 'none',
                color: 'var(--tx-80)',
                fontSize: 12,
                letterSpacing: 0.2,
                padding: '6px 14px',
                borderRadius: 999,
                cursor: 'pointer',
                fontFamily: 'inherit',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 0 0 0.5px rgba(255,255,255,0.10)',
              }}
            >
              Загрузить ещё ({messages.length - renderWindow})
            </button>
          </div>
        )}

        {/* Cluster-aware messages render (Cinny-style "folds"):
            - Consecutive same-sender messages with <10min gap are grouped.
            - Sender label / read receipt / timestamp show only on the LAST
              bubble of a cluster. Inner bubbles get tighter vertical gap +
              fully-rounded corners. Tail corner only on the LAST bubble.
            - Inner bubbles expose their HH:MM only on desktop :hover via the
              .nee2p-cluster-row CSS rule below; the last bubble always shows.
            - Time-divider chip ("сегодня в 03:14") rendered before any
              message whose gap from the previous is > 10min or whose calendar
              day differs. */}
        <style>{`
          .nee2p-cluster-row .nee2p-inner-time { opacity: 0; transition: opacity 0.15s ease; }
          @media (hover: hover) { .nee2p-cluster-row:hover .nee2p-inner-time { opacity: 0.7; } }
        `}</style>
        {(() => {
          const baseList = searchQ
            ? messages.filter(m => (m.text || '').toLowerCase().includes(searchQ.toLowerCase()))
            : (messages.length > renderWindow ? messages.slice(-renderWindow) : messages);
          const annotated = annotateClusters(baseList, slotUtil.coerceSlot);
          const nodes = [];
          for (let i = 0; i < annotated.length; i++) {
            const { msg: m, showTimeDivider, isFirstInCluster, isLastInCluster } = annotated[i];
            const sideNum = slotUtil.coerceSlot(m.side);
            const mine = sideNum !== null && sideNum === perspective;
            const senderLabel = sideNum !== null ? slotUtil.slotLabel(sideNum, groupMax) : '';
            const senderFriendly = sideNum !== null ? friendlyFor(sideNum) : '';
            const senderHue = sideNum !== null ? slotUtil.slotHue(sideNum) : 0;
            // Tighter vertical gap WITHIN a cluster; first-of-cluster keeps the
            // surrounding gap from the parent flex `gap: 8` and adds nothing.
            const tightTop = !isFirstInCluster ? -6 : 0;   // pulls bubbles closer
            // Round the bottom-tail corner only on the LAST bubble of the
            // cluster (Cinny semantic: the tail "points" to the sender side
            // and lives on the most recent message of the run).
            const showTail = isLastInCluster;
            if (showTimeDivider && m.at) {
              nodes.push(
                <div key={'div-' + (m.id || i)} style={{
                  alignSelf: 'center', margin: '6px 0',
                }}>
                  <Glass radius={9999} padding="4px 12px">
                    <div style={{
                      fontSize: 10, letterSpacing: 0.4,
                      color: 'rgba(255,255,255,0.55)',
                      fontFamily: "'Geist Mono', monospace",
                    }}>{formatDividerLabel(m.at, now)}</div>
                  </Glass>
                </div>
              );
            }
            nodes.push((
            <div key={m.id || i}
              className="nee2p-cluster-row"
              style={{
                display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start',
                marginTop: tightTop,
                animation: isLastInCluster ? 'fade-up 0.3s ease' : 'none',
              }}>
              <div
                onPointerDown={onMsgPointerDown(m)}
                onPointerUp={onMsgPointerEnd}
                onPointerLeave={onMsgPointerCancel}
                onPointerCancel={onMsgPointerCancel}
                onContextMenu={onMsgContextMenu(m)}
                onClickCapture={(e) => {
                  // suppress link click that fires right after a long-press
                  if (longPressFiredRef.current) {
                    e.preventDefault(); e.stopPropagation();
                    longPressFiredRef.current = false;
                  }
                }}
                style={{
                  maxWidth: '78%', position: 'relative',
                  padding: '10px 14px',
                  borderRadius: 22,
                  // Tail corner only on the LAST bubble of a cluster. Inner
                  // bubbles keep all four corners rounded — the cluster reads
                  // as a single "speech blob" with a single tail at the end.
                  borderBottomRightRadius: (mine && showTail) ? 6 : 22,
                  borderBottomLeftRadius: (!mine && showTail) ? 6 : 22,
                  background: mine ? p.accent : 'rgba(255,255,255,0.07)',
                  backdropFilter: mine ? 'none' : 'blur(24px) saturate(180%)',
                  WebkitBackdropFilter: mine ? 'none' : 'blur(24px) saturate(180%)',
                  boxShadow: mine
                    ? `0 6px 18px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`
                    : 'inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 0.5px rgba(255,255,255,0.08)',
                  color: mine ? p.text : '#fff', fontSize: 15, lineHeight: 1.35,
                  letterSpacing: -0.1, wordBreak: 'break-word',
                  cursor: 'default', userSelect: 'none',
                }}>
                {/* Group: color-coded sender label — only on the LAST bubble
                    of an incoming cluster (Cinny "footer" semantic). Inner
                    incoming bubbles get NO sender label so the run reads as
                    one continuous turn. */}
                {isGroup && !mine && senderLabel && isLastInCluster && (
                  <div style={{
                    fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase',
                    fontFamily: "'Geist Mono', monospace",
                    marginBottom: 4,
                    color: `hsl(${senderHue} 80% 75%)`,
                    opacity: 0.95,
                  }} title={senderFriendly ? (senderFriendly + ' · ' + senderLabel) : senderLabel}>
                    {senderFriendly || senderLabel}
                  </div>
                )}
                {m.replyTo && (() => {
                  const orig = messagesById.get(m.replyTo);
                  const origSideNum = orig ? slotUtil.coerceSlot(orig.side) : null;
                  const isMineQuote = origSideNum !== null && origSideNum === perspective;
                  return (
                    <div onClick={() => {
                      if (!orig) return;
                      const node = document.querySelector(`[data-mid="${m.replyTo}"]`);
                      if (node) node.scrollIntoView({behavior:'smooth', block:'center'});
                    }} style={{
                      marginBottom: 6, padding: '6px 8px',
                      borderRadius: 10,
                      borderLeft: `2px solid ${mine ? 'rgba(0,0,0,0.35)' : p.a}`,
                      background: mine ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)',
                      fontSize: 12, lineHeight: 1.3, cursor: orig ? 'pointer' : 'default',
                      maxHeight: 48, overflow: 'hidden',
                    }}>
                      <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase',
                        fontFamily: "'Geist Mono', monospace",
                        opacity: 0.6, marginBottom: 2 }}>
                        {orig ? (isMineQuote ? 'мой ответ на моё' : `${isMineQuote ? '' : ''}ответ`) : 'ответ'}
                      </div>
                      <div style={{
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        opacity: 0.85,
                      }}>
                        {orig ? (orig.text || '').slice(0, 100) : '[сообщение удалено]'}
                      </div>
                    </div>
                  );
                })()}
                {m.blob && (
                  <BlobBubble
                    msg={m}
                    palette={palette}
                    mine={mine}
                    onBlobUrl={onBlobUrl}
                    onOpenFullscreen={(url) => setFullscreenUrl(url)}
                  />
                )}
                {(m.text || (!m.blob)) && (
                  <div data-mid={m.id} style={{ whiteSpace: 'pre-wrap' }}>{renderText(m.text)}</div>
                )}
                {/* Burning-message badge: shown on any msg that carries a TTL.
                    Pinned to the top-right corner of the bubble. */}
                {m.expireSecAfterRead && (
                  <span style={{
                    position: 'absolute', top: 4, right: 6,
                    fontSize: 10, lineHeight: 1,
                    opacity: 0.85,
                    filter: 'drop-shadow(0 0 3px rgba(255,140,80,0.8))',
                    pointerEvents: 'none',
                  }}>🔥</span>
                )}
                {/* Cluster footer: HH:MM + read receipt show on the LAST
                    bubble of a cluster only. Inner bubbles render the same
                    div but with the .nee2p-inner-time CSS class — invisible
                    by default, revealed on desktop :hover (touch users see
                    them when they long-press menu pops, where the cluster
                    footer of the LAST bubble already gives them the time). */}
                <div className={isLastInCluster ? '' : 'nee2p-inner-time'} style={{
                  fontSize: 10,
                  color: mine
                    ? (p.text === '#ffffff' ? 'rgba(255,255,255,0.8)' : 'rgba(10,10,16,0.55)')
                    : 'rgba(255,255,255,0.45)',
                  marginTop: 4, textAlign: 'right',
                  fontFamily: 'Geist Mono, ui-monospace, monospace', letterSpacing: 0.2,
                  minHeight: 12, // reserve space so the cluster footer doesn't
                                 // jiggle when hover toggles the inner row.
                }}>
                  {m.time}
                  {mine && isLastInCluster && (() => {
                    const read = peerLastReadId && m.id <= peerLastReadId; // string compare ok if all ids same scheme; better: order by index
                    const readByIndex = (() => {
                      if (!peerLastReadId) return false;
                      const mineIdx = messages.findIndex(x => x.id === m.id);
                      const readIdx = messages.findIndex(x => x.id === peerLastReadId);
                      return readIdx >= 0 && mineIdx >= 0 && readIdx >= mineIdx;
                    })();
                    const seen = readByIndex;
                    return (
                      <span style={{
                        marginLeft: 4,
                        color: seen
                          ? (p.text === '#ffffff' ? '#9ad6ff' : '#3b82f6')
                          : 'inherit',
                        opacity: seen ? 1 : 0.85,
                      }}>✓✓</span>
                    );
                  })()}
                </div>
                {/* Reactions footer: glass pills, one per emoji, tap to toggle.
                    `mine` here means the bubble belongs to perspective. The
                    "is this MY reaction" check uses perspective slot, not
                    bubble ownership. */}
                {m.reactions && Object.keys(m.reactions).length > 0 && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6,
                    justifyContent: mine ? 'flex-end' : 'flex-start',
                  }}>
                    {Object.entries(m.reactions).map(([emoji, reactors]) => {
                      const reactorNums = (Array.isArray(reactors) ? reactors : [])
                        .map(s => slotUtil.coerceSlot(s)).filter(s => s !== null);
                      const myReact = reactorNums.includes(perspective);
                      const count = reactorNums.length;
                      if (count === 0) return null;
                      // 2-party: show just the count. Groups: show the slot
                      // letters/numbers that reacted, e.g. "👍 1 3".
                      // Tooltip: list of reactors as friendly names (or labels
                      // if names aren't ready yet). Hover shows e.g.
                      // "белый ветер · участник 2, тихий шёпот · участник 3".
                      const reactorTitle = reactorNums.map(n => {
                        const lbl = slotUtil.slotLabel(n, groupMax);
                        const fn = friendlyFor(n);
                        return fn ? (fn + ' · ' + lbl) : lbl;
                      }).join(', ');
                      return (
                        <button
                          key={emoji}
                          title={reactorTitle}
                          onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            if (onReact) onReact(m.id, emoji);
                          }}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px',
                            borderRadius: 999, border: 'none', cursor: 'pointer',
                            background: myReact
                              ? 'rgba(120,170,255,0.22)'
                              : 'rgba(255,255,255,0.10)',
                            boxShadow: myReact
                              ? 'inset 0 0 0 0.5px rgba(150,200,255,0.55), 0 0 6px rgba(120,170,255,0.18)'
                              : 'inset 0 0 0 0.5px rgba(255,255,255,0.10)',
                            color: myReact ? '#cfe3ff' : 'rgba(255,255,255,0.85)',
                            fontSize: 12, fontFamily: 'inherit', lineHeight: 1.2,
                            backdropFilter: 'blur(12px) saturate(160%)',
                            WebkitBackdropFilter: 'blur(12px) saturate(160%)',
                            transition: 'all 0.12s ease',
                          }}
                        >
                          <span style={{ fontSize: 13 }}>{emoji}</span>
                          {isGroup ? (
                            <span style={{
                              fontSize: 10, opacity: 0.85,
                              fontFamily: "'Geist Mono', monospace", letterSpacing: 0.3,
                            }}>
                              {reactorNums.map(n => n + 1).join(' ')}
                            </span>
                          ) : (count > 1 && (
                            <span style={{
                              fontSize: 10, opacity: 0.8,
                              fontFamily: "'Geist Mono', monospace",
                            }}>{count}</span>
                          ))}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            ));
          }
          return nodes;
        })()}

        {partnerTyping && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: 22, borderBottomLeftRadius: 6,
              background: 'rgba(255,255,255,0.06)',
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 0.5px rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.6)',
                  animation: `pulse-dot 1.2s ease-in-out ${i * 0.15}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '8px 12px 30px', position: 'relative', zIndex: 5 }}>
        {/* Burn-after-read chip row — sticky selector. Tap an option to arm
            burnTtl for subsequent sends; "выкл" disables. The send button
            shows a flame overlay when armed. */}
        <div style={{
          margin: '0 4px 6px',
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontFamily: "'Geist Mono', monospace",
          color: 'var(--tx-60)', letterSpacing: 0.3,
          flexWrap: 'wrap',
        }}>
          <span style={{ opacity: 0.8 }}>{burnTtl ? '🔥 после прочтения:' : '🔥 авто-удаление:'}</span>
          {[
            { id: null,  label: 'выкл' },
            { id: 10,    label: '10с' },
            { id: 60,    label: '1м' },
            { id: 3600,  label: '1ч' },
          ].map(opt => {
            const active = burnTtl === opt.id;
            return (
              <button key={String(opt.id)}
                onClick={() => setBurnTtl(opt.id)}
                style={{
                  padding: '3px 9px', border: 'none', cursor: 'pointer',
                  borderRadius: 999,
                  background: active
                    ? 'rgba(255,140,80,0.20)'
                    : 'rgba(255,255,255,0.05)',
                  boxShadow: active
                    ? 'inset 0 0 0 0.5px rgba(255,170,110,0.55), 0 0 8px rgba(255,140,80,0.18)'
                    : 'inset 0 0 0 0.5px rgba(255,255,255,0.08)',
                  color: active ? '#ffb178' : 'var(--tx-80)',
                  fontFamily: 'inherit', fontSize: 11, letterSpacing: 0.3,
                  transition: 'all 0.15s ease',
                }}>
                {opt.label}
              </button>
            );
          })}
        </div>
        {replyingTo && (
          <div style={{
            margin: '0 4px 6px', padding: '8px 12px',
            borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(255,255,255,0.06)',
            borderLeft: `3px solid ${p.a}`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 0 0 0.5px rgba(255,255,255,0.08)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--tx-60)',
                letterSpacing: 0.6, textTransform: 'uppercase', fontFamily: "'Geist Mono', monospace" }}>
                {(() => {
                  const repSide = slotUtil.coerceSlot(replyingTo.side);
                  if (repSide === perspective) return 'ответ на своё';
                  const lbl = repSide !== null ? slotUtil.slotLabel(repSide, groupMax) : '?';
                  return `ответ на ${lbl}`;
                })()}
              </div>
              <div style={{ fontSize: 12, color: 'var(--tx-80)', marginTop: 2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {(replyingTo.text || '').slice(0, 120)}
              </div>
            </div>
            <button onClick={cancelReply} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              color: 'var(--tx-60)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}
        <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 24,
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16), 0 -2px 30px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.10)',
          }} />
          <div style={{ position: 'relative', padding: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              // `accept` is a hint, not a hard restriction: iOS uses it to
              // surface its optimised camera/photos sheet; desktop browsers
              // still let users pick anything via "All files". Listing the
              // common types here is enough to get the better UX on mobile.
              accept="image/*,video/*,audio/*,application/pdf"
              onChange={onFilePicked}
            />
            <button
              type="button"
              onPointerUp={onPaperclip}
              aria-label="Прикрепить файл"
              style={{
                width: 40, height: 40, borderRadius: 14, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,0.06)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
              <PaperclipIcon size={18} color="#fff" />
            </button>

            {/* When recording, the text input is replaced by a recording HUD */}
            {recording ? (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 10,
                padding: '0 12px', minHeight: 40,
                color: recording.cancel ? '#ff7a7a' : '#fff',
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: '#ff5a5a',
                  boxShadow: '0 0 12px rgba(255,90,90,0.8)',
                  animation: 'pulse-dot 1.2s ease-in-out infinite',
                  flexShrink: 0,
                }} />
                <span style={{
                  fontFamily: "'Geist Mono', ui-monospace, monospace",
                  fontSize: 13, fontWeight: 600, letterSpacing: -0.1, minWidth: 44,
                }}>
                  {formatMmSs(Math.floor(recording.elapsed / 1000))}
                </span>
                <span style={{
                  flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.55)',
                  letterSpacing: 0.2,
                  transform: `translateX(${Math.min(0, recording.dragDx || 0)}px)`,
                  transition: 'opacity 0.1s ease',
                  opacity: recording.cancel ? 0.5 : 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {recording.cancel ? 'отпусти для отмены' : '← смахни влево для отмены'}
                </span>
              </div>
            ) : (
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  const v = e.target.value;
                  setInput(v);
                  if (v) {
                    sendTyping(true);
                    clearTimeout(typingTimerRef.current);
                    typingTimerRef.current = setTimeout(() => sendTyping(false), 2000);
                  } else {
                    clearTimeout(typingTimerRef.current);
                    sendTyping(false);
                  }
                }}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                onFocus={(e) => {
                  // Fallback for browsers without visualViewport (or where the
                  // viewport listener is no-op): nudge the input into view
                  // after the soft-keyboard finishes its open animation.
                  // The visualViewport-resize listener registered in a useEffect
                  // below handles iOS Safari, where the keyboard transition is
                  // slower than 300ms and shrinks visualViewport.height.
                  if (typeof window === 'undefined' || !window.visualViewport) {
                    setTimeout(() => {
                      try { e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
                    }, 300);
                  }
                }}
                inputMode="text"
                enterKeyHint="send"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                placeholder="whisper something…"
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: '#fff', fontSize: 15, fontFamily: 'inherit',
                  padding: '10px 14px', letterSpacing: -0.1,
                }}
              />
            )}
            {/* Action button: send when there is text; mic (hold-to-record) otherwise. */}
            {input.trim() && !recording ? (
              <button onClick={send} style={{
                width: 40, height: 40, borderRadius: 16, border: 'none', cursor: 'pointer',
                background: p.accent,
                boxShadow: `0 4px 14px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`,
                transition: 'all 0.2s ease',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, position: 'relative',
              }}>
                <Icon.Send size={16} color={p.text} />
                {burnTtl && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    fontSize: 12, lineHeight: 1,
                    filter: 'drop-shadow(0 0 4px rgba(255,140,80,0.8))',
                  }}>🔥</span>
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={micDenied}
                onPointerDown={onMicPointerDown}
                onPointerMove={onMicPointerMove}
                onPointerUp={onMicPointerUp}
                onPointerCancel={onMicPointerCancel}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={recording ? 'Запись…' : 'Удержать для записи голоса'}
                style={{
                  width: 40, height: 40, borderRadius: 16, border: 'none',
                  cursor: micDenied ? 'not-allowed' : 'pointer',
                  background: recording
                    ? (recording.cancel
                        ? 'linear-gradient(180deg, #ff5a5a, #b03030)'
                        : p.accent)
                    : 'rgba(255,255,255,0.08)',
                  boxShadow: recording
                    ? `0 4px 14px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`
                    : 'inset 0 1px 0 rgba(255,255,255,0.12)',
                  transition: 'all 0.18s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: micDenied ? 0.4 : 1, flexShrink: 0,
                  transform: recording ? 'scale(1.08)' : 'scale(1)',
                  touchAction: 'none',
                }}>
                <MicIcon size={18} color={recording ? p.text : '#fff'} />
              </button>
            )}
          </div>
          {uploadProgress > 0 && (
            <div style={{
              position: 'absolute', top: 4, right: 8, display: 'flex', gap: 4,
              alignItems: 'center', fontSize: 10, color: 'var(--tx-60)',
              fontFamily: "'Geist Mono', monospace", letterSpacing: 0.2,
              pointerEvents: 'none',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: p.a,
                boxShadow: `0 0 8px ${p.glow}`,
                animation: 'pulse-dot 1.2s ease-in-out infinite',
              }} />
              <span>загрузка {uploadProgress > 1 ? `· ${uploadProgress}` : ''}</span>
            </div>
          )}
        </div>
        {micToast && (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 96, display: 'flex',
            justifyContent: 'center', pointerEvents: 'none', zIndex: 60,
          }}>
            <div style={{
              padding: '8px 14px', borderRadius: 14,
              background: 'rgba(20,20,28,0.92)', color: '#fff', fontSize: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}>
              {micToast}
            </div>
          </div>
        )}
      </div>

      {menuMsg && (
        <MessageActionMenu
          palette={palette}
          msg={menuMsg}
          isMine={menuMsg.side === perspective}
          onQuote={() => quoteMessage(menuMsg)}
          onDelete={() => deleteMessage(menuMsg)}
          onReact={(emoji) => { if (onReact) onReact(menuMsg.id, emoji); closeMenu(); }}
          onClose={closeMenu}
        />
      )}

      {safetyOpen && (
        <SafetyNumbersModal
          palette={palette}
          fingerprint={safetyFingerprint}
          onClose={() => setSafetyOpen(false)}
        />
      )}

      {fullscreenUrl && (
        <div onPointerDown={() => setFullscreenUrl(null)} style={{
          position: 'absolute', inset: 0, zIndex: 80,
          background: 'rgba(2,2,6,0.96)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 12, animation: 'fade-up 0.18s ease',
        }}>
          <img src={fullscreenUrl} alt="" style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
            borderRadius: 12, boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          }} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Blob bubble: image (thumb → full), voice (player), or file card.
function BlobBubble({ msg, palette, mine, onBlobUrl, onOpenFullscreen }) {
  const p = usePalette(palette);
  const blob = msg.blob;
  if (!blob) return null;

  if (blob.undecryptable) {
    return (
      <div style={{
        margin: '2px 0 4px', padding: '10px 12px', borderRadius: 14,
        background: 'rgba(255,255,255,0.06)', fontSize: 12, color: 'var(--tx-60)',
        fontStyle: 'italic',
      }}>вложение зашифровано прежним ключом</div>
    );
  }

  if (blob.mime && blob.mime.startsWith('image/')) {
    return <ImageBubble msg={msg} palette={palette} mine={mine}
                        onBlobUrl={onBlobUrl} onOpenFullscreen={onOpenFullscreen} />;
  }
  if (blob.mime && blob.mime.startsWith('audio/') && blob.kind === 'voice') {
    return <VoiceBubble msg={msg} palette={palette} mine={mine} onBlobUrl={onBlobUrl} />;
  }
  return <FileBubble msg={msg} palette={palette} mine={mine} onBlobUrl={onBlobUrl} />;
}

function ImageBubble({ msg, palette, mine, onBlobUrl, onOpenFullscreen }) {
  const blob = msg.blob;
  const [fullUrl, setFullUrl] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const thumbSrc = blob.thumb ? 'data:image/jpeg;base64,' + blob.thumb : null;

  // Kick off the full download on mount (lazily — only once).
  React.useEffect(() => {
    let cancel = false;
    if (!onBlobUrl) return;
    setLoading(true);
    onBlobUrl(msg).then(url => {
      if (cancel) return;
      setFullUrl(url || null);
    }).catch(() => {
      if (cancel) return;
    }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [msg.id]);

  const src = fullUrl || thumbSrc;
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (fullUrl && onOpenFullscreen) onOpenFullscreen(fullUrl);
      }}
      style={{
        margin: '2px 0 4px', borderRadius: 14, overflow: 'hidden',
        background: 'rgba(0,0,0,0.25)',
        maxWidth: 260, maxHeight: 320, position: 'relative',
        cursor: fullUrl ? 'zoom-in' : 'default',
      }}>
      {src ? (
        <img src={src} alt={blob.name || ''} draggable={false} style={{
          display: 'block', width: '100%', height: 'auto', maxHeight: 320,
          objectFit: 'cover',
          filter: fullUrl ? 'none' : 'blur(4px)',
          transition: 'filter 0.25s ease',
        }} />
      ) : (
        <div style={{ width: 220, height: 160, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
          загрузка…
        </div>
      )}
      {loading && !fullUrl && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          width: 10, height: 10, borderRadius: '50%',
          background: '#fff', opacity: 0.6,
          animation: 'pulse-dot 1.2s ease-in-out infinite',
        }} />
      )}
    </div>
  );
}

function FileBubble({ msg, palette, mine, onBlobUrl }) {
  const p = usePalette(palette);
  const blob = msg.blob;
  const [busy, setBusy] = React.useState(false);
  const download = async (e) => {
    e.stopPropagation();
    if (!onBlobUrl || busy) return;
    setBusy(true);
    try {
      const url = await onBlobUrl(msg);
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = blob.name || 'file';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.warn('download failed', err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div onClick={download} style={{
      margin: '2px 0 4px', padding: '10px 12px', borderRadius: 14,
      display: 'flex', alignItems: 'center', gap: 12,
      background: mine ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)',
      cursor: busy ? 'wait' : 'pointer', minWidth: 200, maxWidth: 280,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: 'rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <FileIcon size={18} color="#fff" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: mine ? p.text : '#fff',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{blob.name || 'файл'}</div>
        <div style={{
          fontSize: 11, color: mine ? (p.text === '#ffffff' ? 'rgba(255,255,255,0.7)' : 'rgba(10,10,16,0.55)')
                                    : 'rgba(255,255,255,0.5)',
          fontFamily: "'Geist Mono', monospace", letterSpacing: 0.2,
        }}>{formatBytes(blob.size || 0)}</div>
      </div>
      <div style={{ flexShrink: 0, opacity: busy ? 0.4 : 1 }}>
        <DownloadIcon size={16} color={mine ? p.text : '#fff'} />
      </div>
    </div>
  );
}

function VoiceBubble({ msg, palette, mine, onBlobUrl }) {
  const p = usePalette(palette);
  const blob = msg.blob;
  const audioRef = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [ready, setReady] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const waveform = Array.isArray(blob.waveform) && blob.waveform.length > 0
    ? blob.waveform
    : new Array(32).fill(0.2);
  const durationMs = Math.max(1, blob.durationMs || 1000);

  const toggle = async (e) => {
    e.stopPropagation();
    if (!ready) {
      if (!onBlobUrl || loading) return;
      setLoading(true);
      try {
        const url = await onBlobUrl(msg);
        if (!url) return;
        const a = audioRef.current || new Audio();
        if (!audioRef.current) audioRef.current = a;
        a.src = url;
        a.onplay = () => setPlaying(true);
        a.onpause = () => setPlaying(false);
        a.onended = () => { setPlaying(false); setProgress(0); };
        a.ontimeupdate = () => {
          const d = a.duration || (durationMs / 1000);
          setProgress(Math.min(1, (a.currentTime || 0) / (d || 1)));
        };
        setReady(true);
        await a.play();
      } catch (err) {
        console.warn('voice play failed', err);
      } finally {
        setLoading(false);
      }
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { try { await a.play(); } catch {} }
    else { try { a.pause(); } catch {} }
  };

  // Stop the audio if the bubble unmounts (room change, etc).
  React.useEffect(() => () => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    } catch {}
  }, []);

  const totalSec = Math.round(durationMs / 1000);
  const playedBars = Math.round(progress * waveform.length);

  return (
    <div style={{
      margin: '2px 0 4px', padding: '8px 12px', borderRadius: 16,
      display: 'flex', alignItems: 'center', gap: 10,
      background: mine ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)',
      minWidth: 220, maxWidth: 280,
    }}>
      <button onClick={toggle} aria-label={playing ? 'pause' : 'play'} style={{
        width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: mine ? 'rgba(255,255,255,0.85)' : p.accent,
        color: mine ? (p.text === '#ffffff' ? '#0a0a10' : p.text) : p.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 4px 12px rgba(0,0,0,0.25)',
        flexShrink: 0,
      }}>
        {playing
          ? <PauseIcon size={14} color={mine && p.text === '#ffffff' ? '#0a0a10' : (mine ? p.text : p.text)} />
          : <PlayIcon size={14} color={mine && p.text === '#ffffff' ? '#0a0a10' : (mine ? p.text : p.text)} />}
      </button>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 2,
        height: 28,
      }}>
        {waveform.map((v, i) => {
          const h = Math.max(3, Math.round(v * 24));
          const active = i < playedBars;
          return (
            <span key={i} style={{
              width: 3, height: h, borderRadius: 2, flexShrink: 0,
              background: active
                ? (mine ? (p.text === '#ffffff' ? '#fff' : p.text) : p.a)
                : (mine ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)'),
              transition: 'background 0.1s linear',
            }} />
          );
        })}
      </div>
      <span style={{
        fontFamily: "'Geist Mono', monospace", fontSize: 11,
        color: mine ? (p.text === '#ffffff' ? 'rgba(255,255,255,0.8)' : 'rgba(10,10,16,0.6)')
                    : 'rgba(255,255,255,0.6)',
        letterSpacing: 0.2, flexShrink: 0,
      }}>{formatMmSs(Math.max(0, Math.round((1 - progress) * totalSec)))}</span>
      {loading && (
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: 0.6,
          animation: 'pulse-dot 1.2s ease-in-out infinite', flexShrink: 0,
        }} />
      )}
    </div>
  );
}

// ── small utilities + icons used by ChatScreen blob UI ──────
function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  return (n / (1024 * 1024)).toFixed(2) + ' МБ';
}

function formatMmSs(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function PaperclipIcon({ size = 18, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M21 11l-9.5 9.5a5 5 0 11-7-7L13 5a3.4 3.4 0 015 5l-9 9a1.8 1.8 0 11-2.5-2.5l8-8"
        stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function MicIcon({ size = 18, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke={color} strokeWidth="1.8"/>
      <path d="M5 11a7 7 0 0014 0M12 18v3" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}
function PlayIcon({ size = 14, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M7 4l13 8-13 8V4z" />
    </svg>
  );
}
function PauseIcon({ size = 14, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}
function DownloadIcon({ size = 16, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function FileIcon({ size = 18, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"
        stroke={color} strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M14 3v5h5" stroke={color} strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Quick-reaction palette for the long-press menu. Kept short so the row fits
// one line on the narrowest mobile screen.
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '👀', '😢'];

function MessageActionMenu({ palette, msg, isMine, onQuote, onDelete, onReact, onClose }) {
  const p = usePalette(palette);
  const preview = (msg.text || '').slice(0, 120);
  return (
    <div onPointerDown={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(6,6,10,0.55)', backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'fade-up 0.16s ease',
    }}>
      <div onPointerDown={(e) => e.stopPropagation()} style={{
        width: 'calc(100% - 24px)', maxWidth: 360, marginBottom: 24,
        borderRadius: 22, overflow: 'hidden',
        background: 'rgba(20,20,28,0.92)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 -2px 30px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.10)',
      }}>
        {/* Quick-reactions row — sits ABOVE the menu items for one-tap reply. */}
        {onReact && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-around',
            padding: '10px 8px',
            borderBottom: '0.5px solid rgba(255,255,255,0.08)',
            gap: 4,
          }}>
            {REACTION_EMOJIS.map(e => (
              <button key={e}
                onClick={() => onReact(e)}
                style={{
                  width: 40, height: 40, borderRadius: 999, border: 'none',
                  cursor: 'pointer', background: 'transparent',
                  fontSize: 22, lineHeight: 1, padding: 0,
                  transition: 'transform 0.12s ease, background 0.12s ease',
                }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = 'rgba(255,255,255,0.08)'; ev.currentTarget.style.transform = 'scale(1.15)'; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; ev.currentTarget.style.transform = 'scale(1)'; }}
              >{e}</button>
            ))}
          </div>
        )}

        <div style={{
          padding: '12px 16px', fontSize: 12, color: 'var(--tx-60)',
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          fontStyle: 'italic', maxHeight: 60, overflow: 'hidden',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {preview}
        </div>

        <MenuItem
          icon={<Icon.Copy size={16} color="#fff" />}
          label="Скопировать"
          onClick={() => {
            try { navigator.clipboard && navigator.clipboard.writeText(msg.text || ''); } catch {}
            onClose();
          }}
        />
        <MenuItem
          icon={<QuoteIcon />}
          label="Процитировать"
          onClick={onQuote}
        />
        {isMine && (
          <MenuItem
            icon={<Icon.Eraser size={16} color="#ff7a7a" />}
            label="Удалить"
            danger
            onClick={onDelete}
          />
        )}
        <button onClick={onClose} style={{
          width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
          background: 'transparent', color: 'var(--tx-60)',
          fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          borderTop: '0.5px solid rgba(255,255,255,0.06)',
        }}>отмена</button>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '14px 16px', border: 'none', cursor: 'pointer',
      background: 'transparent', display: 'flex', alignItems: 'center', gap: 12,
      color: danger ? '#ff7a7a' : '#fff',
      fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
      borderTop: '0.5px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ width: 22, display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <span>{label}</span>
    </button>
  );
}

function QuoteIcon({ size = 16, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7 7h4v4H7c0 3 2 4 4 4M13 7h4v4h-4c0 3 2 4 4 4"
        stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// SafetyNumbersModal — shows the 12-word session fingerprint so users can
// verify over a trusted channel (voice call, in-person) that no MITM swapped
// public keys. The fingerprint is computed in nee2p-app.jsx from both sides'
// ECDH + ML-KEM-768 pubkeys; if it's null we either don't have both sides'
// keys yet or the BIP-39 wordlist failed to load.
//
// Also surfaces the actual library posture for this session — KDF that fired
// for phrase derivation, X25519 source, and whether ML-KEM-768 is available —
// so the user can spot when something fell back to a weaker fallback.
function SafetyNumbersModal({ palette, fingerprint, onClose }) {
  const p = usePalette(palette);
  // The fingerprint prop is either:
  //   • Array<{slot, label, words, hex, hasKem}>  — group (>=2 peers)
  //   • {words, hex, hasKem}                       — legacy 2-party shape
  //   • null                                       — handshake pending
  const list = Array.isArray(fingerprint)
    ? fingerprint
    : (fingerprint ? [fingerprint] : []);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const active = list[Math.min(activeIdx, list.length - 1)] || null;
  const words = active && Array.isArray(active.words) ? active.words : null;

  // Read the actual library posture from window.Nee2PCrypto (set lazily by
  // crypto.js as deriveKey / generateEphemeralKeypair / generateKemKeypair
  // fire). Wrapped in safe accessors so the modal still renders if crypto.js
  // hasn't run yet (e.g. in a smoke test).
  const HC = (typeof window !== 'undefined' && window.Nee2PCrypto) || {};
  const kdfMode = HC.kdfMode || null;            // 'argon2id' | 'pbkdf2' | null
  const x25519Source = HC.x25519Source || null;  // 'subtle' | 'noble' | 'stablelib' | 'unavailable' | null
  const kemAvailable = HC.kemAvailable;          // true | false | null
  const kdfLabel = kdfMode === 'argon2id'
    ? 'Argon2id ✓'
    : kdfMode === 'pbkdf2'
      ? 'PBKDF2 (fallback)'
      : '…';
  const kdfBad = kdfMode === 'pbkdf2';
  const x25519Label = x25519Source === 'subtle'
    ? 'WebCrypto ✓'
    : x25519Source === 'noble'
      ? 'vendor noble (fallback)'
      : x25519Source === 'stablelib'
        ? 'stablelib (fallback)'
        : x25519Source === 'unavailable'
          ? 'недоступно'
          : '…';
  const x25519Bad = x25519Source && x25519Source !== 'subtle';
  const kemLabel = kemAvailable === true
    ? 'vendor ✓'
    : kemAvailable === false
      ? 'недоступно (только pre-quantum)'
      : '…';
  const kemBad = kemAvailable === false;
  return (
    <div onPointerDown={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 60,
      background: 'rgba(6,6,10,0.62)', backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fade-up 0.16s ease',
    }}>
      <div onPointerDown={(e) => e.stopPropagation()} style={{
        width: 'calc(100% - 24px)', maxWidth: 380,
        borderRadius: 22, overflow: 'hidden',
        background: 'rgba(20,20,28,0.94)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 -2px 40px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.10)',
      }}>
        <div style={{ padding: '18px 18px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(80,180,140,0.18)',
            border: '0.5px solid rgba(255,255,255,0.12)',
          }}>
            <Icon.Shield size={14} color="#7be0b1" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
            Безопасность сессии
          </div>
        </div>

        <div style={{ padding: '10px 18px 4px', fontSize: 12, color: 'var(--tx-60)', lineHeight: 1.45 }}>
          {list.length > 1
            ? 'У каждого участника свой отпечаток. Сверяйте по одному — по голосу.'
            : 'Сравните эти 12 слов с партнёром по голосу. Если совпадают — никто не подменил ключи.'}
        </div>

        {list.length > 1 && (
          <div style={{
            display: 'flex', gap: 6, padding: '8px 14px 0',
            overflowX: 'auto',
          }} className="no-scrollbar">
            {list.map((fp, idx) => {
              // Show "friendly · участник N" when we have a friendly name;
              // fall back to the bare label otherwise. The verbose form is
              // what makes the tab unambiguous when several participants are
              // showing similar word-lists.
              const slotN = (fp.slot ?? 0) + 1;
              const bareLabel = fp.label || ('Участник ' + slotN);
              const display = fp.friendly
                ? (fp.friendly + ' · участник ' + slotN)
                : bareLabel;
              return (
                <button key={fp.slot}
                  onClick={() => setActiveIdx(idx)}
                  title={display}
                  style={{
                    padding: '6px 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: idx === activeIdx
                      ? 'rgba(120,180,255,0.18)'
                      : 'rgba(255,255,255,0.05)',
                    color: idx === activeIdx ? '#cfe3ff' : 'var(--tx-80)',
                    fontSize: 11, fontFamily: "'Geist Mono', monospace",
                    letterSpacing: 0.3, fontWeight: 600,
                    flexShrink: 0,
                    boxShadow: idx === activeIdx
                      ? 'inset 0 0 0 0.5px rgba(150,200,255,0.45)'
                      : 'inset 0 0 0 0.5px rgba(255,255,255,0.08)',
                  }}>{display}</button>
              );
            })}
          </div>
        )}

        {words ? (
          <div style={{ padding: '12px 14px 6px' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6,
              fontFamily: 'var(--ff-mono)',
            }}>
              {words.map((w, i) => (
                <div key={i} style={{
                  padding: '8px 6px',
                  borderRadius: 9,
                  background: 'rgba(255,255,255,0.04)',
                  border: '0.5px solid rgba(255,255,255,0.08)',
                  fontSize: 11, color: '#fff',
                  textAlign: 'center',
                  letterSpacing: 0.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }} title={`${i + 1}. ${w}`}>
                  <span style={{ color: 'var(--tx-40)', marginRight: 4 }}>{i + 1}.</span>{w}
                </div>
              ))}
            </div>
            <div style={{
              padding: '12px 6px 4px', fontFamily: 'var(--ff-mono)',
              fontSize: 9, color: 'var(--tx-40)', letterSpacing: 0.4,
              wordBreak: 'break-all', textAlign: 'center',
            }}>
              {active.hex}
            </div>
            {/* Library posture: KDF + X25519 + ML-KEM-768. Each line shows the
                actual primitive that fired for this session so the user can
                spot when something fell back to a weaker fallback. */}
            <div style={{
              margin: '8px 0 4px', padding: '8px 10px', borderRadius: 9,
              background: 'rgba(255,255,255,0.03)',
              border: '0.5px solid rgba(255,255,255,0.08)',
              fontSize: 11, color: 'var(--tx-80)', lineHeight: 1.5,
              fontFamily: 'var(--ff-mono)', letterSpacing: 0.2,
            }}>
              <div style={{ color: kdfBad ? '#ffd29a' : 'var(--tx-80)' }}>
                Деривация ключа: {kdfLabel}
              </div>
              <div style={{ color: x25519Bad ? '#ffd29a' : 'var(--tx-80)' }}>
                X25519: {x25519Label}
              </div>
              <div style={{ color: kemBad ? '#ffd29a' : 'var(--tx-80)' }}>
                ML-KEM-768: {kemLabel}
              </div>
            </div>
            {!active.hasKem && (
              <div style={{
                margin: '4px 0 8px', padding: '8px 10px', borderRadius: 9,
                background: 'rgba(255,180,80,0.10)',
                border: '0.5px solid rgba(255,180,80,0.25)',
                fontSize: 11, color: '#ffd29a', lineHeight: 1.4,
              }}>
                Постквантовая верификация недоступна — отпечаток построен только на X25519.
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '20px 18px', fontSize: 12, color: 'var(--tx-60)', textAlign: 'center' }}>
            Отпечаток считается… Дождитесь рукопожатия с партнёром.
          </div>
        )}

        <button onClick={onClose} style={{
          width: '100%', padding: '14px 16px', border: 'none', cursor: 'pointer',
          background: 'transparent', color: '#fff',
          fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
          borderTop: '0.5px solid rgba(255,255,255,0.08)',
        }}>Понятно</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function InfoScreen({ palette, onBack }) {
  const p = usePalette(palette);

  const tenets = [
    { icon: Icon.Lock,     title: 'End-to-end шифрование',
      body: 'Сообщения шифруются на устройстве отправителя и расшифровываются только на устройствах получателей. Между ними — нечитаемый поток.' },
    { icon: Icon.NoServer, title: 'Ничего не хранится',
      body: 'Серверов с историей переписки не существует. Всё живёт в оперативной памяти и исчезает вместе с сессией — ни базы, ни бэкапа, ни кэша.' },
    { icon: Icon.Ghost,    title: 'Никакой регистрации',
      body: 'Нет аккаунтов, email, номеров. Сессия живёт под одноразовым кодом — и принадлежит только тем, кто знает фразу.' },
    { icon: Icon.Key,      title: 'У каждого свой пароль',
      body: 'Войти можно, только установив личный пароль для своего слота. Забыл — переписка теряется навсегда, восстановить нельзя.' },
    { icon: Icon.Eraser,   title: 'Таймер самоуничтожения',
      body: 'С момента запуска идёт обратный отсчёт. Когда таймер обнуляется, сессия и все ключи стираются из памяти устройств.' },
    { icon: Icon.Shield,   title: 'Постквантовая защита',
      body: 'Гибридное рукопожатие X25519 + ML-KEM-768 даёт прямую секретность сегодня и устойчивость к будущим квантовым атакам. 12 BIP-39 слов позволяют сверить ключи голосом.' },
    { icon: Icon.Bolt,     title: 'Без метаданных',
      body: 'Не собираем кто, когда, с кем. Нет идентификаторов устройств, IP-логов, телеметрии, аналитики и внешних шрифтов — дружелюбно к Tor.' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '24px 0 30px', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 22px' }}>
        <div onClick={onBack} style={{
          width: 38, height: 38, borderRadius: 12,
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Icon.Arrow size={16} color="#fff" dir="left" />
        </div>
        <Logo size={9} palette={palette} />
        <div style={{ width: 38 }} />
      </div>

      <div style={{ padding: '18px 22px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Icon.Shield size={16} color="rgba(255,255,255,0.7)" />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)',
            letterSpacing: 0.6, textTransform: 'uppercase' }}>
            безопасность и шифрование
          </span>
        </div>
        <h1 style={{
          margin: 0, fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontWeight: 400, fontSize: 38, lineHeight: 1.0, letterSpacing: -0.8,
          color: '#fff',
        }}>
          Семь правил,<br/>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>на которых стоит Nee2P.</span>
        </h1>
      </div>

      <div className="no-scrollbar" style={{
        flex: 1, overflowY: 'auto', padding: '14px 16px 8px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {tenets.map((tn, i) => {
          const Ic = tn.icon;
          return (
            <Glass key={i} radius={20} padding="14px 16px">
              <div style={{ display: 'flex', gap: 14 }}>
                <div style={{
                  flexShrink: 0,
                  width: 38, height: 38, borderRadius: 12,
                  background: 'rgba(255,255,255,0.08)',
                  border: '0.5px solid rgba(255,255,255,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)',
                }}>
                  <Ic size={16} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#fff',
                    letterSpacing: -0.2, marginBottom: 4 }}>
                    {tn.title}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.62)',
                    lineHeight: 1.45, letterSpacing: -0.05 }}>
                    {tn.body}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 2 }}>
                  <span style={{
                    fontFamily: 'Geist Mono, ui-monospace, monospace', fontSize: 10,
                    color: 'rgba(255,255,255,0.3)', letterSpacing: 0.5,
                  }}>{String(i + 1).padStart(2, '0')}</span>
                </div>
              </div>
            </Glass>
          );
        })}

        <div style={{ padding: '14px 6px 0' }}>
          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.55,
            letterSpacing: -0.05,
          }}>
            <b style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Алгоритм:</b> Argon2id для деривации из фразы (PBKDF2 600k как fallback), гибридное эфемерное рукопожатие X25519&nbsp;+&nbsp;ML-KEM-768 для общего секрета (forward secrecy + постквантовая стойкость), AES-256-GCM для шифра сообщений с уникальным IV (96 бит) на каждый пакет. Ключи никогда не покидают устройство; сервер видит только зашифрованные блобы и редактирует токены сессии из access-логов.
            <br/><br/>
            <b style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Доверие:</b> мы&nbsp;не можем читать ваши сообщения. Это не обещание, а свойство протокола — у нас нет ключей.
          </div>
        </div>
      </div>

      <div style={{ padding: '8px 22px 0' }}>
        <GlassButton primary palette={palette} onClick={onBack}
          icon={<Icon.Check size={14} color="#0a0a10" />}>
          Понятно
        </GlassButton>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function ExpiredScreen({ palette, onRestart, reason }) {
  const p = usePalette(palette);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '24px 22px 30px', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ width: 38 }} />
        <Logo size={9} palette={palette} />
        <div style={{ width: 38 }} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center' }}>

        <div style={{
          width: 90, height: 90, borderRadius: '50%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px dashed rgba(255,255,255,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 28,
        }}>
          <Icon.Eraser size={32} color="rgba(255,255,255,0.6)" />
        </div>

        <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontSize: 36, lineHeight: 1.05, fontWeight: 400, letterSpacing: -0.6,
          textAlign: 'center' }}>
          Сессия<br/>
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>растворилась.</span>
        </div>

        <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.55)',
          textAlign: 'center', maxWidth: 300, lineHeight: 1.5 }}>
          {reason || 'Таймер обнулился. Все сообщения и ключи стёрты с устройств.'}
        </div>
      </div>

      <GlassButton primary palette={palette} onClick={onRestart}
        icon={<Icon.Plus size={16} color={p.text} />}>
        Открыть новую
      </GlassButton>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ShareScreen — shown right after a successful create. Displays the code,
// session expiry, partner status. User can close the tab and come back later;
// the relay holds the slot until expiry.
function ShareScreen({ palette, hash, phrase, expiresAt,
                       slots, mySlot, paired, groupMax = 2, participants = null,
                       onEnterChat, onCancel }) {
  const p = usePalette(palette);
  // Local 1-Hz ticker — keeps the expiry countdown live without re-rendering
  // the whole App every second. (Was previously a `nowMs` prop driven by App.)
  const nowMs = useNow(true);
  const [copied, setCopied] = React.useState(false);
  // mySlot is a NUMBER. For 2-party rooms slots come back in legacy {A,B}
  // shape; for groups it's an Array. peerClaimed means "any other slot is
  // claimed" in both shapes (true once at least one partner has joined).
  const peerClaimed = (() => {
    if (Array.isArray(slots)) {
      return slots.some((s, i) => i !== mySlot && s && s.claimed);
    }
    if (slots && typeof slots === 'object') {
      const peerKey = mySlot === 0 ? 'B' : 'A';
      return !!slots[peerKey]?.claimed;
    }
    return false;
  })();

  const copyValue = phrase || hash;
  const onCopy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(copyValue); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const left = Math.max(0, Math.floor(((expiresAt || 0) - (nowMs || Date.now())) / 1000));
  const days = Math.floor(left / 86400);
  const hrs = Math.floor((left % 86400) / 3600);
  const mins = Math.floor((left % 3600) / 60);
  const ttlLabel = days >= 1
    ? `${days}д ${hrs}ч`
    : hrs >= 1
      ? `${hrs}ч ${mins}м`
      : `${mins}м`;

  return (
    <div className="no-scrollbar" style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '20px 18px 24px', position: 'relative', overflowY: 'auto' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div onClick={onCancel} style={{
          width: 38, height: 38, borderRadius: 12,
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Icon.Arrow size={16} color="#fff" dir="left" />
        </div>
        <Logo size={9} palette={palette} />
        <div style={{ width: 38 }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
        <Glass radius={9999} padding="6px 12px">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10,
            fontWeight: 500, color: 'var(--tx-60)', letterSpacing: 1.2,
            textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            <span style={{ position: 'relative', display: 'inline-block', width: 6, height: 6 }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%',
                background: paired ? '#3dff9a' : p.a,
                boxShadow: paired ? '0 0 10px rgba(61,255,154,0.7)' : `0 0 10px ${p.a}`,
                animation: 'pulse-dot 1.6s ease-in-out infinite' }} />
            </span>
            {paired ? 'оба в сессии' : (peerClaimed ? 'второй внутри' : 'ждём второго')}
          </div>
        </Glass>
      </div>

      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontSize: 32, lineHeight: 1.0, fontWeight: 400, letterSpacing: -0.6 }}>
          Код сессии
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--tx-60)',
          letterSpacing: -0.05, maxWidth: 300, margin: '6px auto 0' }}>
          Передай партнёру фразу или хеш. Можно закрыть вкладку — комната живёт ещё <b style={{ color: 'var(--tx-100)' }}>{ttlLabel}</b>.
        </div>
      </div>

      {/* phrase preview, if any */}
      {phrase && (
        <div style={{ marginTop: 12 }}>
          <Glass radius={16} padding="10px 14px">
            <div style={{ fontSize: 9.5, color: 'var(--tx-40)', letterSpacing: 1.4,
              textTransform: 'uppercase', textAlign: 'center', marginBottom: 6,
              fontFamily: "'Geist Mono', monospace" }}>
              фраза
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, textAlign: 'center',
              color: 'var(--tx-100)', wordBreak: 'break-word' }}>
              {phrase}
            </div>
          </Glass>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Glass radius={20} padding="18px 14px" strong>
          <div style={{ fontSize: 9.5, color: 'var(--tx-40)', letterSpacing: 1.4,
            textTransform: 'uppercase', textAlign: 'center', marginBottom: 12,
            fontFamily: "'Geist Mono', monospace" }}>
            MD5 · 128 бит
          </div>
          <HashDisplay hash={hash} big palette={palette} />
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button onClick={onCopy}
              style={{
                flex: 1, height: 40, border: 'none', cursor: 'pointer',
                borderRadius: 14, background: 'rgba(255,255,255,0.08)',
                color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 0.5px rgba(255,255,255,0.10)',
                letterSpacing: 0.4, textTransform: 'uppercase',
              }}>
              {copied
                ? <><Icon.Check size={13} color={p.a} /> скопировано</>
                : <><Icon.Copy size={13} /> {phrase ? 'фразу' : 'хеш'}</>}
            </button>
            <button onClick={async () => {
              try {
                if (navigator.share) {
                  await navigator.share({ title: 'Nee2P. session', text: copyValue });
                } else {
                  navigator.clipboard && navigator.clipboard.writeText(copyValue);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                }
              } catch {}
            }} style={{
              width: 40, height: 40, border: 'none', cursor: 'pointer',
              borderRadius: 14, background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 0.5px rgba(255,255,255,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 3v13M12 3l-4 4M12 3l4 4M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5"
                  stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </Glass>
      </div>

      <div style={{ flex: 1, minHeight: 14 }} />

      <GlassButton primary palette={palette} onClick={onEnterChat}
        icon={<Icon.Arrow size={16} color={p.text} />}>
        {paired ? 'Войти в чат' : 'Открыть чат (партнёр потом)'}
      </GlassButton>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LockedScreen — both slots already claimed by other passwords.
function LockedScreen({ palette, onBack }) {
  const p = usePalette(palette);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '24px 22px 30px', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div onClick={onBack} style={{
          width: 38, height: 38, borderRadius: 12,
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Icon.Arrow size={16} color="#fff" dir="left" />
        </div>
        <Logo size={9} palette={palette} />
        <div style={{ width: 38 }} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center' }}>

        <div style={{
          width: 90, height: 90, borderRadius: '50%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px dashed rgba(255,255,255,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 28,
        }}>
          <Icon.Lock size={36} color="rgba(255,255,255,0.6)" />
        </div>

        <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontSize: 32, lineHeight: 1.05, fontWeight: 400, letterSpacing: -0.6,
          textAlign: 'center' }}>
          Сессия закрыта<br/>
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>максимум участников исчерпан.</span>
        </div>

        <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.55)',
          textAlign: 'center', maxWidth: 300, lineHeight: 1.5 }}>
          По этой фразе все слоты заняты. Если ты участник — введи свой пароль ещё раз. Иначе — попроси у создателя свежую фразу или новую сессию побольше.
        </div>
      </div>

      <GlassButton primary palette={palette} onClick={onBack}
        icon={<Icon.Arrow size={16} color={p.text} dir="left" />}>
        К началу
      </GlassButton>
    </div>
  );
}

Object.assign(window, {
  WelcomeScreen, CreatedScreen, JoinScreen, WaitingScreen,
  ChatScreen, InfoScreen, ExpiredScreen, ShareScreen, LockedScreen, ConnectOrb,
});
