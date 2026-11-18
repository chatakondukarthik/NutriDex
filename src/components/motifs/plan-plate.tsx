import { BrassDefs, r2 } from "./motif-frame";

/**
 * Plan — The Week's Toran. String.
 * A marigold-and-mango-leaf garland, one medallion per day, strung on a
 * cord between two brass hooks. The week as a festival doorway.
 */
export default function PlanPlate() {
  const medallions = Array.from({ length: 7 }, (_, i) => {
    const t = 0.08 + (i * 0.84) / 6;
    const x = r2(30 + t * 380);
    // Match the quadratic sag of the cord path M 30 64 Q 230 138 430 64
    const y = r2(64 + 2 * (1 - t) * t * 74);
    return { x, y, i };
  });

  return (
    <>
      <BrassDefs idPrefix="plan" />
      {/* hooks */}
      <circle cx="30" cy="64" r="7" fill="url(#plan-rim)" stroke="#241A0C" strokeWidth="1.5" />
      <circle cx="430" cy="64" r="7" fill="url(#plan-rim)" stroke="#241A0C" strokeWidth="1.5" />
      {/* cord */}
      <path d="M 30 64 Q 230 138 430 64" fill="none" stroke="#8A6A34" strokeWidth="3.5" />
      {/* leaves between medallions */}
      {medallions.slice(0, -1).map((m, i) => {
        const nx = medallions[i + 1].x;
        const mx = r2((m.x + nx) / 2);
        const my = r2((m.y + medallions[i + 1].y) / 2);
        return (
          <g key={`leaf-${i}`} transform={`translate(${mx} ${my}) rotate(${i % 2 ? -28 : 24})`}>
            <path d="M 0 0 C 16 -14 34 -10 46 2 C 28 10 12 8 0 0 Z" fill="url(#plan-leaf)" stroke="#141B0D" strokeWidth="1" />
          </g>
        );
      })}
      {/* medallions */}
      {medallions.map((m) => (
        <g key={m.i}>
          <circle cx={m.x} cy={m.y} r="15" fill="url(#plan-ember)" stroke="#241A0C" strokeWidth="1.5" />
          <circle cx={m.x} cy={m.y} r="5.5" fill="#F6C445" stroke="#572F10" strokeWidth="1" />
        </g>
      ))}
      {/* sway weights — small bells at the ends */}
      <path d="M 24 78 L 18 104 L 40 104 Z" fill="url(#plan-rim)" stroke="#241A0C" strokeWidth="1.5" />
      <path d="M 436 78 L 430 104 L 452 104 Z" fill="url(#plan-rim)" stroke="#241A0C" strokeWidth="1.5" />
    </>
  );
}
