import Link from "next/link";
import { ThemeSettingsPanel } from "@/components/theme-settings";
import { InstallAppCard } from "@/components/install-app-card";
import { AiSettingsPanel } from "@/components/ai-settings";
import { AiInstructionsPanel } from "@/components/ai-instructions-panel";
import { DataPortabilityPanel } from "@/components/data-portability";
import { DataDeletionPanel } from "@/components/data-deletion";
import { PeopleSettingsPanel } from "@/components/people-settings";
import { TargetSettingsPanel } from "@/components/target-settings";
import { getMasterPrompt, getTargetRules } from "@/lib/db/settings";
import { getPurgePreview } from "@/lib/db/purge";
import { getProfile } from "@/lib/db/profile";
import {
  getHousehold,
  listPeople,
  personDeletionCounts,
} from "@/lib/db/people";
import { getActivePerson } from "@/lib/person-server";
import { targetsFor } from "@/lib/targets";
import { aiStatus } from "@/lib/ai/client";
import { PageHeader } from "@/components/page-header";
import { Rise } from "@/components/motion/reveal";
import { readAiConfig } from "@/lib/ai/config";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const person = await getActivePerson();
  const rules = getTargetRules(person.id);
  const recommended = targetsFor(getProfile(person.id), { ...rules, overrides: {} });

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4">
        <PageHeader
          title="Settings"
          kicker="People · targets · appearance"
          lead={
            <>
              Appearance is local to this browser. Recommended targets come from{" "}
              <Link href="/profile" className="underline underline-offset-2 hover:text-ink">
                {person.displayName}&apos;s profile
              </Link>
              ; the thresholds and overrides below sit on top of them.
            </>
          }
        />
      </div>

      <Rise delay={0.05}>
        <PeopleSettingsPanel
          activePersonId={person.id}
          householdName={getHousehold().name}
          people={listPeople({ includeArchived: true }).map((member) => ({
            id: member.id,
            displayName: member.displayName,
            archivedAt: member.archivedAt,
            counts: personDeletionCounts(member.id),
          }))}
        />
      </Rise>
      <Rise delay={0.1} className="mt-6">
        <TargetSettingsPanel
          key={person.id}
          personId={person.id}
          personName={person.displayName}
          initial={rules}
          recommended={recommended}
        />
      </Rise>
      <Rise delay={0.15} className="mt-6">
        <ThemeSettingsPanel />
      </Rise>
      <Rise delay={0.18} className="mt-6">
        <InstallAppCard />
      </Rise>
      <Rise delay={0.2} className="mt-6">
        <AiSettingsPanel status={aiStatus()} config={readAiConfig() ?? {}} />
      </Rise>
      <Rise delay={0.25} className="mt-6">
        <AiInstructionsPanel initial={getMasterPrompt()} />
      </Rise>
      <Rise delay={0.3} className="mt-6">
        <DataPortabilityPanel
          key={person.id}
          people={listPeople().map((person) => ({
            id: person.id,
            displayName: person.displayName,
          }))}
          activePersonId={person.id}
        />
      </Rise>
      <Rise delay={0.35} className="mt-6">
        <DataDeletionPanel key={person.id} initialPreview={getPurgePreview("person", person.id)} />
      </Rise>
    </main>
  );
}
