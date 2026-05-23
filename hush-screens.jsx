// hush-screens.jsx — six flow screens. Visuals lifted from the design prototype.
// Differences from the prototype:
//   • simulate buttons removed (the server drives transitions, not buttons)
//   • CreatedScreen has a Cancel button instead of the "simulate" button
//   • Chat typing indicator only shows when the actual peer is typing
//   • ChatScreen receives a goBack handler for the back arrow

const { GradientMesh, Glass, GlassButton, Logo, StatusDot, HashDisplay, Icon, usePalette } = window;
const md5 = window.md5;

// ─────────────────────────────────────────────────────────────
function WelcomeScreen({ palette, onCreate, onJoin, onInfo }) {
  const p = usePalette(palette);

  const phrases = ['один код', 'один секрет', 'один таймер', 'ни следа'];
  const [phraseIdx, setPhraseIdx] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setPhraseIdx(i => (i + 1) % phrases.length), 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
      padding: '24px 22px 26px', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        animation: 'welcome-rise 0.7s ease both' }}>
        <Logo size={11} palette={palette} />
        <Glass radius={9999} padding="6px 12px" style={{ display: 'inline-flex' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10,
            fontWeight: 500, color: 'var(--tx-60)', letterSpacing: 1.2,
            textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
              background: p.a, boxShadow: `0 0 8px ${p.a}` }} />
            без следов
          </div>
        </Glass>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center', position: 'relative' }}>

        <div style={{ animation: 'welcome-rise 0.9s 0.1s ease both' }}>
          <ConnectOrb palette={palette} size={220} />
        </div>

        <h1 style={{
          margin: '22px 0 0',
          fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontWeight: 400, fontSize: 68, lineHeight: 0.9, letterSpacing: -2.2,
          textAlign: 'center', color: 'var(--tx-100)',
          animation: 'welcome-rise 0.9s 0.25s ease both',
        }}>
          Двое.
        </h1>

        <div style={{
          marginTop: 14, height: 16, display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          fontSize: 11, fontWeight: 500, color: 'var(--tx-60)',
          letterSpacing: 2.2, textTransform: 'uppercase', whiteSpace: 'nowrap',
          animation: 'welcome-rise 0.9s 0.4s ease both',
        }}>
          <span style={{ width: 18, height: 1, background: 'var(--tx-25)' }} />
          <span key={phraseIdx} style={{
            animation: 'glyph-cycle 2.6s ease-in-out both',
            minWidth: 110, textAlign: 'center',
          }}>{phrases[phraseIdx]}</span>
          <span style={{ width: 18, height: 1, background: 'var(--tx-25)' }} />
        </div>

        <p style={{
          margin: '22px 0 0', fontSize: 13, color: 'var(--tx-60)',
          textAlign: 'center', maxWidth: 290, lineHeight: 1.55, letterSpacing: -0.05,
          fontWeight: 400,
          animation: 'welcome-rise 0.9s 0.55s ease both',
        }}>
          Сессия живёт, пока вы вдвоём.<br/>
          И исчезает, когда вы уходите.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10,
        animation: 'welcome-rise 0.9s 0.7s ease both' }}>
        <GlassButton primary palette={palette} onClick={onCreate}
          icon={<Icon.Plus size={18} color={p.text} />}>
          Создать сессию
        </GlassButton>
        <GlassButton palette={palette} onClick={onJoin}
          icon={<Icon.Key size={16} color="rgba(255,255,255,0.85)" />}>
          Подключиться к коду
        </GlassButton>
        <button onClick={onInfo} style={{
          position: 'relative', height: 42, border: 'none', cursor: 'pointer',
          width: '100%', borderRadius: 14, background: 'transparent',
          padding: 0, overflow: 'hidden', fontFamily: 'inherit',
        }}>
          <div style={{
            position: 'relative', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8, height: '100%',
            fontSize: 12, fontWeight: 500, color: 'var(--tx-40)',
            letterSpacing: 0.3,
          }}>
            <Icon.Shield size={12} color="var(--tx-40)" />
            <span>Как защищены ваши сообщения</span>
            <Icon.Arrow size={11} color="var(--tx-40)" />
          </div>
        </button>

        <div style={{
          marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, fontSize: 9.5, fontWeight: 500, color: 'var(--tx-25)',
          letterSpacing: 1.4, textTransform: 'uppercase',
          fontFamily: "'Geist Mono', monospace",
        }}>
          <span>X25519</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--tx-25)' }} />
          <span>ChaCha20</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--tx-25)' }} />
          <span>Argon2id</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function ConnectOrb({ palette = 'mono', size = 220 }) {
  const p = usePalette(palette);
  const R = 48;

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div style={{
        position: 'absolute', inset: -24, borderRadius: '50%',
        background: `radial-gradient(circle, ${p.a}33, transparent 65%)`,
        filter: 'blur(24px)', animation: 'pulse-dot 4s ease-in-out infinite',
      }} />

      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'radial-gradient(circle at 30% 28%, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 50%, rgba(0,0,0,0.35) 100%)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        boxShadow: 'inset 0 4px 28px rgba(255,255,255,0.16), inset 0 -14px 40px rgba(255,255,255,0.06), 0 30px 60px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.18)',
      }} />

      <div style={{
        position: 'absolute', inset: 10, borderRadius: '50%',
        background: `conic-gradient(from 220deg, ${p.a}25, ${p.b}25, ${p.c}25, ${p.a}25)`,
        filter: 'blur(28px)', opacity: 0.55,
        animation: 'drift-slow 30s linear infinite',
      }} />

      <div style={{
        position: 'absolute', top: 14, left: 26, width: 78, height: 50,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(255,255,255,0.7), transparent 70%)',
        transform: 'rotate(-25deg)', filter: 'blur(6px)',
      }} />

      {[0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute', top: '50%', left: '50%',
          width: R * 2, height: R * 2, marginLeft: -R, marginTop: -R,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.5)',
          animation: `ring-expand 3.6s ease-out ${i * 1.2}s infinite`,
          pointerEvents: 'none',
        }} />
      ))}

      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 5, height: 5, marginLeft: -2.5, marginTop: -2.5,
        borderRadius: '50%', background: '#fff',
        boxShadow: '0 0 10px rgba(255,255,255,0.9)',
        animation: 'pulse-dot 1.6s ease-in-out infinite',
      }} />

      <div style={{
        position: 'absolute', inset: 0,
        animation: 'svg-orbit 18s linear infinite',
        transformOrigin: '50% 50%',
      }}>
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          width: R * 2 - 18, height: 1,
          transform: 'translate(-50%, -50%)',
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
          boxShadow: '0 0 6px rgba(255,255,255,0.4)',
        }} />

        <div style={{
          position: 'absolute', top: '50%', width: 4, height: 4,
          marginTop: -2, borderRadius: '50%',
          background: '#fff', boxShadow: '0 0 8px rgba(255,255,255,0.9)',
          animation: 'particle-trace 2.6s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', top: '50%', width: 4, height: 4,
          marginTop: -2, borderRadius: '50%',
          background: '#fff', boxShadow: '0 0 8px rgba(255,255,255,0.9)',
          animation: 'particle-trace-rev 2.6s ease-in-out 1.3s infinite',
        }} />

        <div style={{
          position: 'absolute', top: '50%', left: `calc(50% - ${R}px)`,
          width: 24, height: 24, marginTop: -12, marginLeft: -12,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 28%, #ffffff 0%, #ffffff 40%, #c8c8d0 100%)',
          boxShadow: '0 6px 14px rgba(0,0,0,0.45), 0 0 18px rgba(255,255,255,0.25), inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -2px 3px rgba(0,0,0,0.1)',
        }} />

        <div style={{
          position: 'absolute', top: '50%', left: `calc(50% + ${R}px)`,
          width: 24, height: 24, marginTop: -12, marginLeft: -12,
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
function CreatedScreen({ palette, mode, setMode, phrase, setPhrase, autoSeed,
                         ttlOptions, ttlId, setTtlId,
                         password, setPassword,
                         busy, error, onCancel, onSubmit }) {
  const p = usePalette(palette);
  const [showPwd, setShowPwd] = React.useState(false);

  const source = mode === 'phrase' ? (phrase || '') : autoSeed;
  const hash = source ? md5(source) : '';
  const canSubmit = hash && password.length >= 4 && !busy;

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

      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
          fontSize: 32, lineHeight: 1.0, fontWeight: 400, letterSpacing: -0.6 }}>
          Создать сессию
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--tx-60)', letterSpacing: -0.05 }}>
          Фраза, время жизни и твой пароль. Второй подключится в любое время до истечения.
        </div>
      </div>

      {/* — mode toggle: random or phrase — */}
      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
        <Glass radius={9999} padding={3} style={{ display: 'inline-flex' }}>
          <div style={{ display: 'flex', gap: 2, position: 'relative' }}>
            {[
              { id: 'auto',   label: 'случайно' },
              { id: 'phrase', label: 'своя фраза' },
            ].map(o => (
              <button key={o.id} onClick={() => setMode(o.id)}
                style={{
                  position: 'relative', border: 'none', cursor: 'pointer',
                  background: mode === o.id ? p.accent : 'transparent',
                  color: mode === o.id ? p.text : 'var(--tx-60)',
                  padding: '6px 14px', borderRadius: 9999,
                  fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
                  textTransform: 'uppercase', fontFamily: 'inherit',
                  boxShadow: mode === o.id ? `0 4px 12px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)` : 'none',
                  transition: 'background 0.25s ease, color 0.25s ease',
                }}>{o.label}</button>
            ))}
          </div>
        </Glass>
      </div>

      {mode === 'phrase' && (
        <div style={{ marginTop: 12 }}>
          <Glass radius={18} padding="10px 14px" strong>
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="например: пушкин-кафе-22"
              maxLength={120}
              style={{
                width: '100%', background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--tx-100)', fontSize: 15, fontWeight: 500,
                letterSpacing: -0.1, padding: '4px 0', fontFamily: 'inherit',
              }}
            />
          </Glass>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--tx-40)',
            letterSpacing: 0.4, textAlign: 'center', textTransform: 'uppercase' }}>
            любой язык, любые символы · {(phrase || '').length} / 120
          </div>
        </div>
      )}

      {/* — TTL chooser — */}
      <div style={{ marginTop: mode === 'phrase' ? 12 : 14 }}>
        <div style={{ fontSize: 10, color: 'var(--tx-40)', letterSpacing: 1.4,
          textTransform: 'uppercase', marginBottom: 8, fontFamily: "'Geist Mono', monospace",
          textAlign: 'center' }}>
          код активен ·
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          {ttlOptions.map(o => (
            <button key={o.id} onClick={() => setTtlId(o.id)}
              style={{
                position: 'relative', border: 'none', cursor: 'pointer',
                background: ttlId === o.id ? p.accent : 'rgba(255,255,255,0.06)',
                color: ttlId === o.id ? p.text : 'var(--tx-80)',
                padding: '7px 12px', borderRadius: 9999,
                fontSize: 12, fontWeight: 600, letterSpacing: 0.2,
                fontFamily: 'inherit',
                boxShadow: ttlId === o.id
                  ? `0 4px 12px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`
                  : 'inset 0 1px 0 rgba(255,255,255,0.12)',
                transition: 'background 0.25s ease, color 0.25s ease',
              }}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* — hash preview — */}
      <div style={{ marginTop: 14 }}>
        <Glass radius={18} padding="14px 12px" strong>
          <div style={{ fontSize: 9.5, color: 'var(--tx-40)', letterSpacing: 1.4,
            textTransform: 'uppercase', textAlign: 'center', marginBottom: 10,
            fontFamily: "'Geist Mono', monospace" }}>
            MD5 · 128 бит
          </div>
          <HashDisplay hash={hash} palette={palette} />
        </Glass>
      </div>

      {/* — password field — */}
      <div style={{ marginTop: 12 }}>
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
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && onSubmit()}
              placeholder="придумай"
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
        icon={canSubmit ? <Icon.Plus size={16} color={p.text} /> : <Icon.Lock size={14} color="var(--tx-40)" />}
        onClick={onSubmit}>
        {busy ? 'создаём…' : (canSubmit ? 'Создать и поделиться' : 'фраза и пароль нужны оба')}
      </GlassButton>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function JoinScreen({ palette, value, setValue, password, setPassword,
                      onBack, onContinue, busy, error }) {
  const p = usePalette(palette);
  const [showPwd, setShowPwd] = React.useState(false);
  const trimmed = (value || '').trim();
  const hashRegex = /^[a-f0-9]{32}$/i;
  const isHash = hashRegex.test(trimmed);
  const finalHash = trimmed ? (isHash ? trimmed.toLowerCase() : md5(trimmed)) : '';
  const validInput = trimmed.length > 0;
  const valid = validInput && password.length >= 4 && !busy;

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
            onChange={(e) => setValue(e.target.value)}
            placeholder="любая фраза или 32 символа хеша"
            rows={3}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--tx-100)', fontSize: 16, fontWeight: 500,
              letterSpacing: -0.1, fontFamily: 'inherit',
              resize: 'none', minHeight: 64,
            }}
          />
        </Glass>

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

      {/* — password field — */}
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

      <GlassButton primary={valid} palette={palette} disabled={!valid}
        icon={valid ? <Icon.Arrow size={16} color={p.text} /> : <Icon.Lock size={14} color="var(--tx-40)" />}
        onClick={onContinue}>
        {busy ? 'подключение…' : (valid ? 'Подключиться' : 'фраза и пароль нужны оба')}
      </GlassButton>
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
  const copyValue = phrase || hash;
  const doCopy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(copyValue); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const doShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'hush. session', text: copyValue });
      else doCopy();
    } catch {}
  };
  return (
    <Glass radius={18} padding="12px 14px" style={{ alignSelf: 'stretch', margin: '0 4px' }}>
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
    </Glass>
  );
}

// URL detector — turn http(s)://... runs into clickable <a>. The rest of the
// message is plain text wrapped in spans (so XSS isn't possible — React
// escapes children).
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"',.!?)]/gi;
function renderText(text) {
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

function ChatScreen({ palette, perspective, expirySeconds, totalSeconds,
                       partnerOnline, partnerClaimed, partnerTyping, paired,
                       messages, sessionHash, sharePhrase,
                       onSend, onDelete, onBack, banner }) {
  const p = usePalette(palette);
  const [input, setInput] = React.useState('');
  const inputRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const typingTimerRef = React.useRef(null);
  const typingStateRef = React.useRef({ on: false, lastSentAt: 0 });
  // long-press menu: { msg } | null
  const [menuMsg, setMenuMsg] = React.useState(null);
  const longPressRef = React.useRef(null);
  const longPressFiredRef = React.useRef(false);

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
    const quoted = msg.text.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    setInput(prev => quoted + (prev || ''));
    closeMenu();
    setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
  };
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
    if (!window.__hushTypingSend) return;
    const now = Date.now();
    const st = typingStateRef.current;
    if (on) {
      if (!st.on || now - st.lastSentAt > 4000) {
        st.on = true; st.lastSentAt = now;
        window.__hushTypingSend(true);
      }
    } else {
      if (st.on) {
        st.on = false; st.lastSentAt = now;
        window.__hushTypingSend(false);
      }
    }
  };

  const hh = String(Math.floor(expirySeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((expirySeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(expirySeconds % 60).padStart(2, '0');
  const lowTime = expirySeconds < 600;

  const partnerLetter = perspective === 'A' ? 'B' : 'A';

  const send = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
    clearTimeout(typingTimerRef.current);
    sendTyping(false);
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
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', lineHeight: 1.1 }}>
                anonymous · {partnerLetter}
              </div>
              <div style={{ fontSize: 11, color: partnerOnline ? '#3dff9a' : 'rgba(255,255,255,0.5)',
                lineHeight: 1.2, marginTop: 2, letterSpacing: 0.2 }}>
                {partnerOnline ? (partnerTyping ? 'online · typing' : 'online') : 'offline'}
              </div>
            </div>

            <div>
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
                  <div style={{ fontFamily: 'Geist Mono, ui-monospace, monospace', fontWeight: 700,
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

        {messages.map((m, i) => {
          const mine = m.side === perspective;
          return (
            <div key={m.id || i} style={{
              display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start',
              animation: 'fade-up 0.3s ease',
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
                  borderBottomRightRadius: mine ? 6 : 22,
                  borderBottomLeftRadius: mine ? 22 : 6,
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
                <div style={{ whiteSpace: 'pre-wrap' }}>{renderText(m.text)}</div>
                <div style={{
                  fontSize: 10,
                  color: mine
                    ? (p.text === '#ffffff' ? 'rgba(255,255,255,0.8)' : 'rgba(10,10,16,0.55)')
                    : 'rgba(255,255,255,0.45)',
                  marginTop: 4, textAlign: 'right',
                  fontFamily: 'Geist Mono, ui-monospace, monospace', letterSpacing: 0.2,
                }}>
                  {m.time}{mine && ' ✓✓'}
                </div>
              </div>
            </div>
          );
        })}

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
              placeholder="whisper something…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#fff', fontSize: 15, fontFamily: 'inherit',
                padding: '10px 14px', letterSpacing: -0.1,
              }}
            />
            <button onClick={send} style={{
              width: 40, height: 40, borderRadius: 16, border: 'none', cursor: 'pointer',
              background: input.trim() ? p.accent : 'rgba(255,255,255,0.08)',
              boxShadow: input.trim()
                ? `0 4px 14px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4)`
                : 'inset 0 1px 0 rgba(255,255,255,0.12)',
              transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon.Send size={16} color={input.trim() ? p.text : '#fff'} />
            </button>
          </div>
        </div>
      </div>

      {menuMsg && (
        <MessageActionMenu
          palette={palette}
          msg={menuMsg}
          isMine={menuMsg.side === perspective}
          onQuote={() => quoteMessage(menuMsg)}
          onDelete={() => deleteMessage(menuMsg)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function MessageActionMenu({ palette, msg, isMine, onQuote, onDelete, onClose }) {
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
function InfoScreen({ palette, onBack }) {
  const p = usePalette(palette);

  const tenets = [
    { icon: Icon.Lock,     title: 'End-to-end шифрование',
      body: 'Сообщения шифруются на устройстве отправителя и расшифровываются только на устройстве получателя. Между ними — нечитаемый поток.' },
    { icon: Icon.NoServer, title: 'Ничего не хранится',
      body: 'Серверов с историей переписки не существует. После закрытия сессии не остаётся ни базы, ни бэкапа, ни кэша.' },
    { icon: Icon.Ghost,    title: 'Никакой регистрации',
      body: 'Нет аккаунтов, email, номеров. Сессия живёт под одноразовым кодом — и принадлежит ровно двум устройствам.' },
    { icon: Icon.Key,      title: 'Два пароля — один замок',
      body: 'Сессия открывается только когда оба участника установили личный пароль. Один забыл — переписка теряется навсегда.' },
    { icon: Icon.Eraser,   title: 'Таймер самоуничтожения',
      body: 'С момента запуска идёт обратный отсчёт. Когда таймер обнуляется, сессия и все ключи стираются из памяти устройств.' },
    { icon: Icon.Bolt,     title: 'Без метаданных',
      body: 'Не собираем кто, когда, с кем. Нет идентификаторов устройств, IP-логов, телеметрии или аналитики.' },
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
          Шесть правил,<br/>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>на которых стоит hush.</span>
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
            <b style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Алгоритм:</b> PBKDF2 для деривации из фразы, AES-GCM 256-бит для шифра сообщений, каждое сообщение получает свой одноразовый IV (96 бит). Ключ никогда не покидает устройство; сервер видит только зашифрованные блобы.
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
function ShareScreen({ palette, hash, phrase, expiresAt, nowMs,
                       slots, mySlot, paired, onEnterChat, onCancel }) {
  const p = usePalette(palette);
  const [copied, setCopied] = React.useState(false);
  const peerSlot = mySlot === 'A' ? 'B' : 'A';
  const peerClaimed = !!slots[peerSlot]?.claimed;

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
                  await navigator.share({ title: 'hush. session', text: copyValue });
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
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>на два пароля.</span>
        </div>

        <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.55)',
          textAlign: 'center', maxWidth: 300, lineHeight: 1.5 }}>
          По этой фразе уже сидят двое. Если ты один из них — введи свой пароль ещё раз. Иначе — попроси у партнёра свежую фразу.
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
