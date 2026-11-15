import Link from "next/link";
import { listFoods, listCapturedFoods } from "@/lib/db/foods";
import { FoodsBrowser } from "@/components/foods-browser";

export const dynamic = "force-dynamic";

export default function FoodsPage() {
  const all = listFoods();
  const captured = listCapturedFoods();
  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Foods</h1>
          <p className="mt-1 text-xs text-muted">
            Search the library as you type. {captured.length} of your own foods, plus {all.length - captured.length} built-in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/foods/import" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:bg-ink/5">
            Import CSV
          </Link>
          <Link href="/foods/new" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg">
            New food
          </Link>
        </div>
      </div>
      <FoodsBrowser foods={all} />
    </main>
  );
}