"use client";

import { useState, useTransition } from "react";
import { importInndbAction } from "@/app/actions";

const DEFAULT_MAPPING = {
  name: "Food name",
  aliases: "Aliases",
  category: "Food group",
  code: "Food code",
  defaultCategory: "Indian",
  defaultKind: "raw",
  nutrients: {
    "Energy (kcal)": "ENERC_KCAL",
    "Protein (g)": "PROCNT",
    "Fat (g)": "FAT",
    "Carbohydrate (g)": "CHOCDF",
    "Dietary fibre (g)": "FIBTG",
    "Total sugars (g)": "SUGAR",
    "Sodium (mg)": "NA",
    "Potassium (mg)": "K",
    "Calcium (mg)": "CA",
    "Iron (mg)": "FE",
    "Zinc (mg)": "ZN",
    "Magnesium (mg)": "MG",
    "Vitamin A (µg)": "VITA_RAE",
    "Vitamin C (mg)": "VITC",
    "Vitamin D (µg)": "VITD",
    "Vitamin B12 (µg)": "VITB12",
    "Folate (µg)": "FOL",
    "Vitamin B6 (mg)": "VITB6",
  },
};

export function InndbImporter() {
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState(JSON.stringify(DEFAULT_MAPPING, null, 2));
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setResult(null);
    startTransition(async () => {
      const r = await importInndbAction(csv, mapping);
      if (!r.ok) setResult(r.message ?? "Import failed.");
      else setResult(`Imported ${r.imported}, skipped ${r.skipped}, ${r.errors?.length ?? 0} errors.`);
    });
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">CSV data</span>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={12}
            placeholder="Food name,Energy (kcal),Protein (g),..."
            className="rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs"
          />
        </label>
      </div>
      <div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Column mapping (JSON)</span>
          <textarea
            value={mapping}
            onChange={(e) => setMapping(e.target.value)}
            rows={12}
            className="rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs"
          />
        </label>
      </div>
      <div className="lg:col-span-2">
        <button
          type="button"
          onClick={run}
          disabled={pending || !csv.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
        >
          {pending ? "Importing…" : "Import"}
        </button>
        {result && <p className="mt-2 text-xs text-muted">{result}</p>}
      </div>
    </div>
  );
}
