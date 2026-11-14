# NutriPlan — Stack

**Status:** Implemented for S0–S1
**Decision:** D-027

---

## What runs it

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 26 | Ships `node:sqlite`, so no native dependency |
| Framework | Next.js 16 (App Router, Turbopack) | Server components keep the engine on the server; server actions remove most API boilerplate |
| UI | React 19 + Tailwind 4 | No component library yet; the design is small enough to hand-build |
| Language | TypeScript, strict | The nutrition model is the product; types are the cheapest tests |
| Database | SQLite via `node:sqlite` | Zero setup for a walking skeleton |
| Tests | Vitest | Fast, no DOM needed for the engine |
| Deploy | Vercel (planned) | Later; SQLite is local-only |

## Why SQLite now

The plan recommended Postgres. For a skeleton, a database service is friction
with no payoff: it needs an account, a connection string, and a migration
pipeline before the first page renders.

`node:sqlite` is built into Node 26. It is synchronous, which is fine for a
single-user local app, and it means a clean checkout runs with `npm install &&
npm run dev`.

The cost is that it does not deploy to Vercel. That is acceptable and
deliberate: deployment is an S4 concern, and the migration is contained.

## The migration path

`src/lib/db/client.ts` and `src/lib/db/entries.ts` are the only files that know
SQLite exists. Moving to Postgres means:

1. Replace `node:sqlite` with `pg` or Drizzle's Postgres driver.
2. Convert `?` placeholders to `$1` style.
3. Move the schema to a migration tool.
4. Everything above the repository layer is unchanged.

No ORM is used on purpose. With one table, an ORM is pure overhead, and the
queries are the documentation.

## Why the engine has no dependencies

`src/lib/nutrition/` imports nothing but its own types. No database, no
framework, no network.

This is the single most important structural choice in the repo. The engine is
the part most likely to be wrong and the part that must stay testable in
isolation. It can be lifted into a worker, a CLI, a Python service's reference
implementation, or a benchmark harness without touching a line.

## When a second runtime arrives

The estimation service and evaluation harness (D-019) are natural Python
deliverables. They arrive with AI in P2, behind an HTTP boundary. The MVP
deliberately has one runtime.

## Commands

```bash
npm run dev        # local dev server
npm run build      # production build
npm test           # engine + repo tests
npm run typecheck  # tsc --noEmit
```

## Constraints to respect

- `node:sqlite` is server-only. Never import it from a client component.
- Anything in `src/lib/db/` must stay out of client bundles.
- The engine must not gain an I/O dependency.
