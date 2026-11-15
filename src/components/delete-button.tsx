"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Delete with confirmation. Shows what will happen:
 * - if the item is in use, it is archived (kept for history), not destroyed
 * - otherwise it is deleted
 */
export function DeleteButton({
  label,
  action,
  arg,
  confirmText,
  redirectTo,
}: {
  label: string;
  action: (arg: string) => Promise<{ ok: boolean; outcome?: string; message?: string }>;
  arg: string;
  confirmText?: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function go() {
    setMessage(null);
    startTransition(async () => {
      const result = await action(arg);
      if (!result.ok) {
        setMessage(result.message ?? "Could not delete.");
        setConfirming(false);
        return;
      }
      setMessage(result.outcome === "archived" ? "Archived (kept for history)." : "Deleted.");
      setConfirming(false);
      router.push(redirectTo);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-danger/30 px-3 py-2 text-xs font-medium text-danger-ink transition hover:bg-danger-soft"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-ink">
      <span>{confirmText ?? "Delete this? If it is in use it will be archived instead."}</span>
      <button type="button" onClick={go} disabled={pending} className="rounded-md bg-danger px-2 py-1 font-medium text-white disabled:opacity-50">
        {pending ? "Working…" : "Delete"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-line px-2 py-1">
        Cancel
      </button>
      {message && <span>{message}</span>}
    </div>
  );
}
