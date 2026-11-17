# Portability and identity — 2026-11-17

**Question:** How should a local-first app split online identity from local
content, and what should a total export look like?

**Outcome:** D-047 (one archive, two representations) and D-048 (identity is
optional and holds no content). Implementation: S11.

---

## What comparable products do

| Product | Content | Identity | Export |
|---|---|---|---|
| Obsidian | A folder of Markdown + attachments | None | The folder *is* the export |
| Joplin | SQLite locally, optional sync | Optional account on a sync target | One archive of Markdown + resources |
| Actual Budget | SQLite locally, optional self-hosted sync server | Optional server account | The SQLite file / a server export |
| Standard Notes | Encrypted notes | Account required | Encrypted JSON |

The pattern is consistent: the products that survive are the ones whose export
is a *file the user can open without the app*. None of them put the content in
the identity provider.

## Local-first, briefly

Ink & Switch's local-first ideal has seven properties: fast, multi-device,
offline, collaboration, longevity, privacy, and user control. NutriDex already
has five. Multi-device and collaboration are the expensive ones, and both can
be served later by moving an encrypted file — not by hosting the data.

A cloud login does not protect the local SQLite file. If the laptop is
unlocked, signing in changes nothing. The local boundary remains the OS
account, an optional app passphrase, file modes, and disk encryption.

## Supabase, if an identity plane is added

- **Auth only.** `auth.users` holds an email and an id. `user_metadata` is
  user-editable and must never be used for authorization.
- **RLS** is only relevant if content is stored there. If no content is stored,
  there is nothing to protect with policies — the safest policy is no table.
- **Cost.** Free tier: 500 MB database, 50k MAU, 2 projects. **Projects pause
  after about a week of inactivity**; Pro starts at $25/month.
- **Consequence.** A required login on a paused project is an outage. The
  account must therefore be optional and additive, and the app must be fully
  usable signed out, forever.

## Archive formats

| Option | Strength | Weakness |
|---|---|---|
| Single JSON | Trivial to parse | Whole file in memory; images need base64; one error kills the file |
| SQLite snapshot (`VACUUM INTO`) | Exact, consistent, compact | Coupled to this schema; unsafe to import across versions; opaque |
| ZIP + NDJSON + files | Streamable, inspectable, partial recovery, images included | More code; needs a manifest to be trustworthy |

`VACUUM INTO` is the right tool for a *backup* and the wrong tool for an
*interchange format*. The chosen design keeps both, with one job each: NDJSON
is what the importer reads, the snapshot is a recovery copy it never reads.

## Portability principles applied

- **Machine-readable and documented** — NDJSON plus a manifest with a version,
  counts, columns and checksums.
- **Complete** — every user-owned table, including stored recipe snapshots and
  evidence images.
- **No lock-in** — the archive opens with `unzip` and any text editor.
- **No silent loss** — an unknown table is refused, a missing required column
  is an error, and an unknown column is reported rather than dropped quietly.
- **No silent overwrite** — merge reports conflicts; replace is explicit and
  requires a successful dry run.

## Sources

- Ink & Switch, *Local-first software* — https://www.inkandswitch.com/local-first/
- Supabase Auth — https://supabase.com/docs/guides/auth
- Supabase users and PII — https://supabase.com/docs/guides/auth/users
- Supabase RLS — https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase pricing and pausing — https://supabase.com/pricing
- SQLite `VACUUM INTO` — https://sqlite.org/lang_vacuum.html
- SQLite backup API — https://sqlite.org/backup.html
- Actual Budget docs — https://actualbudget.org/docs/
- Wikipedia, *Local-first software* — https://en.wikipedia.org/wiki/Local-first_software
