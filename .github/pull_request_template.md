<!-- Thanks for the PR. Please fill in what's relevant — delete the rest. -->

## What & why

<!-- One paragraph: what does this change and why. -->

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Docs / DX
- [ ] Crypto / wire-format change (requires threat-model note below)

## Checklist

- [ ] `node tools/smoke-wire-format.js` passes locally
- [ ] `CACHE_VERSION` in `sw.js` bumped if any JS/JSX changed
- [ ] No new runtime dependencies
- [ ] No new external network calls from the browser bundle

## Crypto / wire-format note

<!-- Required for changes touching crypto.js, key exchange, or the relay envelope.
     - What attacker capability changes?
     - How do older clients behave against a new relay (and vice versa)?
     - What's the test that catches a regression?
     Delete this section if not applicable. -->
