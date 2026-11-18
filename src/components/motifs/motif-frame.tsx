/**
 * The shared grammar of The Seven Plates.
 *
 * One viewBox (460×300), one palette, one camera. Every motif is drawn from
 * the same flat-bellied kitchen artifacts under the same upper-left lighting.
 * The rim/spokes/center disc primitives are shared so the plates read as one
 * object passing through seven exposures.
 *
 * Also exports shared <defs> blocks so every plate's gradients agree.
 */

export const VIEW_W = 460;
export const VIEW_H = 300;

/** Shared brass & spice gradients — the family's entire colour story. */
export const BrassDefs = ({ idPrefix = "plate" }: { idPrefix?: string }) => (
  <defs>
    <radialGradient id={`${idPrefix}-rim`} cx="38%" cy="32%" r="75%">
      <stop offset="0%" stopColor="#E9C878" />
      <stop offset="30%" stopColor="#B8893B" />
      <stop offset="68%" stopColor="#6B4A1E" />
      <stop offset="100%" stopColor="#2E1F0E" />
    </radialGradient>
    <radialGradient id={`${idPrefix}-floor`} cx="50%" cy="50%" r="60%">
      <stop offset="0%" stopColor="#171009" />
      <stop offset="80%" stopColor="#0F0B07" />
      <stop offset="100%" stopColor="#080604" />
    </radialGradient>
    <radialGradient id={`${idPrefix}-turmeric`} cx="42%" cy="36%" r="70%">
      <stop offset="0%" stopColor="#E4B65A" />
      <stop offset="55%" stopColor="#C09A35" />
      <stop offset="100%" stopColor="#6E4C12" />
    </radialGradient>
    <radialGradient id={`${idPrefix}-chilli`} cx="42%" cy="36%" r="70%">
      <stop offset="0%" stopColor="#C05A2A" />
      <stop offset="55%" stopColor="#93381C" />
      <stop offset="100%" stopColor="#461C0C" />
    </radialGradient>
    <radialGradient id={`${idPrefix}-leaf`} cx="42%" cy="36%" r="70%">
      <stop offset="0%" stopColor="#4E6138" />
      <stop offset="55%" stopColor="#2E3A20" />
      <stop offset="100%" stopColor="#141B0D" />
    </radialGradient>
    <radialGradient id={`${idPrefix}-brassBowl`} cx="42%" cy="36%" r="70%">
      <stop offset="0%" stopColor="#8A6A34" />
      <stop offset="60%" stopColor="#55401F" />
      <stop offset="100%" stopColor="#241A0C" />
    </radialGradient>
    <radialGradient id={`${idPrefix}-ember`} cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="#F6C445" />
      <stop offset="45%" stopColor="#C4531F" />
      <stop offset="100%" stopColor="#461F10" />
    </radialGradient>
    <radialGradient id={`${idPrefix}-steel`} cx="40%" cy="30%" r="75%">
      <stop offset="0%" stopColor="#B8B0A0" />
      <stop offset="55%" stopColor="#6E675C" />
      <stop offset="100%" stopColor="#241F18" />
    </radialGradient>
  </defs>
);

/** Round a computed coordinate to 2 decimals (SSR↔browser float stringification
 *  can differ in the last ULP between engines; rounding collapses that). */
export const r2 = (n: number) => Number(n.toFixed(2));

/** Bowl/katori coordinates for the 7-fold radial layout, centred on (cx, cy). */
export function katoriRing(cx: number, cy: number, radius = 62, count = 7) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    return {
      x: r2(cx + radius * Math.cos(angle)),
      y: r2(cy + radius * Math.sin(angle)),
      angle: (angle + Math.PI * 2) % (Math.PI * 2),
    };
  });
}
