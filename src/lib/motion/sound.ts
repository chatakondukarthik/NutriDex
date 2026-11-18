/**
 * Sound effects — The Thali Ledger.
 *
 * One Web Audio context, five synthesized cues. No assets, no library.
 * Design rules:
 *  - quiet by default (master gain 0.15) — a kitchen whisper, not a jingle;
 *  - every effect is short (≤ 350 ms) and stops itself;
 *  - respects `data-sound="off"` on <html> (Settings → Sound effects);
 *  - safe before first user gesture (resumes on demand);
 *  - silent under any failure — sound is garnish, never a requirement.
 */

export type SoundName = "tick" | "stamp" | "spark" | "thud" | "switch";

const MASTER_GAIN = 0.15;

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    return context;
  } catch {
    return null;
  }
}

function output(ctx: AudioContext): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = MASTER_GAIN;
  gain.connect(ctx.destination);
  return gain;
}

function tone(ctx: AudioContext, dest: GainNode, { from, to, type, t0, peak, decay }: {
  from: number;
  to?: number;
  type: OscillatorType;
  t0: number;
  peak: number;
  decay: number;
}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to != null) osc.frequency.exponentialRampToValueAtTime(to, t0 + decay);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  osc.connect(env);
  env.connect(dest);
  osc.start(t0);
  osc.stop(t0 + decay + 0.02);
}

function noiseBurst(ctx: AudioContext, dest: GainNode, { t0, peak, decay, from, to }: {
  t0: number;
  peak: number;
  decay: number;
  from: number;
  to: number;
}) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * decay, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    // exp decay envelope on the noise itself
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + decay);
  filter.Q.value = 1.1;
  const env = ctx.createGain();
  env.gain.setValueAtTime(peak, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  source.connect(filter);
  filter.connect(env);
  env.connect(dest);
  source.start(t0);
}

export function playSound(name: SoundName): void {
  if (typeof document !== "undefined" && document.documentElement.dataset.sound === "off") return;
  const ctx = audio();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const dest = output(ctx);
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case "tick":
        tone(ctx, dest, { from: 1560, type: "sine", t0: t, peak: 0.5, decay: 0.07 });
        break;
      case "stamp":
        noiseBurst(ctx, dest, { t0: t, peak: 0.8, decay: 0.13, from: 1400, to: 320 });
        tone(ctx, dest, { from: 210, to: 130, type: "triangle", t0: t, peak: 0.9, decay: 0.16 });
        break;
      case "spark":
        tone(ctx, dest, { from: 2093, type: "sine", t0: t, peak: 0.35, decay: 0.34 });
        tone(ctx, dest, { from: 3136, type: "sine", t0: t + 0.03, peak: 0.28, decay: 0.4 });
        tone(ctx, dest, { from: 6272, type: "sine", t0: t + 0.06, peak: 0.1, decay: 0.3 });
        break;
      case "thud":
        tone(ctx, dest, { from: 112, to: 70, type: "sine", t0: t, peak: 0.8, decay: 0.18 });
        break;
      case "switch":
        tone(ctx, dest, { from: 880, type: "sine", t0: t, peak: 0.3, decay: 0.06 });
        break;
    }
    // Let the tail finish, then disconnect the master gain.
    window.setTimeout(() => {
      try {
        dest.disconnect();
      } catch {
        /* already gone */
      }
    }, 800);
  } catch {
    /* sound is garnish; never break the action underneath */
  }
}
