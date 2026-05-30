#!/usr/bin/env python3
"""Reproducible build for Nee2P Lite — inlines vendor libraries.

Usage (from repo root):
    python3 lite/build/inline.py

Reads:
    lite/build/nee2p-lite.template.html — template with vendor placeholders
    vendor/argon2-bundled.min.js
    vendor/bip39-en.js
    vendor/mlkem.bundle.mjs
    vendor/noble-ed25519.bundle.mjs

Writes:
    lite/nee2p-lite.html — single self-contained artifact

For auditors: re-run this script and `sha256sum lite/nee2p-lite.html` should
match the committed file's hash and the GitHub Release artifact's hash.
Any drift means either the template, the vendor files, or this script
itself was modified — diff against git history to investigate.

The template uses these markers (one per vendor):
    /* __VENDOR_INLINE__ argon2 */
    /* __VENDOR_INLINE__ bip39 */
    /* __VENDOR_INLINE__ mlkem */
    /* __VENDOR_INLINE__ noble */

argon2 and bip39 are classic <script> globals — inlined verbatim.
mlkem and noble are ES modules — their trailing `export {...}` statement
is stripped (the template's `window.__nee2pX = ...` bindings expose the
locals to non-module scripts).

This is a one-step build: there is no minifier, no transpiler, no bundler.
"""

import hashlib
import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / 'lite' / 'build' / 'nee2p-lite.template.html'
OUTPUT = ROOT / 'lite' / 'nee2p-lite.html'
VENDOR = ROOT / 'vendor'

VENDOR_FILES = {
    'argon2': VENDOR / 'argon2-bundled.min.js',
    'bip39':  VENDOR / 'bip39-en.js',
    'mlkem':  VENDOR / 'mlkem.bundle.mjs',
    'noble':  VENDOR / 'noble-ed25519.bundle.mjs',
}

# ES-module bundles: drop the final `export {...}` so they can sit inside
# our <script type="module"> wrapper without leaking unused exports.
ES_MODULES = {'mlkem', 'noble'}

EXPORT_RE = re.compile(r'export\{[^}]*\}\s*;?\s*$', flags=re.MULTILINE)


def load_vendor(name: str, path: pathlib.Path) -> str:
    if not path.exists():
        sys.exit(f'ERROR: vendor file missing: {path}')
    body = path.read_text(encoding='utf-8')
    if name in ES_MODULES:
        body = EXPORT_RE.sub('', body).rstrip()
    return body


def main() -> int:
    if not TEMPLATE.exists():
        sys.exit(f'ERROR: template missing: {TEMPLATE}')

    html = TEMPLATE.read_text(encoding='utf-8')

    for name, path in VENDOR_FILES.items():
        marker = f'/* __VENDOR_INLINE__ {name} */'
        if marker not in html:
            sys.exit(f'ERROR: marker not found in template: {marker}')
        html = html.replace(marker, load_vendor(name, path))

    # Sanity: no marker should survive
    leftover = re.search(r'/\*\s*__VENDOR_INLINE__\s+\S+\s*\*/', html)
    if leftover:
        sys.exit(f'ERROR: leftover marker after inline: {leftover.group(0)}')

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(html, encoding='utf-8')

    digest = hashlib.sha256(html.encode('utf-8')).hexdigest()
    size = OUTPUT.stat().st_size

    print(f'Wrote   {OUTPUT.relative_to(ROOT)}')
    print(f'  Size:   {size:>8} bytes  ({size / 1024:.1f} KB)')
    print(f'  SHA256: {digest}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
