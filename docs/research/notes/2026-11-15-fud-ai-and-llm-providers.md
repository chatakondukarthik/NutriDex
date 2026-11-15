# 2026-11-15 — Fud AI, food capture, and bring-your-own LLM

**Question:** What does a shipping, open-source, privacy-first calorie tracker do
for food capture and AI providers, and what should NutriPlan copy?

**Method:** Read the Fud AI repository README, its App Store and Play Store
listings, the fud-ai.app FAQ and privacy pages, and the blueprint's §17
integration notes. No code was run; the iOS/Android sources were not read line
by line.

---

## Findings

1. **Fud AI is real and MIT-licensed.** `github.com/apoorvdarshan/fud-ai`
   (535 stars, 119 forks at the time of writing), plus
   [fud-ai.app](https://fud-ai.app). Native iOS (SwiftUI) and Android (Compose),
   local-first storage, no account, no ads. The developer is a sole trader
   registered in India.

2. **Capture is a menu, not four products.** Camera (up to 10 photos for one
   combined analysis, plus an optional note), photo library (same), barcode,
   voice (six STT engines), text, manual entry, and saved meals. Every result
   lands on a **Review Food** screen before anything is logged, with editable
   grams, visible units, and "unlock nutrition to correct any value".

3. **Barcode is a lookup, not OCR.** It reads a barcode and pulls the product
   from **Open Food Facts**. Label text extraction is a separate path. This
   matches our own risk note in `docs/build/PLAN.md` (packaged-food data is the
   hard part) and confirms Open Food Facts is the pragmatic first source.

4. **The review screen is the trust mechanism.** "What if?" previews the effect
   on today's macros before logging; serving changes scale from the corrected
   values. This is the same shape as D-016's per-nutrient diff.

5. **BYOK is the default, not a fallback.** Sixteen providers: Google Gemini,
   OpenAI, Anthropic Claude, xAI Grok, OpenRouter, Together, Groq, Hugging
   Face, Fireworks, DeepInfra, Mistral, DeepSeek, Alibaba Qwen, Cerebras,
   Ollama (local), and any OpenAI-compatible endpoint. Model defaults are
   pinned per provider (e.g. Gemini 3.5 Flash-Lite, GPT-5.4 Mini, Claude
   Sonnet 5). Keys live in iOS Keychain / Android Keystore-backed
   `EncryptedSharedPreferences`; requests go **directly from the device** to
   the provider.

6. **Resilience is explicit.** Transient 429/503/529 retries with 1 s / 2 s /
   4 s exponential backoff; a configured fallback provider; on iOS, Apple
   Intelligence as a last-resort on-device fallback for text and photos.
   Failed image analysis offers retry without a retry budget.

7. **Its energy model matches ours.** Katch–McArdle when body fat is known,
   Mifflin–St Jeor otherwise, TDEE = BMR × activity, weekly adjustment =
   `kg × 7700 / 7`. That is independently the same call we made in D-031,
   which is weak but real validation.

8. **It does not solve our hard problem either.** Fud AI estimates a *meal*.
   It has no recipe block model, no pinned sub-ingredients, no yield basis, and
   no per-nutrient provenance that survives a recipe edit. The capture patterns
   are worth copying; the calculation model is not something it can teach us.

9. **Provider structured output is uniformly available.** Gemini exposes
   `responseSchema`, OpenAI `response_format: json_schema`, Anthropic tool use
   or structured output, and every OpenAI-compatible endpoint accepts a JSON
   schema. One adapter interface with per-provider request shaping is enough.

10. **The Health Connect bridge is still a bridge.** Fud AI can write meal
    nutrition, weight, body fat and calculated workout calories to Health
    Connect, and read steps and energy. That confirms the blueprint's §17
    direction but does not give us an API to call from a web app.

---

## What this changes

- Confirms the **review-before-save** pattern as the industry norm for AI
  capture, not a NutriPlan invention.
- Gives a concrete provider set and a proven key-handling model for the BYO LLM
  design (`spec/BYO_LLM.md`).
- Confirms Open Food Facts as the first barcode source, with a coverage question
  recorded as still open.
- Confirms our energy-model choice (D-031); no change.
- Does **not** change the recipe block model (D-021) or the pinned-version rules
  (D-018, D-024). Fud AI has no equivalent, so there is nothing to copy.

## Still open

- Open Food Facts coverage for Indian packaged foods and Indian-language labels.
- Whether a browser can call Gemini/OpenAI/Anthropic directly (CORS, key
  exposure) or needs a thin server proxy. The answer drives S7's shape.
- What a defensible golden dataset for the estimation eval looks like.
- Whether a camera capture can run fully client-side or must upload an image.
- Health Connect access from a web app still requires a companion native app.
