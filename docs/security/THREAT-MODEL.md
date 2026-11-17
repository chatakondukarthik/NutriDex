# Threat model — local-first, single user

This document replaces the earlier hosted/deployment threat model. NutriPlan
is a personal app: one OS user, one database on that user's device, no
central service. The security question is not "can another tenant read this
row?" — it is "can anything other than the owner reach the data or the keys?"

## Assets

| Asset | Why it matters |
|---|---|
| Food, recipe, plan and diary rows | Health and dietary history; personal by nature |
| `data/nutriplan.sqlite` (+ `-wal`, `-shm`) | The whole database |
| `data/secrets.json` | Provider API keys, billed to the owner |
| `data/ai-config.json` | Endpoints and models; also a key-exfiltration lever |
| The browser session | Anyone with it can act as the owner |

## Trust boundaries

```
┌──────────────────────────────────────────────────────────────┐
│ OS user account (the real boundary)                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Data directory 0700                                    │  │
│  │  SQLite 0600   secrets.json 0600   ai-config.json 0600 │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Node process (Next)                                    │  │
│  │  request gate → server actions → SQLite / outbound AI  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Browser on the same machine                            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

1. **OS account** — the primary boundary. Another local account must not be
   able to read the data directory or the key files.
2. **Optional app passphrase** — a second lock for someone who already has
   the OS session. Default off; not implemented yet (`SEC-LCK-01`).
3. **Browser Origin / Host** — stops a random website or a LAN caller from
   driving the local server.
4. **File permissions** — `0700` directory, `0600` files, atomic writes.
5. **At-rest encryption** — delegated to OS/volume encryption. SQLite cannot
   use SQLCipher through `node:sqlite`; app-level encryption would create a
   key-recovery problem.

## In scope

- A request from the LAN, another device, or another local process reaching
  the port.
- A website in the user's browser issuing a cross-site request to the local
  server.
- A malicious or compromised AI provider / OpenAI-compatible endpoint.
- Prompt injection through stored names, notes, aliases and imported product
  names.
- A malformed import, oversized payload or hostile CSV.
- A crash during a write, or a partial multi-row copy.
- A dependency advisory.
- Another local OS account reading files.

## Out of scope

- Multi-tenant authorization, roles, invites, password reset, admin panels.
- Server-side sessions and a hosted login.
- TLS termination, reverse-proxy hardening, Docker/container escapes.
- Backup drills, compliance audit logging, SIEM, uptime monitoring.
- An attacker with the unlocked OS session *and* the app unlocked. That is
  the owner.
- Physical access to an unencrypted disk. Use FileVault/LUKS/BitLocker.

## Threats and controls

### T1 — LAN exposure of an unauthenticated app
`next start` (or `next dev` invoked directly) can bind a wider interface, and
every server action runs as the single local user with no session. Anyone who
reaches the port can read, rewrite or delete everything and can repoint
`baseUrl` to capture the key.

**Controls:** `npm run dev` binds `127.0.0.1`; the gate defaults to `local`;
loopback only; `0.0.0.0` is not loopback; `hosts` mode trusts only the
allowlist; `token` mode trusts only a header/cookie token; forwarded headers
are stripped unless a proxy is explicitly trusted. The bind address is the
first control; the gate is defence-in-depth. See `SEC-LOC-01`…`SEC-LOC-06`.

### T2 — Cross-site request forgery from the browser
Next's action origin check rejects a cross-site request but allows one with
no `Origin` header. A page could POST to `127.0.0.1`.

**Controls:** `isCrossSiteMutation` rejects non-GET requests unless
`Sec-Fetch-Site` is absent or `same-origin` (`none` is a typed navigation, not
a server action), and rejects an `Origin` whose authority (including a
non-default port) differs, unless it matches a configured
`NUTRIPLAN_ALLOWED_ORIGINS` host. See `SEC-LOC-05`.

### T3 — AI key exfiltration through `baseUrl`
The AI layer posts a stored key to a user-supplied URL. Change the URL, press
"test connection", and the key leaves.

**Controls:** `assertOutboundUrl` rejects non-HTTPS, credentials, private,
loopback, link-local and reserved ranges (including IPv4-mapped and NAT64
encodings of those addresses), and resolves DNS. `fetchJson` refuses
redirects. Keys are bound to the host they were entered for; a custom endpoint
with a different host gets no key and a "re-enter" error. An env key is
released to a custom host only when the operator pins it with
`NUTRIPLAN_AI_<PROVIDER>_HOST`. See `SEC-AIL-01`…`SEC-AIL-03`.

### T4 — SSRF / DNS rebinding
A public hostname can resolve to a private address after validation.

**Controls:** DNS is resolved and checked with a short cache; redirects are
refused; mapped/NAT64 literals cannot smuggle a private IPv4 destination.
**Residual:** a TOCTOU window remains between the check and the socket. See
`RESIDUAL-RISKS.md`.

### T5 — Prompt injection from stored data
Recipe names, food names, aliases, imported product names and notes are
re-fed into later prompts. Un-delimited text reads as instruction.

**Controls:** untrusted spans go inside fixed tags with a data preamble;
`&`, `<`, `>` are escaped so the delimiter cannot be forged; the master
prompt has one home in the system turn. Model output is schema-validated and
re-resolved before storage. See `SEC-AIL-05`.

### T6 — Cost blowout
A loop or a hostile page can drain the provider quota or the shared USDA
`DEMO_KEY`.

**Controls:** daily AI cap; per-minute token buckets on every expensive
action; response size cap; plan/ingredient/step caps. See `SEC-AIL-04`,
`SEC-AIL-07`, `SEC-AIL-08`.

### T7 — Malformed or hostile import
A huge CSV, embedded newlines, prototype-pollution headers or a renamed
image.

**Controls:** 400k-character import cap, quote-aware parser, 50k-row cap,
null-prototype rows, image MIME allowlist + magic-byte sniffing. See
`SEC-INP-03`, `SEC-INP-04`, `SEC-EXP-02`.

### T8 — Data readable by another local account
Default umask leaves the database and keys world-readable.

**Controls:** `0700` directory, `0600` files, `fchmod` before rename, SQLite
sidecars tightened on boot. See `SEC-DAT-01`…`SEC-DAT-04`.

### T9 — Partial writes, partial copies and interrupted migrations
A crash mid-write truncates `secrets.json`; a failure mid-copy leaves a
partial day; a crash during the `entries` rebuild strands the diary.

**Controls:** atomic temp+fsync+rename writes; `transaction()` around day and
week copies; the `entries` rebuild runs in one transaction, and a stranded
`entries_v1` is finished on the next boot (the live table wins when the copy
already ran; otherwise the stranded rows are merged). See `SEC-DAT-03`,
`SEC-PER-01`, `SEC-PER-03`, `SEC-PER-04`.

### T10 — Supply chain
A vulnerable framework or a native addon.

**Controls:** `next@16.4.6`, clean `npm audit`, no native SQLite module. See
`SEC-SUP-01`, `SEC-SUP-02`.

## Assumptions

- The OS account is not shared and the disk is encrypted.
- The browser profile is the owner's.
- `NUTRIPLAN_GATE` is not set to `off` on a machine with an untrusted LAN.
- `NUTRIPLAN_TRUST_PROXY=1` is set only behind a proxy that overwrites
  forwarded headers.
- Provider keys from env vars are operator-controlled; they are released to a
  custom host only when pinned with `NUTRIPLAN_AI_<PROVIDER>_HOST`, and are
  otherwise used only for the provider's fixed endpoint.
