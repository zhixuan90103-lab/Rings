/** Visual refusal only. Collision keeps the rule pose. */

/** About 3° at the ring. The rim travels roughly 3 design pixels. */
export const RING_RECOIL_MAX = (3 * Math.PI) / 180;

/** A click has no drag, so its first peak is smaller than the held 3°. */
export const CLICK_RECOIL_SCALE = 2 / 3;

/** World-unit cap for a bar: 3 design pixels on an 844-tall view of height 10. */
export const BAR_RECOIL_WORLD = (3 / 844) * 10;

/** Three trips. Each later peak is about 60% of the previous one. */
export const WOBBLE_CYCLES = 3;
export const WOBBLE_SECONDS = 0.42;

export type Recoil = {
  sign: number;
  max: number;
  elapsed: number;
  /** While held, the ring stays on the first peak. Release starts the decay. */
  hold: boolean;
};

/** The first blocked direction stays until release. Later samples cannot flip it. */
export function heldSign(latched: number | null, rejected: number): number | null {
  if (latched !== null && latched !== 0) return latched;
  const sign = Math.sign(rejected);
  return sign === 0 ? null : sign;
}

/** Direction comes from the blocked push. The curve does not. */
export function beginRecoil(rejected: number, max: number, hold = false): Recoil | null {
  if (Math.abs(rejected) < 1e-5 || max <= 0) return null;
  return { sign: Math.sign(rejected), max, elapsed: 0, hold };
}

export function releaseHold(recoil: Recoil): void {
  const period = WOBBLE_SECONDS / WOBBLE_CYCLES;
  recoil.hold = false;
  recoil.elapsed = period / 4;
}

/** Each later peak is smaller. The first peak stays at `max`. */
export function wobbleOffset(recoil: Recoil): number {
  if (recoil.hold) return recoil.sign * recoil.max;
  const t = recoil.elapsed;
  if (t <= 0 || t >= WOBBLE_SECONDS) return 0;
  const period = WOBBLE_SECONDS / WOBBLE_CYCLES;
  const firstCrest = period / 4;
  const decay = Math.exp(-3.6 * (t - firstCrest));
  return recoil.sign * recoil.max * Math.sin((Math.PI * 2 * t) / period) * decay;
}

export function stepRecoil(recoil: Recoil, dt: number): boolean {
  if (recoil.hold) return false;
  recoil.elapsed += dt;
  return recoil.elapsed >= WOBBLE_SECONDS;
}
