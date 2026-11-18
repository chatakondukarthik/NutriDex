"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { fmt } from "@/lib/format";
import type { Rollup } from "@/lib/nutrition/engine";
import { NUTRIENT_CODES, NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";

export interface SheetItem {
  id: string;
  name: string;
  qty: string;
  slot: string;
  slotLabel: string;
  rollup: Rollup | null;
}

const DEFAULT_COLUMNS: NutrientCode[] = ["PROCNT", "CHOCDF", "FAT", "FIBTG", "NA", "CA"];
const STORAGE_KEY = "nutriplan-item-sheet-columns";
const MAX_COLUMNS = 6;

export function PlanItemSheet({
  items,
  period,
  dayLabel,
  onCopy,
  onRemove,
}: {
  items: SheetItem[];
  period: "day" | "week";
  dayLabel: string;
  onCopy?: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const [columns, setColumns] = useState<NutrientCode[]>(DEFAULT_COLUMNS);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detail, setDetail] = useState<SheetItem | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as NutrientCode[];
        const valid = parsed.filter((code) => (NUTRIENT_CODES as readonly string[]).includes(code));
        if (valid.length) setColumns(valid.slice(0, MAX_COLUMNS));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(columns)); } catch { /* ignore */ }
  }, [columns]);

  const coverage = useMemo(() => {
    for (const item of items) {
      if (item.rollup) return true;
    }
    return false;
  }, [items]);

  if (items.length === 0) return null;

  function toggleColumn(code: NutrientCode) {
    setColumns((current) => {
      if (current.includes(code)) return current.filter((c) => c !== code);
      if (current.length >= MAX_COLUMNS) return current;
      return [...current, code];
    });
  }

  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-tight text-ink">Item detail</h2>
          <p className="text-[11px] text-ink/40">{dayLabel}</p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink"
          >
            Columns: {columns.length} of {MAX_COLUMNS} ▾
          </button>
          {pickerOpen && (
            <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-card">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                Which nutrients?
              </p>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {NUTRIENT_CODES.map((code) => {
                  const meta = NUTRIENTS[code];
                  const on = columns.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleColumn(code)}
                      aria-pressed={on}
                      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] transition ${
                        on ? "bg-accent/10 text-accent" : "text-ink/60 hover:bg-ink/5"
                      }`}
                    >
                      <span className="truncate">{meta.label}</span>
                      {on && <span aria-hidden>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-line/70 text-[10px] uppercase tracking-wider text-ink/40">
              <th className="py-2 pl-4 pr-2 font-semibold">Item</th>
              <th className="py-2 pr-2 font-semibold">Qty</th>
              <th className="py-2 pr-2 text-right font-semibold">kcal</th>
              {columns.map((code) => {
                const meta = NUTRIENTS[code];
                return (
                  <th key={code} className="py-2 pr-2 text-right font-semibold">
                    {meta.short}
                  </th>
                );
              })}
              <th className="py-2 pl-2 pr-2 text-right font-semibold">More</th>
              <th className="w-16 py-2 pr-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-ink/[0.03]">
                <td className="py-2 pl-4 pr-2">
                  <div className="max-w-48">
                    <p className="truncate font-medium text-ink/80">{item.name}</p>
                    <p className="text-[9px] uppercase tracking-wide text-ink/35">{item.slotLabel}</p>
                  </div>
                </td>
                <td className="py-2 pr-2 tabular text-ink/50">{item.qty}</td>
                <td className="py-2 pr-2 text-right tabular text-ink/70">
                  {item.rollup?.totals.ENERC_KCAL != null ? fmt(item.rollup.totals.ENERC_KCAL, 0) : "—"}
                </td>
                {columns.map((code) => {
                  const value = item.rollup?.totals[code];
                  return (
                    <td key={code} className="py-2 pr-2 text-right tabular text-ink/60">
                      {value != null ? fmt(value, NUTRIENTS[code].precision) : "·"}
                    </td>
                  );
                })}
                <td className="py-2 pl-2 pr-2 text-right">
                  <button
                    type="button"
                    onClick={() => setDetail(item)}
                    disabled={!item.rollup}
                    className="rounded-md border border-line px-2 py-1 text-[10px] font-medium text-muted hover:text-ink disabled:opacity-30"
                  >
                    All 18
                  </button>
                </td>
                <td className="py-2 pr-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {onCopy && (
                      <button
                        type="button"
                        onClick={() => onCopy(item.id)}
                        aria-label={`Copy ${item.name} to the palette`}
                        title="Copy to the palette, keeping quantity"
                        className="grid h-6 w-6 place-items-center rounded text-ink/30 hover:bg-ink/5 hover:text-ink/70"
                      >
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                          <rect x="5" y="5" width="8" height="8" rx="1" />
                          <rect x="2" y="2" width="8" height="8" rx="1" />
                        </svg>
                      </button>
                    )}
                    {onRemove && (
                      <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        aria-label={`Remove ${item.name}`}
                        title="Remove from the plan"
                        className="grid h-6 w-6 place-items-center rounded text-ink/30 hover:bg-ink/5 hover:text-ink/70"
                      >
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                          <path d="M3 5h10M6 5V3h4v2m-6 0l1 9h6l1-9" strokeLinejoin="round" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && detail.rollup && (
        <DetailModal item={detail} rollup={detail.rollup} onClose={() => setDetail(null)} />
      )}
    </section>
  );
}

function DetailModal({
  item,
  rollup,
  onClose,
}: {
  item: SheetItem;
  rollup: Rollup;
  onClose: () => void;
}) {
  const panelRef = useDialogFocus(true, onClose);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Nutrient details for ${item.name}`}
        tabIndex={-1}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-card outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold leading-tight">{item.name}</h3>
            <p className="mt-0.5 text-[11px] text-muted">{item.slotLabel} · {item.qty}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink/40 hover:bg-ink/5 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <ul className="mt-3 divide-y divide-line/60">
          {NUTRIENT_CODES.map((code) => {
            const meta = NUTRIENTS[code];
            const value = rollup.totals[code];
            const coverage = rollup.coverage[code];
            const partial = coverage.total > 0 && coverage.known < coverage.total;
            return (
              <li key={code} className="flex items-baseline justify-between gap-2 py-1.5 text-xs">
                <span className="text-ink/70">{meta.label}</span>
                <span className="tabular flex items-baseline gap-2">
                  {value != null ? (
                    <>
                      <span className="text-ink/80">{fmt(value, meta.precision)} {meta.unit}</span>
                      {partial && <span className="text-[9px] text-warn-ink">partial</span>}
                    </>
                  ) : (
                    <span className="text-ink/30">unknown</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10px] text-ink/35">Values are per the amount you entered, not per 100 g.</p>
      </div>
    </div>,
    document.body,
  );
}
