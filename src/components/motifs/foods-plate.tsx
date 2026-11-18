import { BrassDefs, r2 } from "./motif-frame";

/**
 * Foods — The Tokri of Produce. Gather.
 * A woven palm-frond basket heaped with the raw materials of the week —
 * tomato, brinjal, cauliflower, greens, lemon, chilli. Top-down, the same
 * camera as every plate. The basket's concentric weave is the rim grammar.
 */
export default function FoodsPlate() {
  const cx = 208;
  const cy = 166;
  const weave = Array.from({ length: 40 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 40;
    const inner = 90;
    const outer = 112;
    return {
      x1: r2(cx + inner * Math.cos(angle)),
      y1: r2(cy + inner * Math.sin(angle)),
      x2: r2(cx + outer * Math.cos(angle)),
      y2: r2(cy + outer * Math.sin(angle)),
      faint: i % 2 === 0,
    };
  });

  return (
    <>
      <BrassDefs idPrefix="foods" />
      <defs>
        <radialGradient id="foods-rattan" cx="42%" cy="36%" r="72%">
          <stop offset="0%" stopColor="#A9803E" />
          <stop offset="55%" stopColor="#6B4A1E" />
          <stop offset="100%" stopColor="#2B1F0E" />
        </radialGradient>
        <radialGradient id="foods-cream" cx="42%" cy="36%" r="70%">
          <stop offset="0%" stopColor="#EDE4C8" />
          <stop offset="60%" stopColor="#B9AE92" />
          <stop offset="100%" stopColor="#5E584A" />
        </radialGradient>
        <radialGradient id="foods-brinjal" cx="40%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#6E4A7A" />
          <stop offset="55%" stopColor="#45304F" />
          <stop offset="100%" stopColor="#1E1526" />
        </radialGradient>
      </defs>

      {/* basket body */}
      <circle cx={cx} cy={cy} r="104" fill="url(#foods-rattan)" />
      {weave.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="#D9B36A"
          strokeWidth={t.faint ? 3 : 5}
          strokeOpacity={t.faint ? 0.28 : 0.5}
          strokeLinecap="round"
        />
      ))}
      <circle cx={cx} cy={cy} r="86" fill="#12100B" stroke="#241A0C" strokeWidth="3" />
      <circle cx={cx} cy={cy} r="66" fill="none" stroke="#3A2B18" strokeWidth="6" />

      {/* greens, flanking the back */}
      <path d="M 150 130 C 134 102 156 88 178 102 C 174 126 164 134 150 130 Z" fill="url(#foods-leaf)" stroke="#141B0D" strokeWidth="1.5" />
      <path d="M 268 128 C 286 100 262 88 240 100 C 246 124 254 134 268 128 Z" fill="url(#foods-leaf)" stroke="#141B0D" strokeWidth="1.5" />

      {/* cauliflower, back centre */}
      <circle cx="208" cy="124" r="17" fill="url(#foods-cream)" stroke="#241A0C" strokeWidth="1.5" />
      <circle cx="201" cy="118" r="4" fill="#F4EDDC" opacity="0.8" />
      <circle cx="216" cy="118" r="4" fill="#F4EDDC" opacity="0.8" />
      <circle cx="208" cy="128" r="4" fill="#D8CFB4" opacity="0.9" />

      {/* tomato, front left */}
      <circle cx="168" cy="162" r="17" fill="url(#foods-chilli)" stroke="#241A0C" strokeWidth="2" />
      <path d="M 168 152 L 170.5 158.5 L 177.5 158.5 L 172 162.5 L 174.5 169 L 168 165.2 L 161.5 169 L 164 162.5 L 158.5 158.5 L 165.5 158.5 Z" fill="#572F10" opacity="0.9" />

      {/* brinjal, front right */}
      <ellipse cx="248" cy="164" rx="18" ry="12" transform="rotate(-14 248 164)" fill="url(#foods-brinjal)" stroke="#241A0C" strokeWidth="1.5" />
      <path d="M 231 155 Q 240 149 247 156 Q 237 159 231 155 Z" fill="url(#foods-leaf)" stroke="#141B0D" strokeWidth="1" />

      {/* lemon, front centre */}
      <ellipse cx="205" cy="180" rx="14" ry="9" fill="url(#foods-turmeric)" stroke="#241A0C" strokeWidth="1.5" />
      <circle cx="199" cy="177" r="1.6" fill="#F6D98A" opacity="0.85" />

      {/* chilli, draped across the front */}
      <path d="M 150 203 C 192 216 250 215 286 198" fill="none" stroke="#C4531F" strokeWidth="5" strokeLinecap="round" />
      <path d="M 286 198 L 296 191" stroke="#572F10" strokeWidth="4" strokeLinecap="round" />
    </>
  );
}
