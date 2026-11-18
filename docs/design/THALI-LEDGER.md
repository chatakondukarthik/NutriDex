# The Thali Ledger — NutriPlan design system

Codename: **The Thali Ledger** · Status: v0.1 (first vertical slice — Diary + shell) · Dark-first

> The household's nutrition ledger: a record kept with the material warmth of a South Indian
> kitchen — brass, clay, spice tins, and warm parchment — and the discipline of a ledger.
> Numbers here are *record*, not analytics. The thali (the meal plate) is the brand's
> master shape: it appears as the macro ring, the favicon motif, and the loading state.

---

## 1. Thesis

1. **Ledger first, chrome second.** Every screen is a page in a running household record.
   Data is the content; the frame recedes.
2. **Hand-made, not home-made.** Tooling feels like an instrument, not a toy. Springs
   feel like weight, not bounce; VFX marks *earned* moments only.
3. **One warm world.** Parchment/ink/saffron, always. Nothing cool, nothing clinical,
   nothing candy-like. Dark is the night kitchen; light is the morning pantry.
4. **Satisfying to log.** Every action answers with a micro-gesture. The diary is not
   a form; it is the act of *serving* yourself a measured plate.
5. **Family-safe.** Deep, warm, calm — readable by a child, dignified for a grandparent,
   never childish. Motion never startles; celebrations never demand attention.
6. **Old Malayalam home, modern kitchen.** Depth comes from warm shadows, grain and
   thali geometry — never from glass-blur frosting or neon.

Anti-goals: anime bounty language (that is Bingo Book's world), tracker coldness,
enterprise density, emoji-as-icon, gradients-as-content.

## 2. Non-negotiable principles

- All colours are tokens. Components never write a hex.
- All motion is transform/opacity/stroke-drawing. Never width/height animation on load-bearing layout.
- Every interactive element has `cursor-pointer`, a press response (`:active` transform), and a visible focus ring.
- `prefers-reduced-motion` and `data-motion="off"` both honoured everywhere, always.
- One orchestrated moment per view. Micro-motion everywhere else.
- 375 px first. Nothing overflows, nothing hides under hover-only affordances.

## 3. Palette

### 3.1 Dark ("Night Kitchen") — default tuning

| Token | OKLCH | Hex (approx) | Use |
|---|---|---|---|
| `--canvas` | 0.158 0.017 55 | #1C1510 | page canvas — warm black, never #000 |
| `--surface` | 0.205 0.019 55 | #241C16 | card/panel body |
| `--surface-2` | 0.248 0.021 55 | #2D241C | raised / hover / inputs |
| `--line` | 0.318 0.023 57 | #3A2F24 | hairline border |
| `--line-strong` | 0.43 0.03 57 | #524332 | strong border, focus hover |
| `--ink` | 0.935 0.023 75 | #EFE4D0 | warm parchment text |
| `--muted` | 0.72 0.03 70 | #ABA08D | secondary text |
| `--faint` | 0.575 0.03 65 | #86796A | tertiary text, icons |
| `--accent` | 0.77 0.145 72 | #DCA142 | saffron — brand, CTA |
| `--accent-strong` | 0.83 0.14 75 | #E9B454 | accent hover |
| `--accent-ink` | 0.24 0.055 55 | #3A2A12 | text on saffron fill |
| `--gold` | 0.86 0.15 88 | #EDCB66 | earned-only: goal hit, streak |
| `--ember` | 0.6 0.155 36 | #C4531F | sparks, ember VFX |
| `--leaf` | 0.7 0.13 150 | #5FA873 | success / balanced |
| `--warn` | 0.8 0.135 78 | #D9A03C | caution (warm) |
| `--warn-soft` / `--warn-line` / `--warn-ink` | | | soft caution surfaces |
| `--danger` | 0.68 0.17 27 | #CE5A44 | error / destructive |
| `--danger-soft` / `--danger-line` / `--danger-ink` | | | soft danger surfaces |

### 3.2 Light ("Morning Pantry")

| Token | OKLCH | approx | Use |
|---|---|---|---|
| `--canvas` | 0.965 0.011 78 | #F5EEE0 | warm paper canvas |
| `--surface` | 0.995 0.006 85 | #FCFAF4 | card body |
| `--surface-2` | 0.935 0.013 75 | #ECE3D4 | raised / hover |
| `--line` | 0.885 0.013 72 | #DCD1C0 | hairline |
| `--line-strong` | 0.78 0.018 68 | #C3B4A0 | strong |
| `--ink` | 0.26 0.03 60 | #2E2419 | dark brown ink |
| `--muted` | 0.48 0.03 65 | #6E6151 | secondary |
| `--faint` | 0.62 0.03 63 | #8D8070 | tertiary |
| `--accent` | 0.55 0.125 60 | #96611F | deep saffron (contrast ≥ 4.5 on paper) |
| `--accent-strong` | 0.47 0.125 58 | #7F5218 | hover |
| `--accent-ink` | 0.99 0.003 85 | #FDFBF6 | text on deep saffron |
| `--gold` | 0.6 0.13 75 | #8A6A1A | earned, on paper |
| `--ember` | 0.52 0.15 36 | #96402A | ember |
| `--leaf` | 0.45 0.11 150 | #3D6B4A | success |

Accents (`data-accent`) keep the same names (`forest | ocean | plum | ember`) — they remap
`--accent-*` only; the warm world stays warm. New mapping: forest→peepal green, ocean→deep peacock teal, plum→mulberry, ember→chili.

### 3.3 Reserved

`--gold` is *never* used for interactive affordance. It means earned (goal closed, streak).

## 4. Type

| Role | Face | Notes |
|---|---|---|
| Display / headings | **Fraunces** (variable: `opsz`, `SOFT`) | 500–600; tight tracking (-0.02em); the "kitchen serif" |
| Body | **Instrument Sans** | 400/500/600; warm grotesque, set 15–16 px/1.55 |
| Ledger numerals | **Space Mono** | 400/700; ALL stats, kcal, percentages, chip microcopy-adjacent figures |

Scale (px): 12 · 13 (caption floor) · 15 (body) · 17 · 20 · 24 · 32 (page title) · 40 (hero numerals) · 56 (dossier).
Display uses Fraunces 560 weight with `opsz` above 28 auto-emphasis via `font-variation-settings`.
Line lengths ≤ 72 ch. All numerals `tabular-nums`.

## 5. Layout & depth

- App shell: sticky header, content max-width 1080 px, 20 px gutters (16 on 375 px).
- Depth ladder (dark): canvas → surface → surface-2; elevation = 1 px warm hairline + a warm
  shadow `0 18px 40px -18px oklch(0.05 0.02 55 / 0.55)`, never blur-frosted glass.
- **Grain**: fixed SVG `feTurbulence` overlay at 3.5 % opacity, `mix-blend-mode: overlay`.
- **Thali ring**: macro-progress rings have plate-thick arcs `stroke-width: 7` with round caps,
  saffron arc over a hairline track, subtle inner shadow — the plate motif.
- **Halftone** (celebration surfaces only): `radial-gradient(circle, ink 0.9px, transparent 1.1px) 7px 7px` at low opacity.
- Radius: `control` 0.625rem · `card` 1rem · `plate` 999px.
- Shadows: warm hues only. No pure-black elevation shadows.

## 6. Motion

```css
--spring-snap: 520 34;      /* micro — buttons, toggles */
--spring-settle: 260 26;    /* sheets, dialogs, reveals */
--spring-drop: 330 22;      /* food falls into the diary */
--ease-emphasis: cubic-bezier(0.2, 0, 0, 1);
--ease-swipe: cubic-bezier(0.22, 1, 0.36, 1);
--dur-micro: 140ms; --dur-quick: 220ms; --dur-move: 380ms; --dur-page: 480ms;
```

Vocabulary, app-wide:

| Gesture | Feel |
|---|---|
| Press any button/chip/row | scale(0.96→1) spring `snap`, 140 ms, slight saffron bloom on release |
| Page enter | 12 px rise + fade, 380 ms `ease-emphasis` (existing PageTransition) |
| Add food to diary | the added row **drops in** (`spring-drop`, y -26 → 0) with a short saffron flash line, then the new row wears a transient "fresh" hatch for 2 s |
| Delete entry | row squashes (scaleY 0.92) and fades out over 160 ms — never teleports |
| Save anywhere meaningful (food save, recipe save) | **ink stamp**: rotated rounded-check draws in via stroke-dashoffset + haptic-ish double tap |
| Macro ring closes to 100 % | plate tilt (rotate 2°), arc springs to full, ember spark burst (canvas, ≤ 24 particles, 900 ms), `--gold` numerals |
| Streak milestone (7/30/100 days) | one ember burst + the streak chip glows once — then still |
| Switch person | cross-fade with 8 px shared blur — feels like the same kitchen, another cook |
| Empty states | gentle inhale/exhale of the illustration (2.6 s loop, transform-only, disabled under reduced motion) |
| Skeletons | shimmer passes like spice dust (keep incumbent `.skeleton`, renamed feel) |
| Dialogs | spring-settle scale from 0.96 + scrim fade; Escape and Cancel always work |
| Recipe save success | stamp + the version number ticks (Space Mono odometer, 480 ms) |

Restraint rules: no sound without matching motion; no gold without an earn; no burst twice
for the same cause per day; never block input waiting for an animation.

## 7. Sound (opt-in, default ON at low gain)

Web Audio, synthesized. Master gain 0.15. Setting: Settings → Motion & sound → “Sound
effects”. Honours `data-motion="off"`? No — sound has its own toggle; reduced-motion does
not mute sound (user may want sound with no visual motion).

| Token | Sound | When |
|---|---|---|
| `tick` | 1.6 kHz sine blip, 40 ms, fast decay | food selected, unit changed |
| `stamp` | filtered noise thump + 330 Hz triad, 150 ms | save committed |
| `spark` | 2.1 kHz + harmonic, 300 ms shimmer-ish | goal hit, streak |
| `thud` | 90 Hz sine drop, 180 ms | error/rejected action |
| `switch` | 800 Hz soft blip, 60 ms | person switch |

## 8. Iconography & ornament

- Incumbent geometric line set stays; new icons drawn to the same 24 px grid, 1.6 stroke, rounded caps.
- Phosphor **Fill** weights only for earned/celebration states (check-burst, streak medallion), ~10 icons.
- Ornaments: hairline rule with a centred thali glyph (`◉` no—drawn SVG `thali-divider`), corner ticks on the dossier.
- No emoji in chrome. One-off tasteful ✶ ✦ may appear *inside* illustrations only.

## 9. Satisfaction map (action → response)

| User action | System response |
|---|---|
| Open app | header wordmark settles; page rise-in |
| Add food/recipe to diary | row drops in + tick + transient fresh-hatch; totals count up (odometer) |
| Log crosses 100 % of an energy target | thali tilt + ring close + ember burst + Space Mono flips to gold (once per day) |
| Remove entry | squash-fade |
| Save food/recipe | ink stamp on the trigger button |
| AI fill completes | values bloom in sequentially (30 ms stagger, opacity only) |
| Estimate saved with 0 values | thud + message (never silent) |
| Switch person | kitchen cross-fade; diary re-drops (stagger 30 ms) |
| Toggle theme/accent | instant swap; sun/moon morph (kept) |
| Archive export completes | stamp + file name slides in |
| Delete data | thud; progress steps |
| Empty state first ever load | inhale illustration + one line + one CTA |

## 10. Surfaces & phases

**Phase 0 (this slice)** — shell restyle, Diary restyle + motion, sound system, this doc, `ThaliRing`, `StampCheck`, `Odometer`, `SparkBurst`.
**Phase 1** — foods/recipes cards + favorites shelf (dock hover), recipe detail as "plate card".
**Phase 2** — Profile → **Kitchen Dossier**: plate-monogram portrait, signature numerals (days logged · protein hit-rate · streak), plate-signature radar (macros), The Line-Up (six signature dishes), year-strip of eating history, tally-style stats.
**Phase 3** — Plan (week board as ledger grid), Settings restyle, About/Glossary.
**Phase 4** — polish sweep: responsive audit at 375/768/1440, contrast pass, motion audit, reduced-motion pass, performance trace.

## 11. Sketches

### 11.1 Diary (after)

```
┌─ NutriPlan ───────────────────────────────────────────────┐
│  [N] Diary  Plan  Recipes  Foods  Profile  ⚙  [Karthik ∨] │  ← warm ink bar, spring pill nav
├───────────────────────────────────────────────────────────┤
│  Thursday, 13 Nov                          [date picker]  │  ← Fraunces title
│  ┌───────────────────────────────────────────────────┐    │
│  │  ◯  1,742 of 2,200 kcal                            │    │  ← THALI RING (plate arc)
│  │     458 under · leaf-green “balanced”               │    │    Space Mono numerals
│  │     ▓▓▓▓▓▓▓▓░░  macros  P 96 · C 214 · F 41        │    │
│  └───────────────────────────────────────────────────┘    │
│  [ Find a food ⋮  (foods|recipes ⌕)  search…          ]   │
│   results as spice-tin rows (name · category · kcal)      │
│  ┌─ Today's plate ───────────────────────────────────┐    │
│  │  08:15  Idli × 3                     340 kcal  ✕  │    │  ← rows drop in on add
│  │  13:05  Sambar rice                620 kcal  ✕    │    │    Space Mono numerals
│  └───────────────────────────────────────┬───────────┘    │
│  Saved totals · 3 entries · coverage per nutrient          │  ← muted ledger footnote
└───────────────────────────────────────────────────────────┘
```

### 11.2 Dossier (Phase 2 gesture)

```
┌────────────────┐  ┌───────────────────────────────────────┐
│  ◉ plate mono  │  │  SIGNATURE (all Space Mono)           │
│  KARTHIK       │  │  214 days logged · 78% protein hit    │
│  HOME CHEF     │  │  streak 17 · usual: pesarattu (34×)   │
│                │  ├───────────────────────────────────────┤
│  plate-radar   │  │  THE LINE-UP (six signature dishes)   │
│  P/C/F/fiber   │  │  skewed recipe cards, dock hover      │
│                │  ├───────────────────────────────────────┤
│  ───────────   │  │  YEAR IN A PLATE — stacked strip      │
│  gold tally    │  │  month-by-month colour blocks         │
└────────────────┘  └───────────────────────────────────────┘
```

## 12. Guardrails

- Contrast ≥ 4.5 body / 3 headings on both themes; focus ring always visible.
- 60 fps: transforms/stroke-dashoffset only; canvas particles ≤ 24, lifetime ≤ 900 ms.
- Reduced motion: everything fades to ≤ 1 ms; no canvas; no tilt.
- Budget: `gsap` ≈ 48 KB gz + `@tsparticles/slim` ≈ 95 KB gz, both behind dynamic import.
- No new runtime features; this is presentation + feel. Data, routes, actions unchanged.

## 13. The restraint gate (Emil Kowalski)

Every proposed animation must pass, in order. No exceptions for "it would look cool."

1. **Frequency** — 100+/day (keyboard) → never animate. Tens/day → near-imperceptible only
   (fast, subtle). Occasional → standard animation. Rare/first-time → the delight budget lives here.
2. **Purpose** — one of: Feedback · Spatial consistency · State indication ·
   Preventing a jarring change · Explanation (marketing only) · Delight (rare tier only).
3. **Speed** — press 100–160 ms · popovers 125–200 · dropdowns 150–250 · modals 200–500 ·
   anything else in UI < 300 ms.
4. **Function** — decoration on functional, information-dense UI hinders. Data the user is
   reading should not move for style.

Mechanics: transform/opacity only (clip-path for hold-to-confirm, measured height for accordions are
the documented exceptions); reduced-motion = gentler, never zero; hover only behind
`@media (hover: hover) and (pointer: fine)`; more than one orchestrated moment per view is a smell.
