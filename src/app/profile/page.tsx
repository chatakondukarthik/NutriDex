import Link from "next/link";
import { ProfileForm } from "@/components/profile-form";
import { getProfile } from "@/lib/db/profile";
import { fmt } from "@/lib/format";
import { NUTRIENTS, NUTRIENT_CODES, type NutrientGroup } from "@/lib/nutrition/types";
import { bmr, dailyEnergyKcal, isDefaultProfile, maintenanceKcal, proteinGrams } from "@/lib/profile";
import { targetsFor } from "@/lib/targets";

export const dynamic = "force-dynamic";

const GROUPS: { key: NutrientGroup; label: string }[] = [
  { key: "macro", label: "Macros" },
  { key: "mineral", label: "Minerals" },
  { key: "vitamin", label: "Vitamins" },
];

export default function ProfilePage() {
  const profile = getProfile();
  const targets = targetsFor(profile);
  const targetByCode = new Map(targets.map((target) => [target.code, target]));

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-xs text-black/45">
            Used to work out your daily targets. Nothing here is sent anywhere.
          </p>
        </div>

        {isDefaultProfile(profile) && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            These are the default numbers, not yours. Change them and save to make the diary and
            plan use your targets.
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
          <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h2 className="text-sm font-semibold">Your numbers</h2>
            <p className="mt-1 text-xs text-black/45">
              Energy and protein are calculated from these; the rest are reference values.
            </p>
            <div className="mt-4">
              <ProfileForm profile={profile} />
            </div>
          </section>

          <aside className="lg:sticky lg:top-20">
            <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Targets</h2>
                <Link
                  href="/plan"
                  className="text-[11px] text-black/40 underline underline-offset-2 hover:text-black/60"
                >
                  Plan
                </Link>
              </div>

              <div className="mt-3 space-y-1 rounded-xl bg-[#faf9f7] px-3 py-2.5 text-[11px] text-black/50">
                <div className="flex justify-between gap-2">
                  <span>Basal rate</span>
                  <span className="tabular">{fmt(bmr(profile), 0)} kcal</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Maintenance</span>
                  <span className="tabular">{fmt(maintenanceKcal(profile), 0)} kcal</span>
                </div>
                <div className="flex justify-between gap-2 font-medium text-black/70">
                  <span>Daily target</span>
                  <span className="tabular">{fmt(dailyEnergyKcal(profile), 0)} kcal</span>
                </div>
                <div className="flex justify-between gap-2 font-medium text-black/70">
                  <span>Protein</span>
                  <span className="tabular">{fmt(proteinGrams(profile), 0)} g</span>
                </div>
              </div>

              <p className="mt-2 text-[10px] leading-relaxed text-black/35">
                Saved values are used. Targets update after you save.
              </p>

              <div className="mt-4 space-y-4">
                {GROUPS.map((group) => (
                  <div key={group.key}>
                    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-black/35">
                      {group.label}
                    </h3>
                    <ul className="space-y-1">
                      {NUTRIENT_CODES.filter(
                        (code) => NUTRIENTS[code].group === group.key,
                      ).map((code) => {
                        const meta = NUTRIENTS[code];
                        const target = targetByCode.get(code);
                        return (
                          <li
                            key={code}
                            className="flex items-baseline justify-between gap-2 text-[11px]"
                          >
                            <span className="text-black/60">{meta.label}</span>
                            <span className="tabular text-black/45">
                              {fmt(target?.value ?? null, meta.precision)}
                              {meta.unit === "kcal" ? "" : ` ${meta.unit}`}
                              {target?.direction === "max" && (
                                <span className="text-black/25"> max</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <footer className="mt-5">
          <p className="text-[11px] leading-relaxed text-black/35">
            Energy uses Mifflin–St Jeor with an activity multiplier and a goal adjustment.
            Protein scales with body weight. Minerals and vitamins are ICMR–NIN 2020 reference
            allowances, banded by sex and age, and are seed values that have not been through a
            verified review. Targets are a starting point to adjust against what actually
            happens, not medical advice.
          </p>
        </footer>
      </main>
    </div>
  );
}
