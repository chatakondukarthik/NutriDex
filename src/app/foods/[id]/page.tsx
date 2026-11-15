import Link from "next/link";
import { notFound } from "next/navigation";
import { getFood } from "@/lib/db/foods";
import { deleteCapturedFoodAction } from "@/app/actions";
import { DeleteButton } from "@/components/delete-button";
import { NUTRIENT_CODES, NUTRIENTS } from "@/lib/nutrition/types";
import { fmt } from "@/lib/format";
import { EstimateWithAiButton } from "@/components/estimate-with-ai-button";
import { aiStatus } from "@/lib/ai/client";

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

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{food.name}</h1>
          <p className="mt-1 text-xs text-muted">
            {food.category} · {food.kind} · {food.state}
            {food.aliases?.length ? ` · ${food.aliases.join(", ")}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {isCaptured && (
            <EstimateWithAiButton
              foodId={food.id}
              missingCount={counts.unknown}
              aiEnabled={ai.enabled}
              hasKey={ai.hasKey}
            />
          )}
          {food.source ? (
            <>
              <Link href={`/foods/${food.id}/edit`} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium">
                Edit
              </Link>
              <DeleteButton
                label="Delete"
                redirectTo="/foods"
                action={deleteCapturedFoodAction}
                arg={food.id}
              />
            </>
          ) : null}
          <Link href="/foods" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium">
            Back
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold">Details</h2>
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-muted">Basis</dt><dd>{food.basis ?? "per 100 g"}</dd></div>
            {food.servingSizeG != null && <div className="flex justify-between"><dt className="text-muted">Serving size</dt><dd>{food.servingSizeG} g</dd></div>}
            {food.densityGPerMl != null && <div className="flex justify-between"><dt className="text-muted">Density</dt><dd>{food.densityGPerMl} g/ml</dd></div>}
            {food.source && <div className="flex justify-between"><dt className="text-muted">Source</dt><dd>{food.source}{food.sourceCode ? ` (${food.sourceCode})` : ""}</dd></div>}
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
            <h2 className="text-sm font-semibold">Nutrients (per 100 g)</h2>
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
    </main>
  );
}
