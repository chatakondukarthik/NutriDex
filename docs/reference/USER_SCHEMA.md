# NutriPlan — Identity and profiles (design only)

**Status:** Design only. The app is single-user today, and D-048 fixes the
shape of any future account: identity is optional, holds no content, and is
represented by `meta.account_id`. This document records that seam and the
multi-user design we deliberately rejected, so neither is reopened by
accident.

## Current state

Everything hangs off a single implicit row: `profile.id = 'local'`, one plan
per week, entries with no owner. There is no `users` table and no `owner_id`
column. `meta.account_id` exists and is `NULL` until an identity provider is
wired in (P3, optional).

## The seam

- **Content stays local.** Profile, diary, recipes, plans, captured foods and
  evidence live only in the SQLite file.
- **Identity holds no content.** At most an opaque `account_id` and an email
  in the provider's `auth.users`.
- **The app is fully usable signed out, forever.** A paused or deleted
  identity project must never make local data unreachable.
- **Profiles are filters, not a privacy boundary.** One OS account owns every
  row; a profile is a label on rows that account already owns. No code path
  may treat a profile as an authorization check (`SEC-GOV-02`).
- **Multi-device is the archive** (D-047): export on A, import on B. Later,
  an encrypted archive in the user's own storage — not our database.

## Rejected: a `users` table and `owner_id` on every table

Before D-048, the parked plan was to add a local `users` table and scope every
owned table by `user_id`. That design is rejected for v1 because:

- in a single-tenant file it adds a join to every query and buys no security;
- it invites a false "profile isolation" claim;
- it duplicates what the archive already provides for multi-device.

It would only make sense if the product ever becomes a hosted, multi-tenant
service — which is out of scope by design.

## If accounts are built (P3)

1. Add Supabase auth-only behind a config flag; magic link, no content table.
2. Store the provider's opaque id in `meta.account_id`. Never store an email
   or name locally.
3. Keep every feature available signed out; the account only enables
   optional multi-device workflows.
4. Removing the account clears `meta.account_id` and touches nothing else.

## What not to change

- The 18-nutrient model, block model, pinned versions and provenance rules
  are user-agnostic. Do not touch them.
- Theme/settings stay per-browser (cookies) even with an account.
- Seed food ids are part of the archive contract; they may only change with a
  migration (see `DATA-MODEL.md`).
