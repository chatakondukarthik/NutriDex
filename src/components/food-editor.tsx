"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveCapturedFoodAction,
  updateCapturedFoodAction,
  extractFoodAction,
  promoteFoodToRecipeAction,
} from "@/app/actions";
import type { CapturedFoodInput } from "@/lib/captured-food";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";
import type { Food } from "@/lib/nutrition/types";

const CATEGORIES = ["Dairy", "Grains", "Vegetables", "Fruits", "Legumes", "Oils", "Nuts", "Meat", "Seafood", "Spices", "Beverages", "Custom"];

interface Props {
  initial?: Food;
  mode: "create" | "edit";
}

export function FoodEditor({ initial, mode }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [category, setCategory] = useState(initial?.category ?? "Custom");
  const [kind, setKind] = useState(initial?.kind ?? "provisional");
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
  const [aiImage, setAiImage] = useState<string | null>(null);
  const [aiImageMime, setAiImageMime] = useState<string>("image/jpeg");
  const [rationale, setRationale] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      source: "manual",
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
    if (proposal.rationale) setRationale(proposal.rationale);
    setMessage("Filled from AI. Review before saving.");
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

  function onImageFile(file: File | null) {
    if (!file) return;
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
      setMessage("Saved.");
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
        setMessage("Promoted to a recipe.");
        router.push(`/recipes/${result.recipeId}`);
      }
    });
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === "create" ? "New food" : `Edit ${initial?.name}`}
      </h1>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {/* Manual form */}
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold">Details</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="font-medium">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="font-medium">Also known as (comma separated)</span>
              <input value={aliases} onChange={(e) => setAliases(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
                <option value="provisional">Homemade / provisional</option>
                <option value="branded">Branded / packaged</option>
                <option value="raw">Raw ingredient</option>
                <option value="composite">Composite</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">State</span>
              <select value={state} onChange={(e) => setState(e.target.value as any)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
                <option value="raw">Raw</option>
                <option value="cooked">Cooked</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Nutrition basis</span>
              <select value={basis} onChange={(e) => setBasis(e.target.value as any)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
                <option value="per_100g">Per 100 g</option>
                <option value="per_serving">Per serving</option>
                <option value="per_pack">Per pack</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Serving size (g)</span>
              <input value={servingSizeG} onChange={(e) => setServingSizeG(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Servings per pack</span>
              <input value={servingsPerPack} onChange={(e) => setServingsPerPack(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
            </label>
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium">Household portions</p>
            {portions.map((p, i) => (
              <div key={i} className="mt-1 flex gap-2">
                <input
                  value={p.label}
                  onChange={(e) => {
                    const next = [...portions];
                    next[i] = { ...next[i], label: e.target.value };
                    setPortions(next);
                  }}
                  placeholder="1 katori"
                  className="flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
                />
                <input
                  value={p.grams}
                  onChange={(e) => {
                    const next = [...portions];
                    next[i] = { ...next[i], grams: e.target.value };
                    setPortions(next);
                  }}
                  placeholder="100"
                  className="w-20 rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setPortions(portions.filter((_, j) => j !== i))}
                  className="text-xs text-muted hover:text-ink"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPortions([...portions, { label: "", grams: "" }])}
              className="mt-2 text-xs text-muted underline underline-offset-2 hover:text-ink"
            >
              + Add portion
            </button>
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium">Nutrients (per 100 g)</p>
            <p className="text-[11px] text-muted">Leave blank what you do not know. Blank is unknown, never zero.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {NUTRIENT_CODES.map((code) => (
                <label key={code} className="flex flex-col gap-0.5 text-[11px]">
                  <span className="text-muted">{code}</span>
                  <input
                    value={nutrients[code] ?? ""}
                    onChange={(e) => setNutrients({ ...nutrients, [code]: e.target.value })}
                    className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
            >
              {mode === "create" ? "Save food" : "Save changes"}
            </button>
            {mode === "edit" && initial && (
              <button
                type="button"
                onClick={promote}
                disabled={pending}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                Promote to recipe
              </button>
            )}
          </div>
          {message && <p className="mt-2 text-xs text-muted">{message}</p>}
          {rationale && <p className="mt-2 text-xs italic text-muted">{rationale}</p>}
        </section>

        {/* AI assist */}
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold">Fill from AI</h2>
          <p className="mt-1 text-xs text-muted">
            Describe the food or paste a label. The model proposes values; you review and save.
            Requires a key in Settings.
          </p>

          <label className="mt-3 flex flex-col gap-1 text-xs">
            <span className="font-medium">Description</span>
            <textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              rows={3}
              placeholder="e.g. 100 g of home-made paneer, full fat"
              className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={runTextExtract}
            disabled={pending || !aiText.trim()}
            className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Extract from text
          </button>

          <div className="mt-4">
            <p className="text-xs font-medium">Or a label photo</p>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onImageFile(e.target.files?.[0] ?? null)}
              className="mt-1 block text-xs"
            />
            <label className="mt-2 flex flex-col gap-1 text-xs">
              <span className="font-medium">Note (optional)</span>
              <input
                value={aiNote}
                onChange={(e) => setAiNote(e.target.value)}
                placeholder="e.g. front of pack, per 100 g"
                className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={runImageExtract}
              disabled={pending || !aiImage}
              className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Extract from image
            </button>
            {aiImage && <p className="mt-1 text-[11px] text-muted">Image loaded.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
