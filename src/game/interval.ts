import { TAU, wrapAngle } from './angle';

/** Arc on a circle, measured CCW from `start` for `length` radians. */
export type CircInterval = { start: number; length: number };

export type LinInterval = { a: number; b: number };

/** θ where a pin at world angle `alpha` sits in the ring solid (not the gap). */
export function pinForbidden(alpha: number, gap: number): CircInterval | null {
  if (gap >= TAU - 1e-6) return null;
  if (gap <= 1e-6) return { start: 0, length: TAU };
  const allowedStart = wrapAngle(alpha - gap / 2);
  return { start: wrapAngle(allowedStart + gap), length: TAU - gap };
}

export function hardForbidden(center: number, half: number): CircInterval | null {
  const length = Math.min(TAU, Math.max(0, half * 2));
  if (length <= 1e-6) return null;
  if (length >= TAU - 1e-6) return { start: 0, length: TAU };
  return { start: wrapAngle(center - half), length };
}

export function freeArcs(forbidden: CircInterval[]): CircInterval[] {
  const segs: LinInterval[] = [];
  for (const f of forbidden) {
    if (f.length >= TAU - 1e-6) return [];
    if (f.length <= 1e-6) continue;
    const s = wrapAngle(f.start);
    const e = s + f.length;
    if (e <= TAU) segs.push({ a: s, b: e });
    else {
      segs.push({ a: s, b: TAU });
      segs.push({ a: 0, b: e - TAU });
    }
  }
  segs.sort((p, q) => p.a - q.a);
  const merged: LinInterval[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (!last || s.a > last.b + 1e-8) merged.push({ a: s.a, b: s.b });
    else last.b = Math.max(last.b, s.b);
  }
  const free: CircInterval[] = [];
  let cursor = 0;
  for (const m of merged) {
    if (m.a > cursor + 1e-8) free.push({ start: cursor, length: m.a - cursor });
    cursor = Math.max(cursor, m.b);
  }
  if (cursor < TAU - 1e-8) free.push({ start: cursor, length: TAU - cursor });
  return free;
}

export function clampAngle(theta: number, delta: number, free: CircInterval[]): number {
  if (free.length === 0 || delta === 0) return wrapAngle(theta);
  const t = wrapAngle(theta);
  let arc: CircInterval | undefined;
  let rel = 0;
  for (const f of free) {
    const d = wrapAngle(t - f.start);
    if (d <= f.length + 1e-6) {
      arc = f;
      rel = Math.min(d, f.length);
      break;
    }
  }
  if (!arc) return wrapAngle(theta);
  if (delta > 0) return wrapAngle(t + Math.min(delta, arc.length - rel));
  return wrapAngle(t + Math.max(delta, -rel));
}

export function mergeLinear(blocked: LinInterval[], limitA: number, limitB: number): LinInterval[] {
  const segs = blocked
    .map((s) => ({ a: Math.max(limitA, Math.min(s.a, s.b)), b: Math.min(limitB, Math.max(s.a, s.b)) }))
    .filter((s) => s.b - s.a > 1e-6)
    .sort((p, q) => p.a - q.a);
  const merged: LinInterval[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (!last || s.a > last.b + 1e-8) merged.push({ ...s });
    else last.b = Math.max(last.b, s.b);
  }
  return merged;
}

export function freeLinear(blocked: LinInterval[], limitA: number, limitB: number): LinInterval[] {
  const merged = mergeLinear(blocked, limitA, limitB);
  const free: LinInterval[] = [];
  let cursor = limitA;
  for (const m of merged) {
    if (m.a > cursor + 1e-8) free.push({ a: cursor, b: m.a });
    cursor = Math.max(cursor, m.b);
  }
  if (cursor < limitB - 1e-8) free.push({ a: cursor, b: limitB });
  return free;
}

export function clampLinear(current: number, target: number, free: LinInterval[]): number {
  if (free.length === 0) return current;
  const seg = free.find((f) => current >= f.a - 1e-6 && current <= f.b + 1e-6);
  if (!seg) return current;
  return Math.min(seg.b, Math.max(seg.a, target));
}
