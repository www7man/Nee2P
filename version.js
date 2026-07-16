// version.js — single source of truth for the displayed app version.
//
// Owner: `open-source` agent. Bumped in lock-step with `package.json` and
// `git tag vX.Y.Z` in every release commit. Don't edit this file directly
// from feature-agent sessions — let the release commit do it.
//
// Consumed by: nee2p-screens.jsx WelcomeScreen (Open Source badge) and
// any other surface that wants to show the current build version.
window.NEE2P_VERSION = '0.9.20';
