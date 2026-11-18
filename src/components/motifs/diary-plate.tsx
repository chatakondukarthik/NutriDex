import { BrassDefs, VIEW_W, VIEW_H, katoriRing } from "./motif-frame";

/**
 * Diary — The Brimming Thali. Serve.
 * A heaped plate with seven katoris — today's seven slots of the day.
 */
export default function DiaryPlate() {
  const cx = 200;
  const cy = 152;
  const bowls = katoriRing(cx, cy, 62, 7);
  return (
    <>
      <BrassDefs idPrefix="diary" />
      {/* rim + floor */}
      <circle cx={cx} cy={cy} r="118" fill="url(#diary-rim)" />
      <circle cx={cx} cy={cy} r="96" fill="url(#diary-floor)" />
      <circle cx={cx} cy={cy} r="88" fill="none" stroke="#000" strokeOpacity="0.4" strokeWidth="6" />
      {/* katoris */}
      {bowls.map((b, i) => (
        <circle
          key={i}
          cx={b.x}
          cy={b.y}
          r="17"
          fill={i % 3 === 0 ? "url(#diary-turmeric)" : i % 3 === 1 ? "url(#diary-chilli)" : "url(#diary-steel)"}
          stroke="#241A0C"
          strokeWidth="2"
        />
      ))}
      {/* center disc — dal-gold */}
      <circle cx={cx} cy={cy} r="24" fill="url(#diary-turmeric)" stroke="#2E1F0E" strokeWidth="2.5" />
      {/* grain flecks */}
      <circle cx={cx - 7} cy={cy - 4} r="1.6" fill="#F6D98A" opacity="0.8" />
      <circle cx={cx + 8} cy={cy + 6} r="1.3" fill="#F6D98A" opacity="0.7" />
      <circle cx={cx + 3} cy={cy - 9} r="1.2" fill="#F6D98A" opacity="0.6" />
      {/* gleam arc on rim */}
      <path
        d={`M ${cx - 82} ${cy - 60} A 96 96 0 0 1 ${cx + 40} ${cy - 88}`}
        stroke="#F0DCAC"
        strokeOpacity="0.35"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
    </>
  );
}
