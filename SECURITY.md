# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security finding.

- Use GitHub's private reporting: **Security → Report a vulnerability** on
  this repository (GitHub Security Advisories), or
- Open a *draft* security advisory at
  `https://github.com/chatakondukarthik/NutriDex/security/advisories/new`.

Include what you did, what you expected, the affected route or file, and a
reproduction. You should get an acknowledgement within a few days. If a fix
is needed, it lands here before any disclosure.

## Supported versions

This is a personal, local-first application, not a hosted service. There are
no tagged releases yet; the `main` branch is the only supported line. Fix
your checkout by pulling `main`.

## Scope

**In scope:** anything in this repository — the Next.js app, the request
gate, server actions, the service worker, the AI key handling, the build and
deploy configuration.

**Out of scope:**

- **The deployment you put in front of it.** NutriPlan has no login by
  design; the boundary is whatever you stand in front of it (reverse proxy
  auth, VPN, `NUTRIPLAN_GATE=token`). A finding that amounts to "there is
  no authentication" is documented behaviour, not a bug — see
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- **The OS account boundary.** A process running as the same user can read
  `0600` files. That is the modelled trust boundary, recorded as R2 in
  [`docs/security/RESIDUAL-RISKS.md`](docs/security/RESIDUAL-RISKS.md).
- **Dependency advisories** already published against packages in
  `package-lock.json`, unless they are reachable in this code.
- **Social engineering, physical access, and lost/stolen devices** — disk
  encryption (FileVault/LUKS/BitLocker) is the mitigation, recorded as R1.

## Threat model and tracking

The full asset inventory, trust boundaries and controls live in
[`docs/security/THREAT-MODEL.md`](docs/security/THREAT-MODEL.md). Known
accepted risks with expiry dates are in
[`docs/security/RESIDUAL-RISKS.md`](docs/security/RESIDUAL-RISKS.md), the
control tracker in [`docs/security/TRACKER.md`](docs/security/TRACKER.md),
and the ASVS mapping in
[`docs/security/ASVS-MAPPING.md`](docs/security/ASVS-MAPPING.md). Incident
steps are in [`docs/security/RUNBOOK.md`](docs/security/RUNBOOK.md).

Start there before reporting — your finding may already be recorded as an
accepted risk with a stated reason and revisit date.

## Repository hygiene

The public history contains two SQLite sidecar files
(`data/nutriplan.sqlite-wal` and `-shm`) from the first two commits. They were
removed from the working tree in `625729f` and are now git-ignored. Their
contents were inspected before publication: schema DDL for the `entries`
table only — no rows, no keys, no tokens. They are left in history rather
than rewriting published commits, because the information they carry is
already public in `src/lib/db/`. No other env, key, or database file has ever
been committed.

Commits made before 2026-11-19 carry local author identities
(`karthik@localhost`, `karthik@Karthiks-MacBook.local`). They are historical
metadata, not credentials.

## Design commitments worth knowing

- **Local-first and private.** No telemetry, no analytics, no accounts, no
  server-side session. The app talks only to itself and to AI/food-data
  providers you configure.
- **No secrets in this repository.** `.env.example` holds placeholders only;
  real keys live in `.env*` (git-ignored) or `data/secrets.json` (mode 0600,
  git-ignored). Provider keys are bound to the host they were entered for,
  so changing a base URL cannot silently exfiltrate them — see the header of
  [`src/lib/ai/secrets.ts`](src/lib/ai/secrets.ts).
- **Errors never reach the browser.** Responses are fixed sentences; paths,
  keys and provider bodies are redacted from logs
  (`src/lib/security/errors.ts`).
- **The service worker only caches.** It serves a static shell and hashed
  assets, never injects code and never caches authenticated responses — see
  [`public/sw.js`](public/sw.js).
