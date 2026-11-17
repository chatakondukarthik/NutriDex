# Deploying NutriPlan

NutriPlan runs as a single Node process with a SQLite file. There is no
database server, no queue and no external cache. That makes it easy to host,
and it also fixes the shape of a correct deployment: **one instance, one
writable volume, one TLS-terminating reverse proxy**.

This guide covers both worlds:

- **Local** — `npm run dev` on your machine, reachable only from your machine.
- **Deployed** — the same app behind a reverse proxy on a public hostname.

The security model is the same in both, only the gate mode differs.

---

## 1. Security posture (read this first)

The app has **no authentication by design**. It is a personal tool with one
implicit user: every server action can read and write every recipe, food and
plan. Adding accounts is a product decision, not a configuration flag, and is
not implemented.

The request gate in `src/proxy.ts` is a **safety net, not a login system**:

| Mode | Who gets in | Use for |
|---|---|---|
| `local` (default) | requests whose `Host` is loopback | local development |
| `hosts` | only hosts in `NUTRIPLAN_ALLOWED_HOSTS`; loopback is not implicitly trusted | a reverse proxy that preserves the public `Host` |
| `token` | only a matching `nutriplan_token` header or cookie (never a query string) | a private share link, or a proxy that cannot preserve `Host` |
| `off` | everyone | only when the network or proxy is the boundary |

Things the gate does **not** do:

- It does not verify identity. A caller who forges `Host: localhost` passes
  `local` mode. `Host` is a header the client controls.
- It does not replace TLS, proxy auth, a VPN or a firewall.
- `NUTRIPLAN_TRUST_PROXY=1` makes it believe `X-Forwarded-Host`. Only set that
  when a proxy you control **overwrites** the header. Left unset, forwarded
  headers are ignored precisely so a caller cannot claim to be loopback.

Three failure modes the earlier version had are now closed:

- Loopback is trusted **only** in `local` mode. In `hosts` and `token` mode a
  loopback `Host` is a claim, not a fact, so a proxy that rewrites `Host` to
  its `127.0.0.1:3000` upstream cannot turn the gate into a no-op.
- `0.0.0.0` is no longer treated as loopback. It is a bind address, never a
  destination a browser or proxy addresses.
- The token is accepted only from a header or cookie. The query-string form
  leaked into browser history, referrers and access logs.

**A public deployment should therefore have at least one real boundary in
front of it**: TLS plus proxy-level auth (basic auth, OIDC, mTLS), a VPN, or
`NUTRIPLAN_GATE=token` with a long random secret. The gate then keeps the
app from being accidentally reachable outside that boundary.

Other properties worth knowing before you expose it:

- The SQLite file and `secrets.json` live on the data volume. Prefer provider
  keys from environment variables so the volume holds no secret.
- Rate limits (USDA, Open Food Facts, AI calls) are **in-process**. They do
  not coordinate across replicas, and they reset on restart.
- SQLite has one writer. Run exactly one instance against a volume.
- Prompt output from a model is treated as untrusted data. It cannot set a
  known nutrient, choose a food id, or inject instructions into later calls
  (`docs/spec/BYO_LLM.md` §9, §11).

---

## 2. Requirements

- **Node.js 24 or newer.** The app uses the built-in `node:sqlite` module,
  which needs Node 23.4+ and is provided by the `node:24-bookworm-slim`
  image used in the Dockerfile. The local dev machine runs newer, which is
  fine.
- A writable directory for state (`NUTRIPLAN_DATA_DIR`).
- A reverse proxy for anything beyond localhost.

---

## 3. Local development

```bash
npm install
npm run dev            # http://localhost:3000
```

With no configuration the gate is `local`: the app answers on loopback and
refuses a request addressed to a LAN address. To preview from another device
on your network during development:

```bash
# .env.local
NUTRIPLAN_GATE=hosts
NUTRIPLAN_ALLOWED_HOSTS=192.168.1.16,my-laptop.local
```

Restart `next dev` after changing environment variables. A `Host` header
spoof still passes; this is a convenience gate, not a boundary.

To use a production build locally:

```bash
npm run build
npm start              # next start, same gate, production CSP
```

---

## 4. Configuration reference

Next reads `.env`, `.env.local` and the process environment. `.env.example`
documents every variable. The split that matters:

### Runtime (change without rebuilding)

| Variable | Purpose |
|---|---|
| `NUTRIPLAN_GATE` | `local` \| `hosts` \| `token` \| `off`; inferred if unset |
| `NUTRIPLAN_ALLOWED_HOSTS` | comma list for `hosts` mode |
| `NUTRIPLAN_TOKEN` | shared secret for `token` mode |
| `NUTRIPLAN_TRUST_PROXY` | `1` to believe `X-Forwarded-Host` |
| `NUTRIPLAN_DATA_DIR` | directory for database, keys, AI config |
| `NUTRIPLAN_DB_PATH` | exact database file; wins over the data dir |
| `NUTRIPLAN_AI_<PROVIDER>_KEY` | `GEMINI`, `OPENAI`, `ANTHROPIC`, `OPENAI_COMPATIBLE` |
| `NUTRIPLAN_ALLOW_PRIVATE_AI_URLS` | `1` to allow a private/loopback AI endpoint |
| `NUTRIPLAN_USDA_KEY` | FoodData Central key (otherwise the rate-limited `DEMO_KEY`) |
| `PORT`, `HOSTNAME` | bind address for the standalone server |

### Build time (baked into the build)

| Variable | Purpose |
|---|---|
| `NUTRIPLAN_ALLOWED_ORIGINS` | extra origins allowed to invoke server actions |
| `NUTRIPLAN_ALLOWED_DEV_ORIGINS` | dev-only origins; ignored in production |

Next serialises `next.config.ts` into the build output, so `ALLOWED_ORIGINS`
must be set before `npm run build` / `docker build`. If your proxy preserves
the public `Host`, you do not need it at all.

### Choosing the gate

- Proxy preserves `Host` (nginx `proxy_set_header Host $host;`, Caddy
  `reverse_proxy`): use `NUTRIPLAN_GATE=hosts` with the public hostname.
  No forwarded-header trust is needed.
- Proxy rewrites `Host` to its upstream (`127.0.0.1:3000`): **the gate sees
  loopback and allows every request**, because `Host` is what it trusts.
  Make the proxy overwrite `X-Forwarded-Host` with the public hostname and
  set `NUTRIPLAN_TRUST_PROXY=1`, so the gate evaluates the real host. Next's
  action origin check also compares the browser's `Origin` with the rewritten
  host, so add the public hostname to `NUTRIPLAN_ALLOWED_ORIGINS` and
  rebuild.
- Platform gives you only `X-Forwarded-Host`: set
  `NUTRIPLAN_TRUST_PROXY=1` **and** make sure the platform overwrites the
  header. Then use `hosts` or `token` mode.

---

## 5. Docker

```bash
cp .env.example .env      # set the gate mode and keys
docker compose up -d --build
curl -s http://127.0.0.1:3000/api/health   # {"ok":true}
```

The compose file publishes the port on `127.0.0.1` only, drops all Linux
capabilities, sets `no-new-privileges`, and mounts a named volume at `/data`.
That is deliberately not internet-facing.

The image is a three-stage build: dependencies, `next build`, then a runtime
layer containing only `.next/standalone`, `.next/static` and the traced
dependencies. It runs as uid 1001, not root. The build context excludes
`data/`, `.env*` and `.git`, so local keys cannot be baked into a layer.

### Bind mount instead of a named volume

```yaml
volumes:
  - /srv/nutriplan/data:/data
```

The host directory must be writable by uid/gid **1001**:

```bash
sudo install -d -o 1001 -g 1001 -m 0700 /srv/nutriplan/data
```

`0700` keeps the database and any saved key readable only by the app user.

### Without Docker

```bash
npm ci
npm run build
NODE_ENV=production NUTRIPLAN_DATA_DIR=/var/lib/nutriplan node .next/standalone/server.js
```

With `output: "standalone"`, copy `.next/static` into `.next/standalone/.next/static`
(or serve it from the proxy) — the Dockerfile does this for you. If you use
`next start` instead, the data directory default (`./data`) is fine.

---

## 6. Reverse proxy

Terminate TLS at the proxy, forward to the app on loopback, and **preserve
the public `Host` header**. Keep the proxy's body limit at least as large as
the app's 16 MB server-action limit, or image uploads fail with 413 before
they reach the app.

### nginx

```nginx
server {
    listen 80;
    server_name nutriplan.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name nutriplan.example.com;

    ssl_certificate     /etc/letsencrypt/live/nutriplan.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nutriplan.example.com/privkey.pem;

    # Must be >= the app's serverActions.bodySizeLimit (16mb).
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # The public hostname, without a port. This is what the gate and
        # Next's action origin check read.
        proxy_set_header Host $host;

        # Optional. Only meaningful with NUTRIPLAN_TRUST_PROXY=1, and only
        # if nginx overwrites whatever the client sent. Leave both lines
        # out if `Host` above is enough.
        # proxy_set_header X-Forwarded-Host $host;
        # proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
```

Do not add `proxy_set_header Host $proxy_host;` or a hard-coded upstream
host: it makes the app believe it is being addressed as `127.0.0.1`, which
breaks the action origin check.

### Caddy

```caddyfile
nutriplan.example.com {
    encode zstd gzip

    # Matches the app's 16 MB action limit.
    request_body {
        max_size 16MB
    }

    reverse_proxy 127.0.0.1:3000 {
        # Caddy already preserves Host; this makes it explicit.
        header_up Host {host}
    }
}
```

Caddy obtains and renews certificates automatically. Add
`basic_auth { ... }` or `forward_auth` here if this is the real boundary.

### Headers the app sets itself

`next.config.ts` and `src/proxy.ts` emit `Content-Security-Policy` (nonce
based in production), `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
`Permissions-Policy`, and in production `Strict-Transport-Security`. Do not
strip them at the proxy. HSTS is only honoured over HTTPS, so it is harmless
when you test over plain HTTP on loopback.

`includeSubDomains` is intentionally omitted: enabling it would pin every
sibling subdomain, which is not this app's decision to make.

---

## 7. Verifying a deployment

```bash
# The probe is exempt from the gate and returns no data beyond `ok`.
curl -sS https://nutriplan.example.com/api/health
# -> {"ok":true}

# Production CSP should carry a nonce and no 'unsafe-inline' in script-src.
curl -sSI https://nutriplan.example.com/ | grep -i 'content-security-policy'

# Security headers survive the proxy.
curl -sSI https://nutriplan.example.com/ | grep -iE 'x-content-type|x-frame|referrer|cross-origin|permissions|strict-transport'

# A remote caller without the token should be refused in token mode.
curl -sS -o /dev/null -w '%{http_code}\n' https://nutriplan.example.com/
# -> 403 until a valid nutriplan_token is supplied
```

From the server log, one line states the mode:

```
[gate] mode=hosts trustProxy=off
```

It never prints the token or the allowlist contents.

---

## 8. Backups and restore

The database is a single SQLite file in `WAL` mode. Copying it while the app
is running can miss the `-wal` file, so use one of these:

**Online, consistent snapshot** (no downtime):

```bash
docker compose exec nutriplan node -e \
  "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/nutriplan.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
docker compose cp nutriplan:/data/backup.sqlite ./nutriplan-backup.sqlite
docker compose exec nutriplan rm /data/backup.sqlite
```

**Offline copy** (simple, brief downtime):

```bash
docker compose stop
docker run --rm -v nutriplan-data:/data -v "$PWD":/backup \
  node:24-bookworm-slim cp /data/nutriplan.sqlite /backup/nutriplan-backup.sqlite
docker compose start
```

Back up `secrets.json` and `ai-config.json` too **only if** you saved keys
through the UI. Prefer environment keys, which are not on the volume.

Restore: stop the app, replace `nutriplan.sqlite`, delete any stale
`nutriplan.sqlite-wal` / `-shm`, then start. Take a backup before upgrading.

---

## 9. Upgrades

```bash
docker compose build --pull
docker compose up -d
```

Schema creation is idempotent and runs at startup, so there is no separate
migration step. Back up first anyway; this is a single-file database and the
backup is cheap.

Because `NUTRIPLAN_ALLOWED_ORIGINS` is baked into the build, re-check it when
the public hostname changes.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every page is 403 after deploy | gate is `local` (or the host is not listed) | set `NUTRIPLAN_GATE=hosts` + `NUTRIPLAN_ALLOWED_HOSTS`, or `token` |
| Pages load but saving fails with an origin error | proxy rewrote `Host`, so `Origin` ≠ host | preserve `Host`, or add the public host to `NUTRIPLAN_ALLOWED_ORIGINS` and rebuild |
| `token` mode lets everyone in | proxy rewrites `Host` to a loopback upstream | preserve `Host`, or overwrite `X-Forwarded-Host` and set `NUTRIPLAN_TRUST_PROXY=1` |
| 413 on image upload | proxy body limit below 16 MB | raise `client_max_body_size` / `max_size` |
| CSP console errors in production only | a dependency injected an inline script | report it; do not add `'unsafe-inline'` to `script-src` as a shortcut |
| `/api/health` is 503 | the process cannot open the database | check volume ownership (uid 1001) and `NUTRIPLAN_DATA_DIR` |
| Data disappears after a rebuild | state was written inside the build output | set `NUTRIPLAN_DATA_DIR` to the mounted volume |
| USDA search returns 429 | `DEMO_KEY` per-IP limit | set `NUTRIPLAN_USDA_KEY` |

---

## 11. Known limitations

- **No authentication.** The gate is not a substitute. Put a real boundary in
  front of a public deployment.
- **`Host` is spoofable.** `local` and `hosts` trust a client-controlled
  header. `token` mode is the only mode with a secret.
- **Single instance.** SQLite writes and the in-memory rate limits assume one
  process per data directory.
- **In-process rate limits** reset on restart and do not span replicas.
- **`style-src 'unsafe-inline'`** stays in production because React Flow sets
  node positions through style attributes, which a nonce cannot cover.
  Scripts use a per-request nonce.
- **Secrets on the volume** if keys are entered in Settings rather than set in
  the environment. The file is `0600`, but it is part of a backup.
- **No malware scanning** of uploaded label images. They are parsed as images
  in the browser and sent to the configured model; they are not executed.
