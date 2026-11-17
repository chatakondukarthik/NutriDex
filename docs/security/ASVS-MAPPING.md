# ASVS mapping

Target: **OWASP ASVS 5.0 Level 1 baseline**, plus Level 2 for the chapters
that matter to a local-first app that stores health data and posts to a
user-supplied LLM endpoint: **V3 (Web Frontend Security), V5 (File Handling),
V11 (Cryptography), V13 (Configuration), V14 (Data Protection), V15 (Secure
Coding and Architecture)**.

This is a working map, not a certification. A row is `met` only when the
control is implemented and testable in this repo. `N/A` means the requirement
depends on a hosted multi-user design the product does not have.

## V1 — Encoding and sanitization

| Requirement | Status | Evidence |
|---|---|---|
| Output is context-encoded; no raw HTML injection | met | React text nodes only; no `dangerouslySetInnerHTML` in `src/` |
| Untrusted data is not interpreted as code | met | `asData` escapes `&`, `<`, `>` in `src/lib/ai/prompt.ts` |
| CSV/formula injection is not introduced into exports | met | The archive is ZIP + NDJSON; rows are `JSON.stringify`-encoded, never written into a spreadsheet context. The legacy CSV importer is covered by `SEC-INP-04`/`SEC-INP-08`. |

## V2 — Validation and business logic

| Requirement | Status | Evidence |
|---|---|---|
| All input is validated on the server | met | Every action in `src/app/actions.ts` validates its own inputs; graph, recipe and captured-food shapes have dedicated validators |
| Numeric bounds are enforced | met | grams, servings, image bytes, graph nodes/edges/outputs, recipe blocks/inputs, plan steps |
| Business-logic limits are enforced server-side | met | AI daily cap, per-minute buckets, unique-ingredient cap |
| Anti-automation controls exist for expensive operations | met | `src/lib/security/rate-limit.ts`, `aiThrottle` |

## V3 — Web frontend security (L2)

| Requirement | Status | Evidence |
|---|---|---|
| CSP restricts script sources | met | nonce-based CSP in `src/proxy.ts`; dev policy in `next.config.ts` |
| `frame-ancestors 'none'` | met | `src/proxy.ts` |
| `X-Content-Type-Options: nosniff` | met | `next.config.ts`, gate 403 response |
| Cross-site request forgery is prevented | met | `isCrossSiteMutation` rejects `none`/`same-site`/`cross-site`, mismatched origins and non-default ports; Next's action origin check runs after it |
| Host header is validated | met | `src/lib/security/gate.ts` |
| Referrer policy is restrictive | met | `next.config.ts` |

## V4 — API and web service

| Requirement | Status | Evidence |
|---|---|---|
| No unnecessary HTTP methods are exposed | met | Next route handlers; gate checks mutations |
| Health endpoint leaks no data | met | `src/app/api/health/route.ts` returns `{ ok }` |
| Rate limits exist | met | in-process buckets for AI, USDA, OFF |

## V5 — File handling (L2)

| Requirement | Status | Evidence |
|---|---|---|
| Uploaded file type is validated by content | met | magic-byte sniff in `extractFoodAction` |
| Upload size is bounded | met | 5 MB/image, 12 MB total, 10 images |
| Path traversal is not possible | met | No user-supplied path reaches `fs`; `dataDir` is fixed |
| Imported text is bounded | met | 400k chars, 50k rows, 50 errors |
| Temporary files are private | met | `atomicWritePrivateFile` uses random `wx` temp files, `0600`, short-write/fsync, cleanup on failure; fault-tested |

## V6 — Authentication

| Requirement | Status | Evidence |
|---|---|---|
| Authentication exists where required | N/A | Single local user by design; OS account is the boundary |
| Credential storage is resistant to offline cracking | N/A | No app password; if `SEC-LCK-01` is added: Argon2id/scrypt |

## V7 — Session management

| Requirement | Status | Evidence |
|---|---|---|
| Session tokens are protected | N/A | No server session; optional lock would use an in-memory token |
| Session timeout | N/A | Same |

## V8 — Authorization

| Requirement | Status | Evidence |
|---|---|---|
| Access control is enforced server-side | N/A | Single user; profiles are filters, not a boundary (`SEC-GOV-02`) |
| IDOR is prevented | N/A | No cross-user objects exist |

## V11 — Cryptography (L2)

| Requirement | Status | Evidence |
|---|---|---|
| Approved algorithms only | met | `node:crypto` only; no custom crypto |
| No secrets in source or logs | met | `redact` in `src/lib/security/errors.ts`; keys in `secrets.json` or env |
| Random values use a CSPRNG | met | `crypto.randomUUID`, `randomBytes` in docs |
| Secrets are not stored in plaintext where encryption is expected | partial | Keys are `0600` but not encrypted; relies on OS/volume encryption (`SEC-DAT-05`) |

## V12 — Secure communication

| Requirement | Status | Evidence |
|---|---|---|
| TLS is used for outbound calls | met | `https:` required by `assertOutboundUrl` (local opt-in only) |
| Certificate validation is not disabled | met | No `rejectUnauthorized: false` |
| Inbound TLS | N/A | Local loopback; a deployment puts TLS in front |

## V13 — Configuration (L2)

| Requirement | Status | Evidence |
|---|---|---|
| Secure defaults | met | gate defaults to `local`; unknown mode fails closed |
| Debug mode is off in production | met | `NODE_ENV` drives CSP and dev-only paths |
| Security headers are set | met | `next.config.ts`, `src/proxy.ts` |
| Secrets are separated from code | met | env vars or `data/secrets.json` |
| Unnecessary features are disabled | met | no admin, no sessions, no upload directory |

## V14 — Data protection (L2)

| Requirement | Status | Evidence |
|---|---|---|
| Sensitive data is protected at rest | partial | `0700`/`0600`; encryption delegated to the OS (`SEC-DAT-05`) |
| Sensitive data is not cached inappropriately | met | `cache-control: no-store` on gate responses |
| Data is not leaked in error messages | met | `publicError` returns fixed sentences; details are logged |
| Data can be exported | met | `SEC-EXP-01`: complete archive from `src/lib/archive/export.ts`; round-trip test in `tests/archive.test.ts` |
| Data can be deleted | met | `SEC-DAT-06`: category-scoped preview and delete in `src/lib/db/purge.ts`, refusal on dangling references, evidence cleanup after commit; `tests/purge.test.ts`, `tests/components/data-deletion.test.tsx` |

## V15 — Secure coding and architecture (L2)

| Requirement | Status | Evidence |
|---|---|---|
| Trust boundaries are documented | met | `docs/security/THREAT-MODEL.md` |
| Security controls are centralized | met | gate, URL validation, private files, rate limits, secrets |
| Dependencies are current | met | `next@16.4.6`; clean `npm audit` (`SEC-SUP-01`) |
| No known vulnerable components | met | `npm audit` clean at time of writing |
| Security tests exist | met | 691 tests, including gate, origin, URL, key-binding, client-bundle boundary, file-fault, graph-validation, archive round-trip and DB-recovery suites |

## V16 — Security logging and error handling

| Requirement | Status | Evidence |
|---|---|---|
| Errors do not expose internals to the client | met | `publicError` / `redact` |
| Security events are logged without secrets | partial | gate mode logs once; no audit log by design |
| Log injection is prevented | met | structured messages, no user text in log prefixes |

## V17 — WebRTC

N/A. No WebRTC.

## Deferred / accepted

| Item | Reason |
|---|---|
| App passphrase lock (`SEC-LCK-01`) | Optional; OS account is the primary boundary |
| Encryption at rest (`SEC-DAT-05`) | `node:sqlite` cannot use SQLCipher; OS/volume encryption is the answer |
| Audit logging | Not useful for a single local user; adds cost and a new data store |
| Multi-tenant authZ | Out of scope by design |
