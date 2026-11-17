import { readFileSync, existsSync } from "node:fs";
import { dataFile, ensureDataDir } from "@/lib/data-dir";
import { atomicWritePrivateFile } from "@/lib/security/private-files";
import type { AiConfig } from "./types";

const CONFIG_PATH = dataFile("ai-config.json");

export function readAiConfig(): AiConfig | null {
  ensureDataDir();
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AiConfig;
  } catch {
    return null;
  }
}

export function writeAiConfig(config: AiConfig): void {
  // Atomic and `0600`: a crash mid-write used to truncate the file, and the
  // default umask left it world-readable next to the database.
  atomicWritePrivateFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function defaultAiConfig(): AiConfig {
  // `gemini-flash-latest` is Google's moving alias for the current Flash
  // model. The old pinned `gemini-2.0-flash` now returns 404, which made a
  // fresh install's first connection test fail before the user changed
  // anything. The Settings list shows exact IDs, so pinning remains easy.
  return { enabled: true, provider: "gemini", model: "gemini-flash-latest", dailyCallCap: 200 };
}
