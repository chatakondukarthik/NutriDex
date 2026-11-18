import { BrassDefs } from "./motif-frame";

/**
 * About — The Tulā. Settle.
 * A brass balance: grain heap on one pan, scroll on the other. The flame above
 * the pillar settles to a low lamp — each page-load re-weighs the claim.
 */
export default function AboutPlate() {
  return (
    <>
      <BrassDefs idPrefix="about" />
      {/* pedestal */}
      <path d="M 205 232 L 255 232 L 248 206 L 212 206 Z" fill="url(#about-rim)" stroke="#241A0C" strokeWidth="2" />
      <rect x="226" y="118" width="8" height="88" fill="url(#about-rim)" stroke="#241A0C" strokeWidth="1.5" />
      <circle cx="230" cy="112" r="9" fill="url(#about-rim)" stroke="#241A0C" strokeWidth="1.5" />
      {/* diya on the pillar */}
      <ellipse cx="230" cy="86" rx="16" ry="6" fill="url(#about-steel)" stroke="#241A0C" strokeWidth="1.5" />
      <path d="M 230 84 C 224 70 230 58 230 48 C 234 58 240 68 230 84 Z" fill="#C4531F" opacity="0.95" />
      <path d="M 230 76 C 227 66 230 58 230 54 C 233 60 235 68 230 76 Z" fill="#F6C445" opacity="0.8" />
      {/* beam */}
      <path d="M 120 112 L 340 112" stroke="url(#about-rim)" strokeWidth="6" strokeLinecap="round" />
      {/* pans — triangles + chains */}
      <line x1="150" y1="112" x2="150" y2="150" stroke="#B8893B" strokeWidth="2" />
      <line x1="310" y1="112" x2="310" y2="150" stroke="#B8893B" strokeWidth="2" />
      <path d="M 126 158 L 174 158 L 160 138 L 140 138 Z" fill="url(#about-rim)" stroke="#241A0C" strokeWidth="1.5" />
      <path d="M 286 158 L 334 158 L 320 138 L 300 138 Z" fill="url(#about-rim)" stroke="#241A0C" strokeWidth="1.5" />
      {/* left pan — grain heap */}
      <path d="M 140 152 Q 150 132 160 152 Z" fill="url(#about-turmeric)" stroke="#241A0C" strokeWidth="1" />
      {/* right pan — scroll */}
      <g transform="translate(310 148) rotate(-8)">
        <rect x="-12" y="-4" width="24" height="8" rx="2" fill="#55401F" stroke="#241A0C" strokeWidth="1" />
        <rect x="-12" y="-6.5" width="24" height="2.5" fill="#C9B37E" opacity="0.7" />
      </g>
    </>
  );
}
