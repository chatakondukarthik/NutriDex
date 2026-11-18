# Household mode — design and implementation plan

**Status:** Accepted design; implementation in progress.
**Decision:** D-051 (households are trusted; people are convenience scopes).
**Baseline:** `1b847cd`; 68 test files / 729 tests.
**Scope:** one installation = one household; 3+ people; shared recipes and foods;
per-person diary, plans, body profile, targets and default amounts.

This document is the ground truth for the household-mode build. If code and
this document disagree, one of them is wrong; fix it in the same commit.

---

## 1. What household mode is

- **One installation is one household.** A second household is a second
  installation, data directory, OS user or device. There is no in-app
  household switcher and no cloud sync.
- **People are filters, not a privacy boundary.** Anyone at the device can
  switch people and see all household data. There is no per-person login,
  PIN or authorization check.
- **The shared library is household content.** Seed foods, captured foods,
  nutrients, portions, evidence, recipes, versions, blocks, ingredient lines
  and user retention overrides are shared by everyone.
- **Personal data is per person.** Body profile, target rules/thresholds,
  diary entries, weekly plans, plan entries and default amount pins belong to
  one person.
- **AI is household-wide in V1.** One enabled flag, one provider/model
  configuration, one key set, one master prompt, one daily cap, one call log
  and one estimate cache.
- **No shared meal planning.** A recipe is not automatically added to anyone
  else's plan or diary. Each person adds what they ate from the shared
  library. "Cook once" is a permanent non-goal, not a deferred feature.
- **Deletion and export are scope-aware.** Personal data can be deleted or
  exported for one person; shared content is deleted or exported as a
  library. A whole-household operation says so explicitly.

---

## 2. Why the current model cannot be extended by adding a label

The single-user assumption is concentrated in a few load-bearing places:

| Place | Current shape | Household consequence |
|---|---|---|
| `profile` | one row, `id = 'local'` | one profile per person |
| `entries` | no owner column; `entries_day_idx(day, created_at)` | needs `person_id`, index `(person_id, day, created_at)` |
| `plans` | `starts_on TEXT NOT NULL UNIQUE` | one plan per person per week; `UNIQUE(person_id, starts_on)` |
| `food_default_amounts` | `PRIMARY KEY(food_id)` | pins per person; `PRIMARY KEY(person_id, food_id)` |
| `target_rules` | one JSON row in `app_settings` | per person |
| `purge` | table-wide deletes; `profile WHERE id = 'local'` | scope picker; person-attributed blockers |
| archive | format v1, 15 tables, no person dimension | format v2 with `household`, `person`, `shared` scopes |
| tests | fixtures insert `'local'` and ownerless rows | fixtures need a person |

A fresh `owner_id` on every table would repeat the single-user design with
more joins. The model below adds a person only where a row is genuinely
personal, and keeps the shared library owner-agnostic.

---

## 3. Locked decisions

| Area | Decision |
|---|---|
| Household unit | One installation = one household. Separate households use separate installations/data directories. |
| Person ids | UUIDs, including the migrated first person. `'local'` is migration input only. |
| Roster | `households` + `people`; `people.archived_at` for deactivation. |
| Profile | Keep the `profile` table; `profile.id` is the person id. `people` holds identity. |
| Plans | Per person, one plan per week. Same week for different people is allowed. |
| Pins | Per person: `(person_id, food_id)`. |
| Targets | Per person in `person_settings` (`target_rules`). |
| Master prompt | Household-wide in `app_settings`. |
| AI | Entire layer household-wide in V1. No per-person keys, prompts, caps or attribution. |
| Archive | Format v2, scopes `household` / `person` / `shared`; scope-filtered replace; v1 imports as one person. |
| Person scope contents | The person's rows **plus the whole shared library**, so the archive is self-contained. It never includes another person's rows. |
| v1 replace | Allowed only when the household has one person; otherwise refuse and recommend merge. |
| Deletion | Person scope: diary, plans, profile reset, defaults, target rules. Household scope: recipes, foods, retention/preferences, AI. Person removal is a separate People action. |
| Shared blockers | Any person's references block shared deletion, with person-attributed counts. Never cascade. |
| Active person | Opaque cookie `np_person`, resolved server-side and validated against `people`. No client-supplied id is authoritative. |
| Person removal | Deactivate by default; hard delete separate; the last person cannot be removed. |
| Migration | One transactional migration with an automatic pre-migration `VACUUM INTO` snapshot. |
| `target_energy_kcal` | Wire the existing column into `getProfile`/`saveProfile`; it is currently silently dropped. |
| Fresh install | Boot creates one household and one person (`Me`); first-run renames. |
| Drafts | Food drafts in `localStorage` are keyed by person id. Theme and sheet columns stay per browser. |
| Privacy escalation | Separate OS users or encrypted vaults. Never a PIN over the shared database. |

---

## 4. Schema

### 4.1 New tables

```sql
CREATE TABLE households (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT 'Household',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE people (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  archived_at  TEXT
);

CREATE TABLE person_settings (
  person_id  TEXT NOT NULL REFERENCES people(id),
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (person_id, key)
);

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

`schema_migrations` is internal, never exported, and never writable by an
import. `meta` stays installation-level (`account_id`, `created_at`).

### 4.2 Changed tables

```sql
-- entries
person_id TEXT NOT NULL REFERENCES people(id)
CREATE INDEX entries_person_day_idx ON entries (person_id, day, created_at);

-- plans
person_id TEXT NOT NULL REFERENCES people(id)
UNIQUE (person_id, starts_on)

-- food_default_amounts
person_id TEXT NOT NULL REFERENCES people(id)
PRIMARY KEY (person_id, food_id)

-- profile
-- unchanged columns; profile.id is the person id
```

`plan_entries` does **not** get a `person_id` in V1. It belongs to a plan, and
`plans.person_id` is the single source of truth. Queries join through `plans`.
If a later feature needs a denormalized column, it must be backfilled from
`plans` and kept consistent at write time.

`app_settings` keeps only household settings:
`ai_master_prompt`. `target_rules` moves to `person_settings`.

`captured_foods.created_by` is provenance only. New captures use the active
person id; existing `'local'` values are treated as "original installer" and
backfilled during migration. It is never an authorization check.

`ai_calls` is unchanged in V1. There is no person attribution.

### 4.3 Shared vs personal

| Shared (`household` content) | Personal (`person` content) |
|---|---|
| `recipes`, `recipe_versions`, `components`, `component_inputs` | `profile` |
| `captured_foods`, `captured_food_nutrients`, `captured_food_portions` | `entries` |
| `retention_factors` (`origin = 'user'`) | `plans`, `plan_entries` |
| `app_settings.ai_master_prompt` | `food_default_amounts` |
| `estimate_cache`, `ai_calls` (operational) | `person_settings.target_rules` |

`households`, `people`, `meta` and `schema_migrations` are installation-level.

---

## 5. Active person

### 5.1 Resolution

`src/lib/person-server.ts`:

- `getActivePerson(): Person` — reads the `np_person` cookie, validates it
  against `people` where `archived_at IS NULL`, and falls back to the first
  active person. If none exists, boot has failed its invariant; create a
  default person rather than crash.
- `requireActivePerson(): Person` — same, but throws a user-facing error if
  the roster is empty.
- `setActivePersonCookie(personId)` — sets an opaque id, `path=/`,
  `sameSite=lax`, non-HttpOnly, one year. It is not a credential.

Server components and server actions call this. A client never supplies an
authoritative person id.

### 5.2 Stale-action detection

Forms may carry an **expected** person id (`expectedPersonId`) for staleness
detection. The server resolves the active person first; if the expected id is
present and differs, the action refuses with:

> You switched people. Review this form and submit it again.

The expected id is never used to authorize or to choose a person.

### 5.3 Switching

`switchPersonAction(personId)` validates the id, sets the cookie, calls
`revalidatePath("/", "layout")`, and returns. The client calls
`router.refresh()`. Any open dialog closes or reloads under the new person.

A long-running AI action captures the person id at start and completes or
fails as that person. It must not silently land as someone else.

---

## 6. Migration

### 6.1 Preflight and snapshot

When the household migration is pending:

1. Detect a stranded `entries_v1` / rebuild table.
2. Create `nutriplan.sqlite.pre-household-<timestamp>.sqlite` with
   `VACUUM INTO`, mode `0600`. Keep it on success and failure.
3. If person columns exist but the `schema_migrations` marker is absent,
   refuse to boot with a clear instruction to restore the snapshot.
4. `PRAGMA foreign_keys=OFF` **before** `BEGIN`; required for the `plans` and
   `entries` rebuilds.

### 6.2 Transaction order

```
BEGIN IMMEDIATE
  create households, people, person_settings, schema_migrations
  insert household (UUID)
  insert person (UUID), using the existing profile as its body
  update profile.id from 'local' to the person UUID
  move app_settings.target_rules -> person_settings(person_id, 'target_rules')
  rebuild entries   (person_id NOT NULL, index)
  rebuild plans     (person_id NOT NULL, UNIQUE(person_id, starts_on))
  rebuild food_default_amounts (person_id, food_id) PK
  update captured_foods.created_by 'local' -> person UUID
  PRAGMA foreign_key_check
  insert schema_migrations(1)
COMMIT
PRAGMA foreign_keys=ON
```

Every step is guarded by `PRAGMA table_info`/object existence and is
idempotent. DDL is transactional, so a crash rolls back. The existing
`entries_v1` recovery is preserved and runs in the same outer transaction.

The `plans` rebuild preserves plan ids so `plan_entries` survive. The
`entries` rebuild must extend the existing `rebuildEntriesTable` rather than
bypass it: its early return on the new shape would otherwise skip the person
column.

### 6.3 Fresh install and empty roster

- Fresh install: boot creates one household and one person named `Me`.
- First run renames that person and fills the body profile.
- Upgrade: the existing person is named `Me`; a one-time banner offers a
  rename. Never silently rename user data.
- If `people` is empty but content exists, refuse person-scoped writes and
  offer restore/repair. If the database is empty, create a person.
- `target_energy_kcal` is read and written by `getProfile`/`saveProfile`.

### 6.4 Rollback

Any migration exception: `ROLLBACK`, log a clear message, refuse to boot,
point at the snapshot. The snapshot is the rollback path; the rebuilds are
not individually reversible in place.

---

## 7. Database API changes

All person-scoped functions take an explicit `personId`. No ambient global.

| Module | New signatures |
|---|---|
| `db/people.ts` | `listPeople(includeArchived?)`, `getPerson(id)`, `createPerson(input)`, `updatePerson(id, patch)`, `archivePerson(id)`, `deletePerson(id)`, `ensureHousehold()`, `defaultPersonId()` |
| `db/entries.ts` | `listEntries(personId, day)`, `addEntry(personId, input)`, `addRecipeEntry(personId, input)`, `removeEntry(personId, id)`, `countEntriesForRecipe(versionIds)` (household-wide) |
| `db/plan.ts` | `getPlan(personId, startsOn)`, `getOrCreatePlan(personId, startsOn)`, `listPlanEntries(planId)`, `getPlanForPerson(personId, planId)`, `addPlanEntry(personId, input)`, `updatePlanEntryQuantity(personId, id, patch)`, `movePlanEntry(personId, id, dest)`, `removePlanEntry(personId, id)` |
| `db/profile.ts` | `getProfile(personId)`, `saveProfile(personId, profile)`; include `targetEnergyKcal` |
| `db/settings.ts` | `getTargetRules(personId)`, `setTargetRules(personId, rules)`, `resetTargetRules(personId)`; master prompt unchanged |
| `db/defaults.ts` | `getFoodDefaultPin(personId, foodId)`, `setFoodDefaultPin(personId, foodId, pin)`, `lastUsedAmountFor(personId, foodId)`, `resolveDefaultAmount(personId, foodId)` |
| `db/foods.ts` | `saveCapturedFood(input, createdBy?)` |
| `db/purge.ts` | `getPurgePreview(scope, personId?)`, `purgeData(scope, personId, categories)` |
| `archive/export.ts` | `buildArchive({ scope, personId, includeAiCalls, includeSnapshot })` |
| `archive/import.ts` | `applyArchive(parsed, { mode, dryRun, targetPersonId? })` |

`countEntriesForRecipe` and recipe/food reference counts stay household-wide:
shared content deletion must see every person's references.

---

## 8. Archive v2

### 8.1 Format

`ARCHIVE_FORMAT = "nutriplan.archive"`, `ARCHIVE_FORMAT_VERSION = 2`.
`isSupportedFormat` accepts 1..2. A v1 build refuses v2 loudly.

New registry entries, in FK-safe order:

```
households, people, profile, recipes, recipe_versions, components,
component_inputs, plans, plan_entries, entries, captured_foods,
captured_food_nutrients, captured_food_portions, food_default_amounts,
person_settings, retention_factors, app_settings, ai_calls
```

`person_settings` is exported with a `where` that keeps only keys this build
restores (`target_rules`). `app_settings` keeps only `ai_master_prompt`.
`retention_factors` keeps `origin='user'` and omits `origin`.

Manifest additions:

```ts
scope: "household" | "person" | "shared";
householdId: string;
personId: string | null;
includes: {
  aiCalls: boolean;
  snapshot: boolean;
  secrets: false;
};
```

### 8.2 Scopes

| Scope | Tables |
|---|---|
| `household` | all tables, all people, all shared content |
| `person` | `households` (the current row), `people` (one person), `profile` (one), that person's `plans`, `plan_entries`, `entries`, `food_default_amounts`, `person_settings`, **all shared tables and evidence** |
| `shared` | shared tables and evidence only; no `households`, `people`, `profile`, personal tables |

The person scope includes the whole shared library rather than a referenced
subgraph. It is self-contained, has no FK edge cases, and the library is
household-shared — not another person's private data. It must never include
another person's profile, diary, plans, pins or target rules.

### 8.3 Export

`GET /api/export?scope=household|person|shared&person=<id>&ai=1&snapshot=0`

- `household` is the default.
- `person` defaults to the active person; an explicit `person` must be a
  member.
- `snapshot.sqlite` is included only for `household` (it contains everyone).
  Person and shared exports omit it.
- `ai_calls` remains opt-in; `estimate_cache` and secrets never travel.
- The README is generated per scope and states exactly who is included.
- Evidence is copied for the shared rows in the archive.

### 8.4 Import

Merge stays the same: insert-if-absent by PK; differing row = conflict; no
timestamp comparison. Plans conflict on `(person_id, starts_on)`.

Replace is scope-filtered:

| Archive scope | Replace deletes | Then inserts |
|---|---|---|
| `person` | that person's `profile`, `plans`/`plan_entries`, `entries`, `food_default_amounts`, `person_settings` | all archive rows; shared rows are merged (insert-if-absent), not deleted |
| `shared` | shared tables only | all archive rows; people/personal rows untouched |
| `household` | all tables in the registry | all archive rows |

A person-scope replace never deletes shared rows and never touches another
person. A shared-scope replace never touches people. A household-scope
replace is the current full wipe.

Evidence rewrite-by-value is allowed only for `shared` and `household`
scopes. A person-scope import must not rename or repoint another person's
rows.

### 8.5 v1 archives

A v1 archive has no scope and no people.

- Choose `targetPersonId`: active person by default, or an explicit
  `assignTo`.
- Rewrite `profile.id`, `plans.person_id`, `entries.person_id`,
  `food_default_amounts.person_id` and `person_settings.person_id` to the
  target person before applying.
- `target_rules` from `app_settings` goes to the target person's
  `person_settings`.
- Merge behaves like today, scoped to that person and the shared library.
- Replace is allowed only when the household has exactly one person;
  otherwise refuse with: "This archive predates household support. Merge it,
  or restore it on a single-person installation."
- Required-column validation uses the archive format version, not only the
  live schema, so new NOT NULL columns do not make v1 archives invalid.

A v2 archive imported by a v1 build is refused by the format check. No lossy
down-export is built.

### 8.6 Multiple households

- A household archive restored into another installation merges as distinct
  people and library rows. There is no identity unification by name or email.
- A person archive moves one person to another installation as a new person.
- A shared archive grafts a library into an existing household.
- Import is never called "sync". Merge adds; replace destroys.

---

## 9. Purge

### 9.1 Scopes and categories

| Scope | Categories |
|---|---|
| `person` | `diary`, `plans`, `profile` (reset body/targets), `defaults`, `preferences` (that person's `target_rules`) |
| `household` | `recipes`, `foods`, `preferences` (master prompt + retention overrides), `ai` |

`profile` in person scope deletes that person's body row; recommended targets
fall back to the example profile. Removing the person is a separate People
action, not a purge category.

### 9.2 Blockers

- Shared food/recipe deletion is blocked by any person's diary, plan or
  recipe references. Counts stay household-wide.
- Blockers are person-attributed: "Used by Priya's diary (12), Rahul's plans
  (3)." A blocker the actor cannot resolve is not presented as "select that
  category too".
- The preview and the purge run the same queries. The purge re-checks inside
  `BEGIN IMMEDIATE`.
- Selecting your own diary does not satisfy another person's reference.

### 9.3 Files, retention, AI

- Evidence unlink and the orphan sweep run only for household `foods`
  deletion. Person purge never touches files.
- Retention reseeding runs only after household preference deletion.
- AI log/cache deletion is household-wide.
- `meta`, seed foods, seed retention factors, AI config and keys are never
  purged by category.

### 9.4 Person removal

`deletePerson(personId)`:

- Refuses the last active person.
- Deletes that person's `profile`, `entries`, `plans`/`plan_entries`,
  `food_default_amounts`, `person_settings`, then the `people` row.
- Leaves shared recipes/foods and evidence.
- Requires a two-step acknowledgement in the UI, with counts and an archive
  offer.
- If the deleted person was active, the next active person becomes active and
  the UI refreshes.

---

## 10. AI

V1 keeps the whole AI layer household-wide:

- `ai-config.json`, `secrets.json`, provider/model/base URLs, image model,
  enabled flag and daily cap.
- `ai_master_prompt` in `app_settings`.
- `ai_calls` and `estimate_cache`.
- Image capture, nutrient estimation and recipe generation write to shared
  foods/recipes.

Prompt construction receives only the active person's profile and targets.
It must never include another person's body data.

Deferred: per-person keys/models/prompts/caps, per-person AI logs, AI coaching
over diary data.

---

## 11. UX

### 11.1 Header switcher

- A compact chip in the header's first row, before theme and settings.
- Shows the active person's initial and name.
- Opens a menu of active people with the current one checked, plus
  "Manage people…".
- Mobile: compact chip in row 1; the menu is an anchored dropdown on every
  size, anchored to the trailing edge so it stays inside small viewports. No
  separate sheet in V1.
- Accessibility: menu button with `aria-haspopup`/`aria-expanded`,
  `aria-current` on the active person, Escape closes and restores focus,
  visible text not colour alone.

### 11.2 Settings → People

- List active and archived people.
- Add person: name, body fields, optional "copy targets from…".
- Rename.
- Deactivate / reactivate.
- Hard delete: two-step, counts, archive offer; last person blocked.
- Copy says profiles are not private and shared data is used by the
  household.

### 11.3 Screens

| Screen | Change |
|---|---|
| `/` | active person's diary, targets, bars, empty state |
| `/plan` | active person's week; copy day/week stays in that person |
| `/profile` | active person's body profile |
| `/settings` | People panel; target rules labeled per person; AI/theme/export stay household/browser-wide |
| Header | person switcher |
| Data deletion | scope picker; person-attributed blockers |
| Data portability | scope picker; person export picker; scope-aware warnings |

### 11.4 Copy

- "Profiles are not private. Anyone on this device can switch people and see
  all household data."
- "Shared foods and recipes are used by everyone in the household."
- "This archive contains every person in this household."
- "Replace deletes this household's people, diaries, recipes and plans
  first."
- "Archives from before household support import as a single person."
- "The AI key and daily limit are shared by the household."

---

## 12. Security invariants

1. Active person is resolved server-side from an opaque cookie and validated
   against `people`. No client-supplied id is authoritative.
2. Forms may carry an expected person id for stale-action detection only; a
   mismatch refuses the action.
3. No person secret in any cookie or storage. The cookie is an id.
4. Switching invalidates server-rendered person scope and the client router
   cache.
5. Destructive and AI-spending actions state whom they act for.
6. Export and purge copy are honest about scope.
7. Shared AI budget is documented as shared.
8. No `owner_id`-style authorization check. Person ids are filters.
9. `meta.account_id` remains installation-level.
10. A plan entry is restored only when its plan is in the archive. A
    household merge re-keys a plan id that already exists here for another
    person, so a merged entry cannot attach to someone else's week.

Accepted risks: household members can read/change/delete each other's data;
shared AI quota can be exhausted by one person; misattribution after a switch;
whole-install archive exposure; purge blast radius; no audit trail; logical
deletion is not secure erase.

Not acceptable: per-person PINs presented as privacy, hidden profiles over
the same database, per-person encryption with a short secret, treating the
gate/CSRF/localhost binding as household privacy, or claiming isolation from
person ids.

If privacy is ever required: separate OS users or encrypted per-person
vaults with a recovery story.

---

## 13. Testing

### 13.1 Existing suites to keep green

All current test files must pass and new ones join them. Files with fixtures
that need a person:

- `archive.test.ts`, `restore-fresh.test.ts`, `purge.test.ts`
- `data-integrity.test.ts`, `db-recovery.test.ts`
- `repo.test.ts`, `plan-repo.test.ts`, `actions.test.ts`
- `foods-db.test.ts`, `legacy-convert.test.ts`, `recipe-versions.test.ts`
- `targets.test.ts`, `profile.test.ts`
- component tests that render person-scoped props

### 13.2 New coverage

Migration:

- upgrade preserves ids/counts/hashes;
- same week for two people allowed; same person duplicate rejected;
- same food pinned by two people;
- target rules moved exactly once;
- legacy `entries_v1` + household in one boot;
- crash at each rebuild boundary;
- ambiguous state refuses;
- second boot is byte-stable;
- fresh install creates one person;
- empty roster behavior;
- `foreign_key_check` empty.

Scoping:

- A/B isolation for entries, plans, profile, targets, pins;
- cross-person plan/entry ids rejected;
- recipes/foods usable by both;
- forged/stale/archived active person cannot read or write another person.

Archive:

- v1 -> v2 mapping;
- household round trip;
- person round trip on a fresh directory;
- shared graft;
- two-person merge;
- foreign-household merge;
- scope-filtered replace;
- v1 replace refusal in multi-person households;
- manifest scope tampering;
- evidence rewrite boundaries;
- snapshot scope.

Purge:

- per-person categories leave the other person intact;
- shared deletion blocked by another person's references;
- household delete all;
- last-person guard;
- retention reseed only household.

AI:

- global cap and cache;
- generation writes the active person only;
- prompts exclude other people's body data.

---

## 14. Implementation phases

1. **Documentation and decision record.**
   This file, D-051, index entry.
2. **Migration framework and snapshot.**
   No user-visible schema change; `db-recovery`/`data-integrity` green.
3. **Schema and people spine.**
   `households`, `people`, `person_settings`; profile re-key; rebuilds;
   boot ensure-person.
4. **Scoped repositories.**
   Entries, plans, profile, settings, defaults, foods; explicit person args.
5. **Active person and UI.**
   Cookie resolver, header switcher, People settings, first-run, page
   plumbing.
6. **Archive v2.**
   Scopes, manifest, export, import, v1 mapping, evidence, snapshot.
7. **Purge v2.**
   Scope picker, person categories, household categories, blockers,
   person removal, test migration.
8. **AI and security pass.**
   Prompt scoping, active-person attribution, invariants, docs.
9. **Full verification.**
   `tsc --noEmit`, `npm test`, `npm run build`, archive/manual restore.

---

## 15. Non-goals

- Per-person AI configuration or attribution in V1.
- Shared meal planning / "cook once" propagation.
- Cloud sync, accounts, invites, roles or permissions.
- Per-person PINs or privacy guarantees inside the installation.
- Per-person themes, evidence libraries or shopping lists.
- Identity unification when merging households.
- A lossy household -> v1 archive exporter.
- Secure erase beyond SQL `DELETE`.
