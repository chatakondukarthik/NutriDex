"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertAllRecipesToV2Action } from "@/app/actions";

export function ConvertRecipesButton({ legacyCount }: { legacyCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await convertAllRecipesToV2Action();
          if (!result.ok) setMessage(result.message ?? "Conversion failed.");
          else {
            setMessage(`Converted ${result.converted}, skipped ${result.skipped}.`);
            router.refresh();
          }
        })
      }
      className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
    >
      {pending ? "Converting…" : message ?? `Convert ${legacyCount} legacy recipe${legacyCount === 1 ? "" : "s"}`}
    </button>
  );
}
