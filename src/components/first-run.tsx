import Link from "next/link";

/**
 * First-run guidance (S4).
 *
 * A new install opens on a diary with no entries, a plan with no week and a
 * default profile that is not the user's. The screen is usable but says
 * nothing about where to begin, so this card names the three steps in the
 * order they matter and marks the ones already done. It disappears once the
 * profile is set and there is both a logged entry and a planned item.
 */
export function FirstRunGuide({
  profileIsDefault,
  hasEntries,
  hasPlanned,
}: {
  profileIsDefault: boolean;
  hasEntries: boolean;
  hasPlanned: boolean;
}) {
  if (!profileIsDefault && hasEntries && hasPlanned) return null;

  const steps = [
    {
      done: !profileIsDefault,
      title: "Set your profile",
      body: profileIsDefault
        ? "Targets currently use a default adult. Your numbers make every bar meaningful."
        : "Your targets follow your profile.",
      href: "/profile",
      action: profileIsDefault ? "Set your numbers" : "Review",
    },
    {
      done: hasEntries,
      title: "Log one food",
      body: hasEntries
        ? "Your diary has an entry, so the totals are live."
        : "Search the library, pick a portion and add it to today.",
      href: "/",
      action: hasEntries ? "Open diary" : "Find a food",
    },
    {
      done: hasPlanned,
      title: "Plan the week",
      body: hasPlanned
        ? "This week has planned items."
        : "Place a saved recipe or food into a day and slot.",
      href: "/plan",
      action: hasPlanned ? "Open plan" : "Open the plan",
    },
  ];

  return (
    <section
      aria-labelledby="first-run-title"
      className="mb-4 rounded-2xl border border-accent/25 bg-accent/[0.04] p-4 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="first-run-title" className="text-sm font-semibold">
          Start here
        </h2>
        <span className="text-[10px] text-ink/40">Three steps, about two minutes</span>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={`rounded-xl border px-3 py-2.5 ${
              step.done ? "border-line bg-surface/60" : "border-accent/25 bg-surface"
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                  step.done ? "bg-accent/15 text-accent" : "bg-accent text-accent-fg"
                }`}
              >
                {step.done ? "✓" : index + 1}
              </span>
              <span className="text-xs font-semibold">{step.title}</span>
              {step.done && <span className="sr-only">done</span>}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{step.body}</p>
            {!step.done && (
              <Link
                href={step.href}
                className="mt-1.5 inline-block text-[11px] font-medium text-accent underline underline-offset-2"
              >
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
