import Link from "next/link";
import { ThemeSettingsPanel } from "@/components/theme-settings";
import { AiSettingsPanel } from "@/components/ai-settings";
import { AiInstructionsPanel } from "@/components/ai-instructions-panel";
import { DataPortabilityPanel } from "@/components/data-portability";
import { DataDeletionPanel } from "@/components/data-deletion";
import { TargetSettingsPanel } from "@/components/target-settings";
import { getMasterPrompt, getTargetRules } from "@/lib/db/settings";
import { getPurgePreview } from "@/lib/db/purge";
import { getProfile } from "@/lib/db/profile";
import { targetsFor } from "@/lib/targets";
import { aiStatus } from "@/lib/ai/client";
import { readAiConfig } from "@/lib/ai/config";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const rules = getTargetRules();
  const recommended = targetsFor(getProfile(), { ...rules, overrides: {} });

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-xs text-muted">
          Appearance is local to this browser. Recommended targets come from{" "}
          <Link href="/profile" className="underline underline-offset-2 hover:text-ink">
            Profile
          </Link>
          ; the thresholds and overrides below sit on top of them.
        </p>
      </div>

      <TargetSettingsPanel initial={rules} recommended={recommended} />
      <div className="mt-6">
        <ThemeSettingsPanel />
      </div>
      <div className="mt-6">
        <AiSettingsPanel status={aiStatus()} config={readAiConfig() ?? {}} />
      </div>
      <div className="mt-6">
        <AiInstructionsPanel initial={getMasterPrompt()} />
      </div>
      <div className="mt-6">
        <DataPortabilityPanel />
      </div>
      <div className="mt-6">
        <DataDeletionPanel initialPreview={getPurgePreview()} />
      </div>
    </main>
  );
}
