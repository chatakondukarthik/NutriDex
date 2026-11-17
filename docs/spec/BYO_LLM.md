# Bring-your-own LLM — specification

**Status:** Proposed (design, not committed)
**Date:** 2026-11-15
**Relates to:** D-009, D-016, D-019, D-028, D-034, D-035, D-036, D-037, D-038
**Research:** [`research/notes/2026-11-15-fud-ai-and-llm-providers.md`](../research/notes/2026-11-15-fud-ai-and-llm-providers.md)
**Consumed by:** [`INGREDIENT_CAPTURE.md`](INGREDIENT_CAPTURE.md) S6.3 and S6.4

---

## 1. Problem

Ingredient capture needs a model for two jobs: reading a label, and turning a
sentence into structured food lines. The product also wants AI adjustments
(D-016) and, later, a coach. All of it needs a provider, a model and a key.

Three constraints shape the design:

1. **The user owns the key.** "Google api or openai or anthropic and select the
   model" — provider and model are user choices, not build-time constants.
2. **The key must never reach the browser.** A web app cannot call a provider
   directly without shipping the secret to the client.
3. **AI is required but must not be a single point of failure** (D-019). Every
   AI-assisted step needs a defined non-AI outcome.

---

## 2. Decisions

### D-035 — The server is the only client of a provider

All provider calls go through Next server code. The browser sends
`{ provider, model, capability, payload }` to a server action; the server adds
the key and makes the call. The key is never in a client bundle, a cookie, a
server-action argument, a log line or the database.

Consequence: the browser cannot tell whether a key is configured except by the
settings UI reporting it. That is correct — the presence of a secret is not
information the client needs.

### D-034 — The model proposes, the engine disposes

A model response is a **proposal**, never a result. Every number it returns is
re-derived: quantities go through `toGrams`, nutrient values are rebuilt from a
food record or explicitly marked `estimated`, and any value the model invented
for a nutrient the record does not know is discarded, not stored.

Consequence: a hallucinated "312 kcal" cannot become a stored value. The worst
a model can do is propose a wrong *food*, which the review screen catches.

### D-036 — A provider is an adapter, not a branch

```ts
interface ProviderAdapter {
  readonly id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
  listModels(): Promise<ModelInfo[]>;
}
```

Gemini, OpenAI, Anthropic and OpenAI-compatible are four adapters behind one
interface. Adding a provider is a new file and a row, never a change to the
capture flow.

### D-037 — The prompt is a contract

Every call sends a JSON schema and asks for JSON. The schema lives in the repo,
is versioned with the code, and is tested against a fake provider. Temperature
is 0 for extraction. No prompt contains user data beyond what the feature needs.

---

## 3. What the model is allowed to return

```ts
interface FoodProposal {
  name: string;              // free text, matched later
  quantity?: { amount: number; unit: string };
  preparation?: string;
  per100g?: Partial<Record<NutrientCode, number>>;
  basis?: "per_100g" | "per_serving" | "per_pack";
  servingSizeG?: number;
  confidence?: number;       // ignored (D-016)
  rationale?: string;        // shown to the user, not trusted
}
```

Hard rules:

- **No food id from the model.** It returns a name; `resolve` matches it against
  the food list by name and alias, and a non-match becomes a provisional food.
  A model cannot address a record it does not know.
- **No nutrient the record does not know.** If the matched food has
  `Vit B12 = unknown` and the model supplies 0.4 µg, that value is discarded and
  the nutrient stays `unknown`. This is D-009 applied literally.
- **No confidence is used as confidence.** It is echoed back for the audit trail
  and otherwise ignored. Real confidence comes from evidence quality (§6).
- **Unknown fields stay absent.** The schema is not total; `{}` is a valid
  response meaning "nothing usable".

---

## 4. Provider set

v1 ships four adapters. The rest are later and cheap once the interface holds.

| Provider | API style | Vision | JSON schema | Notes |
|---|---|---|---|---|
| Google Gemini | Gemini API | Yes | `responseSchema` | Free tier is the onboarding path |
| OpenAI | OpenAI | Yes | `response_format: json_schema` | Widest model choice |
| Anthropic Claude | Messages | Yes | tool use | Strong instruction following |
| Custom OpenAI-compatible | OpenAI | Usually | `response_format` | Groq, Together, OpenRouter, Ollama, Mistral, DeepInfra, Fireworks, Cerebras, Qwen, DeepSeek |

Ollama matters: it is the only path that needs no key and no network, which is
the graceful-degradation answer (D-019) for a user who has no key at all.

---

## 5. Where the key lives

| Option | Verdict |
|---|---|
| Environment variable | Yes, for deployment. `NUTRIPLAN_AI_<PROVIDER>_KEY` |
| `data/secrets.json`, mode `0600`, gitignored | Yes, for local use |
| SQLite | **No.** A database export or backup would carry the key |
| Cookie / localStorage / client bundle | **No.** Never |
| A settings field in the `profile` row | **No.** Same reason as SQLite |

Loading order: environment first, then the file. A key present in both is an
error, not a silent precedence, so a stale file cannot override a deployment
secret. The settings UI shows "configured" or "not configured" and never the
value; the field is a password input with autocomplete off.

Secrets file additions to `.gitignore`:

```
data/secrets.json
data/evidence/
```

---

## 6. Model selection and settings

`/settings/ai`, one card per provider plus a defaults card.

```
┌──────────────────────────────────────────────┐
│  AI access                                   │
│                                              │
│  Provider   [ Google Gemini          ▾ ]     │
│  Model      [ Gemini 3.5 Flash-Lite  ▾ ] [↻] │
│  Key        [ •••••••••••• ]  Test  Remove  │
│            Configured · 1 call in the last   │
│            30 days · 4.2 k tokens             │
│                                              │
│  Fallback  [ None                    ▾ ]     │
│  Capture   [ Ask each time           ▾ ]     │
│                                              │
│  [ Save ]                                    │
└──────────────────────────────────────────────┘
```

- The **model list is fetched from the provider**, not hardcoded, because
  hardcoded model names rot (Fud AI's own defaults moved from GPT-5.4 Mini to
  newer models within a year). A cached list with a refresh button is the
  fallback when the fetch fails.
- **Test** makes one cheap call and reports latency and token use. It is the
  only way to know a key works, and it is required before a provider can be
  made the default.
- **Fallback** is a second provider used when the first fails transiently.
- **Capture** decides whether a capture asks which provider to use or uses the
  default. Default: use the default.

### 6.1 Rules

- One default provider. One optional fallback.
- A model that does not support JSON schemas cannot be selected for extraction.
- A model that does not support vision cannot be selected for label or photo
  capture.
- The UI shows capabilities as facts, not as disabled options with no reason.

---

## 7. Resilience

| Failure | Behaviour |
|---|---|
| 429 / 500 / 502 / 503 / 529 | Retry with 1 s / 2 s / 4 s backoff, then fall back |
| Timeout (30 s) | Abort, report "the provider took too long", offer retry |
| Invalid JSON | One repair attempt with the schema repeated, then fail |
| Schema violation | Discard the invalid fields, keep the valid ones, flag review |
| Key missing | Never call. The capture sheet says "add a key in Settings" with a link |
| Key rejected (401) | Clear message: the key is not valid for this provider |
| Everything failed | The non-AI path. Manual entry is always available (D-019) |

No retry budget is imposed on the user's explicit retry button.

---

## 8. Cost and abuse guardrails

A single local user is not a denial-of-service risk, but a runaway loop is.

- **Per-call token ceiling**, enforced server-side.
- **Image limits**: max 10 images, max 5 MB each, downscaled to ~1600 px on the
  long edge before upload.
- **A daily call cap**, configurable, default generous. Reaching it is a normal
  message, not an error.
- **A concurrency limit of 1** for capture, so two tabs cannot double-spend.
- **A call log** in the database: provider, model, capability, tokens, latency,
  status, error. This is the transparency the settings card shows and the data
  the eval harness reads.
- **A failed test or model list is diagnosable without the key.** Settings shows
  the provider's HTTP status and its own explanation (redacted and bounded), a
  category (`http`, `timeout`, `network`, `config`), and a copy button for one
  line containing the action, provider, model, host and message. Redaction
  happens before that line is built, so it is safe to send to a developer.

---

## 9. Prompt and data minimisation

- A prompt contains: the task, the schema, the food list **names and aliases
  only** (no nutrient data — the model does not need it and it is not ours to
  send), and the user's text or OCR text.
- Images are sent only to the provider the user selected, only for the capture
  the user started.
- Raw responses and OCR text are stored with the food record as evidence
  (INGREDIENT_CAPTURE §7 rule 7) and are not sent anywhere else.
- **Prompt injection is treated as data corruption, not instruction.** Model
  output is parsed, schema-validated, and then resolved against our own records.
  Nothing it says can change control flow, request a different food id, or
  suppress the review step.
- No user data is used to train a model. That is a provider-side setting the
  user controls; we state it on `/about`.

---

## 10. Evaluation harness

### D-038 — Model quality is judged by a harness, not by unit tests

A unit test can prove the parser and the resolver are correct; it cannot prove
the model read a label correctly. Model quality gets its own harness: a golden
set of inputs with expected structured output, a runner, and an agreed error
budget. The deterministic part (parse, validate, resolve) is unit-tested with a
fake adapter replaying recorded responses.

**Consequence:** "the AI works" is never a claim without a number. A provider or
prompt change that moves the score is visible before it ships.

---

Unit tests cannot judge model quality. A separate harness does.

```
eval/
  cases/           # YAML or JSON: input + expected structured output
  run.ts           # runs every case against a provider, prints a report
  score.ts         # compares to expected, writes a markdown table
```

A case:

```yaml
id: label-milk-half
kind: label
image: fixtures/milk-label.jpg
expect:
  - name: Milk, whole
    per100g: { ENERC_KCAL: 61, PROCNT: 3.2, FAT: 3.3, CHOCDF: 4.8 }
    basis: per_100g
```

- **Golden cases** cover: a clean label, a per-serving label, a blurry label, a
  label with no nutrition panel, an unknown food, an ambiguous sentence, and a
  sentence with three foods.
- **Error budget**: a release candidate may not drop below an agreed accuracy on
  the golden set. The number is set after the first baseline run, not guessed.
- **Deterministic tests** use a fake adapter replaying recorded responses. The
  harness with a live provider is a separate, opt-in script.

---

## 11. Security checklist

- [x] No key in a client bundle. Verified by `tests/bundle-boundary.test.ts`,
      which follows the client import graph and refuses any reachable module
      that reads a key, `process.env`, the filesystem or a node builtin.
- [ ] No key in a log line, an error message, or a call-log row.
- [ ] No key in the database.
- [ ] Custom base URLs are validated: `https:`, no private/link-local ranges,
      no credentials in the URL.
- [ ] Request timeouts on every outbound call.
- [ ] Response size capped before parsing.
- [ ] Image uploads validated by MIME and magic bytes, not by extension.
- [ ] A failed call never leaves a half-written food record (the existing
      `transaction()` helper).
- [ ] The settings page is server-rendered and never ships the key to the
      client, even masked.

---

## 12. Acceptance criteria

- [ ] A user can add a key for Gemini, OpenAI or Anthropic and select a model
      from the provider's own list.
- [ ] A user can configure a fallback and a custom OpenAI-compatible endpoint.
- [ ] A user can remove a key, and after removal no call is attempted.
- [ ] The browser never receives a key; a build-time test proves it.
- [ ] A label capture and a text capture both produce a schema-valid proposal
      that `resolve` accepts.
- [ ] A model-proposed nutrient for a nutrient the record does not know is
      discarded, and the nutrient stays `unknown`.
- [ ] A model-proposed food id is impossible; only names are returned.
- [ ] A transient provider failure retries and then falls back without user
      action.
- [ ] With no key configured, every AI-assisted step offers a non-AI path.
- [ ] The call log is readable in settings and exportable.
- [ ] The eval harness runs in CI against a fake adapter and locally against a
      real provider.

---

## 13. Non-goals

- Hosted AI, proxies, or a NutriPlan-run model. The user brings the key.
- A chat coach over the diary. It uses the same plumbing but is its own slice.
- Automatic background calls. Every model call is started by a user action.
- Fine-tuning or embeddings. Out of scope indefinitely.
- Sending nutrient data to a provider. The model gets names and the user's text
  or image, never our database.

---

## 14. Slices

| Slice | Appetite | Done when |
|---|---|---|
| **S7.1 Plumbing** | 1 week | Provider adapters, key storage, settings UI, one text call, call log, build-time key test, fake-adapter tests |
| **S7.2 Resilience** | 3 days | Backoff, fallback, timeout, repair attempt, non-AI degradation |
| **S7.3 Evaluation** | 3 days | Golden set, harness, baseline score, CI job against the fake adapter |
| **S7.4 Vision** | 3 days | Image limits, downscale, label capture wired to a vision model |

S7.1 is a prerequisite for capture S6.3 and S6.4.

---

## 15. Open questions

1. **Gemini vs OpenAI vs Anthropic defaults.** Which is the onboarding default
   for a free key? Gemini's free tier is the obvious answer, but it should be a
   decision, not an accident.
2. **Custom endpoint allow-list.** How strict? Recommendation: HTTPS only, no
   private ranges, and a warning for any non-well-known host.
3. **Call log retention.** 30 days? Forever? Needs a rule.
4. **What the coach sends.** Deferred, but the boundary should be designed now
   so it is not retrofitted.
5. **Whether Ollama counts as a first-class provider.** It is the only offline
   path and the strongest privacy answer; recommending it costs nothing.
