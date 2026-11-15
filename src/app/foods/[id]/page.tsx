import Link from "next/link";
import { notFound } from "next/navigation";
import { getFood } from "@/lib/db/foods";
import { NUTRIENT_CODES, NUTRIENTS } from "@/lib/nutrition/types";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FoodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const food = getFood(id);
  if (!food) notFound();

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
          {food.source ? (
            <Link href={`/foods/${food.id}/edit`} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium">
              Edit
            </Link>
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
          <h2 className="text-sm font-semibold">Nutrients (per 100 g)</h2>
          <ul className="mt-3 divide-y divide-line text-xs">
            {NUTRIENT_CODES.map((code) => {
              const v = food.nutrients[code];
              const meta = NUTRIENTS[code];
              return (
                <li key={code} className="flex items-center justify-between py-1.5">
                  <span className="text-ink/70">{meta.label}</span>
                  <span className="tabular text-ink/50">
                    {v?.amount == null ? "unknown" : `${fmt(v.amount, meta.precision)} ${meta.unit}`}
                    {v?.status === "estimated" ? " (est.)" : ""}
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
