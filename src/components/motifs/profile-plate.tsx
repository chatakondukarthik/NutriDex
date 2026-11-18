import { BrassDefs } from "./motif-frame";

/**
 * Profile — The Chai Glass on the Tray. Pour.
 * A kulhar-shaped glass, half-filled, lota behind — the cook restored.
 * Steam curls: never a face, never a body outline.
 */
export default function ProfilePlate() {
  return (
    <>
      <BrassDefs idPrefix="profile" />
      {/* tray */}
      <ellipse cx="220" cy="212" rx="150" ry="16" fill="url(#profile-rim)" stroke="#241A0C" strokeWidth="2" />
      <ellipse cx="220" cy="208" rx="130" ry="11" fill="url(#profile-floor)" opacity="0.9" />
      {/* lota behind */}
      <g transform="translate(330 118)">
        <circle r="38" fill="url(#profile-rim)" stroke="#241A0C" strokeWidth="2" />
        <circle r="28" fill="url(#profile-floor)" opacity="0.85" />
        <path d="M 0 -38 Q 6 -52 0 -60 Q -6 -52 0 -38" fill="url(#profile-rim)" stroke="#241A0C" strokeWidth="1.5" />
      </g>
      {/* the kulhar glass */}
      <g transform="translate(180 116)">
        <path d="M -44 -8 L -56 76 Q 0 92 56 76 L 44 -8 Z" fill="#2E1F14" stroke="#B8893B" strokeOpacity="0.75" strokeWidth="2.5" />
        {/* tea fill */}
        <path d="M -41 18 L -51 71 Q 0 83 51 71 L 41 18 Z" fill="#8A4A24" opacity="0.95" />
        <path d="M -41 18 L 41 18" stroke="#E4B65A" strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* steam wisps */}
      <path d="M 172 88 C 166 64 180 52 172 32" stroke="#D9C9B8" strokeWidth="2.5" strokeOpacity="0.4" fill="none" strokeLinecap="round" />
      <path d="M 196 84 C 202 60 188 48 198 28" stroke="#D9C9B8" strokeWidth="2" strokeOpacity="0.28" fill="none" strokeLinecap="round" />
      <path d="M 214 90 C 220 70 208 58 216 40" stroke="#D9C9B8" strokeWidth="1.8" strokeOpacity="0.22" fill="none" strokeLinecap="round" />
      {/* level mark */}
      <path d="M 138 176 L 254 176" stroke="#E8A33D" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="5 4" />
    </>
  );
}
