# Security runbook — local-first

Operational steps for the single-user, local deployment. Nothing here assumes
a hosted service, a central database or an ops team.

## 1. Start and stop

```bash
npm install
npm run dev            # next dev -H 127.0.0.1 → http://localhost:3000
```

`npm run dev` binds loopback explicitly. `next start` (and a container)
honour `HOSTNAME`/`PORT`, so the gate remains the second control: the default
mode is `local`, and only loopback `Host` headers pass. If the app is
unreachable from the browser, check the gate mode in the startup log:

```
[gate] mode=local trustProxy=off
```

Do not set `NUTRIPLAN_GATE=off` on a machine with an untrusted LAN.

## 2. Where the data lives

| Path | Contents | Mode |
|---|---|---|
| `data/nutriplan.sqlite` | foods, recipes, plans, diary, settings | `0600` |
| `data/nutriplan.sqlite-wal` / `-shm` | SQLite sidecars | `0600` |
| `data/secrets.json` | provider keys, keyed by `provider@host` | `0600` |
| `data/ai-config.json` | provider, model, endpoints, daily cap | `0600` |
| `data/` | the directory itself | `0700` |

`NUTRIPLAN_DATA_DIR` moves all of it. `NUTRIPLAN_DB_PATH` overrides only the
database file. Keep the data directory on a local filesystem: WAL on a network
or cloud-synced volume can corrupt the database (`RESIDUAL-RISKS.md` R8).

Check the modes:

```bash
stat -f '%Lp %N' data data/*
```

Expected: `700` for the directory, `600` for each file. If a file is `644`,
the next boot tightens it; you can also run `chmod 600 data/*`.

## 3. Gate modes

| Situation | Setting |
|---|---|
| Local development (default) | nothing |
| Preview from another device on the LAN | `NUTRIPLAN_GATE=hosts` + `NUTRIPLAN_ALLOWED_HOSTS=192.168.1.16` |
| Behind a proxy that preserves `Host` | `NUTRIPLAN_GATE=hosts` + the public hostname |
| Behind a proxy that rewrites `Host` | `NUTRIPLAN_GATE=token` + `NUTRIPLAN_TOKEN` (header or cookie) |
| Something else is the boundary | `NUTRIPLAN_GATE=off` (only then) |

Notes:

- In `hosts` mode, loopback is **not** implicitly allowed. Add `localhost` to
  the allowlist if you want it.
- In `token` mode, loopback still needs the token.
- The query-string token is rejected. Send `nutriplan_token` as a header or
  set the cookie.
- `NUTRIPLAN_TRUST_PROXY=1` only if a proxy you control overwrites
  `X-Forwarded-Host`. Otherwise forwarded headers are stripped.

## 4. AI keys

### Add or rotate a key

1. Open **Settings → AI**.
2. Enter the key for the provider and save.
3. If the provider uses a custom `baseUrl`, the key is bound to that host.

### "No key is bound to this host"

The key was entered for a different endpoint. This is the exfiltration guard,
not a bug. Re-enter the key for the new host in Settings.

### Rotate after a suspected leak

1. Revoke the key in the provider console.
2. Save the new key in Settings.
3. If the key came from an env var, update the env var and restart.
4. Check `data/secrets.json` for the old value; it should be gone.
5. Review recent usage in the provider console.

### Prefer env keys for a shared machine

```bash
NUTRIPLAN_AI_GEMINI_KEY=...
NUTRIPLAN_AI_OPENAI_KEY=...
NUTRIPLAN_AI_ANTHROPIC_KEY=...
NUTRIPLAN_AI_OPENAI_COMPATIBLE_KEY=...

# Only if that key is for a custom host. Comma-separated; exact host:port.
NUTRIPLAN_AI_OPENAI_HOST=api.example.com
```

An env key is used for the provider's fixed endpoint without a host pin. It
is released to a custom `baseUrl` **only** when its host is listed in
`NUTRIPLAN_AI_<PROVIDER>_HOST`; an unpinned env key fails closed for a custom
endpoint. Setting both an env key and a file key for the same provider is an
error.

Keys saved from Settings are stored per `provider@host`, so the primary,
fallback and image roles can each hold a different key without overwriting
one another. Older flat and single-host `secrets.json` shapes are read on
upgrade and rewritten on the next save.

## 5. Back up and restore

The database is a single file, but a live copy must include the WAL. The
simplest safe backup is a SQLite snapshot:

```bash
# with the app stopped
cp -p data/nutriplan.sqlite "backup-$(date +%F).sqlite"

# or with the app running
sqlite3 data/nutriplan.sqlite ".backup 'backup-$(date +%F).sqlite'"
```

Include `data/ai-config.json` if you want the AI settings. Include
`data/secrets.json` only if you accept storing keys in the backup; otherwise
re-enter them after a restore.

Restore:

1. Stop the app.
2. Replace `data/nutriplan.sqlite` with the backup.
3. Remove stale `-wal` and `-shm` files.
4. Start the app and confirm the row counts in the UI.

A full export/import feature is tracked as `SEC-EXP-01`.

If a restore or an interrupted upgrade leaves an `entries_v1` table beside
`entries`, the next boot finishes it: the live `entries` table wins when the
copy already ran, and stranded rows are merged when it did not. The one state
that still stops the app is `entries_v1` without the new `entries` shape; back
up and inspect the database before starting.

## 6. Locked out

| Symptom | Cause | Fix |
|---|---|---|
| 403 "bound to this machine" | gate mode or `Host` mismatch | Use `localhost`, or add the host to the allowlist |
| 403 on a form submit | cross-site mutation check | Use the app's own origin; do not post from another page |
| App unreachable after setting a proxy | `Host` rewritten to loopback | Preserve `Host` or set `NUTRIPLAN_TRUST_PROXY=1` |
| "No key configured" but a key exists | key is unbound to this host | Re-enter it in Settings |
| "Both … and data/secrets.json define a key" | env + file conflict | Remove one |

## 7. Incident: suspected key leak

1. Revoke the key at the provider.
2. Remove it: Settings → AI → remove, or delete the provider entry from
   `data/secrets.json`.
3. Check the provider's usage/billing for unexpected calls.
4. Review `data/ai-config.json` for an unexpected `baseUrl` or fallback.
5. If the app was reachable beyond loopback, treat the database as exposed:
   review recent recipes/foods/plans and change the gate mode.

## 8. Dependency and framework updates

```bash
npm audit
npm outdated
npm test
npx tsc --noEmit
```

`next@16.4.6` is above the known advisory fixed floors. Re-run `npm audit`
after every lockfile change and record the result in the commit message when
it changes a security-relevant package.

## 9. Before every commit

```bash
npx tsc --noEmit
npm test
```

Both must be green. A security change also needs a tracker update in
`docs/security/TRACKER.md` and, if it changes a boundary, a note in
`THREAT-MODEL.md`.
