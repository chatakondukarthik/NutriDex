"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js. The worker is network-first for documents and only
 * caches hashed static assets + the offline shell, so even in development
 * it can never serve a stale build — fresh HTML always wins.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Install affordances degrade silently; the app works fully without a worker.
    });
  }, []);
  return null;
}
