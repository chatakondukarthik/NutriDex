"use client";

import { useEffect, useRef, useState } from "react";
import { toFoodCsv, toFoodJson } from "@/lib/export-foods";
import type { Food } from "@/lib/nutrition/types";

const ACTIONS = [
  { id: "json", label: "Copy as JSON" },
  { id: "csv", label: "Copy as CSV" },
  { id: "download", label: "Download CSV" },
] as const;

export function FoodExportMenu({ foods, label = "Export" }: { foods: Food[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  async function copy(text: string, kind: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setOpen(false);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  function onAction(id: (typeof ACTIONS)[number]["id"]) {
    if (id === "json") copy(toFoodJson(foods), "json");
    else if (id === "csv") copy(toFoodCsv(foods), "csv");
    else {
      const blob = new Blob([toFoodCsv(foods)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "nutriplan-foods.csv";
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:bg-ink/5"
      >
        {copied ? "Copied!" : label}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-line bg-surface p-1 shadow-card">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => onAction(action.id)}
              className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-ink/5"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
