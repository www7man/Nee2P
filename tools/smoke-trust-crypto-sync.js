#!/usr/bin/env node
// tools/smoke-trust-crypto-sync.js
//
// Keeps `trust.html` section 02 (crypto-stack table) honest: parses both
// the table and the actual values in `crypto.js` and fails if they
// diverge. trust.html is the public "trust me, here's what we use" page;
// if it lies, that's worse than a bug in code — so this test guards the
// contract between the two files.
//
// Checks:
//   • Argon2id:    time, mem (KiB ↔ MiB), parallelism
//   • PBKDF2:      iterations
//   • Salts:       hush.v3.argon2id: / hush.v3.pbkdf2: (these are
//                  persistent compatibility identifiers — must NOT be
//                  renamed; the brand is "Nee2P.", the salt is not)
//   • HKDF info:   hush.v3.session / hush.v3.session.pq
//   • ML-KEM:      version 768 (not 1024)
//   • AES-GCM IV:  12 bytes
//   • Fingerprint: 12 BIP-39 words
//
// Exit 0 = in sync. Exit 1 = mismatch. Run via:
//   node tools/smoke-trust-crypto-sync.js
//
// Owner: trust-page agent. CI integration TODO (open-source): add to
// .github/workflows/ci.yml alongside smoke-wire-format.js.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '..');
const trust = fs.readFileSync(path.join(ROOT, 'trust.html'), 'utf8');
const crypt = fs.readFileSync(path.join(ROOT, 'crypto.js'),  'utf8');

const fails = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) {
    passes.push(name);
  } else {
    fails.push(`✗ ${name}` + (detail ? `  →  ${detail}` : ''));
  }
}

// ── Argon2id parameters ─────────────────────────────────────────────────────
const cTime = (crypt.match(/\btime:\s*(\d+)/)         || [])[1];
const cMem  = (crypt.match(/\bmem:\s*(\d+)/)          || [])[1];
const cPar  = (crypt.match(/\bparallelism:\s*(\d+)/)  || [])[1];

check('crypto.js defines argon2 time',        !!cTime, 'no `time: N` line found');
check('crypto.js defines argon2 mem',         !!cMem,  'no `mem: N` line found');
check('crypto.js defines argon2 parallelism', !!cPar,  'no `parallelism: N` line found');

if (cTime && cMem && cPar) {
  const cMemMib = (+cMem) / 1024;

  // trust.html params cell for Argon2id row. The first <td> is the algo
  // (wrapped in <a>...Argon2id</a>), the second is the params text. After
  // the EN/RU split the cell holds two <span lang="..."> children with
  // the same numbers (mem suffix differs: МиБ vs MiB) — match either.
  const argonRow = trust.match(
    /Argon2id<\/a><\/td>\s*<td>([\s\S]*?)<\/td>/
  );
  if (!argonRow) {
    check('trust.html has Argon2id params cell', false, 'row not found in section 02 table');
  } else {
    const p   = argonRow[1];
    const tT  = (p.match(/t=(\d+)/)                       || [])[1];
    const tM  = (p.match(/mem=(\d+)\s*(?:МиБ|MiB)/)       || [])[1];
    const tP  = (p.match(/p=(\d+)/)                       || [])[1];

    check('argon2 time matches',
      +tT === +cTime,
      `trust=${tT}, crypto=${cTime}`);
    check('argon2 memory matches (MiB ↔ KiB)',
      +tM === cMemMib,
      `trust=${tM} MiB, crypto=${cMem} KiB (=${cMemMib} MiB)`);
    check('argon2 parallelism matches',
      +tP === +cPar,
      `trust=${tP}, crypto=${cPar}`);
  }
}

// ── PBKDF2 iterations ───────────────────────────────────────────────────────
const cIter = (crypt.match(/\biterations:\s*(\d+)/) || [])[1];
check('crypto.js defines pbkdf2 iterations', !!cIter, 'no `iterations: N` line found');

if (cIter) {
  // trust.html: "600 000 итераций" — strip any whitespace (regular, NBSP,
  // thin-space) to get the integer.
  const iterStr = (trust.match(/>([0-9   ]+)\s*итераций/) || [])[1];
  const tIter   = iterStr ? +iterStr.replace(/[\s  ]/g, '') : null;

  check('pbkdf2 iterations cell present in trust.html', !!iterStr, 'no "N итераций" string');
  check('pbkdf2 iterations matches',
    tIter === +cIter,
    `trust=${tIter}, crypto=${cIter}`);
}

// ── Persistent identifiers (NEVER rebrand) ──────────────────────────────────
check('crypto.js argon2 salt prefix `hush.v3.argon2id:`',
  /['"]hush\.v3\.argon2id:/.test(crypt),
  'someone may have rebranded the salt — this breaks every existing session');
check('crypto.js pbkdf2 salt prefix `hush.v3.pbkdf2:`',
  /['"]hush\.v3\.pbkdf2:/.test(crypt),
  'same warning — salt is a persistent compat identifier');

check('trust.html documents argon2 salt as `hush.v3.argon2id:<roomId>`',
  /hush\.v3\.argon2id:&lt;roomId&gt;|hush\.v3\.argon2id:<roomId>/.test(trust),
  'trust.html lies about salt name (or was rebranded)');

// ── HKDF info strings ───────────────────────────────────────────────────────
check('crypto.js HKDF info `hush.v3.session`',
  /['"]hush\.v3\.session['"]/.test(crypt),
  'missing pre-quantum HKDF label');
check('crypto.js HKDF info `hush.v3.session.pq`',
  /['"]hush\.v3\.session\.pq['"]/.test(crypt),
  'missing post-quantum HKDF label');

// ── ML-KEM version ──────────────────────────────────────────────────────────
const tKemMatch = trust.match(/ML-KEM-(\d+)/);
check('trust.html mentions ML-KEM-N', !!tKemMatch, 'no ML-KEM version in trust.html');

const cHas768  = /MlKem768|ML-KEM-768/.test(crypt);
const cHas1024 = /MlKem1024|ML-KEM-1024/.test(crypt);
check('crypto.js uses MlKem768 (and not 1024)',
  cHas768 && !cHas1024,
  `crypto.js: hasMlKem768=${cHas768}, hasMlKem1024=${cHas1024}`);

if (tKemMatch) {
  check('ml-kem version in trust.html matches crypto.js (768)',
    tKemMatch[1] === '768' && cHas768,
    `trust=ML-KEM-${tKemMatch[1]}, crypto=${cHas768 ? '768' : '?'}`);
}

// ── AES-GCM IV size ─────────────────────────────────────────────────────────
// trust.html: "IV 12B" (IV may be wrapped in <a>...IV</a>).
const tIv = trust.match(/>IV(?:<\/a>)?\s+(\d+)B\b/);
check('trust.html documents AES-GCM IV size', !!tIv, 'no "IV NB" string in section 02');

if (tIv) {
  // We don't try to extract IV size from crypto.js (it's used as a literal
  // in several places). 12 bytes is the spec — flag anything else as
  // suspicious.
  check('AES-GCM IV documented as 12 bytes',
    tIv[1] === '12',
    `trust says IV ${tIv[1]}B; spec says 12. If crypto.js really changed, this test needs updating.`);
}

// ── BIP-39 fingerprint ──────────────────────────────────────────────────────
// (No `\b` after `слов` — JS RegExp \b only recognises ASCII word chars,
// so it would always fail after a Cyrillic letter.)
check('trust.html mentions "12 слов" BIP-39 fingerprint',
  /12\s+слов/.test(trust),
  'fingerprint table changed format?');

// ── Report ──────────────────────────────────────────────────────────────────
if (fails.length === 0) {
  console.log(`✓ trust.html ↔ crypto.js: in sync (${passes.length} checks passed)`);
  process.exit(0);
} else {
  console.error(`✗ trust.html ↔ crypto.js: ${fails.length} mismatch(es), ${passes.length} passed:\n`);
  for (const f of fails) console.error('  ' + f);
  console.error(
    '\n→ Update trust.html section 02 (crypto-stack table) to match crypto.js,\n' +
    '  or revert the change to crypto.js if it was unintended.\n' +
    '  trust.html is a public claim — if it lies, that hurts user trust\n' +
    '  more than a bug in code.\n'
  );
  process.exit(1);
}
