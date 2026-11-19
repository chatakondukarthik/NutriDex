# Third-party notices

NutriPlan is MIT-licensed (see [`LICENSE`](LICENSE)). It bundles or
redistributes the following third-party works, each under its own license.

## Agent skills (`.agents/skills/`)

| Work | Source | License | License text |
|---|---|---|---|
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 | [`.agents/skills/frontend-design/LICENSE.txt`](.agents/skills/frontend-design/LICENSE.txt) |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT | [`.agents/skills/ui-ux-pro-max/LICENSE`](.agents/skills/ui-ux-pro-max/LICENSE) |

These are design-assistance skills used while building the interface. They
are not imported by, or required to run, the application; a fresh checkout
builds and tests without them.

Install provenance (source repository, commit hash) is recorded in
[`skills-lock.json`](skills-lock.json).

## Runtime and build dependencies

Node dependencies are declared in [`package.json`](package.json) with their
licenses resolved from [`package-lock.json`](package-lock.json). Notable
runtime libraries:

| Package | License |
|---|---|
| [next](https://github.com/vercel/next.js) | MIT |
| [react](https://github.com/facebook/react) / [react-dom](https://github.com/facebook/react) | MIT |
| [@xyflow/react](https://github.com/xyflow/xyflow) | MIT |
| [@dagrejs/dagre](https://github.com/dagrejs/dagre) | MIT |
| [gsap](https://github.com/greensock/GSAP) | Standard ("no-charge") license — see [greensock.com/license](https://gsap.com/licensing/) |
| [motion](https://github.com/motiondivision/motion) | MIT |
| [tailwindcss](https://github.com/tailwindlabs/tailwindcss) | MIT |

`gsap` is under GreenSock's standard license: free for most uses, but not
under the "no-charge" terms if you distribute it as part of a competing
toolkit or sell it as a product. Complying with NutriPlan's MIT license
does not relicense GSAP.

## Data sources

Food composition data is not bundled in this repository. At runtime the app
may query:

- **USDA FoodData Central** — public domain (CC0-equivalent); attribution
  appreciated, not required.
- **Open Food Facts** — database under ODbL 1.0; product photographs may be
  under their own licenses. See [openfoodfacts.org/terms-of-use](https://world.openfoodfacts.org/terms-of-use).
- **Indian Nutrient Databank (INDB)** — recorded as CC BY 4.0 in
  [`docs/research/RESEARCH.md`](docs/research/RESEARCH.md); attribution is
  required for any data actually imported from it.

If you redistribute a database built from these sources, keep the upstream
license terms with it.
