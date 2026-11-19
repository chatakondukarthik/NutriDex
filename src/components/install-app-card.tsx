"use client";

import { useEffect, useState } from "react";

/**
 * "Download the app" card — the PWA install entry point.
 *
 * Three honest states:
 *  - prompt: this browser fired beforeinstallprompt — a real button calls it
 *  - ios: iPhones/iPads never fire it; the install hint is manual
 *  - manual: everything else — one truthful instruction, not a fake button
 * Installed users see a done-state instead of a dead button.
 */

type State = "installed" | "prompt" | "ios" | "manual";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function InstallAppCard() {
  const [state, setState] = useState<State>(() => (detectInstalled() ? "installed" : "manual"));
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !detectInstalled()) {
      setState("ios");
    }
    function onBeforeInstallPrompt(event: Event) {
      // Stop the mini infobar; the card does its own honest button instead.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setState((current) => (current === "installed" ? current : "prompt"));
    }
    function onInstalled() {
      setState("installed");
      setPromptEvent(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setState("installed");
    setPromptEvent(null);
  }

  return (
    <section
      className="rounded-card border border-line bg-surface p-5 shadow-card"
      aria-labelledby="install-app-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="install-app-title" className="font-display text-sm font-semibold tracking-tight text-ink">
            Install NutriPlan
          </h2>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
            Keep the kitchen ledger one tap away. NutriPlan installs like an app — full
            screen, its own icon, works offline once the pages you visit have loaded.
          </p>
        </div>

        {state === "installed" && (
          <p className="rounded-control border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">
            Installed
          </p>
        )}

        {state === "prompt" && (
          <button
            type="button"
            onClick={install}
            className="rounded-control bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition hover:bg-accent-strong"
          >
            Download app
          </button>
        )}
      </div>

      {state === "ios" && (
        <p className="mt-3 rounded-control border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
          On iPhone or iPad: tap the <span className="font-semibold text-ink">Share</span> button
          in Safari, then <span className="font-semibold text-ink">Add to Home Screen</span>.
          NutriPlan opens full-screen with its own icon from there.
        </p>
      )}
      {state === "manual" && (
        <p className="mt-3 rounded-control border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
          Your browser decides when it can offer the install. In Chrome or Edge look for the
          install icon in the address bar, or <span className="font-semibold text-ink">Menu → Install NutriPlan</span>.
        </p>
      )}
    </section>
  );
}
