# Security tracker

Local-first, single-user scope. One OS account owns the database and the AI
keys; profiles are optional filters on rows that account owns and are **not**
a privacy boundary. The tracker exists so every security claim has an owner,
a code location and a way to verify it.

## Status workflow

```
proposed → gap → mitigating → verified
                    ↘ accepted (requires an expiry date)
```

- **proposed** — identified, not assessed.
- **gap** — no control exists.
- **mitigating** — a control exists but is incomplete or untested.
- **verified** — control exists, is tested, and matches the stated scope.
- **accepted** — deliberately not fixed. Must carry an expiry and a reason.

A record moves to `verified` only when there is a test or a reproducible
check. Prose is not verification.

## Record template

```
### SEC-<TRACK>-<NN> — <short title>
Status:  proposed | gap | mitigating | verified | accepted (expires YYYY-MM-DD)
Track:   GOV | LOC | LCK | DAT | INP | AIL | EXP | SUP | PER | TST
Threat:  what can go wrong, in one sentence
Control: what the code does about it
Where:   file:line (or test name)
Verify:  the command or manual step that proves it
Notes:   residual gap, follow-up, or why accepted
```

## Tracks

| Track | Covers |
|---|---|
| `GOV` | Scope, threat model, decisions, data ownership |
| `LOC` | Local exposure: request gate, Host/origin checks, CSRF, browser boundary |
| `LCK` | Optional app passphrase lock (default off, deferred) |
| `DAT` | Data at rest: file modes, atomic writes, encryption |
| `INP` | Input and output validation at server-action boundaries |
| `AIL` | BYO LLM: SSRF, key handling, prompt injection, cost limits |
| `EXP` | Total import/export and portability |
| `SUP` | Supply chain: dependencies, framework advisories |
| `PER` | Persistence and integrity: transactions, migrations, crash safety |
| `TST` | Tests that keep the controls honest |

---

## Records

### SEC-GOV-01 — Local-first threat model
Status:  verified
Track:   GOV
Threat:  A hosted multi-tenant design would add auth, tenancy and ops risk
         the product does not need.
Control: One OS user, one database on that user's device, no central service.
         The threat model is in `THREAT-MODEL.md`.
Where:   `docs/security/THREAT-MODEL.md`
Verify:  Review against `product/SCOPE.md` and `DEPLOYMENT.md`.

### SEC-GOV-02 — Profiles are not an authorization boundary
Status:  verified
Track:   GOV
Threat:  Treating a profile id as an ownership check would create a false
         sense of isolation between rows the same account owns.
Control: Profile is a filter. Every action runs as the single local user.
Where:   `src/lib/db/*`, `src/app/actions.ts`
Verify:  Grep for `profileId` authorization checks: none exist by design.

### SEC-LOC-01 — Gate defaults to loopback-only
Status:  verified
Track:   LOC
Threat:  `next dev` binds `*:3000`; without a gate, every recipe, food and
         the stored AI key are readable and writable from the LAN.
Control: `resolveGateMode()` returns `local` unless a mode is explicit or
         inferred from a configured allowlist/token.
Where:   `src/lib/security/gate.ts` — `resolveGateMode`
Verify:  `tests/security-gate.test.ts` → `resolveGateMode`

### SEC-LOC-02 — `0.0.0.0` is not loopback
Status:  verified
Track:   LOC
Threat:  A caller can send `Host: 0.0.0.0`; treating the bind address as a
         destination let it through the local gate.
Control: `LOOPBACK_HOSTS` contains only `localhost`, `127.0.0.1`, `::1` and
         `ip6-localhost`.
Where:   `src/lib/security/gate.ts` — `LOOPBACK_HOSTS`
Verify:  `tests/security-gate.test.ts` → `isLoopbackHost`

### SEC-LOC-03 — Loopback trusted only in `local` mode
Status:  verified
Track:   LOC
Threat:  A reverse proxy that rewrites `Host` to `127.0.0.1:3000` made every
         request look local, so `hosts` and `token` modes were decorative.
Control: In `hosts` mode only the allowlist passes; in `token` mode only a
         matching token passes. Loopback is not an implicit bypass.
Where:   `src/lib/security/gate.ts` — `decideGate`
Verify:  `tests/security-gate.test.ts` → `decideGate`

### SEC-LOC-04 — Forwarded headers are stripped unless a proxy is trusted
Status:  verified
Track:   LOC
Threat:  `X-Forwarded-Host` is client-writable, and Next's action origin
         check trusts it. A caller could satisfy the check by sending one.
Control: Without `NUTRIPLAN_TRUST_PROXY=1`, `x-forwarded-host`,
         `x-forwarded-proto` and `x-forwarded-for` are removed before the
         request reaches a route.
Where:   `src/proxy.ts` — `proxy`
Verify:  Manual: send a forged `X-Forwarded-Host` and confirm it is ignored;
         `tests/security-gate.test.ts` pins the `decideGate` half of it.

### SEC-LOC-05 — Cross-site mutation check
Status:  verified
Track:   LOC
Threat:  Next allows a server-action request with no `Origin` header. A
         website in the user's browser could POST to `127.0.0.1` and mutate
         data.
Control: Non-GET/HEAD/OPTIONS requests are rejected when `Sec-Fetch-Site`
         is neither `same-origin` nor `none`, or when `Origin` does not
         match the request authority including the port.
Where:   `src/proxy.ts` — `isCrossSiteMutation`
Verify:  Manual: `curl -X POST -H 'Sec-Fetch-Site: cross-site'` returns 403.

### SEC-LOC-06 — Query-string token removed
Status:  verified
Track:   LOC
Threat:  A token in a URL leaks into browser history, referrers and access
         logs.
Control: `token` mode accepts only the `nutriplan_token` header or cookie.
Where:   `src/proxy.ts` — `proxy`
Verify:  `?nutriplan_token=…` no longer authenticates; header/cookie still do.

### SEC-LOC-07 — Health endpoint is exempt from the gate
Status:  accepted (expires 2027-01-01)
Track:   LOC
Threat:  `/api/health` is reachable without the gate, which reveals that the
         process is running.
Control: The route returns only `{ ok: true }`; no data or version.
Where:   `src/app/api/health/route.ts`, `src/proxy.ts`
Verify:  Manual: `curl http://127.0.0.1:3000/api/health`.
Notes:   Accepted for local monitoring. Revisit if the app is ever exposed.

### SEC-LCK-01 — Optional app passphrase lock
Status:  proposed
Track:   LCK
Threat:  Another process or person using the same OS account can read the
         app. The OS account is the primary boundary, so this is optional.
Control: Not implemented. If added: Argon2id (or `crypto.scrypt` fallback),
         default off, prompted once, unlock token held in memory only.
Where:   —
Verify:  —
Notes:   Deferred. Do not add server sessions, password reset or invites.

### SEC-DAT-01 — Data directory is owner-only
Status:  verified
Track:   DAT
Threat:  The data directory inherits the umask (usually `022`), so other
         local accounts can list the database and key files.
Control: `ensurePrivateDir` creates the directory `0700` and re-applies the
         mode on boot.
Where:   `src/lib/security/private-files.ts`, `src/lib/data-dir.ts`
Verify:  `tests/private-files.test.ts` (new and existing directories become
         `0700`); `stat -f '%Lp' data` → `700`.

### SEC-DAT-02 — Data files are owner-only
Status:  verified
Track:   DAT
Threat:  A health diary and the AI key readable by every local account.
Control: `restrictFile` sets `0600` on the SQLite file and its `-wal`/`-shm`
         sidecars; atomic writes `fchmod` the descriptor before rename.
Where:   `src/lib/security/private-files.ts`, `src/lib/db/client.ts`
Verify:  `tests/private-files.test.ts` (atomic writes are `0600`);
         `stat -f '%Lp' data/nutriplan.sqlite data/secrets.json` → `600`.

### SEC-DAT-03 — Atomic, crash-safe private writes
Status:  verified
Track:   DAT
Threat:  A crash during `writeFileSync` truncated `secrets.json` and lost
         every stored key.
Control: Temp file in the same directory → `fchmod 0600` → write → `fsync` →
         rename. The old file survives a failed write.
Where:   `src/lib/security/private-files.ts` — `atomicWritePrivateFile`
Verify:  `tests/private-files.test.ts` — content survives a second write and no
         `.tmp` file is left behind.

### SEC-DAT-04 — Database sidecars are tightened
Status:  verified
Track:   DAT
Threat:  SQLite creates `-wal` and `-shm` itself, so they inherit the umask
         even if the main file was restricted.
Control: `restrictDbFiles` runs after schema creation and on every boot.
Where:   `src/lib/db/client.ts` — `restrictDbFiles`
Verify:  `ls -l data/nutriplan.sqlite*` after a write.

### SEC-DAT-05 — Encryption at rest
Status:  accepted (expires 2027-06-01)
Track:   DAT
Threat:  Someone with the disk image can read the database.
Control: Rely on OS/volume encryption (FileVault, LUKS, BitLocker). BYOK
         keys are protected by file permissions, not encrypted at rest.
Where:   `docs/security/RESIDUAL-RISKS.md`
Verify:  Confirm the host volume is encrypted.
Notes:   `node:sqlite` cannot use SQLCipher. App-level encryption would add
         a key-recovery problem for a single-user local app.

### SEC-INP-01 — Server-action inputs are bounded
Status:  verified
Track:   INP
Threat:  A client can send arbitrarily large strings, arrays or numbers to
         an action and make the server store or process them.
Control: Every action caps its own inputs: prompt and note lengths, image
         count and bytes, CSV size and rows, graph nodes/edges, servings,
         recipe/step/ingredient names, instructions and layout keys.
Where:   `src/app/actions.ts`, `src/lib/ai-generate-recipe.ts`
Verify:  `tests/` plus manual oversized requests.

### SEC-INP-02 — Units are validated at the boundary
Status:  verified
Track:   INP
Threat:  `updatePlanEntryQuantityAction` accepted any string as a unit and
         stored it as display metadata.
Control: Accept only a known `Unit` or `portion:<label>`, and cap the label
         length.
Where:   `src/app/actions.ts` — `updatePlanEntryQuantityAction`
Verify:  `tests/actions.test.ts` → `updatePlanEntryQuantityAction` (unknown unit,
         oversized label, `portion:` accepted).

### SEC-INP-03 — Images are checked by content, not just MIME
Status:  verified
Track:   INP
Threat:  A file labelled `image/png` but containing something else was
         base64-posted to the provider.
Control: Allowlist JPEG/PNG/WebP/GIF/HEIC, validate base64, and sniff the
         magic bytes; the declared type must match.
Where:   `src/app/actions.ts` — `extractFoodAction`, `sniffImageType`
Verify:  `tests/actions.test.ts` → `extractFoodAction image validation`
         (mismatched bytes, unsupported type, non-base64).

### SEC-INP-04 — CSV parser is quote-aware and row-capped
Status:  verified
Track:   INP
Threat:  Splitting on newlines broke quoted fields containing line breaks
         and let a large paste allocate millions of rows.
Control: RFC 4180-style record parser (quoted commas, escaped quotes,
         embedded newlines) and a 50,000-row cap.
Where:   `src/lib/importer/csv.ts`
Verify:  `tests/csv.test.ts` (embedded newlines, escaped quotes, CRLF,
         null-prototype rows, 50,000-row cap).

### SEC-INP-05 — Graph saves are shape-capped
Status:  verified
Track:   INP
Threat:  A 1 MB graph means a full recompute and a multi-megabyte snapshot.
Control: 300 nodes, 600 edges, 600 layout keys, name ≤ 200, version label
         ≤ 120, instructions ≤ 20,000, servings ≤ 1,000.
Where:   `src/app/actions.ts` — `saveGraphAction`
Verify:  `tests/actions.test.ts` → `saveGraphAction caps` (nodes, edges,
         layout keys, name, label, instructions, servings, mode).

### SEC-AIL-01 — Outbound AI URLs are validated
Status:  verified
Track:   AIL
Threat:  A stored key is posted to a caller-supplied `baseUrl`; without a
         check this is credential exfiltration and SSRF.
Control: `https:` only (local opt-in for http), no embedded credentials, no
         private/loopback/link-local/reserved ranges, DNS resolved and
         checked.
Where:   `src/lib/security/urls.ts`
Verify:  `tests/security-urls.test.ts` (metadata IP, loopback, credentials,
         public hostname).

### SEC-AIL-02 — Redirects are refused
Status:  verified
Track:   AIL
Threat:  `fetch` follows redirects by default; a public endpoint could 302
         to a metadata endpoint or attacker host and carry the key.
Control: `fetchJson` uses `redirect: "error"`.
Where:   `src/lib/ai/adapters.ts` — `fetchJson`
Verify:  `tests/ai-adapters.test.ts` — `fetch` is called with
         `redirect: "error"`.

### SEC-AIL-03 — Keys are bound to the host they were entered for
Status:  verified
Track:   AIL
Threat:  Changing `baseUrl` and pressing "test connection" sent the stored
         key to the new host.
Control: `secrets.json` records a host per key. A custom endpoint receives a
         file key only when the host matches; otherwise it fails closed with
         "re-enter the key". Env keys are operator-controlled and unbound.
Where:   `src/lib/ai/secrets.ts`, `src/lib/ai/adapters.ts`
Verify:  `tests/ai-secrets.test.ts` — save key for host A, request host B → no
         key; unbound file key refused; env key unbound.

### SEC-AIL-04 — Provider responses are size-capped and redacted
Status:  verified
Track:   AIL
Threat:  A provider (or a malicious compatible endpoint) can return a huge
         body or echo secrets into an error.
Control: 5 MB cap with streaming abort; error bodies redacted and truncated.
Where:   `src/lib/ai/adapters.ts` — `readCapped`, `fetchJson`
Verify:  `tests/ai-adapters.test.ts` — a declared `content-length` over the
         cap is rejected before the body is buffered.

### SEC-AIL-05 — Prompt delimiters cannot be forged
Status:  verified
Track:   AIL
Threat:  A food or product name containing `</request>` could close the
         data block and make the rest read as instructions.
Control: `asData` and the master-prompt block escape `&`, `<`, `>`.
Where:   `src/lib/ai/prompt.ts`
Verify:  `tests/ai-prompt.test.ts` — `</request>` is escaped in `asData` and
         the master-prompt block.

### SEC-AIL-06 — Model-supplied factors are clamped
Status:  verified
Track:   AIL
Threat:  A hallucinated retention factor of `1e9` produces an absurd total.
Control: Factors are clamped to `[0, 2]`; reason and notes are truncated.
Where:   `src/lib/ai/estimate.ts` — `parseEstimate`
Verify:  `tests/estimate.test.ts` — `1e9` clamps to 2, a negative clamps to 0,
         reason/notes are truncated.

### SEC-AIL-07 — Ingredient fan-out is capped
Status:  verified
Track:   AIL
Threat:  A plan with hundreds of unique ingredient names causes hundreds of
         USDA searches.
Control: Plans are rejected above 60 unique ingredients; resolution also
         stops at 60.
Where:   `src/lib/ai-generate-recipe.ts` — `validateRecipePlan`;
         `src/lib/ai/food-resolve.ts` — `planUniqueFoodNames`
Verify:  `tests/ai-food-resolve.test.ts` — 61 unique names are rejected and
         `planUniqueFoodNames` stops at 60.

### SEC-AIL-08 — AI calls have a daily cap and a burst limit
Status:  verified
Track:   AIL
Threat:  A loop drains the user's provider quota in seconds.
Control: `withAiBudget` enforces the daily cap; each expensive action also
         passes a per-minute token bucket.
Where:   `src/lib/ai/client.ts`, `src/app/actions.ts` — `aiThrottle`
Verify:  Manual: loop a test connection and see the throttle message.

### SEC-EXP-01 — Total export
Status:  gap
Track:   EXP
Threat:  A user cannot take their data out, which contradicts local
         ownership and makes lock-in a real risk.
Control: Not implemented. Plan: one archive containing the SQLite snapshot
         plus `ai-config.json` and `secrets.json` (keys optionally omitted),
         with a versioned manifest.
Where:   —
Verify:  Export, wipe the data directory, import, compare row counts.
Notes:   Product feature, not a security patch. Tracked so it is not lost.

### SEC-EXP-02 — Import is explicit and bounded
Status:  verified
Track:   EXP
Threat:  An imported CSV can be huge or malformed and exhaust memory.
Control: 400,000-character cap, quote-aware parser, 50,000-row cap, 50
         reported errors, null-prototype rows.
Where:   `src/app/actions.ts` — `importInndbAction`,
         `src/lib/importer/csv.ts`
Verify:  `tests/csv.test.ts` and `tests/inndb-import.test.ts`.

### SEC-SUP-01 — Framework and dependency advisories
Status:  verified
Track:   SUP
Threat:  A known vulnerability in Next, React or a dependency.
Control: `next@16.4.6` is above all known advisory fixed floors; `npm audit`
         is clean at the time of writing.
Where:   `package.json`, `package-lock.json`
Verify:  `npm audit --omit=dev` and `npm audit`.

### SEC-SUP-02 — No native SQLite addon
Status:  verified
Track:   SUP
Threat:  A native module adds build and supply-chain surface.
Control: `node:sqlite` is built into Node; no `better-sqlite3`.
Where:   `src/lib/db/client.ts`
Verify:  `npm ls better-sqlite3` → empty.

### SEC-PER-01 — Multi-row plan copies are transactional
Status:  verified
Track:   PER
Threat:  A failure halfway through a day/week copy leaves a partial copy
         that looks like data loss.
Control: `copyPlanDayAction` and `copyPlanWeekAction` wrap their inserts in
         `transaction()`.
Where:   `src/app/actions.ts`, `src/lib/db/client.ts`
Verify:  `tests/actions.test.ts` → `copyPlanDayAction` — a failing second row
         leaves zero rows in the target day.

### SEC-PER-02 — WAL and busy timeout
Status:  verified
Track:   PER
Threat:  Two processes opening the file fail with "database is locked".
Control: `PRAGMA busy_timeout = 5000` and WAL mode.
Where:   `src/lib/db/client.ts` — schema pragmas
Verify:  Start the dev server and a build worker together.

### SEC-PER-03 — Additive migrations only
Status:  verified
Track:   PER
Threat:  A destructive migration loses data on boot.
Control: `migrate()` only adds nullable/defaulted columns.
Where:   `src/lib/db/client.ts` — `migrate`
Verify:  Review every `addColumn` call.

### SEC-TST-01 — Gate semantics are unit-tested
Status:  verified
Track:   TST
Threat:  A gate change silently reopens the LAN.
Control: `tests/security-gate.test.ts` pins loopback, `0.0.0.0`, allowlist,
         token and forwarded-host behaviour.
Where:   `tests/security-gate.test.ts`
Verify:  `npm test`

### SEC-TST-02 — Full suite and typecheck are green
Status:  verified
Track:   TST
Threat:  A security patch breaks an unrelated path.
Control: `npx tsc --noEmit` and `npm test` (46 files, 479 tests).
Where:   `tests/`
Verify:  Run both before every commit.
