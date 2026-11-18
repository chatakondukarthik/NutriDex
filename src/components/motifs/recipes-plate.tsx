import { BrassDefs } from "./motif-frame";

/**
 * Recipes — The Seven-Slat Pothi. Unfurl.
 * A bound olam palm-leaf recipe stack — the written method,
 * abstracted into stippled lines. Never legible script.
 */
export default function RecipesPlate() {
  const slats = Array.from({ length: 7 }, (_, i) => ({
    y: 26 + i * 34,
    rotate: i % 2 === 0 ? -1.4 : 1.6,
    fill: i % 2 === 0 ? "#6B5A32" : "#4F4522",
  }));

  return (
    <>
      <BrassDefs idPrefix="recipes" />
      {/* slats */}
      {slats.map((s, i) => (
        <g key={i} transform={`rotate(${s.rotate} 230 ${s.y + 10})`}>
          <rect x="62" y={s.y} width="336" height="20" rx="6" fill={s.fill} stroke="#281F10" strokeWidth="1.5" />
          {/* stippled writing rows */}
          {Array.from({ length: 9 }, (_, j) => (
            <circle key={j} cx={92 + j * 34} cy={s.y + 10} r="1.7" fill="#C9B37E" opacity="0.6" />
          ))}
        </g>
      ))}
      {/* binding cords */}
      <rect x="168" y="14" width="6" height="268" fill="#8A6A34" opacity="0.9" />
      <rect x="292" y="14" width="6" height="268" fill="#8A6A34" opacity="0.9" />
      {/* cord knots */}
      <circle cx="171" cy="24" r="5" fill="url(#recipes-rim)" stroke="#241A0C" strokeWidth="1" />
      <circle cx="295" cy="24" r="5" fill="url(#recipes-rim)" stroke="#241A0C" strokeWidth="1" />
      <circle cx="171" cy="276" r="5" fill="url(#recipes-rim)" stroke="#241A0C" strokeWidth="1" />
      <circle cx="295" cy="276" r="5" fill="url(#recipes-rim)" stroke="#241A0C" strokeWidth="1" />
      {/* end weight — brass trapezoid */}
      <path d="M 356 8 L 440 8 L 428 292 L 368 292 Z" fill="url(#recipes-rim)" opacity="0.9" />
      <path d="M 374 20 L 424 20 L 416 280 L 382 280 Z" fill="url(#recipes-floor)" opacity="0.85" />
    </>
  );
}
