import Link from "next/link";

export const metadata = {
  title: "About the numbers · NutriPlan",
  description: "Where the data comes from, how targets are calculated, and what this tool is not.",
};

/**
 * The trust page.
 *
 * Every claim the product makes about a number should be checkable from
 * here: the equation, the source, and the size of the uncertainty. It is
 * deliberately written in plain language and links back to the screens
 * that show the working.
 */
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">About the numbers</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          NutriPlan is a planning tool. It helps you see what a meal contains and how a week adds
          up. It does not diagnose, treat, or replace advice from a clinician or dietitian.
        </p>
      </header>

      <div className="mt-8 space-y-8">
        <Section
          title="How a target is calculated"
          lead="Targets are derived from your profile every time a page is read. They are not stored, so changing the profile moves the diary and the plan at once."
        >
          <dl className="space-y-3">
            <Row term="Energy">
              Mifflin–St Jeor by default. If you give a body-fat percentage, Katch–McArdle is used
              instead, because lean mass predicts resting energy better than height and weight. The
              result is multiplied by an activity factor, then adjusted by a pace expressed as a
              share of body weight per week.
            </Row>
            <Row term="Safety rails">
              Energy never drops below 1,200 kcal (female) or 1,500 kcal (male), a deficit never
              exceeds 25% of maintenance, and a surplus never exceeds 15%. When a rail applies, the
              profile page shows the rate actually delivered, not the one requested.
            </Row>
            <Row term="Protein">
              Body weight × 1.0 g/kg to maintain, 1.2 g/kg to lose, 1.4 g/kg to gain.
            </Row>
            <Row term="Fat, carbohydrate, fibre, sugars">
              Fat is a ceiling at 30% of energy. Carbohydrate is the energy left after protein and
              fat. Fibre is 14 g per 1,000 kcal. Sugars are capped at 10% of energy — a stricter
              reading than free-sugar guidance, because the field is total sugars.
            </Row>
            <Row term="Minerals and vitamins">
              ICMR–NIN 2020 reference allowances for Indians, banded by sex and age. These are
              population reference values, not a personal prescription, and they are currently
              unverified seed data.
            </Row>
          </dl>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            <Link href="/profile" className="font-medium text-accent underline underline-offset-2">
              Open your profile
            </Link>{" "}
            to see the equation, the activity multiplier and the rails for your own numbers. The
            panel updates as you type; nothing is saved until you press save.
          </p>
        </Section>

        <Section
          title="Why a day and a week are judged differently"
          lead="A daily reference is not always the right window to judge it in."
        >
          <ul className="space-y-3">
            <Role
              label="Hit most days"
              items="Energy, protein"
              body="These steer the plan. Close to target on most days is what matters; one unusual day is not a failure."
            />
            <Role
              label="Reach across the week"
              items="Carbohydrate, fibre, potassium, calcium, iron, zinc, magnesium, vitamins A, C, D, B12, folate, B6"
              body="These are averages over time. A low day is fine if the week adds up, so the day view shows them without a verdict."
            />
            <Role
              label="Stay under across the week"
              items="Fat, total sugars, sodium"
              body="These are ceilings. Going over on one day is not a breach if the week averages out, but the bar turns amber as a signal."
            />
          </ul>
        </Section>

        <Section
          title="When a bar changes colour"
          lead="The colours are a reading aid, not a grade. The exact rules are below, and you can change them."
        >
          <dl className="space-y-3">
            <Row term="Amber">
              An amount that is past the target. Out of the box that is “as soon as it is over”,
              which is why a weekly limit turns amber before it is a problem.
            </Row>
            <Row term="Red">
              An amount at or past 20% over the target. This is the only “clearly past it”
              signal; there is no red for a shortfall.
            </Row>
            <Row term="On target">
              Within ±10% of the reference, either side. Sugars use ±15% because a label value
              is less precise than a weighed ingredient.
            </Row>
            <Row term="Day versus week">
              Energy and protein are judged day by day. Every other nutrient is judged on the
              week total, so a low-fibre Tuesday is grey rather than red. A weekly limit turns
              amber only when the week is over.
            </Row>
            <Row term="Overrides">
              A per-nutrient value replaces the profile recommendation for every day, and the
              week total becomes seven times that value. Clearing it returns to the
              recommendation.
            </Row>
          </dl>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            All of these are editable in{" "}
            <Link href="/settings" className="font-medium text-accent underline underline-offset-2">
              Settings → Status colours and targets
            </Link>
            . Red is kept at or above amber, percentages are clamped to a range the screen can
            explain, and a restored archive carries the same values. The thresholds change the
            colour and the verdict, never the recommended amount itself.
          </p>
        </Section>

        <Section
          title="Where the food data comes from"
          lead="The seed dataset exists to prove the engine works. It is not yet the verified production dataset."
        >
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Used for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="px-3 py-2 text-ink/80">USDA SR Legacy</td>
                  <td className="px-3 py-2 text-muted">Most nutrient values per 100 g</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-ink/80">IFCT 2017</td>
                  <td className="px-3 py-2 text-muted">Indian food composition where it differs</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-ink/80">ICMR–NIN 2020</td>
                  <td className="px-3 py-2 text-muted">Reference allowances for the targets</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            Values have not been through a verified import and review. Cooking changes water
            content and nutrient retention, so a raw-food value is an estimate for a cooked dish.
            That is why every nutrient carries a status:
          </p>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted">
            <li>
              <Status className="bg-accent" /> <strong className="text-ink/80">Known</strong> — every
              contributing ingredient has a value for this nutrient.
            </li>
            <li>
              <Status className="bg-warn" />{" "}
              <strong className="text-ink/80">Estimated</strong> — some ingredients have it and some
              do not. The total is shown with its coverage (for example 3/5) and is never scaled up
              to pretend it is complete.
            </li>
            <li>
              <Status className="bg-ink/20" /> <strong className="text-ink/80">Unknown</strong> — no
              contributing ingredient has it. The UI says “unknown” and draws no bar. It never shows
              zero, because zero is a measurement.
            </li>
          </ul>
        </Section>

        <Section
          title="What is stored, and where"
          lead="This build runs locally. There is no account, no sync and no analytics."
        >
          <ul className="space-y-2 text-xs leading-relaxed text-muted">
            <li>
              <strong className="text-ink/80">Your profile and plan</strong> live in a SQLite file
              on this machine (<code className="rounded bg-ink/[0.06] px-1 py-0.5">data/nutriplan.sqlite</code>).
            </li>
            <li>
              <strong className="text-ink/80">Appearance</strong> (mode, accent, motion) is stored
              in three cookies, so the server can render the right theme on the first paint.
            </li>
            <li>
              <strong className="text-ink/80">Nothing is sent anywhere.</strong> There is no AI
              feature in this build and no third-party request from the page.
            </li>
          </ul>
        </Section>

        <Section title="What this is not">
          <p className="text-xs leading-relaxed text-muted">
            The targets are reference values adjusted by an equation, not a prescription. The food
            data is a development fixture, not a laboratory analysis. A plan is not a log of what
            you ate. If you have a medical condition, are pregnant, or are treating a diagnosed
            deficiency, use this alongside professional advice rather than instead of it.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            The calculation contract is documented in{" "}
            <code className="rounded bg-ink/[0.06] px-1 py-0.5">docs/reference/NUTRITION.md</code>{" "}
            in the repository. Every number the UI shows traces back to it.
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      {lead && <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">{lead}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">{term}</dt>
      <dd className="text-xs leading-relaxed text-muted">{children}</dd>
    </div>
  );
}

function Role({ label, items, body }: { label: string; items: string; body: string }) {
  return (
    <li className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
          {label}
        </span>
        <span className="text-[10px] text-faint">{items}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
    </li>
  );
}

function Status({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 translate-y-px rounded-full ${className}`}
    />
  );
}
