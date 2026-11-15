# Evaluation harness (S7.3)

Model quality is judged here, not in unit tests. Unit tests prove the parser
and resolver; this proves the model.

## Layout

- `cases/` — golden cases. Each file is JSON: `{ id, kind, input, expect }`.
- `run.ts` — runner. With `--fake` it replays recorded responses (deterministic,
  used in CI). Without `--fake` it calls the configured provider (opt-in, needs
  a key) and prints a score table.
- `score.ts` — compares actual vs expected, writes a markdown table.

## Status

The runner is not wired to a TypeScript entry point yet (no `tsx` in deps).
The deterministic half is covered by `tests/extraction.test.ts` and the
captured-food tests. The live half is a manual script until a runner is added.

## Running

```bash
# deterministic (CI)
npm test -- tests/extraction.test.ts

# live (needs a key in Settings)
# npm run eval
```
