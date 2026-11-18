"use client";

import { useState, useTransition } from "react";
import {
  saveAiConfigAction,
  removeAiKeyAction,
  setAiKeyAction,
  testAiConnectionAction,
  testProviderAction,
  listAiModelsAction,
} from "@/app/actions";

const PROVIDERS = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic Claude" },
  { id: "openai-compatible", label: "OpenAI-compatible (Groq, Together, Ollama, …)" },
];

/** Plain-language headings for the error categories the actions return. */
const FAILURE_LABELS: Record<string, string> = {
  http: "Provider rejected the request",
  timeout: "Provider timed out",
  network: "Network error",
  config: "Configuration problem",
  unknown: "Unexpected error",
};

interface Failure {
  kind: string;
  message: string;
  detail?: string;
}

function failureText(failure: Failure): string {
  return [
    "NutriPlan AI error",
    `type: ${failure.kind}`,
    `message: ${failure.message}`,
    failure.detail ? `detail: ${failure.detail}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

interface Props {
  status: {
    enabled: boolean;
    configured: boolean;
    imageConfigured: boolean;
    provider: string;
    model: string;
    fallback?: string;
    dailyCap: number;
    callsToday: number;
  };
  config: {
    fallbackProvider?: string;
    fallbackModel?: string;
    fallbackBaseUrl?: string;
    imageProvider?: string;
    imageModel?: string;
    imageBaseUrl?: string;
    imageFallbackProvider?: string;
    imageFallbackModel?: string;
    imageFallbackBaseUrl?: string;
    baseUrl?: string;
  };
}

export function AiSettingsPanel({ status, config }: Props) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [provider, setProvider] = useState(status.provider);
  const [model, setModel] = useState(status.model);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? "");
  const [key, setKey] = useState("");

  const [fallbackProvider, setFallbackProvider] = useState(config.fallbackProvider ?? "");
  const [fallbackModel, setFallbackModel] = useState(config.fallbackModel ?? "");
  const [fallbackBaseUrl, setFallbackBaseUrl] = useState(config.fallbackBaseUrl ?? "");
  const [fallbackKey, setFallbackKey] = useState("");

  const [imageProvider, setImageProvider] = useState(config.imageProvider ?? "");
  const [imageModel, setImageModel] = useState(config.imageModel ?? "");
  const [imageBaseUrl, setImageBaseUrl] = useState(config.imageBaseUrl ?? "");
  const [imageKey, setImageKey] = useState("");

  const [imageFallbackProvider, setImageFallbackProvider] = useState(config.imageFallbackProvider ?? "");
  const [imageFallbackModel, setImageFallbackModel] = useState(config.imageFallbackModel ?? "");
  const [imageFallbackBaseUrl, setImageFallbackBaseUrl] = useState(config.imageFallbackBaseUrl ?? "");
  const [imageFallbackKey, setImageFallbackKey] = useState("");

  const [cap, setCap] = useState(String(status.dailyCap));
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isCompatible = provider === "openai-compatible";

  function showFailure(
    result: { message?: string; kind?: string; detail?: string },
    fallback: string,
  ) {
    setMessage(null);
    setErrorCopied(false);
    setFailure({
      kind: result.kind ?? "unknown",
      message: result.message ?? fallback,
      detail: result.detail,
    });
  }

  function showSuccess(text: string) {
    setFailure(null);
    setErrorCopied(false);
    setMessage(text);
  }

  async function writeClipboard(text: string): Promise<boolean> {
    try {
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function save() {
    setMessage(null);
    setFailure(null);
    startTransition(async () => {
      const result = await saveAiConfigAction({
        enabled,
        provider,
        model,
        baseUrl: isCompatible ? baseUrl : undefined,
        fallbackProvider: fallbackProvider || undefined,
        fallbackModel: fallbackModel || undefined,
        fallbackBaseUrl: fallbackProvider === "openai-compatible" ? fallbackBaseUrl : undefined,
        imageProvider: imageProvider || undefined,
        imageModel: imageModel || undefined,
        imageBaseUrl: imageProvider === "openai-compatible" ? imageBaseUrl : undefined,
        imageFallbackProvider: imageFallbackProvider || undefined,
        imageFallbackModel: imageFallbackModel || undefined,
        imageFallbackBaseUrl: imageFallbackProvider === "openai-compatible" ? imageFallbackBaseUrl : undefined,
        dailyCallCap: Number(cap) || undefined,
        key: key || undefined,
      });
      // save keys for fallback/image providers if entered
      if (fallbackKey)
        await saveKeyOnly(
          fallbackProvider,
          fallbackKey,
          setFallbackKey,
          fallbackProvider === "openai-compatible" ? fallbackBaseUrl : undefined,
        );
      if (imageKey)
        await saveKeyOnly(
          imageProvider,
          imageKey,
          setImageKey,
          imageProvider === "openai-compatible" ? imageBaseUrl : undefined,
        );
      if (imageFallbackKey)
        await saveKeyOnly(
          imageFallbackProvider,
          imageFallbackKey,
          setImageFallbackKey,
          imageFallbackProvider === "openai-compatible" ? imageFallbackBaseUrl : undefined,
        );
      if (!result.ok) showFailure(result, "Could not save.");
      else {
        showSuccess("Saved.");
        setKey("");
      }
    });
  }

  async function saveKeyOnly(
    providerId: string,
    keyValue: string,
    reset: (v: string) => void,
    baseUrl?: string,
  ) {
    if (!providerId || !keyValue.trim()) return;
    await setAiKeyAction(providerId, keyValue, baseUrl);
    reset("");
  }

  function testPrimary() {
    setMessage(null);
    // A typed-but-unsaved key cannot be used: the test reads the stored key.
    // Say so instead of failing with a confusing "no key" error.
    if (key.trim()) {
      showFailure(
        {
          kind: "config",
          message: "Save the key first, then test the connection.",
        },
        "Connection failed.",
      );
      return;
    }
    setFailure(null);
    startTransition(async () => {
      const result = await testAiConnectionAction({
        provider,
        model,
        baseUrl: isCompatible ? baseUrl : undefined,
      });
      if (!result.ok) showFailure(result, "Connection failed.");
      else showSuccess(`Connected in ${result.latencyMs} ms.`);
    });
  }

  function testProvider(providerId: string, modelId: string, baseUrlValue?: string) {
    setMessage(null);
    setFailure(null);
    startTransition(async () => {
      const result = await testProviderAction({ provider: providerId, model: modelId, baseUrl: baseUrlValue });
      if (!result.ok) showFailure(result, "Connection failed.");
      else showSuccess(`Connected in ${result.latencyMs} ms.`);
    });
  }

  function removeKey(providerId: string) {
    setMessage(null);
    setFailure(null);
    startTransition(async () => {
      await removeAiKeyAction(providerId);
      showSuccess("Key removed.");
    });
  }

  function refreshModels() {
    setMessage(null);
    setFailure(null);
    startTransition(async () => {
      const result = await listAiModelsAction({
        provider,
        baseUrl: isCompatible ? baseUrl : undefined,
      });
      if (!result.ok) showFailure(result, "Could not list models.");
      else {
        setModels(result.models ?? []);
        showSuccess(`Found ${result.models?.length ?? 0} models.`);
      }
    });
  }

  async function copyModelId(id: string) {
    if (!(await writeClipboard(id))) {
      setMessage("Could not copy automatically — select the model ID and copy it.");
      return;
    }
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
  }

  async function copyFailure() {
    if (!failure) return;
    if (!(await writeClipboard(failureText(failure)))) {
      setMessage("Could not copy automatically — select the error text and copy it.");
      return;
    }
    setErrorCopied(true);
    window.setTimeout(() => setErrorCopied(false), 1500);
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-sm font-semibold tracking-tight text-ink">AI access</h2>
      <p className="mt-1 text-xs text-muted">
        NutriPlan never holds a key. You bring your own from Google, OpenAI, Anthropic, or any
        OpenAI-compatible endpoint. Keys are stored in <code>data/secrets.json</code> (mode 0600) or
        an environment variable, never in the database or the browser. The AI key and daily limit
        are shared by the household.
      </p>

      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="font-medium">Enable AI features</span>
        <span className="text-muted">(turn off to use NutriPlan without any model)</span>
      </label>

      {!enabled && (
        <p className="mt-3 text-xs text-muted">
          AI is off. Nothing will call a provider. Turn it back on to configure a key.
        </p>
      )}

      {enabled && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Model <span className="font-normal text-muted">(exact ID)</span></span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gemini-flash-latest" className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
              <span className="text-[10px] text-muted">Use the exact model ID, not the display name.</span>
            </label>
            {isCompatible && (
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="font-medium">Base URL</span>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.groq.com/openai/v1" className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="font-medium">API key</span>
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={status.configured ? "configured — leave blank to keep" : "paste key"} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Daily call cap</span>
              <input type="number" value={cap} onChange={(e) => setCap(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
            </label>
          </div>

          {/* Fallback provider */}
          <div className="mt-4 rounded-md border border-line bg-bg p-3">
            <p className="text-xs font-medium">Fallback provider (optional)</p>
            <p className="text-[11px] text-muted">Used when the primary fails after retries. Can be a different provider with its own key.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select value={fallbackProvider} onChange={(e) => setFallbackProvider(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm">
                <option value="">None</option>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)} placeholder="model id" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm" />
              {fallbackProvider === "openai-compatible" && (
                <input value={fallbackBaseUrl} onChange={(e) => setFallbackBaseUrl(e.target.value)} placeholder="base URL" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm sm:col-span-2" />
              )}
              <input type="password" autoComplete="off" value={fallbackKey} onChange={(e) => setFallbackKey(e.target.value)} placeholder="fallback API key (leave blank to keep)" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm sm:col-span-2" />
            </div>
            {fallbackProvider && (
              <button type="button" onClick={() => testProvider(fallbackProvider, fallbackModel, fallbackProvider === "openai-compatible" ? fallbackBaseUrl : undefined)} disabled={pending} className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                Test fallback
              </button>
            )}
          </div>

          {/* Image provider */}
          <div className="mt-4 rounded-md border border-line bg-bg p-3">
            <p className="text-xs font-medium">Image provider (optional override for label scans)</p>
            <p className="text-[11px] text-muted">Defaults to the primary provider. Set a separate one if your primary lacks vision.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select value={imageProvider} onChange={(e) => setImageProvider(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm">
                <option value="">Use primary</option>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="model id" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm" />
              {imageProvider === "openai-compatible" && (
                <input value={imageBaseUrl} onChange={(e) => setImageBaseUrl(e.target.value)} placeholder="base URL" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm sm:col-span-2" />
              )}
              <input type="password" autoComplete="off" value={imageKey} onChange={(e) => setImageKey(e.target.value)} placeholder="image API key (leave blank to keep)" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm sm:col-span-2" />
            </div>
            {imageProvider && (
              <button type="button" onClick={() => testProvider(imageProvider, imageModel, imageProvider === "openai-compatible" ? imageBaseUrl : undefined)} disabled={pending} className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                Test image provider
              </button>
            )}

            <p className="mt-3 text-xs font-medium">Image fallback (optional)</p>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <select value={imageFallbackProvider} onChange={(e) => setImageFallbackProvider(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm">
                <option value="">None</option>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input value={imageFallbackModel} onChange={(e) => setImageFallbackModel(e.target.value)} placeholder="model id" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm" />
              {imageFallbackProvider === "openai-compatible" && (
                <input value={imageFallbackBaseUrl} onChange={(e) => setImageFallbackBaseUrl(e.target.value)} placeholder="base URL" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm sm:col-span-2" />
              )}
              <input type="password" autoComplete="off" value={imageFallbackKey} onChange={(e) => setImageFallbackKey(e.target.value)} placeholder="image fallback API key (leave blank to keep)" className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm sm:col-span-2" />
            </div>
            {imageFallbackProvider && (
              <button type="button" onClick={() => testProvider(imageFallbackProvider, imageFallbackModel, imageFallbackProvider === "openai-compatible" ? imageFallbackBaseUrl : undefined)} disabled={pending} className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                Test image fallback
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">Save</button>
            <button type="button" onClick={testPrimary} disabled={pending} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50">Test primary</button>
            <button type="button" onClick={refreshModels} disabled={pending} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50">List models</button>
            <button type="button" onClick={() => removeKey(provider)} disabled={pending} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-warn disabled:opacity-50">Remove primary key</button>
          </div>

          {message && (
            <p role="status" className="mt-2 text-xs text-muted">
              {message}
            </p>
          )}

          {failure && (
            <div className="mt-2 flex items-start justify-between gap-2 rounded-md border border-line bg-bg p-2 text-xs">
              <div role="alert" className="min-w-0 flex-1">
                <p className="font-medium text-warn">
                  {FAILURE_LABELS[failure.kind] ?? "Error"}
                  <span className="ml-1 font-normal text-muted">({failure.kind})</span>
                </p>
                <p className="mt-0.5">{failure.message}</p>
                {failure.detail && (
                  <p className="mt-1 break-all font-mono text-[10px] text-muted">
                    {failure.detail}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-muted">
                  Safe to share — keys are redacted.
                </p>
                {/* Shown verbatim so the clipboard-fallback instruction is
                    actionable: the user can select and copy this block. */}
                <pre className="mt-2 select-all whitespace-pre-wrap break-all rounded border border-line bg-surface p-2 font-mono text-[10px] text-muted">
                  {failureText(failure)}
                </pre>
              </div>
              <button
                type="button"
                onClick={copyFailure}
                className="shrink-0 rounded border border-line px-2 py-0.5 text-[10px] font-medium hover:bg-surface"
              >
                {errorCopied ? "Copied" : "Copy error"}
              </button>
            </div>
          )}
          <span role="status" className="sr-only">
            {errorCopied ? "Error copied to clipboard." : ""}
          </span>

          {models && models.length > 0 && (
            <div className="mt-3 rounded-md border border-line bg-bg p-2 text-xs">
              <p className="px-1 pb-1 text-[11px] text-muted">
                Click a row to use that model. The monospace line is the exact ID.
              </p>
              <div className="max-h-56 overflow-auto">
                {models.slice(0, 60).map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-surface">
                    <button
                      type="button"
                      onClick={() => setModel(m.id)}
                      className="min-w-0 flex-1 rounded text-left"
                      aria-label={`Use model ${m.id}`}
                    >
                      <span className="block truncate font-medium">{m.label}</span>
                      <span className="block truncate font-mono text-[10px] text-muted">{m.id}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyModelId(m.id)}
                      className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium hover:bg-bg"
                      aria-label={`Copy model ID ${m.id}`}
                    >
                      {copied === m.id ? "Copied" : "Copy ID"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <span role="status" className="sr-only">
            {copied ? "Model ID copied to clipboard." : ""}
          </span>
        </>
      )}

      <p className="mt-3 text-[11px] text-muted">
        Status: {status.configured ? "key configured" : "no key"} · {status.callsToday}/{status.dailyCap} calls today.
        {status.imageConfigured ? " · image override set" : ""}
      </p>
    </section>
  );
}
