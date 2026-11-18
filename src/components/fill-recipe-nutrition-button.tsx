"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { estimateFoodsAction } from "@/app/actions";
import { EstimateFoodsDialog } from "@/components/estimate-foods-dialog";
import type { NutrientCode } from "@/lib/nutrition/types";

/**
 * "Fill the leftover nutrition of this recipe's ingredients with AI."
 *
 * One AI call per captured food with missing nutrients, sharing the same
 * warning dialog as the foods page. Known values are never overwritten.
 */
export function FillRecipeNutritionButton({
  foods,
}: {
  foods: Array<{ id: string; name: string; missingCodes: NutrientCode[] }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (foods.length === 0) return null;

  function go(codes: NutrientCode[]) {
    setOpen(false);
    setMessage(null);
    startTransition(async () => {
      const result = await estimateFoodsAction({
        foodIds: foods.map((f) => f.id),
        nutrientCodes: codes,
      });
      setMessage(result.message ?? (result.ok ? "Done." : "Failed."));
      router.refresh();
    });
  }

  if (message) {
    return (
      <p role="status" className="max-w-xs text-right text-[10px] leading-snug text-muted">
        {message}
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        title={`One AI call per captured ingredient with missing data — ${foods.length} food${foods.length === 1 ? "" : "s"}. Known values are never overwritten.`}
        className="rounded-lg border border-warn-line bg-warn-soft px-3.5 py-2 text-[11px] font-semibold text-warn-ink transition hover:bg-warn-soft/70 disabled:opacity-50"
      >
        {pending ? "Filling…" : `✨ Fill nutrition (${foods.length})`}
      </button>
      <EstimateFoodsDialog
        open={open}
        foods={foods}
        busy={pending}
        onCancel={() => setOpen(false)}
        onConfirm={go}
      />
    </>
  );
}
