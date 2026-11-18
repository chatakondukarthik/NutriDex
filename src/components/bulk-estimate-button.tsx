"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { estimateFoodsAction } from "@/app/actions";
import { EstimateFoodsDialog } from "@/components/estimate-foods-dialog";
import type { NutrientCode } from "@/lib/nutrition/types";

interface PendingFood {
  id: string;
  name: string;
  /** True when the food came from the user's capture, not the seed fixtures. */
  captured: boolean;
  /** Which nutrients are currently unknown — the dialog's pickable set. */
  missingCodes: NutrientCode[];
}

/**
 * Fill missing nutrient data with AI estimates — for the selection, or for
 * every captured food when nothing is selected. Known values are never
 * overwritten; every fill is tagged estimated + ai:<model>.
 */
export function BulkEstimateButton({
  pendingFoods,
  selectedIds,
  aiEnabled,
  hasKey,
}: {
  pendingFoods: PendingFood[];
  selectedIds: ReadonlySet<string>;
  aiEnabled: boolean;
  hasKey: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eligible = useMemo(
    () => pendingFoods.filter((food) => food.captured),
    [pendingFoods],
  );
  const selectedEligible = useMemo(
    () => eligible.filter((food) => selectedIds.has(food.id)),
    [eligible, selectedIds],
  );
  const target = selectedIds.size > 0 ? selectedEligible : eligible;
  const seedsInSelection =
    selectedIds.size > 0
      ? [...selectedIds].filter((id) => !eligible.some((food) => food.id === id)).length
      : 0;

  const blocked = !aiEnabled
    ? "AI is turned off in Settings."
    : !hasKey
      ? "Add an AI key in Settings first."
      : target.length === 0
        ? selectedIds.size > 0
          ? "Nothing missing in the selection — only captured foods can be AI-filled."
          : "Every captured food has full nutrient data."
        : null;

  const label =
    selectedIds.size > 0
      ? `Fill selected with AI (${selectedEligible.length})`
      : `Fill all with AI (${eligible.length})`;

  if (blocked) {
    return (
      <button
        type="button"
        disabled
        title={blocked}
        className="cursor-not-allowed rounded-lg border border-line bg-bg px-3 py-1.5 text-[11px] font-semibold text-muted opacity-60"
      >
        ✨ {label}
      </button>
    );
  }

  if (message) {
    return (
      <p role="status" className="max-w-xs text-right text-[10px] leading-snug text-muted">
        {message}
      </p>
    );
  }

  function go(codes: NutrientCode[]) {
    setOpen(false);
    setMessage(null);
    startTransition(async () => {
      const ids = target.map((food) => food.id);
      const result = await estimateFoodsAction({ foodIds: ids, nutrientCodes: codes });
      setMessage(result.message ?? (result.ok ? "Done." : "Failed."));
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        title={`One AI call per food — will estimate ${target.length} food${target.length === 1 ? "" : "s"}. Known values are never overwritten.`}
        className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-50"
      >
        {pending ? "Estimating…" : `✨ ${label}`}
      </button>

      <EstimateFoodsDialog
        open={open}
        foods={target.map((food) => ({ id: food.id, name: food.name, missingCodes: food.missingCodes }))}
        busy={pending}
        onCancel={() => setOpen(false)}
        onConfirm={go}
      />
      {seedsInSelection > 0 && (
        <p className="w-full text-right text-[9px] text-ink/35">
          {seedsInSelection} seed food{seedsInSelection === 1 ? "" : "s"} in the selection will be
          skipped — seeds are read-only fixtures.
        </p>
      )}
    </>
  );
}
