"use client";

import { useState, useTransition } from "react";
import {
  saveAiConfigAction,
  removeAiKeyAction,
  testAiConnectionAction,
  listAiModelsAction,
} from "@/app/actions";

const PROVIDERS = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic Claude" },
  { id: "openai-compatible", label: "OpenAI-compatible (Groq, Together, Ollama, …)" },
];

export function AiSettingsPanel({ status }: { status: ReturnType<typeof import("@/lib/ai/client").aiStatus> }) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [provider, setProvider] = useState(status.provider);
  const [model, setModel] = useState(status.model);
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [fallback, setFallback] = useState(status.fallback ?? "");
  const [cap, setCap] = useState(String(status.dailyCap));
  const [message, setMessage] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  const [pending, startTransition] = useTransition();

  const isCompatible = provider === "openai-compatible";

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveAiConfigAction({
        enabled,
        provider,
        model,
        fallbackProvider: fallback || undefined,
        fallbackModel: fallback ? model : undefined,
        baseUrl: isCompatible ? baseUrl : undefined,
        dailyCallCap: Number(cap) || undefined,
        key: key || undefined,
      });
      if (!result.ok) setMessage(result.message ?? "Could not save.");
      else {
        setMessage("Saved.");
        setKey("");
      }
    });
  }

  function test() {
    setMessage(null);
    startTransition(async () => {
      const result = await testAiConnectionAction();
      if (!result.ok) setMessage(result.message ?? "Connection failed.");
      else setMessage(`Connected in ${result.latencyMs} ms.`);
    });
  }

  function removeKey() {
    setMessage(null);
    startTransition(async () => {
      await removeAiKeyAction(provider);
      setMessage("Key removed.");
    });
  }

  function refreshModels() {
    setMessage(null);
    startTransition(async () => {
      const result = await listAiModelsAction();
      if (!result.ok) setMessage(result.message ?? "Could not list models.");
      else {
        setModels(result.models ?? []);
        setMessage(`Found ${result.models?.length ?? 0} models.`);
      }
    });
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold">AI access</h2>
      <p className="mt-1 text-xs text-muted">
        NutriPlan never holds a key. You bring your own from Google, OpenAI, Anthropic, or any
        OpenAI-compatible endpoint. Keys are stored in <code>data/secrets.json</code> (mode 0600) or
        an environment variable, never in the database or the browser.
      </p>

      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="font-medium">Enable AI features</span>
        <span className="text-muted">(turn off to use NutriPlan without any model)</span>
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Model</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. gemini-2.0-flash"
            className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
          />
        </label>

        {isCompatible && (
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            <span className="font-medium">Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.groq.com/openai/v1"
              className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          <span className="font-medium">API key</span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={status.hasKey ? "•••• (configured — leave blank to keep)" : "paste key"}
            className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Fallback provider (optional)</span>
          <select
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
            className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
          >
            <option value="">None</option>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Daily call cap</span>
          <input
            type="number"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={test}
          disabled={!enabled || pending}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          Test connection
        </button>
        <button
          type="button"
          onClick={refreshModels}
          disabled={pending}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          List models
        </button>
        <button
          type="button"
          onClick={removeKey}
          disabled={pending}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-warn disabled:opacity-50"
        >
          Remove key
        </button>
      </div>

      {message && <p className="mt-2 text-xs text-muted">{message}</p>}

      {models && models.length > 0 && (
        <div className="mt-3 max-h-40 overflow-auto rounded-md border border-line bg-bg p-2 text-xs">
          {models.slice(0, 60).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModel(m.id)}
              className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-surface"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted">
        Status: {status.hasKey ? "key configured" : "no key"} · {status.callsToday}/{status.dailyCap} calls today.
      </p>
    </section>
  );
}
