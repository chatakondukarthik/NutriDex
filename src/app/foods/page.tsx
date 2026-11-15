import Link from "next/link";
import { listCapturedFoods } from "@/lib/db/foods";

export const dynamic = "force-dynamic";

export default function FoodsPage() {
  const foods = listCapturedFoods();
  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your foods</h1>
          <p className="mt-1 text-xs text-muted">
            Foods you have added yourself. Seed foods live in the library and cannot be edited.
          </p>
        </div>
        <Link
          href="/foods/new"
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
        >
          New food
        </Link>
      </div>

      {foods.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-sm text-muted">
          Nothing yet. Add your first food manually or by scanning a label.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {foods.map((food) => (
            <li
              key={food.id}
              className="rounded-lg border border-line bg-surface p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{food.name}</p>
                  <p className="text-xs text-muted">
                    {food.category} · {food.kind} · {food.state}
                    {food.source ? ` · ${food.source}` : ""}
                  </p>
                </div>
                <Link
                  href={`/foods/${food.id}/edit`}
                  className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                >
                  Edit
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
