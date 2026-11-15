import Link from "next/link";
import { ThemeSettingsPanel } from "@/components/theme-settings";
import { AiSettingsPanel } from "@/components/ai-settings";
import { AiInstructionsPanel } from "@/components/ai-instructions-panel";
import { getMasterPrompt } from "@/lib/db/settings";
import { aiStatus } from "@/lib/ai/client";
import { readAiConfig } from "@/lib/ai/config";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-xs text-muted">
          Appearance is local to this browser. Nutrition targets live on{" "}
          <Link href="/profile" className="underline underline-offset-2 hover:text-ink">
            Profile
          </Link>
          .
        </p>
      </div>

      <ThemeSettingsPanel />
      <div className="mt-6">
        <AiSettingsPanel status={aiStatus()} config={readAiConfig() ?? {}} />
      </div>
      <div className="mt-6">
        <AiInstructionsPanel initial={getMasterPrompt()} />
      </div>
    </main>
  );
}
