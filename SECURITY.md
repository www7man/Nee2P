# Security Policy

Nee2P is a cryptographic messenger — security bugs are taken seriously.

## Reporting a vulnerability

**Do not file public GitHub issues for security vulnerabilities.**

Report privately via one of:

- **GitHub Security Advisories** (preferred): https://github.com/www7man/Nee2P/security/advisories/new
- **Email:** security@nee2p.com

Please include:

- Affected version or commit hash (`git rev-parse HEAD`)
- Reproduction steps or a proof-of-concept
- Impact assessment (what an attacker can learn or do)
- Your name/handle for credit, or note if you prefer anonymity

We aim to acknowledge reports within **72 hours** and ship fixes for
critical issues within **14 days**.

## Scope

In scope:

- Cryptographic flaws — key exchange, KDF parameters, AEAD usage,
  wire-format authentication
- Server-side leaks — logs, error messages, or memory dumps exposing
  plaintext, keys, or phrase material
- Authentication / session-claim races, slot hijacking
- Web client — XSS, prototype pollution, Service Worker cache poisoning
- PWA escalation paths, unsafe `postMessage` handlers

Out of scope:

- DoS via raw volume (RAM-only relay has documented per-room caps)
- Self-XSS requiring user to paste code into DevTools
- Issues in third-party services (Tor, VPN, the user's browser)
- Vulnerabilities in `node_modules` already covered by `npm audit`
  (please open an issue, not an advisory, for those)

## Disclosure policy

We follow coordinated disclosure. A fix lands first, then a public
advisory is published within **7 days** of the patched release.
Reporters are credited unless they request otherwise.

## Supported versions

| Version | Supported |
|---------|-----------|
| `main`  | ✅ Yes    |
| Tagged releases | ✅ For 90 days after the next minor release |

## Threat model — quick reference

- Server is **untrusted**: assume it is fully compromised. Past messages
  remain unreadable (no key material is stored); impersonation is
  detected by the [Safety Fingerprint](trust.html).
- Network observer (passive ISP / VPN provider) sees TLS metadata
  (room ID, traffic timing, IP). Use Tor or a VPN for network anonymity.
- Compromised endpoint (browser / OS) breaks all guarantees — no
  application-layer crypto can rescue a malicious runtime.
- Shared secret is the **phrase** — the entire model rests on choosing
  it well and sharing it out-of-band.

See [README.md](README.md#security-model) and [trust.html](trust.html)
for a longer treatment.
