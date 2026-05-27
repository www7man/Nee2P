// smoke-i18n.js — verify the i18n catalog in i18n.js is complete and that
// every t('key') used in the React layer resolves to a real entry.
//
// Pure Node, no deps. Designed to run under `node tools/smoke-i18n.js`
// from the repo root, both locally and in CI. Exits 0 on pass, 1 on fail.
//
// Checks (run independently — each failure adds a line to the report and
// flips the exit code):
//   (a) Every language listed in LANGS has the same key set as 'ru'.
//   (b) No translated value is undefined / empty string / pure whitespace.
//   (c) LANG_NAMES covers every entry in LANGS (used by the LangToggle
//       dropdown — missing name → blank menu item).
//   (d) Every t('foo.bar') used in nee2p-screens.jsx and nee2p-app.jsx
//       resolves to a key present in the 'ru' catalog (which is the
//       canonical superset per check (a)).
//
// Implementation notes:
//   • i18n.js is loaded as a string, the TRANSLATIONS / LANGS / LANG_NAMES
//     literals are extracted via a sandboxed Function() — we do NOT execute
//     the IIFE wrapper, because it touches `window`, `localStorage`,
//     `navigator`, and React. Sandboxing keeps the test runnable in pure
//     Node without DOM polyfills.
//   • Usage extraction does a simple regex scan for t('...')/tr('...').
//     Template literals are out of scope (we don't use them for keys today).
//   • Arrays are treated as valid values when every element passes the
//     (b) emptiness check (welcome.phrases, pwd.strength).

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const I18N_PATH = path.join(REPO_ROOT, 'i18n.js');
const USAGE_FILES = ['nee2p-screens.jsx', 'nee2p-app.jsx', 'nee2p-ui.jsx'];

// ── Load the catalog ──────────────────────────────────────────────────────

function loadCatalog() {
  const src = fs.readFileSync(I18N_PATH, 'utf8');

  // The IIFE body lives between the outer `(function (g) { ... })(...)`.
  // We rip it out as a string, then build a synthetic body that returns the
  // three literals we care about. The original IIFE assigns to `g.Nee2Pi18n`
  // and reads from `navigator`/`localStorage`/`React` — bypassing it.
  //
  // Extraction strategy: locate `const LANGS`, `const LANG_NAMES`, and
  // `const TRANSLATIONS` then evaluate each individual assignment. This is
  // far more robust than a single sandbox of the whole IIFE.
  function extractConstObject(name) {
    // Match `const NAME = <expr>;` where <expr> is an object/array literal.
    // We scan forward from the `const NAME = ` token and balance braces.
    const start = src.indexOf(`const ${name}`);
    if (start === -1) throw new Error(`i18n.js missing "const ${name}"`);
    const eq = src.indexOf('=', start);
    if (eq === -1) throw new Error(`i18n.js: const ${name} has no =`);
    // Find the first { or [ after `=` — that's the literal opener.
    let i = eq + 1;
    while (i < src.length && src[i] !== '{' && src[i] !== '[') i++;
    if (i === src.length) throw new Error(`i18n.js: const ${name} value is not a literal`);
    const opener = src[i];
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let strCh = '';
    let escape = false;
    let inLineComment = false;
    let inBlockComment = false;
    let end = -1;
    for (let j = i; j < src.length; j++) {
      const ch = src[j];
      const next = src[j + 1];
      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; j++; }
        continue;
      }
      if (inStr) {
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === strCh) { inStr = false; }
        continue;
      }
      // Outside strings/comments: handle comment starts first.
      if (ch === '/' && next === '/') { inLineComment = true; j++; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; j++; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; continue; }
      if (ch === opener) depth++;
      else if (ch === closer) {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) throw new Error(`i18n.js: const ${name} literal not closed`);
    const literal = src.slice(i, end + 1);
    // Evaluate the literal in a function scope with no globals leaked.
    // eslint-disable-next-line no-new-func
    return Function('"use strict"; return (' + literal + ');')();
  }

  const LANGS = extractConstObject('LANGS');
  const LANG_NAMES = extractConstObject('LANG_NAMES');
  const TRANSLATIONS = extractConstObject('TRANSLATIONS');
  return { LANGS, LANG_NAMES, TRANSLATIONS };
}

// ── Checks ─────────────────────────────────────────────────────────────────

const failures = [];
function fail(msg) { failures.push(msg); }
function pass(msg) { console.log('  ✓ ' + msg); }

function isEmptyValue(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) {
    if (v.length === 0) return true;
    return v.some(item => isEmptyValue(item));
  }
  // Anything else (boolean, number, object) — treat as non-empty if not null.
  return false;
}

function checkLangsParity(LANGS, TRANSLATIONS) {
  console.log('\n[a] every lang has the same key set as ru');
  const ru = TRANSLATIONS.ru;
  if (!ru) { fail('TRANSLATIONS.ru is missing — cannot compare'); return; }
  const ruKeys = new Set(Object.keys(ru));
  for (const lang of LANGS) {
    const dict = TRANSLATIONS[lang];
    if (!dict) { fail(`TRANSLATIONS.${lang} missing entirely`); continue; }
    const here = new Set(Object.keys(dict));
    const missing = [...ruKeys].filter(k => !here.has(k));
    const extra = [...here].filter(k => !ruKeys.has(k));
    if (missing.length === 0 && extra.length === 0) {
      pass(`${lang}: ${here.size} keys, matches ru`);
    } else {
      if (missing.length) fail(`${lang}: missing ${missing.length} keys present in ru: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
      if (extra.length)   fail(`${lang}: has ${extra.length} keys NOT in ru: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', …' : ''}`);
    }
  }
}

function checkNoEmptyValues(LANGS, TRANSLATIONS) {
  console.log('\n[b] no translated value is empty/whitespace');
  for (const lang of LANGS) {
    const dict = TRANSLATIONS[lang] || {};
    const empties = [];
    for (const [k, v] of Object.entries(dict)) {
      if (isEmptyValue(v)) empties.push(k);
    }
    if (empties.length === 0) pass(`${lang}: all values populated`);
    else fail(`${lang}: ${empties.length} empty value(s): ${empties.slice(0, 5).join(', ')}${empties.length > 5 ? ', …' : ''}`);
  }
}

function checkLangNamesCoverage(LANGS, LANG_NAMES) {
  console.log('\n[c] LANG_NAMES covers every entry in LANGS');
  const missing = LANGS.filter(l => !LANG_NAMES[l] || String(LANG_NAMES[l]).trim() === '');
  if (missing.length === 0) pass(`LANG_NAMES has all ${LANGS.length} entries`);
  else fail(`LANG_NAMES missing native name for: ${missing.join(', ')}`);
}

// Strip JS line-comments (// …) and block-comments (/* … */) from `src`,
// preserving line numbers (replace comment content with spaces) so error
// locations stay accurate. Skips comment markers that live inside string
// literals — single, double, and template quoted.
function stripComments(src) {
  const out = [];
  let inStr = false;
  let strCh = '';
  let escape = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLine) {
      if (ch === '\n') { inLine = false; out.push(ch); }
      else out.push(' ');
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; out.push('  '); i++; }
      else out.push(ch === '\n' ? '\n' : ' ');
      continue;
    }
    if (inStr) {
      out.push(ch);
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === strCh) inStr = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLine = true; out.push('  '); i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; out.push('  '); i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; }
    out.push(ch);
  }
  return out.join('');
}

function checkUsageKeys(TRANSLATIONS) {
  console.log('\n[d] every t/tr/Nee2Pi18n.t key in JSX resolves to ru');
  const ru = TRANSLATIONS.ru || {};
  const usageRe = /(?:Nee2Pi18n\.t|\b(?:t|tr))\(\s*['"]([a-zA-Z][\w.]*)['"]\s*\)/g;
  const seen = new Map(); // key → first file:line where it appeared
  for (const file of USAGE_FILES) {
    const full = path.join(REPO_ROOT, file);
    if (!fs.existsSync(full)) continue;
    const src = stripComments(fs.readFileSync(full, 'utf8'));
    const lines = src.split('\n');
    lines.forEach((line, idx) => {
      let m;
      // Reset regex state per-line to avoid stateful side effects
      const re = new RegExp(usageRe.source, 'g');
      while ((m = re.exec(line)) !== null) {
        const key = m[1];
        if (!seen.has(key)) seen.set(key, `${file}:${idx + 1}`);
      }
    });
  }
  const missing = [];
  for (const [key, loc] of seen.entries()) {
    if (!(key in ru)) missing.push(`${key} (used at ${loc})`);
  }
  if (missing.length === 0) pass(`${seen.size} unique keys, all resolved`);
  else {
    fail(`${missing.length} key(s) used in JSX but missing from ru catalog:`);
    missing.slice(0, 15).forEach(m => fail('    ' + m));
    if (missing.length > 15) fail(`    …and ${missing.length - 15} more`);
  }
}

// ── Run ────────────────────────────────────────────────────────────────────

(function main() {
  console.log('smoke-i18n.js — verifying i18n catalog completeness');
  let catalog;
  try {
    catalog = loadCatalog();
  } catch (e) {
    console.error('FATAL: could not load i18n.js:', e.message);
    process.exit(2);
  }
  const { LANGS, LANG_NAMES, TRANSLATIONS } = catalog;
  console.log(`  loaded LANGS=[${LANGS.join(', ')}] LANG_NAMES=${JSON.stringify(LANG_NAMES)}`);

  checkLangsParity(LANGS, TRANSLATIONS);
  checkNoEmptyValues(LANGS, TRANSLATIONS);
  checkLangNamesCoverage(LANGS, LANG_NAMES);
  checkUsageKeys(TRANSLATIONS);

  console.log('');
  if (failures.length === 0) {
    console.log('✅ all checks passed');
    process.exit(0);
  } else {
    console.log(`❌ ${failures.length} failure(s):`);
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
})();
