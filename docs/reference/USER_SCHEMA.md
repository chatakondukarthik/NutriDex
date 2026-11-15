# NutriPlan — User & Profile Schema (parked, not built)

**Status:** Design only. The app is single-user today. This document is the
minimal change set needed to support accounts and multiple profiles later,
so the current schema does not paint us into a corner.

## Current state
Everything hangs off a single implicit row: `profile.id = 'local'`, one plan
per week, entries with no owner. There is no `users` table.

## Minimal change set

### 1. Add a `users` table
```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE,
  name        TEXT,
  created_at  TEXT NOT NULL,
  archived_at TEXT
);
```

### 2. Make `profile` per-user
- Add `user_id TEXT NOT NULL REFERENCES users(id)` to `profile`.
- Change PK from `id` to `(user_id, id)` or add a surrogate PK and keep
  `id = 'local'` as the default profile name.
- One user may have multiple profiles (e.g. "cutting", "maintenance") —
  the profile row already represents one person's numbers, so a `label`
  column is enough: `label TEXT NOT NULL DEFAULT 'default'`.

### 3. Scope every owned table by `user_id`
Add `user_id TEXT NOT NULL REFERENCES users(id)` to:
- `entries`
- `recipes`
- `plans`
- `captured_foods`
- `ai_calls` (optional; keep for transparency)

Add an index on `(user_id, ...)` for each.

### 4. Plans and entries
- `plans` already has `starts_on UNIQUE`. Change to `UNIQUE (user_id, starts_on)`.
- `plan_entries` is reached through `plans`, so scoping `plans` is enough.

### 5. Recipes
- `recipes.user_id` scopes ownership. `current_version_id` stays.
- Shared/public recipes are out of scope for v1; if needed later, add a
  `visibility TEXT` column.

### 6. Secrets
- Keys currently live in `data/secrets.json` (mode 0600). For multi-user,
  move to a `user_secrets` table encrypted at rest, or keep BYOK per user
  in their browser's secure storage. Recommend: keep BYOK, store encrypted
  per user in the DB, never in plaintext.

### 7. Migration strategy
- Add the column nullable first, backfill `user_id = 'local-user'` for
  existing rows, then make it NOT NULL.
- Create the implicit `local-user` row on first boot so existing installs
  keep working.

## What NOT to change
- The 18-nutrient model, block model, pinned versions, and provenance rules
  are user-agnostic. Do not touch them.
- Theme/settings can stay per-browser (cookies) even with accounts.

## When to do this
Only when accounts are actually being built. Until then, the single
`'local'` row is correct and the cost of the migration is one ALTER per
table.
