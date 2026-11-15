"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  saveCapturedFoodAction,
  updateCapturedFoodAction,
  extractFoodAction,
  lookupBarcodeAction,
  searchUsdaAction,
  importUsdaAction,
  promoteFoodToRecipeAction,
} from "@/app/actions";
import type { CapturedFoodInput } from "@/lib/captured-food";
import { NUTRIENT_CODES, NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";
import type { Food } from "@/lib/nutrition/types";

const CATEGORIES = ["Dairy", "Grains", "Vegetables", "Fruits", "Legumes", "Oils", "Nuts", "Meat", "Seafood", "Spices", "Beverages", "Custom"];

type Method = "manual" | "ai" | "barcode" | "usda";

const METHODS: { id: Method; emoji: string; title: string; blurb: string }[] = [
  { id: "manual", emoji: "✎", title: "Type it in", blurb: "Name, portions and the nutrients you know." },
  { id: "ai", emoji: "✦", title: "AI fill", blurb: "Describe the food or a label; the AI proposes values." },
  { id: "barcode", emoji: "▥", title: "Barcode", blurb: "Look up a packaged food by its barcode." },
  { id: "usda", emoji: "◈", title: "USDA search", blurb: "Search the USDA FoodData Central database." },
];

interface Props {
  initial?: Food;
  mode: "create" | "edit";
  ai?: { enabled: boolean; hasKey: boolean };
}

const NUMERIC_PRECISION = NUTRIENTS;

export function FoodEditor({ initial, mode, ai }: Props) {
  const aiAvailable = !!ai?.enabled && !!ai?.hasKey;
  const router = useRouter();
  const draftKey = `nutriplan-food-draft:${mode}:${initial?.id ?? "new"}`;

  const [method, setMethod] = useState<Method>("manual");
  const [name, setName] = useState(initial?.name ?? "");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [category, setCategory] = useState(initial?.category ?? "Custom");
  const [kind, setKind] = useState(initial?.kind ?? "provisional");
  const [source, setSource] = useState(initial?.source ?? "manual");
  const [state, setState] = useState(initial?.state ?? "raw");
  const [basis, setBasis] = useState(initial?.basis ?? "per_100g");
  const [servingSizeG, setServingSizeG] = useState(initial?.servingSizeG ? String(initial.servingSizeG) : "");
  const [servingsPerPack, setServingsPerPack] = useState(initial?.servingsPerPack ? String(initial.servingsPerPack) : "");
  const [portions, setPortions] = useState<{ label: string; grams: string }[]>(
    (initial?.portions ?? []).map((p) => ({ label: p.label, grams: String(p.grams) })),
  );
  const [nutrients, setNutrients] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (initial?.nutrients) {
      for (const code of NUTRIENT_CODES) {
        const v = initial.nutrients[code]?.amount;
        if (v != null) out[code] = String(v);
      }
    }
    return out;
  });
  const [estimated, setEstimated] = useState<Set<string>>(new Set());
  const [aiText, setAiText] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [barcode, setBarcode] = useState("");
  const [usdaQuery, setUsdaQuery] = useState("");
  const [usdaResults, setUsdaResults] = useState<{ fdcId: number; name: string; category?: string; nutrients: number }[]>([]);
  const [aiImage, setAiImage] = useState<string | null>(null);
  const [aiImageMime, setAiImageMime] = useState<string>("image/jpeg");
  const [rationale, setRationale] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draftBanner, setDraftBanner] = useState<"hidden" | "restore" | "restoring">("hidden");
  const [pending, startTransition] = useTransition();

  // Track dirtiness for the leave guard + draft autosave
  const draftValue = useMemo(
    () => JSON.stringify({
      name, aliases, category, kind, state, basis, servingSizeG, servingsPerPack,
      portions, nutrients: Object.entries(nutrients).filter(([, v]) => v.trim() !== ""),
      source, estimated: [...estimated], aiText, aiNote, barcode, usdaQuery, method,
    }),
    [name, aliases, category, kind, state, basis, servingSizeG, servingsPerPack, portions, nutrients, source, estimated, aiText, aiNote, barcode, usdaQuery, method],
  );

  const dirty = draftValue.length > 2;

  // Restore an unsaved draft, once
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) setDraftBanner("restore");
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the draft (debounced)
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(draftKey, draftValue); } catch { /* ignore */ }
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftValue, dirty]);

  // Browser-level leave guard
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function restoreDraft() {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      setName(d.name ?? "");
      setAliases(d.aliases ?? "");
      setCategory(d.category ?? "Custom");
      setKind(d.kind ?? "provisional");
      setState(d.state ?? "raw");
      setBasis(d.basis ?? "per_100g");
      setServingSizeG(d.servingSizeG ?? "");
      setServingsPerPack(d.servingsPerPack ?? "");
      setPortions(d.portions ?? []);
      setNutrients(Object.fromEntries(d.nutrients ?? []));
      setSource(d.source ?? "manual");
      setEstimated(new Set(d.estimated ?? []));
      setAiText(d.aiText ?? "");
      setAiNote(d.aiNote ?? "");
      setBarcode(d.barcode ?? "");
      setUsdaQuery(d.usdaQuery ?? "");
      setMethod(d.method ?? "manual");
      setDraftBanner("restoring");
      window.setTimeout(() => setDraftBanner("hidden"), 1200);
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }

  function discardDraft() {
    window.localStorage.removeItem(draftKey);
    setDraftBanner("hidden");
  }

  function clearDraftOnSave() {
    try { window.localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }

  function buildInput(): CapturedFoodInput {
    const nutrientMap: Partial<Record<NutrientCode, number | null>> = {};
    for (const code of NUTRIENT_CODES) {
      const v = nutrients[code];
      if (v != null && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) nutrientMap[code] = n;
      }
    }
    return {
      name,
      aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
      category,
      kind: kind as CapturedFoodInput["kind"],
      state: state as CapturedFoodInput["state"],
      basis: basis as CapturedFoodInput["basis"],
      servingSizeG: servingSizeG ? Number(servingSizeG) : undefined,
      servingsPerPack: servingsPerPack ? Number(servingsPerPack) : undefined,
      source,
      nutrients: nutrientMap,
      estimated: [...estimated] as NutrientCode[],
      portions: portions
        .filter((p) => p.label.trim() && p.grams.trim())
        .map((p) => ({ label: p.label.trim(), grams: Number(p.grams) })),
    };
  }

  function applyProposal(proposal: any) {
    if (proposal.name) setName(proposal.name);
    if (Array.isArray(proposal.aliases)) setAliases(proposal.aliases.join(", "));
    if (proposal.category) setCategory(proposal.category);
    if (proposal.kind) setKind(proposal.kind);
    if (proposal.state) setState(proposal.state);
    if (proposal.basis) setBasis(proposal.basis);
    if (proposal.servingSizeG != null) setServingSizeG(String(proposal.servingSizeG));
    if (proposal.servingsPerPack != null) setServingsPerPack(String(proposal.servingsPerPack));
    if (Array.isArray(proposal.portions)) {
      setPortions(proposal.portions.map((p: any) => ({ label: p.label, grams: String(p.grams) })));
    }
    if (proposal.nutrients && typeof proposal.nutrients === "object") {
      const next: Record<string, string> = {};
      for (const code of NUTRIENT_CODES) {
        const v = proposal.nutrients[code];
        if (v != null) next[code] = String(v);
      }
      setNutrients(next);
    }
    if (Array.isArray(proposal.estimated)) setEstimated(new Set(proposal.estimated));
    if (proposal.source) setSource(proposal.source);
    if (proposal.rationale) setRationale(proposal.rationale);
    setMessage("Filled from the proposal. Review before saving.");
  }

  function runTextExtract() {
    setMessage(null);
    startTransition(async () => {
      const result = await extractFoodAction({ mode: "text", text: aiText });
      if (!result.ok) setMessage(result.message ?? "Extraction failed.");
      else applyProposal(result.proposal);
    });
  }

  function runImageExtract() {
    if (!aiImage) { setMessage("Choose an image first."); return; }
    setMessage(null);
    startTransition(async () => {
      const result = await extractFoodAction({
        mode: "image",
        images: [{ mimeType: aiImageMime, data: aiImage }],
        note: aiNote || undefined,
      });
      if (!result.ok) setMessage(result.message ?? "Extraction failed.");
      else applyProposal(result.proposal);
    });
  }

  function runBarcodeLookup() {
    if (!barcode.trim()) { setMessage("Enter a barcode."); return; }
    setMessage(null);
    startTransition(async () => {
      const result = await lookupBarcodeAction(barcode.trim());
      if (!result.ok) setMessage(result.message ?? "Lookup failed.");
      else applyProposal(result.proposal);
    });
  }

  function runUsdaSearch() {
    if (!usdaQuery.trim()) { setMessage("Enter a search term."); return; }
    setMessage(null);
    startTransition(async () => {
      const result = await searchUsdaAction(usdaQuery.trim());
      if (!result.ok) setMessage(result.message ?? "Search failed.");
      else setUsdaResults(result.results ?? []);
    });
  }

  function runUsdaImport(fdcId: number) {
    setMessage(null);
    startTransition(async () => {
      const result = await importUsdaAction(fdcId);
      if (!result.ok) setMessage(result.message ?? "Import failed.");
      else applyProposal(result.proposal);
    });
  }

  function onImageFile(file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage("That image is larger than 5 MB. Pick a smaller one.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setMessage("That does not look like an image.");
      return;
    }
    setAiImageMime(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      const comma = r.indexOf(",");
      setAiImage(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.readAsDataURL(file);
  }

  function save() {
    setMessage(null);
    const input = buildInput();
    startTransition(async () => {
      const result =
        mode === "create"
          ? await saveCapturedFoodAction(input)
          : await updateCapturedFoodAction(initial!.id, input);
      if (!result.ok) {
        setMessage(result.message ?? "Could not save.");
        return;
      }
      clearDraftOnSave();
      router.push("/foods");
      router.refresh();
    });
  }

  function promote() {
    if (!initial) return;
    startTransition(async () => {
      const result = await promoteFoodToRecipeAction(initial.id);
      if (!result.ok) setMessage(result.message ?? "Could not promote.");
      else {
        clearDraftOnSave();
        router.push(`/recipes/${result.recipeId}`);
      }
    });
  }

  const knownCount = NUTRIENT_CODES.filter((code) => (nutrients[code] ?? "").trim() !== "").length;

  return (
    <main className="mx-auto max-w-3xl px-5 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/foods" className="text-[11px] text-ink/40 hover:text-ink/60">
            ← Foods
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {mode === "create" ? "New food" : `Edit ${initial?.name}`}
          </h1>
          <p className="mt-1 max-w-md text-xs text-muted">
            {mode === "create"
              ? "Add your own food — a home-made prep, a packaged product, or something you track. Everything here is editable; nothing is saved until you say so."
              : "Edit the record. Leaving with unsaved changes keeps a local draft until you come back."}
          </p>
        </div>
        {mode === "edit" && initial && (
          <Link href={`/foods/${initial.id}`} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:bg-ink/5">
            View
          </Link>
        )}
      </div>

      {draftBanner !== "hidden" && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-[11px]">
          <span className="flex-1">
            {draftBanner === "restoring" ? "Draft restored." : "You have an unsaved draft from last time."}
          </span>
          {draftBanner === "restore" && (
            <>
              <button type="button" onClick={restoreDraft} className="rounded-md bg-accent px-2 py-1 text-accent-fg">Restore</button>
              <button type="button" onClick={discardDraft} className="rounded-md border border-line px-2 py-1">Discard</button>
            </>
          )}
        </div>
      )}

      {/* ── How you want to start ───────────────────────────────────── */}
      <section className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold">How would you like to start?</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METHODS.map((item) => {
            const disabled = item.id === "ai" && !aiAvailable;
            const active = method === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => setMethod(item.id)}
                aria-pressed={active}
                className={[
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition",
                  disabled
                    ? "cursor-not-allowed border-line/60 bg-bg opacity-40"
                    : active
                      ? "border-accent bg-accent/5 ring-2 ring-accent/20"
                      : "border-line bg-bg hover:border-accent/40 hover:bg-surface",
                ].join(" ")}
              >
                <span className="text-lg leading-none" aria-hidden>{item.emoji}</span>
                <span className="text-xs font-semibold">{item.title}</span>
                <span className="text-[10px] leading-snug text-muted">{item.blurb}</span>
                {disabled && (
                  <span className="mt-0.5 text-[10px] font-medium text-warn-ink">
                    AI off — <Link href="/settings" className="underline">enable in Settings</Link>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {method === "ai" && aiAvailable && (
          <div className="mt-3 rounded-xl border border-line/70 bg-bg p-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Describe the food</span>
              <textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                rows={2}
                placeholder="e.g. 100 g of home-made paneer, full fat"
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={runTextExtract} disabled={pending || !aiText.trim()} className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                Fill from text
              </button>
              <span className="text-[10px] text-muted">or</span>
              <label className="cursor-pointer rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:bg-ink/5">
                {aiImage ? "Label photo ready ✓" : "Upload label photo"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onImageFile(e.target.files?.[0] ?? null)} />
              </label>
              {aiImage && (
                <>
                  <input value={aiNote} onChange={(e) => setAiNote(e.target.value)} placeholder="note (per 100 g, front of pack…)" className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px]" />
                  <button type="button" onClick={runImageExtract} disabled={pending} className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                    Fill from photo
                  </button>
                </>
              )}
            </div>
            {rationale && <p className="mt-2 text-[11px] italic text-muted">{rationale}</p>}
          </div>
        )}

        {method === "barcode" && (
          <div className="mt-3 rounded-xl border border-line/70 bg-bg p-3">
            <label className="flex flex-wrap items-end gap-2 text-xs">
              <span className="flex w-full flex-col gap-1">
                <span className="font-medium">Barcode</span>
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runBarcodeLookup()}
                  placeholder="e.g. 8901030835511"
                  inputMode="numeric"
                  className="w-56 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                />
              </span>
              <button type="button" onClick={runBarcodeLookup} disabled={pending || !barcode.trim()} className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                Look up
              </button>
            </label>
            <p className="mt-1 text-[10px] text-muted">Open Food Facts. Packaged products.</p>
          </div>
        )}

        {method === "usda" && (
          <div className="mt-3 rounded-xl border border-line/70 bg-bg p-3">
            <div className="flex flex-wrap items-end gap-2">
              <input
                value={usdaQuery}
                onChange={(e) => setUsdaQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runUsdaSearch()}
                placeholder="paneer, chicken, moong dal…"
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs"
              />
              <button type="button" onClick={runUsdaSearch} disabled={pending || !usdaQuery.trim()} className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                Search
              </button>
            </div>
            {usdaResults.length > 0 && (
              <ul className="mt-2 max-h-44 overflow-auto rounded-md border border-line bg-surface p-1 text-xs">
                {usdaResults.map((r) => (
                  <li key={r.fdcId} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-ink/5">
                    <span className="min-w-0 truncate">{r.name}{r.category ? ` · ${r.category}` : ""}</span>
                    <button type="button" onClick={() => runUsdaImport(r.fdcId)} className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[10px] font-medium">
                      Import ({r.nutrients} nutrients)
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[10px] text-muted">Public-domain USDA FoodData Central.</p>
          </div>
        )}
      </section>

      {/* ── The food ────────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold">The food</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            <span className="font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Mom's curd" className="rounded-md border border-line bg-bg px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            <span className="font-medium">Also known as <span className="font-normal text-muted">(optional, comma separated)</span></span>
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="dahi, kalonji curd…" className="rounded-md border border-line bg-bg px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-2 text-sm">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as never)} className="rounded-md border border-line bg-bg px-2 py-2 text-sm">
              <option value="provisional">Homemade / provisional</option>
              <option value="branded">Branded / packaged</option>
              <option value="raw">Raw ingredient</option>
              <option value="composite">Composite</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">State</span>
            <select value={state} onChange={(e) => setState(e.target.value as never)} className="rounded-md border border-line bg-bg px-2 py-2 text-sm">
              <option value="raw">Raw</option>
              <option value="cooked">Cooked</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Nutrients are per…</span>
            <select value={basis} onChange={(e) => setBasis(e.target.value as never)} className="rounded-md border border-line bg-bg px-2 py-2 text-sm">
              <option value="per_100g">100 g</option>
              <option value="per_serving">one serving</option>
              <option value="per_pack">the pack</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Serving size <span className="font-normal text-muted">(g)</span></span>
            <input value={servingSizeG} onChange={(e) => setServingSizeG(e.target.value)} className="rounded-md border border-line bg-bg px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Servings per pack</span>
            <input value={servingsPerPack} onChange={(e) => setServingsPerPack(e.target.value)} className="rounded-md border border-line bg-bg px-3 py-2 text-sm" />
          </label>
        </div>

        {/* Portions */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/50">Household portions</h3>
            <button
              type="button"
              onClick={() => setPortions([...portions, { label: "", grams: "" }])}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              + Add portion
            </button>
          </div>
          {portions.length === 0 && (
            <p className="mt-1 text-[11px] text-muted">Optional. "1 katori = 100 g", "1 tbsp = 14 g" — helps you plan without scales.</p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-2">
            {portions.map((portion, index) => (
              <span key={index} className="flex items-center gap-1 rounded-full border border-line bg-bg py-1 pl-3 text-xs">
                <input
                  value={portion.label}
                  onChange={(e) => {
                    const next = [...portions];
                    next[index] = { ...next[index], label: e.target.value };
                    setPortions(next);
                  }}
                  placeholder="1 katori"
                  className="w-24 border-0 bg-transparent p-0 focus:outline-none"
                />
                <span className="text-muted">≈</span>
                <input
                  value={portion.grams}
                  onChange={(e) => {
                    const next = [...portions];
                    next[index] = { ...next[index], grams: e.target.value };
                    setPortions(next);
                  }}
                  className="w-12 border-0 bg-transparent p-0 text-right focus:outline-none"
                />
                <span className="text-muted">g</span>
                <button type="button" onClick={() => setPortions(portions.filter((_, i) => i !== index))} aria-label="Remove portion" className="px-1 text-muted hover:text-ink">×</button>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Nutrients ───────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Nutrients</h2>
            <p className="text-[11px] text-muted">Per 100 g unless you chose a different basis. Leave blank = unknown, never zero.</p>
          </div>
          <span className="tabular text-[11px] text-ink/50">{knownCount}/{NUTRIENT_CODES.length} known</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {NUTRIENT_CODES.map((code) => {
            const meta = NUMERIC_PRECISION[code];
            return (
              <label key={code} className="flex items-baseline justify-between gap-1.5 rounded-lg border border-line bg-bg px-2 py-1.5">
                <span className="text-[10px] leading-tight text-ink/60">{meta.label}</span>
                <span className="flex items-baseline gap-1">
                  <input
                    value={nutrients[code] ?? ""}
                    onChange={(e) => setNutrients((prev) => ({ ...prev, [code]: e.target.value }))}
                    inputMode="decimal"
                    className="w-16 rounded border-0 bg-transparent p-0 text-right text-xs focus:outline-none"
                  />
                  <span className="text-[9px] text-muted">{meta.unit}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 -mx-5 mt-4 border-t border-line/70 bg-canvas/90 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { clearDraftOnSave(); router.push("/foods"); }}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
          >
            Cancel
          </button>
          <div className="ml-auto flex items-center gap-2">
            {message && <p className="max-w-xs truncate text-[11px] text-muted" title={message}>{message}</p>}
            {mode === "edit" && initial && (
              <button type="button" onClick={promote} disabled={pending} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                Promote to recipe
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending || !name.trim()}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
            >
              {pending ? "Saving…" : mode === "create" ? "Save food" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
