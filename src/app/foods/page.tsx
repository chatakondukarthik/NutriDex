import Link from "next/link";
import { listFoods, listCapturedFoods } from "@/lib/db/foods";
import { FoodsBrowser } from "@/components/foods-browser";
import { aiStatus } from "@/lib/ai/client";
import { PageHeader } from "@/components/page-header";
import { Rise } from "@/components/motion/reveal";

export const dynamic = "force-dynamic";

export default function FoodsPage() {
  const all = listFoods();
  const captured = listCapturedFoods();
  const ai = aiStatus();
  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4">
        <PageHeader
          title="Spice Rack"
          kicker={`${captured.length} of your own · ${all.length - captured.length} stocked`}
          lead="Every ingredient the house cooks with — USDA-seeded, your own captures on top."
        >
          <Link href="/foods/import" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:bg-ink/5">
            Import CSV
          </Link>
          <Link href="/foods/new" className="btn-sheen rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition hover:bg-accent-strong active:scale-[0.97]">
            New food
          </Link>
        </PageHeader>
      </div>
      <Rise delay={0.08}>
        <FoodsBrowser foods={all} aiEnabled={ai.enabled} hasKey={ai.hasKey} />
      </Rise>
    </main>
  );
}