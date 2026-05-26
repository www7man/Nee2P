#!/usr/bin/env node
// Generate minimal PNG icons for Nee2P. PWA (192x192, 512x512, maskable-safe).
// Centered glowing dot on near-black background. Pure Node + zlib — no deps.
//
// Maskable safe-area: keep the dot inside the inner 80% radius circle so it
// survives any platform mask (circle, squircle, rounded square).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

// PNG writer ────────────────────────────────────────────────────────────
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = (v & 1) ? (0xedb88320 ^ (v >>> 1)) : (v >>> 1);
      t[n] = v >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writePNG(filePath, width, height, rgbaPixels) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR: width, height, bit depth=8, color=6 (RGBA), compression=0, filter=0, interlace=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // raw image data with filter byte (0) per scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = zlib.deflateSync(raw, { level: 9 });

  const file = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, file);
  return file.length;
}

// Renderer ──────────────────────────────────────────────────────────────
function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;

  // Background: deep near-black radial gradient (matches --bg-deep #06060a)
  // plus a subtle outer-to-inner darken so the dot pops.
  // Maskable: leave 10% padding on each side; dot fits inside inner 80%.
  const innerR = size * 0.40;       // 40% radius (inside safe zone) — large soft halo
  const coreR  = size * 0.13;       // crisp inner core
  const featherR = size * 0.50;     // halo end

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      let r = 6, g = 6, b = 10; // base bg #06060a
      const a = 255;

      // Halo (white glow falloff)
      if (d < featherR) {
        // smooth gauss-ish falloff
        const t = Math.max(0, Math.min(1, 1 - (d / featherR)));
        const halo = Math.pow(t, 2.4);
        const hi = Math.min(255, halo * 110);
        r = Math.min(255, r + hi);
        g = Math.min(255, g + hi);
        b = Math.min(255, b + Math.min(255, hi * 1.05));
      }
      // Bright core
      if (d < innerR) {
        const t = Math.max(0, Math.min(1, 1 - (d / innerR)));
        const core = Math.pow(t, 3);
        const ci = core * 220;
        r = Math.min(255, r + ci);
        g = Math.min(255, g + ci);
        b = Math.min(255, b + ci);
      }
      if (d < coreR) {
        // fully saturated center
        const t = Math.max(0, Math.min(1, 1 - (d / coreR)));
        const blend = Math.pow(t, 0.8);
        r = Math.round(r * (1 - blend) + 255 * blend);
        g = Math.round(g * (1 - blend) + 255 * blend);
        b = Math.round(b * (1 - blend) + 255 * blend);
      }

      const idx = (y * size + x) * 4;
      buf[idx]     = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }
  return buf;
}

for (const size of [192, 512]) {
  const pixels = renderIcon(size);
  const out = path.join(OUT_DIR, `icon-${size}.png`);
  const bytes = writePNG(out, size, size, pixels);
  console.log(`wrote ${out} (${bytes} bytes)`);
}
