import { BrassDefs } from "./motif-frame";

/**
 * Settings — The Sil Batta (mortar & pestle). Grind.
 * The stone grinder — where the household's mix is set to its true
 * proportion: targets, appearance, the people at the table. Top-down,
 * same camera as every plate.
 */
export default function SettingsPlate() {
  return (
    <>
      <BrassDefs idPrefix="settings" />
      <defs>
        <radialGradient id="settings-stone" cx="40%" cy="32%" r="80%">
          <stop offset="0%" stopColor="#6E6862" />
          <stop offset="55%" stopColor="#413C36" />
          <stop offset="100%" stopColor="#1B1815" />
        </radialGradient>
        <linearGradient id="settings-pestle" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#7A746D" />
          <stop offset="50%" stopColor="#4C4741" />
          <stop offset="100%" stopColor="#221F1C" />
        </linearGradient>
      </defs>

      {/* mortar body */}
      <circle cx="205" cy="172" r="98" fill="url(#settings-stone)" />
      <circle cx="205" cy="172" r="88" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="3" />
      <circle cx="205" cy="172" r="80" fill="#141109" stroke="#241F18" strokeWidth="3" />
      {/* carved ring inside the bowl */}
      <circle cx="205" cy="172" r="62" fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="10" />
      {/* polished highlight on the bowl's inner lip */}
      <path d="M 150 128 A 66 66 0 0 1 258 118" stroke="#8A827A" strokeOpacity="0.5" strokeWidth="4" fill="none" strokeLinecap="round" />

      {/* pestle, resting across the rim into the bowl */}
      <g transform="rotate(-38 292 78)">
        <rect x="284" y="8" width="17" height="128" rx="8.5" fill="url(#settings-pestle)" stroke="#141110" strokeWidth="2" />
        <circle cx="292.5" cy="140" r="13" fill="url(#settings-stone)" stroke="#141110" strokeWidth="2" />
      </g>

      {/* spice flecks in the bowl */}
      <circle cx="188" cy="168" r="3" fill="#C09A35" opacity="0.85" />
      <circle cx="224" cy="186" r="2.4" fill="#C09A35" opacity="0.7" />
      <circle cx="206" cy="152" r="2.2" fill="#93381C" opacity="0.8" />

      {/* a curry leaf, resting by the mortar */}
      <path d="M 262 224 C 278 210 300 212 312 224 C 296 232 274 232 262 224 Z" fill="url(#settings-leaf)" stroke="#141B0D" strokeWidth="1" opacity="0.9" />
    </>
  );
}
