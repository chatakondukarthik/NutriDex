import { notFound } from "next/navigation";
import { getFood } from "@/lib/db/foods";
import { NUTRIENT_CODES, NUTRIENTS } from "@/lib/nutrition/types";
import { fmt } from "@/lib/format";
import { FoodDetailActions } from "@/components/food-detail-actions";
import { aiStatus } from "@/lib/ai/client";
import { listPeople } from "@/lib/db/people";
import { ProvenanceChip } from "@/components/provenance-chip";
import { foodProvenance } from "@/lib/provenance";

export const dynamic = "force-dynamic";

export default async function FoodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const food = getFood(id);
  if (!food) notFound();

  const counts = NUTRIENT_CODES.reduce(
    (acc, code) => {
      const v = food.nutrients[code];
      if (v?.amount == null) acc.unknown += 1;
      else if (v.status === "estimated") acc.estimated += 1;
      else acc.known += 1;
      return acc;
    },
    { known: 0, estimated: 0, unknown: 0 },
  );
  const ai = aiStatus();
  const isCaptured = !!food.source;
  const missingCodes = NUTRIENT_CODES.filter((code) => food.nutrients[code]?.amount == null);
  const provenance = foodProvenance(food.source ?? null, food.sourceKind ?? null);
  const capturedBy = food.createdBy
    ? (listPeople({ includeArchived: true }).find((person) => person.id === food.createdBy)?.displayName ??
       (food.createdBy === "local" ? "you (before households)" : "a member who left"))
    : null;
  const capturedOn = food.createdAt ? new Date(food.createdAt) : null;

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-[28px] font-bold leading-none tracking-tight text-ink">{food.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {food.source && <ProvenanceChip provenance={provenance} />}
            <span>
              {food.category} · {food.kind} · {food.state}
              {food.aliases?.length ? ` · ${food.aliases.join(", ")}` : ""}
            </span>
          </p>
        </div>
        <FoodDetailActions
          layout="row"
          foodId={food.id}
          foodName={food.name}
          isCaptured={isCaptured}
          missingCount={counts.unknown}
          missingCodes={missingCodes}
          aiEnabled={ai.enabled}
          hasKey={ai.hasKey}
          source={food.source}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="font-display text-sm font-semibold tracking-tight text-ink">Details</h2>
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-muted">Basis</dt><dd>{food.basis ?? "per 100 g"}</dd></div>
            {food.servingSizeG != null && <div className="flex justify-between"><dt className="text-muted">Serving size</dt><dd>{food.servingSizeG} g</dd></div>}
            {food.densityGPerMl != null && <div className="flex justify-between"><dt className="text-muted">Density</dt><dd>{food.densityGPerMl} g/ml</dd></div>}
            {food.source && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Source</dt>
                <dd className="text-right">
                  <span title={provenance.title}>{provenance.short}</span>
                  {food.sourceCode ? ` · ${food.sourceCode}` : ""}
                  {food.sourcePublished ? ` · pub ${food.sourcePublished}` : ""}
                </dd>
              </div>
            )}
            {isCaptured && capturedOn && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Captured</dt>
                <dd className="text-right">
                  {capturedOn.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  {capturedBy ? ` · by ${capturedBy}` : ""}
                </dd>
              </div>
            )}
            {food.confidence != null && <div className="flex justify-between"><dt className="text-muted">Confidence</dt><dd>{Math.round(food.confidence * 100)}%</dd></div>}
          </dl>

          {food.portions?.length ? (
            <div className="mt-4">
              <h3 className="text-xs font-medium">Household portions</h3>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {food.portions.map((p, i) => (
                  <li key={i}>{p.label} = {p.grams} g</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold tracking-tight text-ink">Nutrients (per 100 g)</h2>
            <p className="text-[10px] tabular text-ink/45">
              <span className="text-accent">{counts.known} known</span>
              {" · "}
              <span className="text-warn-ink">{counts.estimated} estimated</span>
              {" · "}
              <span className="text-ink/40">{counts.unknown} unknown</span>
            </p>
          </div>
          {counts.estimated > 0 && (
            <p className="mt-1.5 rounded-md border border-warn-line bg-warn-soft px-2 py-1.5 text-[10px] leading-snug text-warn-ink">
              {counts.estimated} value{counts.estimated === 1 ? " is" : "s are"} an AI estimate, not
              a measurement. Hover the chip to see why; edit any value to override it.
            </p>
          )}
          <ul className="mt-3 divide-y divide-line text-xs">
            {NUTRIENT_CODES.map((code) => {
              const v = food.nutrients[code];
              const meta = NUTRIENTS[code];
              const method = (v as { method?: string | null } | undefined)?.method ?? null;
              const note = (v as { note?: string | null } | undefined)?.note ?? null;
              const aiFilled = method?.startsWith("ai:");
              return (
                <li key={code} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-ink/70">{meta.label}</span>
                  <span className="flex items-center gap-1.5">
                    {v?.amount == null ? (
                      <span className="text-ink/40">unknown</span>
                    ) : (
                      <span className="tabular text-ink/50">
                        {fmt(v.amount, meta.precision)} {meta.unit}
                      </span>
                    )}
                    {v?.status === "estimated" && (
                      <span
                        title={note ? `${note} (${method ?? "ai"})` : `Estimated by AI${method ? ` · ${method}` : ""}`}
                        className="rounded-full border border-warn-line bg-warn-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warn-ink"
                      >
                        {aiFilled ? "AI est." : "est."}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <FoodDetailActions
        layout="stack"
        foodId={food.id}
        foodName={food.name}
        isCaptured={isCaptured}
        missingCount={counts.unknown}
        missingCodes={missingCodes}
        aiEnabled={ai.enabled}
        hasKey={ai.hasKey}
        source={food.source}
      />
    </main>
  );
}
