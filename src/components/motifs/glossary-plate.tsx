import { BrassDefs, r2 } from "./motif-frame";

/**
 * Glossary — The Decoder Wheel ("Chakri"). Spin.
 * Three concentric brushed-brass rings; one window; a center pip.
 * Alignment is the meaning — the word found.
 */
export default function GlossaryPlate() {
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 24;
    const inner = 108;
    const outer = 128;
    return {
      x1: r2(230 + inner * Math.cos(angle)),
      y1: r2(150 + inner * Math.sin(angle)),
      x2: r2(230 + outer * Math.cos(angle)),
      y2: r2(150 + outer * Math.sin(angle)),
    };
  });

  return (
    <>
      <BrassDefs idPrefix="glossary" />
      {/* outer ring */}
      <circle cx="230" cy="150" r="120" fill="url(#glossary-rim)" />
      <circle cx="230" cy="150" r="100" fill="url(#glossary-floor)" />
      {ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#0A0805" strokeWidth="3" strokeOpacity="0.7" />
      ))}
      {/* middle ring with the window */}
      <circle cx="230" cy="150" r="72" fill="#241A0C" stroke="url(#glossary-rim)" strokeWidth="10" />
      <rect x="249" y="137" width="22" height="26" rx="3" fill="url(#glossary-turmeric)" transform="rotate(90 260 150)" />
      {/* inner spokes + pip */}
      {Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 6;
        return (
          <line
            key={i}
            x1={230}
            y1={150}
            x2={r2(230 + 48 * Math.cos(angle))}
            y2={r2(150 + 48 * Math.sin(angle))}
            stroke="url(#glossary-rim)"
            strokeWidth="5"
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="230" cy="150" r="17" fill="url(#glossary-rim)" stroke="#241A0C" strokeWidth="2" />
      <circle cx="230" cy="150" r="7" fill="#E8A33D" />
    </>
  );
}
