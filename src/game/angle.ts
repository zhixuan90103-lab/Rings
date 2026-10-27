/** World XY angles: 0 at +X, counterclockwise, radians. Mesh rotation.z uses the same θ. */

export const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  const x = a % TAU;
  return x < 0 ? x + TAU : x;
}

/** Shortest signed step from `from` to `to`, in (-π, π]. */
export function signedDelta(from: number, to: number): number {
  let d = wrapAngle(to) - wrapAngle(from);
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Gap centered on `theta` covers world angle `alpha`. */
export function gapCovers(theta: number, alpha: number, gap: number): boolean {
  if (gap <= 0) return false;
  return Math.abs(signedDelta(theta, alpha)) <= gap / 2 + 1e-6;
}
