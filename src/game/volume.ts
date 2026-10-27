/**
 * Flat volumes on one plane.
 * A ring does not block another ring with its own band or gap.
 * Ring-to-ring restraint is only the stem and handle.
 * The bar is what occupies a gap and stops that ring turning.
 */

import type { BarBody, Board, RingBody } from './board';
import { gapCovers } from './angle';
import { PART } from './parts';

function ringSector(ring: RingBody, x: number, y: number): boolean {
  const d = Math.hypot(x - ring.x, y - ring.y);
  if (d < ring.inner || d > ring.outer) return false;
  const alpha = Math.atan2(y - ring.y, x - ring.x);
  return !gapCovers(ring.theta, alpha, ring.gap);
}

const SCALE = PART.scale;

export function connectorLocalAngle(ring: RingBody): number | null {
  return ring.id === 'green' ? Math.PI / 2 : null;
}

function band(): number {
  return PART.outer * PART.bandRatio;
}

function connectorBox(ring: RingBody): { x: number; y: number; angle: number; length: number; width: number }[] {
  const local = connectorLocalAngle(ring);
  if (local === null) return [];
  const b = band();
  const stemLen = b * 2.5 * (2 / 3) * SCALE;
  const stemW = b * 0.88 * SCALE;
  const claspLen = b * 2.1 * (5 / 6) * SCALE;
  const claspW = b * 1.4 * SCALE;
  const stemDist = (PART.outer + (b * 2.5 * (2 / 3)) * 0.5 - b * 0.2) * SCALE;
  const claspDist = stemDist + stemLen * 0.5;
  const world = ring.theta + local;
  const boxes = [
    { dist: stemDist, angle: world, length: stemLen, width: stemW },
    { dist: claspDist, angle: world, length: claspLen, width: claspW, spin: Math.PI / 2 },
  ];
  return boxes.map((box) => ({
    x: ring.x + Math.cos(world) * box.dist,
    y: ring.y + Math.sin(world) * box.dist,
    angle: world + (box.spin ?? 0),
    length: box.length,
    width: box.width,
  }));
}

function pushRingSamples(out: { x: number; y: number }[], ring: RingBody): void {
  const a0 = ring.theta + ring.gap / 2;
  const a1 = ring.theta + Math.PI * 2 - ring.gap / 2;
  const arc = a1 - a0;
  const radii = [ring.inner + 0.012, (ring.inner + ring.outer) / 2, ring.outer - 0.012];
  for (const radius of radii) {
    const n = Math.max(12, Math.ceil((arc * radius) / 0.05));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (arc * i) / n;
      out.push({ x: ring.x + Math.cos(a) * radius, y: ring.y + Math.sin(a) * radius });
    }
  }
  const mid = (ring.inner + ring.outer) / 2;
  const cap = (ring.outer - ring.inner) / 2;
  for (const sign of [-1, 1]) {
    const a = ring.theta + sign * ring.gap / 2;
    const cx = ring.x + Math.cos(a) * mid;
    const cy = ring.y + Math.sin(a) * mid;
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      out.push({ x: cx + Math.cos(t) * (cap * 0.7), y: cy + Math.sin(t) * (cap * 0.7) });
    }
  }
  for (const box of connectorBox(ring)) {
    const n = 6;
    for (let ix = 0; ix <= n; ix++) {
      for (let iy = 0; iy <= 2; iy++) {
        const lx = -box.length / 2 + (box.length * ix) / n;
        const ly = -box.width / 2 + (box.width * iy) / 2;
        const c = Math.cos(box.angle);
        const s = Math.sin(box.angle);
        out.push({ x: box.x + c * lx - s * ly, y: box.y + s * lx + c * ly });
      }
    }
  }
}

function inBox(box: { x: number; y: number; angle: number; length: number; width: number }, x: number, y: number): boolean {
  const dx = x - box.x;
  const dy = y - box.y;
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  return Math.abs(lx) <= box.length / 2 && Math.abs(ly) <= box.width / 2;
}

function ringHolds(ring: RingBody, x: number, y: number): boolean {
  if (ringSector(ring, x, y)) return true;
  const mid = (ring.inner + ring.outer) / 2;
  const cap = (ring.outer - ring.inner) / 2;
  for (const sign of [-1, 1]) {
    const a = ring.theta + sign * ring.gap / 2;
    const dx = x - (ring.x + Math.cos(a) * mid);
    const dy = y - (ring.y + Math.sin(a) * mid);
    if (dx * dx + dy * dy <= cap * cap) return true;
  }
  return connectorBox(ring).some((box) => inBox(box, x, y));
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-8) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

export function barSegment(bar: BarBody, t: number): { ax: number; ay: number; bx: number; by: number } {
  const x = bar.x0 + (bar.x1 - bar.x0) * t;
  const y = bar.y0 + (bar.y1 - bar.y0) * t;
  const dx = bar.x1 - bar.x0;
  const dy = bar.y1 - bar.y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const grip = bar.grip > 0 ? bar.grip : 0.45;
  return { ax: x - ux * grip, ay: y - uy * grip, bx: x + ux * grip, by: y + uy * grip };
}

/** Stem or handle lies in the other ring's gap, so that ring cannot swing off it. */
export function connectorOccupiesGap(owner: RingBody, other: RingBody): boolean {
  if (connectorLocalAngle(owner) === null) return false;
  for (const p of connectorSamples(owner)) {
    const dx = p.x - other.x;
    const dy = p.y - other.y;
    const d = Math.hypot(dx, dy);
    if (d > other.outer || d < other.inner * 0.45) continue;
    if (gapCovers(other.theta, Math.atan2(dy, dx), other.gap)) return true;
  }
  return false;
}

/** The bar is sitting in this ring's gap, so the gap cannot swing away from it. */
export function barOccupiesGap(bar: BarBody, t: number, ring: RingBody): boolean {
  const seg = barSegment(bar, t);
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = seg.ax + (seg.bx - seg.ax) * u;
    const y = seg.ay + (seg.by - seg.ay) * u;
    const dx = x - ring.x;
    const dy = y - ring.y;
    const d = Math.hypot(dx, dy);
    if (d > ring.outer + bar.half || d < ring.inner * 0.35) continue;
    const alpha = Math.atan2(dy, dx);
    if (gapCovers(ring.theta, alpha, ring.gap)) return true;
  }
  return false;
}

export function barHitsRing(bar: BarBody, t: number, ring: RingBody): boolean {
  const seg = barSegment(bar, t);
  const samples: { x: number; y: number }[] = [];
  pushRingSamples(samples, ring);
  for (const p of samples) {
    if (distToSegment(p.x, p.y, seg.ax, seg.ay, seg.bx, seg.by) <= bar.half) return true;
  }
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = seg.ax + (seg.bx - seg.ax) * u;
    const y = seg.ay + (seg.by - seg.ay) * u;
    if (ringHolds(ring, x, y)) return true;
  }
  return false;
}

function connectorSamples(ring: RingBody): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const box of connectorBox(ring)) {
    const n = 6;
    for (let ix = 0; ix <= n; ix++) {
      for (let iy = 0; iy <= 2; iy++) {
        const lx = -box.length / 2 + (box.length * ix) / n;
        const ly = -box.width / 2 + (box.width * iy) / 2;
        const c = Math.cos(box.angle);
        const s = Math.sin(box.angle);
        out.push({ x: box.x + c * lx - s * ly, y: box.y + s * lx + c * ly });
      }
    }
  }
  return out;
}

/** Stem and handle against the other ring. The two bands do not restrain each other. */
export function connectorHitsRing(owner: RingBody, other: RingBody): boolean {
  if (connectorLocalAngle(owner) === null) return false;
  for (const p of connectorSamples(owner)) {
    if (ringSector(other, p.x, p.y)) return true;
    const mid = (other.inner + other.outer) / 2;
    const cap = (other.outer - other.inner) / 2;
    for (const sign of [-1, 1]) {
      const a = other.theta + sign * other.gap / 2;
      const dx = p.x - (other.x + Math.cos(a) * mid);
      const dy = p.y - (other.y + Math.sin(a) * mid);
      if (dx * dx + dy * dy <= cap * cap) return true;
    }
  }
  const bandSamples: { x: number; y: number }[] = [];
  pushRingSamples(bandSamples, other);
  for (const box of connectorBox(owner)) {
    for (const p of bandSamples) if (inBox(box, p.x, p.y)) return true;
  }
  return false;
}

export function ringsOverlap(a: RingBody, b: RingBody): boolean {
  return connectorHitsRing(a, b) || connectorHitsRing(b, a);
}

export function poseOverlaps(board: Board): boolean {
  for (let i = 0; i < board.rings.length; i++) {
    for (let j = i + 1; j < board.rings.length; j++) {
      if (ringsOverlap(board.rings[i], board.rings[j])) return true;
    }
  }
  for (const bar of board.bars) {
    for (const ring of board.rings) {
      if (barHitsRing(bar, bar.t, ring)) return true;
    }
  }
  return false;
}

/** The bar body stops a ring. A clasp does not: the ring passes through it, and pointerup decides. */
export function ringVolumeHit(board: Board, ring: RingBody): boolean {
  for (const bar of board.bars) {
    if (barHitsRing(bar, bar.t, ring)) return true;
  }
  return false;
}
