/**
 * Flat volumes on one plane.
 * A ring does not block another ring with its own band or gap.
 * Ring-to-ring restraint is only the stem and handle.
 * The bar is what occupies a gap and stops that ring turning.
 */

import type { BarBody, Board, RingBody } from './board';
import { gapCovers, signedDelta, wrapAngle } from './angle';
import { PART } from './parts';

/** Horn radius of the drawn ring, including the bevel that grows back out to the band. */
function hornRadius(ring: RingBody): number {
  const band = ring.outer - ring.inner;
  const bevel = band * 0.25;
  return (band - bevel) / 2 + bevel;
}

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
  const stemDist = (PART.outer + stemLen * 0.5 - b * 0.2) * SCALE;
  const world = ring.theta + local;
  const boxes = [
    { dist: stemDist, angle: world, length: stemLen, width: stemW },
  ];
  return boxes.map((box) => ({
    x: ring.x + Math.cos(world) * box.dist,
    y: ring.y + Math.sin(world) * box.dist,
    angle: world,
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
  const cap = hornRadius(ring);
  for (const sign of [-1, 1]) {
    const a = ring.theta + sign * ring.gap / 2;
    const cx = ring.x + Math.cos(a) * mid;
    const cy = ring.y + Math.sin(a) * mid;
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * Math.PI * 2;
      out.push({ x: cx + Math.cos(t) * (cap * 0.92), y: cy + Math.sin(t) * (cap * 0.92) });
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
  const cap = hornRadius(ring);
  for (const sign of [-1, 1]) {
    const a = ring.theta + sign * ring.gap / 2;
    const dx = x - (ring.x + Math.cos(a) * mid);
    const dy = y - (ring.y + Math.sin(a) * mid);
    if (dx * dx + dy * dy <= cap * cap) return true;
  }
  if (connectorBox(ring).some((box) => inBox(box, x, y))) return true;
  const arc = claspArc(ring);
  return arc ? inClasp(arc, x, y) : false;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-8) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function barFrame(bar: BarBody, t: number): { x: number; y: number; ux: number; uy: number; nx: number; ny: number } {
  const x = bar.x0 + (bar.x1 - bar.x0) * t;
  const y = bar.y0 + (bar.y1 - bar.y0) * t;
  const dx = bar.x1 - bar.x0;
  const dy = bar.y1 - bar.y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { x, y, ux, uy, nx: -uy, ny: ux };
}

/** Stadium matching the drawn capsule: round ends of radius `half`, overall length `2 * grip`. */
export function barSegment(bar: BarBody, t: number): { ax: number; ay: number; bx: number; by: number } {
  const frame = barFrame(bar, t);
  const grip = bar.grip > 0 ? bar.grip : 0.45;
  const core = Math.max(0, grip - bar.half);
  return {
    ax: frame.x - frame.ux * core,
    ay: frame.y - frame.uy * core,
    bx: frame.x + frame.ux * core,
    by: frame.y + frame.uy * core,
  };
}

function buckleSleeve(bar: BarBody): { halfLen: number; halfW: number } {
  const basis = PART.outer * 2 * SCALE;
  const sleeveLen = basis * 0.32 * (2 / 3);
  return { halfLen: sleeveLen / 2, halfW: bar.half * 1.3 };
}

/**
 * How far the leading cap sits in the ring solid.
 * Zero means that end is clear. Sliding only stops when this grows.
 */
export function leadDepth(ring: RingBody, bar: BarBody, t: number, sign: number): number {
  const seg = barSegment(bar, t);
  const lead = sign >= 0 ? { x: seg.bx, y: seg.by } : { x: seg.ax, y: seg.ay };
  const at = (x: number, y: number) => {
    if (!ringSector(ring, x, y)) return 0;
    const d = Math.hypot(x - ring.x, y - ring.y);
    return Math.max(ring.inner - d, d - ring.outer, 0.001);
  };
  let depth = at(lead.x, lead.y);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    depth = Math.max(depth, at(lead.x + Math.cos(a) * bar.half, lead.y + Math.sin(a) * bar.half));
  }
  return depth;
}

/** The drawn capsule still passes through the fixed silver buckle. */
export function barStillInBuckle(bar: BarBody, px: number, py: number): boolean {
  const frame = barFrame(bar, bar.t);
  const along = (px - frame.x) * frame.ux + (py - frame.y) * frame.uy;
  const across = (px - frame.x) * frame.nx + (py - frame.y) * frame.ny;
  const sleeve = buckleSleeve(bar);
  const grip = bar.grip > 0 ? bar.grip : 0.45;
  if (Math.abs(across) > sleeve.halfW + bar.half) return false;
  return Math.abs(along) < grip + sleeve.halfLen;
}

/** Silver sleeve and the two grips. The bar slides through this shape, so it is not a hit against its own bar. */
function buckleHolds(bar: BarBody, x: number, y: number, px: number, py: number): boolean {
  const frame = barFrame(bar, bar.t);
  const width = bar.half * 2;
  const basis = PART.outer * 2 * SCALE;
  const sleeveLen = basis * 0.32 * (2 / 3);
  const sleeveW = width * 1.3;
  const gripSpan = sleeveLen * 0.62 * 0.7;
  const gripStick = width * 0.48 * 0.7;
  const dx = x - px;
  const dy = y - py;
  const lx = dx * frame.ux + dy * frame.uy;
  const ly = dx * frame.nx + dy * frame.ny;
  if (Math.abs(lx) <= sleeveLen / 2 && Math.abs(ly) <= sleeveW / 2) return true;
  for (const side of [-1, 1]) {
    const gy = side * (sleeveW / 2 + gripStick / 2);
    if (Math.abs(lx) <= gripSpan / 2 && Math.abs(ly - gy) <= gripStick / 2) return true;
  }
  return false;
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

/** How far the bar body is inside this ring. Zero means the drawn capsule is clear. */
export function barOverlapAmount(bar: BarBody, t: number, ring: RingBody): number {
  const seg = barSegment(bar, t);
  const samples: { x: number; y: number }[] = [];
  pushRingSamples(samples, ring);
  let amount = 0;
  for (const p of samples) {
    const gap = bar.half - distToSegment(p.x, p.y, seg.ax, seg.ay, seg.bx, seg.by);
    if (gap > 0) amount += gap;
  }
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = seg.ax + (seg.bx - seg.ax) * u;
    const y = seg.ay + (seg.by - seg.ay) * u;
    if (ringHolds(ring, x, y)) amount += bar.half;
  }
  return amount;
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
  const arc = claspArc(ring);
  if (arc) {
    for (let i = 0; i <= 8; i++) {
      const a = arc.mid - arc.half + (2 * arc.half * i) / 8;
      for (const k of [-0.4, 0, 0.4]) {
        const radius = arc.radius + arc.width * k;
        out.push({ x: arc.cx + Math.cos(a) * radius, y: arc.cy + Math.sin(a) * radius });
      }
    }
  }
  return out;
}

function claspArc(ring: RingBody): { cx: number; cy: number; radius: number; half: number; width: number; mid: number } | null {
  const local = connectorLocalAngle(ring);
  if (local === null) return null;
  const b = band();
  const stemLen = b * 2.5 * (2 / 3) * SCALE;
  const stemDist = (PART.outer + stemLen * 0.5 - b * 0.2) * SCALE;
  const claspDist = stemDist + stemLen * 0.5;
  const bend = (PART.outer - b / 2) * SCALE;
  const world = ring.theta + local;
  const ox = ring.x + Math.cos(world) * claspDist;
  const oy = ring.y + Math.sin(world) * claspDist;
  return {
    cx: ox + Math.cos(world) * bend,
    cy: oy + Math.sin(world) * bend,
    radius: bend,
    half: (b * 2.1 * (5 / 6) * SCALE) / 2 / bend,
    width: b * 1.4 * SCALE,
    mid: Math.atan2(-Math.sin(world), -Math.cos(world)),
  };
}

function inClasp(arc: { cx: number; cy: number; radius: number; half: number; width: number; mid: number }, x: number, y: number): boolean {
  const d = Math.hypot(x - arc.cx, y - arc.cy);
  if (d < arc.radius - arc.width / 2 || d > arc.radius + arc.width / 2) return false;
  return Math.abs(signedDelta(arc.mid, Math.atan2(y - arc.cy, x - arc.cx))) <= arc.half;
}

/** Stem and bent handle against the other ring. */
export function connectorHitsRing(owner: RingBody, other: RingBody): boolean {
  if (connectorLocalAngle(owner) === null) return false;
  const arc = claspArc(owner);
  for (const p of connectorSamples(owner)) {
    if (ringHolds(other, p.x, p.y)) return true;
  }
  if (!arc) return false;
  const bandSamples: { x: number; y: number }[] = [];
  pushRingSamples(bandSamples, other);
  return bandSamples.some((p) => inClasp(arc, p.x, p.y) || connectorBox(owner).some((box) => inBox(box, p.x, p.y)));
}

function buckleHitsRing(bar: BarBody, ring: RingBody, px: number, py: number): boolean {
  const frame = barFrame(bar, bar.t);
  const width = bar.half * 2;
  const basis = PART.outer * 2 * SCALE;
  const sleeveLen = basis * 0.32 * (2 / 3);
  const sleeveW = width * 1.3;
  const gripSpan = sleeveLen * 0.62 * 0.7;
  const gripStick = width * 0.48 * 0.7;
  const sample = (lx: number, ly: number) => {
    const x = px + frame.ux * lx + frame.nx * ly;
    const y = py + frame.uy * lx + frame.ny * ly;
    return ringHolds(ring, x, y);
  };
  for (let ix = 0; ix <= 4; ix++) {
    for (let iy = 0; iy <= 2; iy++) {
      if (sample(-sleeveLen / 2 + (sleeveLen * ix) / 4, -sleeveW / 2 + (sleeveW * iy) / 2)) return true;
    }
  }
  for (const side of [-1, 1]) {
    const gy = side * (sleeveW / 2 + gripStick / 2);
    for (let ix = 0; ix <= 3; ix++) {
      for (let iy = 0; iy <= 2; iy++) {
        if (sample(-gripSpan / 2 + (gripSpan * ix) / 3, gy - gripStick / 2 + (gripStick * iy) / 2)) return true;
      }
    }
  }
  const samples: { x: number; y: number }[] = [];
  pushRingSamples(samples, ring);
  return samples.some((p) => buckleHolds(bar, p.x, p.y, px, py));
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

/**
 * The bar body stops a ring.
 * A ring's own clasp stops that ring when the clasp is inside another ring's solid.
 * The caught ring still turns through the clasp. Pointerup decides whether it is released.
 */
export function ringVolumeHit(board: Board, ring: RingBody): boolean {
  for (const bar of board.bars) {
    if (barHitsRing(bar, bar.t, ring)) return true;
    const buckle = board.pins.find((pin) => pin.ownerId === bar.id && pin.role === 'stop' && pin.stopHalf === 0);
    if (buckle && buckleHitsRing(bar, ring, buckle.x, buckle.y)) return true;
  }
  for (const other of board.rings) {
    if (other.id === ring.id) continue;
    if (connectorHitsRing(ring, other)) return true;
  }
  return false;
}

function pointBlocked(board: Board, ring: RingBody, x: number, y: number): boolean {
  for (const other of board.rings) {
    if (other.id !== ring.id && ringHolds(other, x, y)) return true;
  }
  for (const bar of board.bars) {
    const seg = barSegment(bar, bar.t);
    if (distToSegment(x, y, seg.ax, seg.ay, seg.bx, seg.by) <= bar.half) return true;
  }
  return false;
}

function fixedHits(board: Board, ring: RingBody): { x: number; y: number }[] {
  const hits: { x: number; y: number }[] = [];
  for (const other of board.rings) {
    if (other.id === ring.id) continue;
    for (const p of connectorSamples(other)) {
      if (ringHolds(ring, p.x, p.y)) hits.push(p);
    }
  }
  for (const bar of board.bars) {
    const seg = barSegment(bar, bar.t);
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const x = seg.ax + (seg.bx - seg.ax) * u;
      const y = seg.ay + (seg.by - seg.ay) * u;
      if (ringHolds(ring, x, y)) hits.push({ x, y });
    }
  }
  return hits;
}

function ringBodySamples(ring: RingBody): { x: number; y: number }[] {
  const samples: { x: number; y: number }[] = [];
  pushRingSamples(samples, ring);
  return samples;
}

function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** First new contact along the push. A long probe would average in later overlaps. */
export function ringStrikePoint(board: Board, ring: RingBody, sign: number): { x: number; y: number } | null {
  const saved = ring.theta;
  const dir = Math.sign(sign) || 1;
  const beforeMove = ringBodySamples(ring);
  const beforeFixed = fixedHits(board, ring);
  const seen = new Set(beforeFixed.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
  try {
    for (const extra of [0.012, 0.024, 0.04]) {
      ring.theta = wrapAngle(saved + dir * extra);
      const afterMove = ringBodySamples(ring);
      const fresh: { x: number; y: number }[] = [];
      for (let i = 0; i < afterMove.length; i++) {
        const next = afterMove[i];
        const prev = beforeMove[i];
        if (!prev) continue;
        if (pointBlocked(board, ring, next.x, next.y) && !pointBlocked(board, ring, prev.x, prev.y)) fresh.push(next);
      }
      for (const p of fixedHits(board, ring)) {
        if (!seen.has(`${p.x.toFixed(3)},${p.y.toFixed(3)}`)) fresh.push(p);
      }
      if (fresh.length > 0) return centroid(fresh);
    }
    return null;
  } finally {
    ring.theta = saved;
  }
}

/** Leading cap of a bar at the moment it enters a ring. */
export function barStrikePoint(board: Board, bar: BarBody, sign: number): { x: number; y: number } | null {
  const saved = bar.t;
  const dir = Math.sign(sign) || 1;
  try {
    for (const extra of [0.01, 0.02, 0.04, 0.08]) {
      const next = Math.min(1, Math.max(0, saved + dir * extra));
      bar.t = next;
      for (const ring of board.rings) {
        if (leadDepth(ring, bar, next, dir) <= leadDepth(ring, bar, saved, dir) + 1e-4) continue;
        const seg = barSegment(bar, next);
        return dir >= 0 ? { x: seg.bx, y: seg.by } : { x: seg.ax, y: seg.ay };
      }
    }
    return null;
  } finally {
    bar.t = saved;
  }
}
