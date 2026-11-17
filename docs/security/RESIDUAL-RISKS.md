# Residual risks

Risks that remain after the current patches. Each has a reason, an expiry and
a trigger for revisiting. Accepted items are not "fixed later by default";
they are deliberate for a local-first, single-user app.

## Accepted

### R1 — Disk image exposes the database
**Expires:** 2027-06-01
**Why:** `node:sqlite` cannot use SQLCipher. Encrypting the database in the
app would move the key-recovery problem into the app, where a forgotten
passphrase means permanent data loss.
**Mitigation:** rely on FileVault / LUKS / BitLocker. File modes prevent
casual reads by other local accounts, not an offline disk copy.
**Revisit:** if the app ever stores data on a shared or cloud-synced volume.

### R2 — Another process under the same OS account
**Expires:** 2027-01-01
**Why:** The OS account is the trust boundary. A process running as the same
user can read `0600` files and call the loopback port.
**Mitigation:** the optional app lock (`SEC-LCK-01`) is the only planned
answer; it is not implemented.
**Revisit:** if the app is used on a shared machine.

### R3 — `Host` is a header, not authentication
**Expires:** 2027-01-01
**Why:** `local` mode trusts a loopback `Host`. A caller who can reach the
port and forge the header gets in.
**Mitigation:** the default bind and gate keep the port off the LAN; a
deployment should use `token` mode or a real proxy auth layer.
**Revisit:** if the app is exposed beyond loopback.

### R4 — Health endpoint bypasses the gate
**Expires:** 2027-01-01
**Why:** Local monitoring needs an unauthenticated liveness check.
**Mitigation:** the route returns only `{ ok: true }` and no version or data.
**Revisit:** before any public exposure.

### R5 — In-process rate limits reset on restart
**Expires:** 2027-01-01
**Why:** A single-user local app does not justify a shared store.
**Mitigation:** the daily AI cap is persisted in SQLite; burst buckets are
best-effort.
**Revisit:** if multiple processes or users share one data directory.

### R6 — DNS rebinding window
**Expires:** 2027-01-01
**Why:** `assertOutboundUrl` resolves the host and checks the address, then
`fetch` resolves it again. A TTL-0 record could change in between.
**Mitigation:** redirects are refused; private/link-local literals are
rejected, including IPv4-mapped and NAT64 encodings; the cache narrows the
window.
**Revisit:** if custom AI endpoints become a shared or multi-user feature.
A future fix is to connect to the validated IP and set the `Host` header.

### R8 — WAL on a network or synced volume
**Expires:** 2027-01-01
**Why:** SQLite's WAL mode assumes a local filesystem. A network share or a
cloud-sync client can interleave writes and corrupt the database.
**Mitigation:** the default data directory is local; the deployment guide
uses a local volume. A synced folder is not a supported backup mechanism.
**Revisit:** if a user asks to place `NUTRIPLAN_DATA_DIR` on iCloud, Dropbox,
NFS or SMB.

### R9 — Legacy `secrets.json` shapes
**Expires:** 2027-01-01
**Why:** Older builds wrote a flat provider→key map, then a single-host
`{ keys, hosts }` shape. Both are still read so an upgrade does not lose a
key. A flat key with no recorded host is treated as unbound (usable for the
provider's fixed endpoint only); a flat key paired with `hosts[provider]` is
treated as bound to that host, so it is never released to the fixed endpoint.
**Mitigation:** the next save rewrites the file in the per-`provider@host`
shape.
**Revisit:** after the next release; remove the readers once no supported
upgrade path can produce the old shapes.

### R7 — No audit trail
**Expires:** 2027-01-01
**Why:** A single local user is the only actor; an append-only log would be
another sensitive store to protect.
**Mitigation:** errors are logged server-side without secrets.
**Revisit:** if profiles ever become a real multi-user boundary.

## Open gaps

### G1 — Total export is not implemented
**Target:** next product slice
**Why it matters:** local ownership is incomplete if the user cannot take
the database and settings out in one step.
**Plan:** a versioned archive containing a SQLite snapshot, `ai-config.json`
and optionally `secrets.json`; a matching import that validates the manifest
and refuses to overwrite without confirmation.
**Tracked as:** `SEC-EXP-01`.

### G2 — App passphrase lock is not implemented
**Target:** deferred
**Why it matters:** it is the only control against another process under the
same OS account.
**Plan:** Argon2id (or `crypto.scrypt`), default off, prompted once, unlock
token in memory only. No server sessions, reset flow or invites.
**Tracked as:** `SEC-LCK-01`.

### G3 — `secrets.json` is not encrypted
**Target:** with G2, if it ships
**Why it matters:** file permissions protect against other accounts, not an
offline copy.
**Plan:** if a lock is added, derive a key from the passphrase and encrypt
the key store; otherwise keep relying on OS/volume encryption.
**Note:** legacy key shapes are read on upgrade and rewritten to the
per-`provider@host` shape on the next save (`R9`).

## Verification cadence

| Check | When |
|---|---|
| `npx tsc --noEmit` and `npm test` | every commit |
| `npm audit` | every dependency change |
| File modes (`stat -f '%Lp'`) | after changing the data directory |
| Gate modes | after changing `src/proxy.ts` or `src/lib/security/gate.ts` |
| Residual-risk expiry | at the start of each quarter |
