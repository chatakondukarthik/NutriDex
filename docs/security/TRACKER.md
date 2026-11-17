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
Threat:  A dev server or `next start` can bind a wider interface; without a
         gate, every recipe, food and the stored AI key are readable and
         writable from the LAN.
Control: `npm run dev` binds `127.0.0.1` explicitly, and
         `resolveGateMode()` returns `local` unless a mode is explicit or
         inferred from a configured allowlist/token. The bind address is the
         first control; the gate is defence-in-depth for `next start`,
         `HOSTNAME=0.0.0.0` and container port publishing.
Where:   `package.json` — `dev`; `src/lib/security/gate.ts` — `resolveGateMode`
Verify:  `npm run dev` logs a loopback URL; `tests/security-gate.test.ts` →
         `resolveGateMode`

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
Control: Non-GET/HEAD/OPTIONS requests are rejected unless `Sec-Fetch-Site`
         is absent or `same-origin` (`none`, `same-site` and `cross-site` are
         rejected), or when `Origin` does not match the request authority
         including a non-default port. A configured
         `NUTRIPLAN_ALLOWED_ORIGINS` host is also accepted.
Where:   `src/lib/security/gate.ts` — `isCrossSiteMutation` (wired from
         `src/proxy.ts`)
Verify:  `tests/security-origin.test.ts`; manual: `curl -X POST -H
         'Sec-Fetch-Site: cross-site'` returns 403.

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

### SEC-LOC-08 — No secret can reach the client bundle
Status:  verified
Track:   LOC
Threat:  A client component imports a server module by accident, carrying
         `process.env`, the database or a key into JavaScript the browser
         can read.
Control: A static import-graph check starts at every `"use client"` module,
         follows the imports the bundler follows, stops at `"use server"`
         boundaries, and refuses any reachable module that names a secret
         env var, reads `process.env`, opens the filesystem or imports a
         node builtin. Type-only imports are erased by the compiler and are
         allowed, which is how a panel can share an `ImportReport` type
         without importing the importer.
Where:   `tests/bundle-boundary.test.ts`
Verify:  `npm test -- tests/bundle-boundary.test.ts`; `npm run build`.
Notes:   This is an import-graph assertion, not a scan of the emitted
         bundle. It catches the realistic mistake (a client import) without
         adding a second build to the suite.

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
         sidecars; atomic writes `fchmod` the descriptor before rename; the
         data directory re-restricts `secrets.json` and `ai-config.json` on
         every boot and read.
Where:   `src/lib/security/private-files.ts`, `src/lib/db/client.ts`,
         `src/lib/data-dir.ts`
Verify:  `tests/private-files.test.ts` (atomic writes are `0600`);
         `stat -f '%Lp' data/nutriplan.sqlite data/secrets.json` → `600`.

### SEC-DAT-03 — Atomic, crash-safe private writes
Status:  verified
Track:   DAT
Threat:  A crash during `writeFileSync` truncated `secrets.json` and lost
         every stored key.
Control: Random temp file in the same directory (`wx`) → `fchmod 0600` →
         short-write loop → `fsync` → rename → directory fsync. A failed
         write or rename removes the temp file and leaves the old file.
Where:   `src/lib/security/private-files.ts` — `atomicWritePrivateFile`
Verify:  `tests/private-files.test.ts` and
         `tests/private-files-faults.test.ts` (short write, ENOSPC mid-write,
         failed rename, no temp leftovers).

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

### SEC-DAT-06 — Deletion is scoped and cannot dangle references
Status:  verified
Track:   DAT
Threat:  A bulk-delete control either leaves rows that render as "unknown
         food", cascades into data the user did not select, or lets a
         crafted request delete arbitrary tables.
Control: The caller sends category ids, never table names; unknown or empty
         selections reject the whole request. The preview counts what
         exists and names dependants, and the purge re-checks the same
         references inside `BEGIN IMMEDIATE`. A referenced parent is
         refused, not cascaded or archived. Seed foods, seed retention
         factors, `meta`, non-importable settings and AI keys are outside
         every category; deleting preferences restores shipped retention
         factors immediately. Evidence files are removed after commit,
         confined to `data/evidence`, and failures are reported as warnings.
Where:   `src/lib/db/purge.ts`, `src/app/actions.ts` (`purgeDataAction`),
         `src/components/data-deletion.tsx`
Verify:  `tests/purge.test.ts` (counts, selective delete, blockers and
         rollback, select-all survival, reseed, invalid input, traversal);
         `tests/components/data-deletion.test.tsx` (selection, blocker,
         acknowledgement, refusal, warnings).

### SEC-INP-01 — Server-action inputs are bounded
Status:  verified
Track:   INP
Threat:  A client can send arbitrarily large strings, arrays or numbers to
         an action and make the server store or process them.
Control: Every action that allocates, stores or forwards caller-controlled
         text/arrays caps its inputs: prompt and note lengths, image count
         and bytes, CSV size and rows, graph nodes/edges and per-node
         outputs, servings, recipe blocks/inputs, ingredient names,
         instructions, layout keys and import mappings. Pure id lookups rely
         on parameterised SQL, so a long id is not an allocation.
Where:   `src/app/actions.ts`, `src/lib/recipe-validate.ts`,
         `src/lib/nutrition/graph-validate.ts`, `src/lib/captured-food.ts`
Verify:  `tests/actions.test.ts`, `tests/graph-validate.test.ts`,
         `tests/csv.test.ts`; manual oversized requests.

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
         embedded newlines), a 50,000-row cap enforced during the scan, and
         a hard error for an unterminated quoted field.
Where:   `src/lib/importer/csv.ts`
Verify:  `tests/csv.test.ts` (embedded newlines, escaped quotes, CRLF,
         null-prototype rows, cap aborts during scan, unterminated quote).

### SEC-INP-05 — Graph saves are shape-validated
Status:  verified
Track:   INP
Threat:  A 1 MB graph means a full recompute and a multi-megabyte snapshot;
         per-node output counts make the engine quadratic, and grams/factors
         are multiplied straight into stored nutrition.
Control: `validateGraphShape` bounds 300 nodes, 600 edges, unique ids, one
         to eight outputs per step, grams `(0, 1,000,000]`, factors `[0, 2]`,
         known nutrient codes, measured-output alignment, edges to known
         nodes with no self-links/duplicates. `validateLayout` bounds 600
         keys and requires finite coordinates. `sanitizeGraph` and
         `sanitizeLayout` then rebuild nodes, outputs, factor maps, edges and
         positions from those known fields, so extra keys (a multi-megabyte
         `blob` on a node or layout value) are dropped before the snapshot is
         stored. Name ≤ 200, version label ≤ 120, instructions ≤ 20,000,
         servings ≤ 1,000.
Where:   `src/lib/nutrition/graph-validate.ts`,
         `src/app/actions.ts` — `saveGraphAction`
Verify:  `tests/graph-validate.test.ts` (bounds and sanitisers);
         `tests/actions.test.ts` → `saveGraphAction caps` (nodes, edges,
         layout, name, label, instructions, servings, mode, invalid
         nutrition, duplicate ids, unknown fields dropped from the stored
         snapshot).

### SEC-INP-06 — Recipe drafts are block- and input-capped
Status:  verified
Track:   INP
Threat:  Each ingredient costs a food lookup and a per-block compute, so a
         16 MB draft would mean hundreds of thousands of synchronous queries.
Control: 50 blocks per recipe and 60 inputs per block, checked before any
         lookup; name, label and instructions are bounded or truncated, the
         step operation is capped at 60 characters and `outputGrams` at the
         1,000,000 g ceiling. A non-string name, operation or preparation is
         treated as absent instead of throwing.
Where:   `src/lib/recipe-validate.ts` — `prepareVersion`
Verify:  `tests/prepare-version.test.ts` (type guards, operation and
         output-weight caps); `tests/actions.test.ts` → `recipe and plan
         quantity caps`.

### SEC-INP-07 — Captured-food inputs are shape-guarded
Status:  verified
Track:   INP
Threat:  The input crosses the action boundary as untyped JSON; a number
         where a string is expected throws (`"x".trim`) or a non-array
         breaks `.map`, producing an unhandled 500.
Control: `prepareCapturedFood` checks the object, name, aliases, portions
         and estimated fields before use, caps the array lengths before they
         are materialised (12 aliases, 20 portions, 100 estimated codes), and
         bounds every stored string. A non-string `imagePath` is ignored
         rather than passed to `.trim()`.
Where:   `src/lib/captured-food.ts`
Verify:  `tests/captured-foods.test.ts` (image path guard, pre-materialisation
         caps); `tests/actions.test.ts` → `saveCapturedFoodAction input
         guards`.

### SEC-INP-08 — Import column mappings are validated
Status:  verified
Track:   INP
Threat:  A string-typed `nutrients` mapping was enumerated per row, and an
         unknown nutrient code could write a key the nutrition engine does
         not read.
Control: Mapping must be an object; its string fields are type-checked; at
         most 40 nutrient columns, each naming a known `NutrientCode`. An
         absent `nutrients` map means "no nutrient columns" rather than a
         crash before the first row.
Where:   `src/app/actions.ts` — `importInndbAction`;
         `src/lib/importer/inndb.ts`
Verify:  `tests/actions.test.ts` → `importInndbAction mapping validation`
         (including a mapping with no `nutrients` map).

### SEC-AIL-01 — Outbound AI URLs are validated
Status:  verified
Track:   AIL
Threat:  A stored key is posted to a caller-supplied `baseUrl`; without a
         check this is credential exfiltration and SSRF.
Control: `https:` only (local opt-in for http), no embedded credentials, no
         private/loopback/link-local/reserved ranges, DNS resolved and
         checked. IPv4-mapped and NAT64 IPv6 literals are judged by their
         embedded IPv4 address; TEST-NET and `2001:db8::/32` are never
         allowed.
Where:   `src/lib/security/urls.ts`
Verify:  `tests/security-urls.test.ts` (metadata IP, loopback, credentials,
         public hostname, mapped/NAT64 encodings).

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
Control: `secrets.json` stores one key per `provider@host`, so the
         primary/fallback/image roles no longer overwrite each other. A
         custom endpoint receives a file key only when the host matches;
         otherwise it fails closed with "re-enter the key". Env keys are
         released to a caller-supplied host only when the operator pins it
         with `NUTRIPLAN_AI_<PROVIDER>_HOST`; an unpinned env key is used
         only for the provider's fixed endpoint. `getKey` deliberately does
         not release a host-bound key to a fixed endpoint.
Where:   `src/lib/ai/secrets.ts`, `src/lib/ai/adapters.ts`
Verify:  `tests/ai-secrets.test.ts` — per-host binding, role separation,
         unbound file key refused, unpinned env key refused for a custom
         host, pinned env key accepted, env/file conflict detected, legacy
         shapes read and migrated on the next save.

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
Control: `asData` escapes `&`, `<`, `>` in every untrusted span (food and
         product names, notes, operations, qualifiers). The master-prompt
         block is deliberately not escaped: it is the app user's own
         system-level text, not third-party data, and escaping turned a
         legitimate `keep salt <2 g` into `&lt;2 g`.
Where:   `src/lib/ai/prompt.ts`
Verify:  `tests/ai-prompt.test.ts` — `</request>` is escaped in `asData`; the
         master-prompt block passes the user's text through unchanged.

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
Status:  verified
Track:   EXP
Threat:  A user cannot take their data out, which contradicts local
         ownership and makes lock-in a real risk.
Control: `buildArchive` writes one ZIP containing `manifest.json` (format
         version, row counts, columns, a SHA-256 per file), one
         `data/<table>.ndjson` per table in the registry, `files/evidence/*`
         for referenced images, an optional `snapshot.sqlite` produced by
         `VACUUM INTO`, and a README. Every table is exported and columns
         are read from the live schema, so a new column cannot be
         forgotten. Secrets never travel; seed foods and seed retention
         factors stay in code; `estimate_cache` is derived and excluded;
         the AI activity log is opt-in.
Where:   `src/lib/archive/registry.ts`, `export.ts`, `manifest.ts`,
         `zip.ts`; `src/app/api/export/route.ts`;
         `src/components/data-portability.tsx`
Verify:  `tests/archive.test.ts` → "restores identical content after a full
         wipe" (export → wipe → import → per-table content hash). Manual:
         `GET /api/export`, `unzip -l`, then `POST /api/import` with
         `dryRun=1`.

### SEC-EXP-03 — Imported archives are treated as hostile input
Status:  verified
Track:   EXP
Threat:  A crafted archive can traverse paths, exhaust memory, forge a
         checksum, or plant a row that breaks the app.
Control: strict ZIP reader (rejects traversal, absolute and duplicate
         names, encryption, ZIP64, multi-disk; caps entries, entry size,
         total size and compression ratio; verifies CRC); a manifest
         checksum for every entry and refusal of unlisted files; unknown
         tables refused; rows validated against the live schema (required
         columns, scalar types only); `image_path` re-validated against the
         same https / `data/evidence` allowlist as the capture action;
         settings restricted to an allowlist; all writes in one transaction
         followed by `PRAGMA foreign_key_check`; a dry run rolls back.
Where:   `src/lib/archive/zip.ts`, `import.ts`, `schema.ts`, `registry.ts`
Verify:  `tests/archive.test.ts` → "hostile archives" (tampered file,
         unknown table, unlisted file, missing required column, dangling
         parent, traversal name, entry cap, zip bomb, non-ZIP input,
         duplicate manifest path, local/central header mismatch, planted
         `origin`, refused setting, unsafe image path, seed factors through
         a replace), plus "archive fidelity" (a row count the manifest does
         not match, a duplicated column, an older archive omitting a
         column, and a default applied per row).

### SEC-EXP-04 — Import cannot be a one-click overwrite
Status:  verified
Track:   EXP
Threat:  A mistaken or malicious import silently destroys the local diary.
Control: the mode is explicit — `merge` is the default and never
         overwrites: an existing row with different values is counted as a
         conflict and left alone, and the report says so. `replace` deletes
         and inserts in one transaction. The UI disables "Import" until the
         same archive has passed a dry run, and the dry run uses the real
         importer so the two cannot drift.
Where:   `src/lib/archive/import.ts`,
         `src/components/data-portability.tsx`
Verify:  `tests/archive.test.ts` → "merge reports a conflict instead of
         overwriting", "reports a unique collision in merge instead of
         dropping the row", "a dry run changes nothing", "handles an
         archive whose tables are empty".

### SEC-EXP-02 — Import is explicit and bounded
Status:  verified
Track:   EXP
Threat:  An imported CSV can be huge or malformed and exhaust memory.
Control: 400,000-character cap, quote-aware parser, 50,000-row cap enforced
         during the scan, 50 reported errors, null-prototype rows, and a
         validated column mapping (≤ 40 known nutrient codes).
Where:   `src/app/actions.ts` — `importInndbAction`,
         `src/lib/importer/csv.ts`, `src/lib/importer/inndb.ts`
Verify:  `tests/csv.test.ts`, `tests/inndb-import.test.ts`, and
         `tests/actions.test.ts` → `importInndbAction mapping validation`.

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
         `transaction()`. The week copy normalises both inputs to the Monday
         plan key, so a non-Monday input cannot create an orphan plan that
         reports success while copying nothing.
Where:   `src/app/actions.ts`, `src/lib/db/client.ts`
Verify:  `tests/actions.test.ts` → `copyPlanDayAction` (a failing second row
         leaves zero rows) and `copyPlanWeekAction` (Wednesday inputs land in
         the target Monday plan).

### SEC-PER-02 — WAL and busy timeout
Status:  verified
Track:   PER
Threat:  Two processes opening the file fail with "database is locked".
Control: `PRAGMA busy_timeout = 5000` and WAL mode.
Where:   `src/lib/db/client.ts` — schema pragmas
Verify:  Start the dev server and a build worker together.
Notes:   WAL assumes a local filesystem. A network or cloud-synced volume can
         corrupt a WAL database; keep `NUTRIPLAN_DATA_DIR` on local disk
         (`RESIDUAL-RISKS.md` R8).

### SEC-PER-03 — Schema migrations are idempotent; rebuilds are transactional
Status:  verified
Track:   PER
Threat:  A destructive migration loses data on boot. The `entries` rebuild
         used to run in autocommit, so a crash between RENAME and DROP could
         strand the diary in `entries_v1`.
Control: `migrate()` runs on every boot and each step inspects the current
         schema (`PRAGMA table_info`) before acting, so it is idempotent
         without a version table. The `entries` rebuild runs inside one
         transaction. On boot, `recoverEntriesRebuild()` finishes a stranded
         copy: if the copy already ran, the live `entries` table wins; if it
         never ran, the stranded rows are merged in.
Where:   `src/lib/db/client.ts` — `migrate`, `rebuildEntriesTable`,
         `recoverEntriesRebuild`
Verify:  `tests/db-recovery.test.ts` (stranded copy finishes; a post-crash
         diary is merged; the live table wins when ids overlap; the day
         index is restored).

### SEC-PER-04 — Write lock is taken up front
Status:  verified
Track:   PER
Threat:  A deferred `BEGIN` lets two writers read the same snapshot and
         fail late, after the handler has done work.
Control: `transaction()` uses `BEGIN IMMEDIATE`, rejects an async callback
         (which would commit before the promise settles), and preserves the
         original error when SQLite has already rolled back.
Where:   `src/lib/db/client.ts` — `transaction`
Verify:  `tests/db-recovery.test.ts` → `transaction` (busy under a competing
         writer, async callback rejected, original error surfaced).

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
Control: `npx tsc --noEmit` and `npm test` (66 files, 691 tests at this
         commit).
Where:   `tests/`
Verify:  Run both before every commit.
