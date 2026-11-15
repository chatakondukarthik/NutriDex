import { ProfileEditor } from "@/components/profile-editor";
import { getProfile } from "@/lib/db/profile";
import { isDefaultProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  const profile = getProfile();

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-xs text-muted">
          Used to work out your daily targets. Nothing here is sent anywhere.
        </p>
      </div>

      {isDefaultProfile(profile) && (
        <p className="mb-4 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-[11px] text-warn-ink">
          These are the default numbers, not yours. Change them and save to make the diary and
          plan use your targets.
        </p>
      )}

      <ProfileEditor profile={profile} />

      <footer className="mt-5">
        <p className="text-[11px] leading-relaxed text-faint">
          Energy uses Mifflin–St Jeor by default, or Katch–McArdle when body fat is known, with
          an activity multiplier and a goal adjustment. Protein scales with body weight. Minerals
          and vitamins are ICMR–NIN 2020 reference allowances, banded by sex and age, and are
          seed values that have not been through a verified review. Targets are a starting point
          to adjust against what actually happens, not medical advice.
        </p>
      </footer>
    </main>
  );
}
