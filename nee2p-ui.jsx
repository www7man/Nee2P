// nee2p-ui.jsx — primitives, palette, background, glass components.
// Lifted verbatim from the design prototype; visuals unchanged.

const PALETTES = {
  mono:  { a: '#d4d4dc', b: '#8e8e9a', c: '#4a4a56',
           accent: 'linear-gradient(180deg,#ffffff 0%,#cdcdd6 100%)',
           glow: 'rgba(255,255,255,0.18)', text: '#0a0a10' },
  steel: { a: '#7a9adf', b: '#3c5b9c', c: '#2a3d6a',
           accent: 'linear-gradient(180deg,#8eb0ff 0%,#4262b8 100%)',
           glow: 'rgba(122,154,223,0.32)', text: '#ffffff' },
  amber: { a: '#e0a060', b: '#a05f24', c: '#5a3520',
           accent: 'linear-gradient(180deg,#f0b878 0%,#a85f24 100%)',
           glow: 'rgba(224,160,96,0.32)', text: '#ffffff' },
  toxic: { a: '#a8e8b0', b: '#5fb070', c: '#2a5c34',
           accent: 'linear-gradient(180deg,#b8f0a8 0%,#5fa05c 100%)',
           glow: 'rgba(168,232,176,0.30)', text: '#0a0a10' },
};

const usePalette = (key) => PALETTES[key] || PALETTES.mono;

function GradientMesh({ palette = 'mono', intensity = 1, variant = 'home' }) {
  const p = usePalette(palette);
  const i = intensity;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#06050c', zIndex: 0 }}>
      <div style={{ position: 'absolute', inset: 0,
        background: 'radial-gradient(120% 80% at 50% 0%, #14141c 0%, #06060a 60%)' }} />

      <div style={{
        position: 'absolute', width: 380, height: 380, borderRadius: '50%',
        background: `radial-gradient(circle, ${p.a}99, transparent 65%)`,
        filter: 'blur(50px)', top: -120, left: -100, mixBlendMode: 'screen',
        opacity: 0.55 * i, animation: 'float1 18s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', width: 340, height: 340, borderRadius: '50%',
        background: `radial-gradient(circle, ${p.b}99, transparent 65%)`,
        filter: 'blur(55px)', top: '40%', right: -140, mixBlendMode: 'screen',
        opacity: 0.50 * i, animation: 'float2 22s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', width: 400, height: 400, borderRadius: '50%',
        background: `radial-gradient(circle, ${p.c}99, transparent 65%)`,
        filter: 'blur(60px)', bottom: -150, left: -80, mixBlendMode: 'screen',
        opacity: 0.45 * i, animation: 'float3 26s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', width: 260, height: 260, borderRadius: '50%',
        background: `radial-gradient(circle, ${p.a}77, transparent 65%)`,
        filter: 'blur(45px)', top: '30%', left: '20%', mixBlendMode: 'screen',
        opacity: 0.35 * i, animation: 'float4 20s ease-in-out infinite',
      }} />

      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        maskImage: 'radial-gradient(120% 80% at 50% 50%, #000 30%, transparent 90%)',
        WebkitMaskImage: 'radial-gradient(120% 80% at 50% 50%, #000 30%, transparent 90%)',
      }} />

      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: 0.18, mixBlendMode: 'overlay',
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
      }} />

      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 25%, transparent 75%, rgba(0,0,0,0.5) 100%)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

function Glass({ children, style = {}, radius = 28, padding = 20, strong = false, glow, onClick, className = '' }) {
  return (
    <div onClick={onClick} className={className} style={{
      position: 'relative',
      borderRadius: radius,
      padding,
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: radius,
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        background: strong
          ? 'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)'
          : 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
        boxShadow: glow
          ? `inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.04), 0 20px 60px ${glow}, 0 0 0 0.5px rgba(255,255,255,0.10)`
          : 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(255,255,255,0.03), 0 8px 32px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(255,255,255,0.08)',
      }} />
      <div style={{
        position: 'absolute', top: 0, left: '14%', right: '14%', height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
        borderRadius: 9999,
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  );
}

function GlassButton({ children, primary = false, palette = 'mono', onClick, icon, iconRight = false, style = {}, disabled = false }) {
  const p = usePalette(palette);
  const [hover, setHover] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const primaryColor = p.text || '#fff';
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        position: 'relative', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        width: '100%', height: 60, borderRadius: 22,
        background: 'transparent', padding: 0, overflow: 'hidden',
        fontFamily: 'inherit', color: primary ? primaryColor : '#fff',
        transform: pressed ? 'scale(0.98)' : 'scale(1)',
        transition: 'transform 0.15s ease',
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 22,
        background: primary ? p.accent : 'rgba(255,255,255,0.06)',
        backdropFilter: primary ? 'none' : 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: primary ? 'none' : 'blur(24px) saturate(180%)',
        boxShadow: primary
          ? `0 12px 32px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.15)`
          : 'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.03), 0 4px 20px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(255,255,255,0.10)',
        transition: 'all 0.25s ease',
      }} />
      {hover && !disabled && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: '40%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
          animation: 'shine-sweep 0.9s ease-out',
          pointerEvents: 'none',
        }} />
      )}
      <div style={{
        position: 'relative', zIndex: 1, height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        fontSize: 17, fontWeight: 600, letterSpacing: -0.2,
      }}>
        {!iconRight && icon}
        <span>{children}</span>
        {iconRight && icon}
      </div>
    </button>
  );
}

function Logo({ size = 18, palette = 'mono' }) {
  const p = usePalette(palette);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 0 }}>
      <span style={{
        fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
        fontSize: size * 2.2, lineHeight: 1, fontWeight: 400,
        color: '#fff', letterSpacing: -1,
      }}>Nee2P</span>
      <span style={{
        display: 'inline-block', width: size * 0.34, height: size * 0.34,
        borderRadius: '50%', background: p.a,
        marginLeft: size * 0.18, transform: `translateY(${size * -0.06}px)`,
        boxShadow: `0 0 ${size * 0.6}px ${p.a}80, 0 0 ${size * 0.2}px ${p.a}`,
      }} />
    </div>
  );
}

function StatusDot({ online = true, size = 8 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: online ? '#3dff9a' : 'rgba(255,255,255,0.3)',
        boxShadow: online ? '0 0 12px rgba(61,255,154,0.7), 0 0 4px rgba(61,255,154,1)' : 'none',
      }} />
      {online && <span style={{
        position: 'absolute', inset: -2, borderRadius: '50%',
        background: '#3dff9a',
        animation: 'pulse-dot 2s ease-in-out infinite',
        opacity: 0.35,
      }} />}
    </span>
  );
}

function HashDisplay({ hash, big = false, palette = 'mono' }) {
  const p = usePalette(palette);
  const safe = (hash || '').toLowerCase().replace(/[^a-f0-9]/g, '').padEnd(32, '_').slice(0, 32);
  const groups = [];
  for (let i = 0; i < 32; i += 4) groups.push(safe.slice(i, i + 4));
  const row1 = groups.slice(0, 4);
  const row2 = groups.slice(4, 8);

  const fs = big ? 18 : 13;
  const gap = big ? 8 : 5;
  const dotSize = big ? 4 : 3;

  const renderRow = (gs, rowIdx) => (
    <div key={rowIdx} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap, fontFamily: "'Geist Mono', ui-monospace, monospace",
      fontSize: fs, fontWeight: 600, letterSpacing: big ? 1.6 : 1.2,
      color: 'var(--tx-100)',
    }}>
      {gs.map((g, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span style={{
              width: dotSize, height: dotSize, borderRadius: '50%',
              background: 'var(--tx-25)', display: 'inline-block',
            }} />
          )}
          <span style={{ display: 'inline-flex', gap: big ? 1 : 0 }}>
            {g.split('').map((ch, ci) => (
              <span key={ci} style={{
                display: 'inline-block',
                color: ch === '_' ? 'var(--tx-25)' : 'var(--tx-100)',
                minWidth: big ? 14 : 10, textAlign: 'center',
              }}>{ch === '_' ? '·' : ch}</span>
            ))}
          </span>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column',
      gap: big ? 6 : 3, alignItems: 'center' }}>
      {renderRow(row1, 0)}
      {renderRow(row2, 1)}
    </div>
  );
}

const Icon = {
  Plus: ({ size = 20, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2.2" strokeLinecap="round"/></svg>
  ),
  Key: ({ size = 20, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="8.5" cy="14.5" r="4" stroke={color} strokeWidth="2"/><path d="M11.5 11.5L20 3M16 7l3 3M14 9l3 3" stroke={color} strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  Copy: ({ size = 16, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2.5" stroke={color} strokeWidth="1.8"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></svg>
  ),
  Send: ({ size = 18, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M5 12l14-7-5 16-4-7-5-2z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill={color} fillOpacity="0.25"/></svg>
  ),
  Eye: ({ size = 18, color = '#fff', closed = false }) => closed ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-6 9-6c2 0 3.7.7 5 1.7M21 12s-3.5 6-9 6c-2 0-3.7-.7-5-1.7M3 3l18 18" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" stroke={color} strokeWidth="1.8"/><circle cx="12" cy="12" r="2.5" stroke={color} strokeWidth="1.8"/></svg>
  ),
  Clock: ({ size = 14, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2"/><path d="M12 7v5l3 2" stroke={color} strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  Lock: ({ size = 16, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke={color} strokeWidth="1.8"/><path d="M8 11V8a4 4 0 018 0v3" stroke={color} strokeWidth="1.8"/></svg>
  ),
  Check: ({ size = 16, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5 11-12" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  Ghost: ({ size = 22, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M5 11a7 7 0 0114 0v9l-2-2-2 2-2-2-2 2-2-2-2 2v-9z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="9" cy="11" r="1.1" fill={color}/><circle cx="15" cy="11" r="1.1" fill={color}/></svg>
  ),
  Flame: ({ size = 16, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 3s4 4 4 8a4 4 0 11-8 0c0-1 .5-2 1-2.5C9 10 9.5 8 12 3z" stroke={color} strokeWidth="1.6" strokeLinejoin="round"/></svg>
  ),
  Arrow: ({ size = 18, color = '#fff', dir = 'right' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ transform: dir === 'left' ? 'rotate(180deg)' : undefined }}><path d="M5 12h14M13 6l6 6-6 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  Shield: ({ size = 16, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 3l8 3v6c0 4.5-3.5 8.5-8 9-4.5-.5-8-4.5-8-9V6l8-3z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  Bolt: ({ size = 16, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" fill="none"/></svg>
  ),
  NoServer: ({ size = 16, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="6" rx="1.5" stroke={color} strokeWidth="1.6"/><rect x="3" y="13" width="18" height="6" rx="1.5" stroke={color} strokeWidth="1.6"/><circle cx="7" cy="8" r="0.8" fill={color}/><circle cx="7" cy="16" r="0.8" fill={color}/><path d="M3 3l18 18" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></svg>
  ),
  Eraser: ({ size = 16, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M15 4l5 5-10 10H5l-2-2 12-13z" stroke={color} strokeWidth="1.6" strokeLinejoin="round"/><path d="M10 9l5 5M9 19h10" stroke={color} strokeWidth="1.6" strokeLinecap="round"/></svg>
  ),
};

function Sheet({ children, style = {} }) {
  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 26,
      animation: 'fade-up 0.5s ease',
      ...style,
    }}>
      {children}
    </div>
  );
}

Object.assign(window, {
  PALETTES, usePalette, GradientMesh, Glass, GlassButton, Logo, StatusDot, HashDisplay, Icon, Sheet,
});
