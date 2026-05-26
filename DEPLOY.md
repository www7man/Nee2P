# Deploy Nee2P.

Self-host the relay backend + static files behind a reverse proxy.  
The example below uses **Caddy** on macOS, but any reverse proxy works.

## Architecture

```
Browser → CDN (optional) → Caddy → static files (nee2p-*.jsx, vendor/, …)
                                  → relay backend (server.js) on localhost:PORT
```

The relay only sees `{iv, ct}` blobs — no plaintext ever leaves the browser.

---

## 1. Clone & install

```bash
git clone https://github.com/<your-org>/nee2p
cd nee2p
npm install
```

---

## 2. Start the relay backend

```bash
PORT=9787 HOST=127.0.0.1 node server.js
# → Nee2P. running at http://127.0.0.1:9787
```

For permanent operation on macOS, use the included launchd plist:

```bash
# edit com.nee2p.relay.plist — set WorkingDirectory and PORT to your paths
cp com.nee2p.relay.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.nee2p.relay.plist
```

Logs: `~/Library/Logs/nee2p-relay.out.log` / `nee2p-relay.err.log`

---

## 3. Caddy reverse proxy

Add inside your domain block in `Caddyfile`.  
Replace `<YOUR_DOMAIN>`, `<STATIC_PATH>`, and `<PORT>` with your values.

```caddyfile
# Nee2P. relay — WebSocket upgrade (must come BEFORE the static handler)
handle_path /2Pee/ws {
    reverse_proxy 127.0.0.1:<PORT> {
        transport http { dial_timeout 2s }
    }
}

# Nee2P. static files + HTTP relay fallback
handle_path /2Pee/* {
    root * <STATIC_PATH>
    @html path / *.html *.jsx
    header @html Cache-Control "no-store"
    @assets path *.js *.css *.svg *.png *.woff2
    header @assets Cache-Control "public, max-age=300"
    try_files {path} {path}/ /index.html
    file_server
}
```

```bash
caddy reload --config /path/to/Caddyfile
```

> **Order matters:** `/2Pee/ws` must appear before `/2Pee/*`, otherwise the  
> file server swallows the WebSocket Upgrade.

---

## 4. Verify

```bash
# Static files respond 200 with no-store
curl -I https://<YOUR_DOMAIN>/2Pee/

# WebSocket upgrade responds 101
curl -i -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  "https://<YOUR_DOMAIN>/2Pee/ws?room=00000000000000000000000000000000"
```

Two-tab smoke test: open your URL twice, create a session on one tab,  
join with the same phrase on the other.

---

## 5. CDN notes (optional)

If fronting with a CDN:
- Ensure it forwards `Upgrade: websocket` headers (or bypass the `/2Pee/ws` path).
- HTML (`no-store`) should never be cached at the CDN edge.
- After deploys, purge `/2Pee/*` from the CDN cache.

---

## Ports & paths reference

| What | Value |
|------|-------|
| Relay listen | `127.0.0.1:<PORT>` (default `9787`) |
| Static root | `<STATIC_PATH>` |
| launchd plist | `~/Library/LaunchAgents/com.nee2p.relay.plist` |
| Logs | `~/Library/Logs/nee2p-relay.{out,err}.log` |

---

## Rollback

```bash
launchctl unload -w ~/Library/LaunchAgents/com.nee2p.relay.plist
# remove the two handle_path blocks from Caddyfile, then:
caddy reload --config /path/to/Caddyfile
```

The room map is in-memory only — no database to clean up.
