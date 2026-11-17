import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { dataFile } from "@/lib/data-dir";
import type { AiConfig } from "./types";

const CONFIG_PATH = dataFile("ai-config.json");

export function readAiConfig(): AiConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AiConfig;
  } catch {
    return null;
  }
}

export function writeAiConfig(config: AiConfig): void {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function defaultAiConfig(): AiConfig {
  return { enabled: true, provider: "gemini", model: "gemini-2.0-flash", dailyCallCap: 200 };
}
