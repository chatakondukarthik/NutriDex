# USDA FoodData Central — how the app reads it

Reference for the people who change this integration. USDA FoodData Central
(FDC) is the largest US government food composition database. Its data is
**public domain** (17 USC 105). The app queries it live and never copies it
wholesale — what lands in the database is only the food the user imports,
with `source = 'usda'` and `source_code = String(fdcId)`.

## The key: `fdcId`

Every food in USDA has exactly one identifier, the **FDC ID** (`fdcId`,
a plain integer, e.g. `170567`). It identifies the *record*, not the food:

```
Nuts, almonds          SR Legacy     fdcId 170567   2019-04-01   ndb 12061
Nuts, almonds, blanched SR Legacy    fdcId 170568   2019-04-01   ndb 12062
```

These are **two different foods**. So are any two branded "ALMONDS" from
different manufacturers — the name is identical, `fdcId` is not. The app
treats `fdcId` as the only way to recognise "this exact USDA record";
`captured_foods.source_code` stores it verbatim. Never match USDA rows by
name, timestamp or nutrient equality.

## The four data types

`dataType` is the single most important field — it tells you what kind of
number you are about to eat.

| `dataType` | What it is | Quality | Use it for |
|---|---|---|---|
| `Foundation` | Research-grade, ≥50 measured attribute values, sample analysed in a lab, reviewed and documented | Highest | Single ingredients where it exists (energy, protein, minerals, moisture). Only a few thousand foods. |
| `SR Legacy` | The classic USDA SR database, frozen 2019-04-01 | High, generic reference | The workhorse: "Nuts, almonds", "Egg, whole", "Tomatoes". Broadest generic coverage. |
| `Survey (FNDDS)` | What We Eat in America — foods as actually eaten, incl. composite/prepared dishes | Moderate, average-of-recipes | Prepared dishes, "rice + dal + oil" style mixed entries the generic tables don't cover. |
| `Branded` | Manufacturer-submitted labels (Label Tru Other Name etc.) | Variable; nutrient source noted per-nutrient | The exact packaged product you are holding. Same name across brands; disambiguated by `brandOwner`/`brandName`/`gtinUpc`. |

Prefer Foundation → SR Legacy → FNDDS → Branded, in that order, unless you
literally own the branded product — in which case the branded row is right
because it describes *your package*.

## What distinguishes a row

Every field below appears in the search/detail responses and (where useful)
is rendered in the UI result rows, full detail behind the hover tooltip, and
is preserved in imports:

| Field | Type | Meaning |
|---|---|---|
| `fdcId` | int | Canonical identity. Always shown. |
| `dataType` | enum | Which table above; shown as a chip on every result row. |
| `description` | string | The official name, e.g. "Nuts, almonds, dry roasted, with salt". Branded rows often repeat one flat name ("ALMONDS"). |
| `foodCategory` | string | USDA food group, e.g. "Nut and Seed Products". |
| `ndbNumber` | string | SR Legacy's own id (e.g. `12061`). Legacy identifier, decorative only. |
| `foodCode` | string | FNDDS's own id (e.g. `11105010`). Decorative only. |
| `publishedDate` / `modifiedDate` | date (YYYY-MM-DD) | When the record was published/refreshed — this is the "date-wise" axis. Shown so a 1990-era value can be told apart from a 2022 one. |
| `brandOwner` / `brandName` | string | Who is behind a branded row, e.g. `Jo-Lee Food Products`, `STOCK & BARREL`. |
| `gtinUpc` | string | Barcode of a branded package, e.g. `064777841846` — lets you match a scanned barcode to a USDA row. |
| `ingredients` | string | Label ingredient list — the fastest way to check oil/salt state of a branded row. |
| `packageWeight` | string | Pack weight, e.g. `14 oz/397 g`. |
| `servingSize` / `servingSizeUnit` / `householdServingFullText` | number / string | Label serving unit (g per serving; "0.125 cup"). |
| `marketCountry` | string | Branded rows are almost always `United States`. USDA has no cuisine/region tags at all — see below. |
| `foodNutrients[]` | array | `nutrientId`, `nutrientNumber`, `nutrientName`, `unitName`, `value` — see mapping below. |
| `publicationDate` | date | See `publishedDate` — the search endpoint uses this name. |

## No region axis — honest answer

**USDA has no region or cuisine facet.** It is a US dataset; even FNDDS —
the survey branch — tags nothing as "Indian", "South East Asian" or
"Mediterranean". Branded rows carry `marketCountry: United States` by
almost always-constancy, not by filter.

Consequence: searching "almonds" will never surface "Kashmiri almonds"
(it may surface `Nuts, almonds` which is the generic reference you want,
or `ALMONDS` from 40 different brands). For Indian dishes, the app ships a
separate importer (`/foods/import`) fed by the Indian Nutrient Databank
(INDB) and accepts any pasted CSV with a column mapping. Use that, not USDA,
for region-specific foods; use USDA for ingredients and packaged products.

## How the app uses it

- **Search** (`searchUsda` / `searchUsdaAction`): `pageSize=12`, sorted by
  `score` by default (relevance) or `publishedDate` / `description`. The UI
  exposes filters for `dataType` (`Foundation`, `SR Legacy`, `Survey
  (FNDDS)`, `Branded`, or the pair `SR Legacy,Foundation`) and `sortBy`.
- **Import** (`importUsda` / `getUsdaFood` / `usdaToInput`): pulls the
  detail response, maps the nutrients below, writes `kind: "branded"`,
  `basis: "per_100g"`, `source: "usda"`, `sourceCode: String(fdcId)`.
  Portions come from `foodPortions[]` (household measure + `gramWeight`).
- **Nutrient mapping** (`USDA_NUTRIENT_MAP`, `src/lib/food-sources/usda.ts`):
  USDA `nutrientId` → the app's codes:

  | USDA id | App code | USDA unit |
  |---|---|---|
  | 1008 | ENERC_KCAL | kcal |
  | 1003 | PROCNT | g |
  | 1004 | FAT | g |
  | 1005 | CHOCDF | g (by difference) |
  | 1079 | FIBTG | g |
  | 2000 | SUGAR | g |
  | 1093 | NA | mg |
  | 1092 | K | mg |
  | 1087 | CA | mg |
  | 1089 | FE | mg |
  | 1095 | ZN | mg |
  | 1090 | MG | mg |
  | 1106 | VITA_RAE | µg |
  | 1162 | VITC | mg |
  | 1114 | VITD | µg |
  | 1178 | VITB12 | µg |
  | 1177 | FOL | µg |
  | 1175 | VITB6 | mg |

## Access, rate limits, keys

- Endpoint: `https://api.nal.usda.gov/fdc/v1/foods/search` (search) and
  `https://api.nal.usda.gov/fdc/v1/food/{fdcId}` (detail). The app caps
  response size (5 MB) and times out at 10 s.
- No key: **DEMO_KEY** — usable, shared, ~30 requests/hour per IP.
- Real key: free from <https://fdc.nal.usda.gov/api-key-signup.html>, set
  `NUTRIPLAN_USDA_KEY`. No default ships with the app (the user's key is
  theirs, not the repo's).
- The app also rate-limits inbound search/import calls (`rate-limit.ts`).

**Failure is visible, never silent.** Any USDA HTTP error (`UsdaHttpError`)
is mapped to a specific message shown in the panel: 429 → "rate limit —
wait or set NUTRIPLAN_USDA_KEY"; 401/403 → "refused the request — check
the key"; 5xx → "USDA is having trouble"; anything else → "could not
complete". A search that finds nothing returns `ok: true` with an empty
list, which the editor renders as "No USDA matches for …". The two are
therefore distinguishable at a glance.

## Nutrient honesty at the import boundary

See [`PROVENANCE.md`](PROVENANCE.md) for the full fill policy — which
provenance classes exist, what may be AI-filled and under which labels,
and what the app never does silently. In one line: absent is `unknown`,
never `0`, and any AI estimate is written as `estimated` with the model
id in `method` and a reason in `note`.

## Barcode is not USDA

The barcode lookup (`lookupBarcodeAction`) goes to **Open Food Facts**,
a separate open-crowdsourced database. It answers the "which package is
this" question; USDA answers "what is in it". They share no ids and are
matched, at most, by UPC/GTIN when the USDA record has one.
