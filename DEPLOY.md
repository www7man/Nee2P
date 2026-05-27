# Deploy Nee2P.

Self-host the relay backend + static files. The relay is a single Node
process; you choose what runs in front of it.

Three paths from easiest to most flexible:

1. [One-click cloud](#one-click-cloud) — Render / Fly.io / Railway
2. [Docker](#docker) — one VM, one compose file
3. [Linux VPS + nginx + systemd](#linux-vps--nginx--systemd) — the
   classic self-host stack
4. [macOS + Caddy + launchd](#macos--caddy--launchd) — if your relay
   lives on a Mac mini at home

The relay only sees `{iv, ct}` blobs — no plaintext ever leaves the
browser, regardless of where it runs.

---

## One-click cloud

| Provider | Free tier? | WebSocket | SSE | Notes |
|---|---|:---:|:---:|---|
| **Render**  | yes, sleeps after 15 min | ✅ | ✅ | Sleeping = bad for a chat → upgrade to Starter ($7/mo) |
| **Fly.io**  | yes, always-on shared CPU | ✅ | ✅ | Best free option for messaging |
| **Railway** | $5/mo trial credit then paid | ✅ | ✅ | Smoothest UX, no free permanent tier |

### Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/www7man/Nee2P)

Uses [render.yaml](render.yaml). After deploy:

- The `ADMIN_KEY` is auto-generated — copy it from the dashboard.
- Add VAPID keys via **Secret Files** if you want Web Push: create
  `/home/node/.nee2p-vapid.json` with `{"publicKey":"...","privateKey":"..."}`.

### Fly.io

```bash
flyctl launch --copy-config --no-deploy   # creates the app, edits fly.toml
flyctl secrets set ADMIN_KEY="$(openssl rand -hex 24)"
flyctl deploy
```

Uses [fly.toml](fly.toml). `shared-cpu-1x / 256 MB` handles hundreds of
concurrent rooms. WebSocket + SSE work without extra config.

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https%3A%2F%2Fgithub.com%2Fwww7man%2FNee2P)

Uses [railway.json](railway.json). Railway auto-detects the Dockerfile,
injects `PORT`, and assigns a public domain. Set `ADMIN_KEY` manually
in **Variables**.

---

## Docker

The fastest path on any Linux VM.

```bash
git clone https://github.com/www7man/Nee2P
cd Nee2P
cp .env.example .env
# edit .env — at minimum, change ADMIN_KEY
docker compose up -d --build
# → http://127.0.0.1:8787
```

Put nginx or Caddy in front for TLS (next sections show how).

To update:

```bash
git pull
docker compose up -d --build
```

The relay is RAM-only, so a redeploy clears all live rooms. There is
nothing to back up.

---

## Linux VPS + nginx + systemd

The classic self-host setup. Works on Ubuntu 22.04 / 24.04, Debian 12,
Rocky / Alma — anything with `systemd` and a recent Node.

### 1. Install Node and clone

```bash
# Node 20 LTS on Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo mkdir -p /opt/nee2p
sudo chown $USER:$USER /opt/nee2p
git clone https://github.com/www7man/Nee2P /opt/nee2p
cd /opt/nee2p
npm ci --omit=dev
```

### 2. systemd unit

Create `/etc/systemd/system/nee2p.service`:

```ini
[Unit]
Description=Nee2P relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/nee2p
ExecStart=/usr/bin/node /opt/nee2p/server.js
Restart=on-failure
RestartSec=3s
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=ADMIN_KEY=change-me-to-a-long-random-string
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nee2p
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /opt/nee2p
sudo systemctl daemon-reload
sudo systemctl enable --now nee2p
sudo journalctl -u nee2p -f      # tail logs
```

### 3. TLS certificate

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d chat.example.com
# Certbot edits the nginx config for HTTPS and sets up auto-renewal.
```

### 4. nginx config

`/etc/nginx/sites-available/nee2p.conf`:

```nginx
# Map the WebSocket upgrade header — required for proxy_set_header below
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name chat.example.com;

    # ssl_certificate / ssl_certificate_key are filled in by certbot.

    # Static files (served directly by nginx)
    root /opt/nee2p;

    # HTML must not be cached at the edge — content rotates on each deploy.
    location ~* \.(html|jsx)$ {
        try_files $uri =404;
        add_header Cache-Control "no-store" always;
    }

    # Vendored libs + static assets — long cache, content-addressed via
    # the ?v= query string that index.html injects automatically.
    location ~* \.(js|css|svg|png|woff2|webmanifest)$ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=86400" always;
    }

    # WebSocket — primary transport
    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;        # keep idle WS alive
        proxy_send_timeout 3600s;
    }

    # HTTP relay endpoints — long-poll + SSE + blob
    location /r/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # CRITICAL: SSE (/r/stream) needs no buffering, no gzip
        proxy_buffering off;
        gzip off;
        proxy_read_timeout 3600s;
    }

    # Catch-all: serve index.html for client-side routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name chat.example.com;
    return 301 https://$host$request_uri;
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/nee2p.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Verify

```bash
# Static files respond 200 with no-store on HTML
curl -I https://chat.example.com/

# WebSocket upgrade succeeds (101)
curl -i -N -H "Host: chat.example.com" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  "https://chat.example.com/ws?room=00000000000000000000000000000000"

# Admin dashboard
curl -H "X-Admin-Key: <YOUR_ADMIN_KEY>" \
  https://chat.example.com/r/admin/stats
```

Two-tab smoke: open the URL twice, create a session on one tab, join
from the other.

### 6. Updates

```bash
cd /opt/nee2p
git pull
npm ci --omit=dev
sudo systemctl restart nee2p
```

The relay is RAM-only, so live rooms drop on restart. Plan deploys for
quiet hours or hint users via Web Push first.

---

## macOS + Caddy + launchd

If your relay lives on a Mac mini at home, use the included launchd
plist and Caddy.

### 1. Clone & install

```bash
git clone https://github.com/www7man/Nee2P ~/Sites/nee2p
cd ~/Sites/nee2p
npm install --omit=dev
```

### 2. launchd

```bash
# Edit com.nee2p.relay.plist — set WorkingDirectory and PORT to your paths
cp com.nee2p.relay.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.nee2p.relay.plist
```

Logs: `~/Library/Logs/nee2p-relay.out.log` / `nee2p-relay.err.log`

### 3. Caddy

Add inside your domain block in `Caddyfile`:

```caddyfile
chat.example.com {
    # WebSocket — must come BEFORE the file_server
    @ws path /ws
    reverse_proxy @ws 127.0.0.1:8787

    # HTTP relay endpoints (long-poll, SSE, blob)
    @relay path /r/*
    reverse_proxy @relay 127.0.0.1:8787 {
        flush_interval -1                 # don't buffer SSE
    }

    # Static files
    root * /Users/you/Sites/nee2p
    @html path *.html *.jsx
    header @html Cache-Control "no-store"
    @assets path *.js *.css *.svg *.png *.woff2
    header @assets Cache-Control "public, max-age=86400"
    try_files {path} {path}/ /index.html
    file_server
}
```

```bash
caddy reload --config /path/to/Caddyfile
```

> **Order matters:** the `@ws` and `@relay` matchers must appear before
> the `file_server` directive, otherwise the static handler swallows the
> upgrade.

---

## CDN notes (optional)

If you front the relay with a CDN (Cloudflare, Fastly, …):

- Ensure WebSocket upgrades are forwarded, or bypass `/ws` from the CDN.
- HTML (`no-store`) must never cache at the edge.
- Disable buffering / compression on `/r/stream` — it's an SSE stream.
- Purge `/*.jsx` and `/index.html` after every deploy.

---

## Rollback

### Docker

```bash
git checkout <previous-tag>
docker compose up -d --build
```

### systemd + nginx

```bash
cd /opt/nee2p
git checkout <previous-tag>
sudo systemctl restart nee2p
```

### macOS / launchd

```bash
launchctl unload -w ~/Library/LaunchAgents/com.nee2p.relay.plist
# revert your Caddyfile changes, then:
caddy reload --config /path/to/Caddyfile
```

The relay has no database — there is nothing to migrate, restore, or
clean up between versions.

---

## Ports & paths reference

| What            | Default                          |
|-----------------|----------------------------------|
| Relay listen    | `127.0.0.1:8787` (`HOST` / `PORT`)|
| Admin endpoint  | `GET /r/admin/stats` (`X-Admin-Key`) |
| VAPID keys      | `~/.nee2p-vapid.json` (optional) |
| launchd plist   | `~/Library/LaunchAgents/com.nee2p.relay.plist` |
| systemd unit    | `/etc/systemd/system/nee2p.service` |

See [.env.example](.env.example) for the full env-var reference.
