"use client";

import Link from "next/link";
import type { NutrientCode } from "@/lib/nutrition/types";
import { EstimateWithAiButton } from "@/components/estimate-with-ai-button";
import { DeleteButton } from "@/components/delete-button";
import { deleteCapturedFoodAction } from "@/app/actions";

/**
 * The food-detail action bar, rendered twice with different layouts:
 *
 * - `row`: compact, right of the title on sm+ screens.
 * - `stack`: full-width column below the details cards on mobile — the
 *   estimate action is the page's primary action there, so it and its
 *   siblings get 44px touch targets.
 *
 * Both render the same four actions; only the layout differs.
 */
export function FoodDetailActions({
  layout,
  foodId,
  foodName,
  isCaptured,
  missingCount,
  missingCodes,
  aiEnabled,
  hasKey,
  source,
}: {
  layout: "row" | "stack";
  foodId: string;
  foodName: string;
  isCaptured: boolean;
  missingCount: number;
  missingCodes: NutrientCode[];
  aiEnabled: boolean;
  hasKey: boolean;
  source?: string;
}) {
  const stack = layout === "stack";
  const container = stack
    ? "mt-4 flex flex-col gap-2 sm:hidden"
    : "hidden flex-wrap items-center gap-2 sm:flex";
  const linkClass = stack
    ? "inline-flex h-11 w-full items-center justify-center whitespace-nowrap rounded-md border border-line px-3 text-sm font-medium"
    : "inline-flex items-center whitespace-nowrap rounded-md border border-line px-3 py-1.5 text-xs font-medium";
  const estimateClass = stack ? "h-11 w-full gap-2 px-3 text-sm" : undefined;

  return (
    <div className={container}>
      {isCaptured && (
        <EstimateWithAiButton
          foodId={foodId}
          foodName={foodName}
          missingCount={missingCount}
          missingCodes={missingCodes}
          aiEnabled={aiEnabled}
          hasKey={hasKey}
          source={source}
          className={estimateClass}
        />
      )}
      {source ? (
        <>
          <Link href={`/foods/${foodId}/edit`} className={linkClass}>
            Edit
          </Link>
          <span
            className={
              stack
                ? "[&>button]:flex [&>button]:h-11 [&>button]:w-full [&>button]:items-center [&>button]:justify-center [&>button]:text-sm [&_div]:w-full"
                : undefined
            }
          >
            <DeleteButton
              label="Delete"
              redirectTo="/foods"
              action={deleteCapturedFoodAction}
              arg={foodId}
            />
          </span>
        </>
      ) : null}
      <Link href="/foods" className={linkClass}>
        Back
      </Link>
    </div>
  );
}
