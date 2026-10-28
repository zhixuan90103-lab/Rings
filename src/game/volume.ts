/**
 * Flat volumes on one plane.
 * A ring does not block another ring with its own band.
 * Ring-to-ring restraint is the stem and handle.
 * A bar capsule and its silver buckle stop a ring where the drawn shapes meet.
 */

import type { BarBody, Board, RingBody } from './board';
import { gapCovers, signedDelta, wrapAngle } from './angle';
import { PART, buckleMetrics, connectorLayout } from './parts';

/**
 * Radius of the drawn gap cap.
 * The mesh insets both edges by band/4, then the extrude bevel grows that
 * outline back out, so the cap is a semicircle of radius band/2.
 */
function hornRadius(ring: RingBody): number {
  return (ring.outer - ring.inner) / 2;
}

function ringSector(ring: RingBody, x: number, y: number): boolean {
  const d = Math.hypot(x - ring.x, y - ring.y);
  if (d < ring.inner || d > ring.outer) return false;
  const alpha = Math.atan2(y - ring.y, x - ring.x);
  return !gapCovers(ring.theta, alpha, ring.gap);
}

const SCALE = PART.scale;

function connectorBox(ring: RingBody): { x: number; y: number; angle: number; length: number; width: number }[] {
  const width = ring.outer * PART.bandRatio;
  return ring.connectors.map((connector) => {
    const metrics = connectorLayout(ring.outer, width, connector.stem);
    const world = ring.theta + connector.angle;
    return {
      x: ring.x + Math.cos(world) * metrics.stemDist,
      y: ring.y + Math.sin(world) * metrics.stemDist,
      angle: world,
      length: metrics.stemLen,
      width: metrics.stemW,
    };
  });
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

/** Drawn ring metal: band with the gap removed, both caps, stem, and clasp. */
export function ringCovers(ring: RingBody, x: number, y: number): boolean {
  return ringHolds(ring, x, y);
}

/** Drawn capsule. The silver buckle is not part of the bar. */
export function barCovers(bar: BarBody, x: number, y: number): boolean {
  const seg = barSegment(bar, bar.t);
  return distToSegment(x, y, seg.ax, seg.ay, seg.bx, seg.by) <= bar.half;
}

/** Silver sleeve and the two grips. A press here is not a bar press. */
export function buckleCovers(bar: BarBody, x: number, y: number, px: number, py: number): boolean {
  return buckleHolds(bar, x, y, px, py);
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
  return claspArcs(ring).some((arc) => inClasp(arc, x, y));
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
  const { sleeveLen, sleeveW } = buckleSpec(bar);
  return { halfLen: sleeveLen / 2, halfW: sleeveW / 2 };
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

function buckleSpec(bar: BarBody): { sleeveLen: number; sleeveW: number; gripSpan: number; gripStick: number } {
  return buckleMetrics(bar.half * 2, PART.outer * 2 * SCALE);
}

function buckleLocal(bar: BarBody, x: number, y: number, px: number, py: number): { lx: number; ly: number } {
  const frame = barFrame(bar, bar.t);
  const dx = x - px;
  const dy = y - py;
  return {
    lx: dx * frame.ux + dy * frame.uy,
    ly: dx * frame.nx + dy * frame.ny,
  };
}

/** How far a point sits inside one buckle box. Zero means it is outside. */
function boxDepth(lx: number, ly: number, cx: number, cy: number, halfL: number, halfW: number): number {
  const along = halfL - Math.abs(lx - cx);
  const across = halfW - Math.abs(ly - cy);
  if (along < 0 || across < 0) return 0;
  return Math.min(along, across);
}

/** Silver sleeve and the two grips. The bar slides through this shape, so it is not a hit against its own bar. */
function buckleHolds(bar: BarBody, x: number, y: number, px: number, py: number): boolean {
  const { sleeveLen, sleeveW, gripSpan, gripStick } = buckleSpec(bar);
  const { lx, ly } = buckleLocal(bar, x, y, px, py);
  if (Math.abs(lx) <= sleeveLen / 2 && Math.abs(ly) <= sleeveW / 2) return true;
  for (const side of [-1, 1]) {
    const gy = side * (sleeveW / 2 + gripStick / 2);
    if (Math.abs(lx) <= gripSpan / 2 && Math.abs(ly - gy) <= gripStick / 2) return true;
  }
  return false;
}

function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const qx = ax - cx;
  const qy = ay - cy;
  const rr = rx * rx + ry * ry;
  const ss = sx * sx + sy * sy;
  const rs = rx * sx + ry * sy;
  const qr = qx * rx + qy * ry;
  const qs = qx * sx + qy * sy;
  let t = 0;
  let u = 0;
  const denom = rr * ss - rs * rs;
  if (denom > 1e-8) t = Math.max(0, Math.min(1, (rs * qs - ss * qr) / denom));
  else t = 0;
  const uDen = ss > 1e-8 ? ss : 1;
  u = Math.max(0, Math.min(1, (t * rs + qs) / uDen));
  if (ss <= 1e-8) u = 0;
  t = rr > 1e-8 ? Math.max(0, Math.min(1, (u * rs - qr) / rr)) : 0;
  const px = ax + rx * t - (cx + sx * u);
  const py = ay + ry * t - (cy + sy * u);
  return Math.hypot(px, py);
}

/** How far two capsules overlap. Zero means they are clear of each other. */
export function barsOverlapAmount(a: BarBody, t: number, b: BarBody): number {
  const left = barSegment(a, t);
  const right = barSegment(b, b.t);
  const gap = a.half + b.half - segmentDistance(left.ax, left.ay, left.bx, left.by, right.ax, right.ay, right.bx, right.by);
  return gap > 0 ? gap : 0;
}

/**
 * How far this ring's solid sits inside the fixed silver buckle.
 * The buckle blocks the ring. Its own bar still slides through it.
 */
export function buckleOverlapAmount(bar: BarBody, ring: RingBody, px: number, py: number): number {
  const { sleeveLen, sleeveW, gripSpan, gripStick } = buckleSpec(bar);
  const samples: { x: number; y: number }[] = [];
  pushRingSamples(samples, ring);
  let amount = 0;
  for (const p of samples) {
    const { lx, ly } = buckleLocal(bar, p.x, p.y, px, py);
    amount += boxDepth(lx, ly, 0, 0, sleeveLen / 2, sleeveW / 2);
    for (const side of [-1, 1]) {
      const gy = side * (sleeveW / 2 + gripStick / 2);
      amount += boxDepth(lx, ly, 0, gy, gripSpan / 2, gripStick / 2);
    }
  }
  const frame = barFrame(bar, bar.t);
  const sample = (lx: number, ly: number) => {
    const x = px + frame.ux * lx + frame.nx * ly;
    const y = py + frame.uy * lx + frame.ny * ly;
    if (ringHolds(ring, x, y)) amount += bar.half;
  };
  for (let ix = 0; ix <= 4; ix++) {
    for (let iy = 0; iy <= 2; iy++) {
      sample(-sleeveLen / 2 + (sleeveLen * ix) / 4, -sleeveW / 2 + (sleeveW * iy) / 2);
    }
  }
  for (const side of [-1, 1]) {
    const gy = side * (sleeveW / 2 + gripStick / 2);
    for (let ix = 0; ix <= 3; ix++) {
      for (let iy = 0; iy <= 2; iy++) {
        sample(-gripSpan / 2 + (gripSpan * ix) / 3, gy - gripStick / 2 + (gripStick * iy) / 2);
      }
    }
  }
  return amount;
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
  return barOverlapAmount(bar, t, ring) > 1e-4;
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
  for (const arc of claspArcs(ring)) {
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

type ClaspArc = { cx: number; cy: number; radius: number; half: number; width: number; mid: number };

function claspArcs(ring: RingBody): ClaspArc[] {
  const width = ring.outer * PART.bandRatio;
  return ring.connectors.map((connector) => {
    const metrics = connectorLayout(ring.outer, width, connector.stem);
    const world = ring.theta + connector.angle;
    const ox = ring.x + Math.cos(world) * metrics.claspDist;
    const oy = ring.y + Math.sin(world) * metrics.claspDist;
    return {
      cx: ox + Math.cos(world) * metrics.bend,
      cy: oy + Math.sin(world) * metrics.bend,
      radius: metrics.bend,
      half: metrics.claspLen / 2 / metrics.bend,
      width: metrics.claspW,
      mid: Math.atan2(-Math.sin(world), -Math.cos(world)),
    };
  });
}

function inClasp(arc: ClaspArc, x: number, y: number): boolean {
  const d = Math.hypot(x - arc.cx, y - arc.cy);
  if (d < arc.radius - arc.width / 2 || d > arc.radius + arc.width / 2) return false;
  return Math.abs(signedDelta(arc.mid, Math.atan2(y - arc.cy, x - arc.cx))) <= arc.half;
}

/**
 * How far an arc may sit off the other ring's center and still count as seated.
 * Inside this distance the captive ring can still turn the gap onto the handle.
 */
export const CLASP_SEAT = 0.07;

/**
 * Core overlap at or under this does not block. The drawn clasp is wider than
 * this core, so a light graze still lets the player turn back onto the seat.
 */
const CORE_SLACK = 0.012;

function coreBox(box: { x: number; y: number; angle: number; length: number; width: number }) {
  return {
    ...box,
    // Straight stem, not the clasp arc. 0.72 keeps a seated stem locked; the arc uses 0.78.
    length: Math.max(0.02, box.length * 0.72),
    width: Math.max(0.02, box.width * 0.62),
  };
}

function coreArc(arc: ClaspArc): ClaspArc {
  return {
    ...arc,
    half: Math.max(0.04, arc.half * 0.78),
    width: arc.width * 0.62,
  };
}

function pointBandDepth(ring: RingBody, x: number, y: number): number {
  if (!ringHolds(ring, x, y)) return 0;
  const radial = Math.hypot(x - ring.x, y - ring.y);
  const innerGap = radial - ring.inner;
  const outerGap = ring.outer - radial;
  if (innerGap <= 0 || outerGap <= 0) return Math.min(hornRadius(ring), 0.02);
  return Math.min(innerGap, outerGap);
}

/** Inset stem and clasp buried in the other ring. Zero means the core is clear. */
export function connectorCoreDepth(owner: RingBody, other: RingBody): number {
  if (owner.connectors.length === 0) return 0;
  let amount = 0;
  for (const box of connectorBox(owner)) {
    const core = coreBox(box);
    const n = 4;
    for (let ix = 0; ix <= n; ix++) {
      for (let iy = 0; iy <= 2; iy++) {
        const lx = -core.length / 2 + (core.length * ix) / n;
        const ly = -core.width / 2 + (core.width * iy) / 2;
        const c = Math.cos(core.angle);
        const s = Math.sin(core.angle);
        amount += pointBandDepth(other, core.x + c * lx - s * ly, core.y + s * lx + c * ly);
      }
    }
  }
  for (const arc of claspArcs(owner)) {
    const core = coreArc(arc);
    for (let i = 0; i <= 6; i++) {
      const a = core.mid - core.half + (2 * core.half * i) / 6;
      for (const k of [-0.35, 0, 0.35]) {
        const radius = core.radius + core.width * k;
        amount += pointBandDepth(other, core.cx + Math.cos(a) * radius, core.cy + Math.sin(a) * radius);
      }
    }
  }
  return amount;
}

/** Distance from this clasp's arc center to the other ring center. */
export function claspCenterDistance(owner: RingBody, other: RingBody): number {
  let best = Infinity;
  for (const arc of claspArcs(owner)) {
    best = Math.min(best, Math.hypot(arc.cx - other.x, arc.cy - other.y));
  }
  return best;
}

export type ClaspPose = { kind: 'owner' | 'captive'; dist: number; depth: number };

/** One pose per clasp this drag can change. Owner clasps first, then clasps on other rings. */
export function claspPoses(board: Board, ring: RingBody): ClaspPose[] {
  const poses: ClaspPose[] = [];
  for (const other of board.rings) {
    if (other.id === ring.id) continue;
    if (ring.connectors.length > 0) {
      poses.push({ kind: 'owner', dist: claspCenterDistance(ring, other), depth: connectorCoreDepth(ring, other) });
    }
    if (other.connectors.length > 0) {
      poses.push({ kind: 'captive', dist: claspCenterDistance(other, ring), depth: connectorCoreDepth(other, ring) });
    }
  }
  return poses;
}

/** §1 drag rule. A graze under `CORE_SLACK` does not block. */
export function claspDragBlocked(before: ClaspPose[], after: ClaspPose[]): boolean {
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) {
    if (before[i].kind !== after[i].kind) continue;
    if (claspStepBlocked(before[i].kind, before[i].dist, before[i].depth, after[i].dist, after[i].depth)) return true;
  }
  return false;
}

function claspStepBlocked(
  kind: 'owner' | 'captive',
  beforeDist: number,
  beforeDepth: number,
  afterDist: number,
  afterDepth: number,
): boolean {
  if (kind === 'captive') {
    if (afterDist <= CLASP_SEAT || afterDepth <= CORE_SLACK) return false;
    if (beforeDepth <= CORE_SLACK) return true;
    return afterDepth > beforeDepth - 0.004;
  }
  if (beforeDist <= CLASP_SEAT && beforeDepth > CORE_SLACK) return true;
  if (beforeDepth <= CORE_SLACK) return afterDist > CLASP_SEAT && afterDepth > CORE_SLACK;
  return afterDist > beforeDist - 0.002;
}

/** Stem and bent handle against the other ring. */
export function connectorHitsRing(owner: RingBody, other: RingBody): boolean {
  if (owner.connectors.length === 0) return false;
  for (const p of connectorSamples(owner)) {
    if (ringHolds(other, p.x, p.y)) return true;
  }
  const arcs = claspArcs(owner);
  const boxes = connectorBox(owner);
  const bandSamples: { x: number; y: number }[] = [];
  pushRingSamples(bandSamples, other);
  return bandSamples.some((p) => arcs.some((arc) => inClasp(arc, p.x, p.y)) || boxes.some((box) => inBox(box, p.x, p.y)));
}

/** Drawn band and gap caps. Another ring's handle is not part of this solid. */
function solidHolds(ring: RingBody, x: number, y: number): boolean {
  if (ringSector(ring, x, y)) return true;
  const mid = (ring.inner + ring.outer) / 2;
  const cap = hornRadius(ring);
  for (const sign of [-1, 1]) {
    const a = ring.theta + (sign * ring.gap) / 2;
    const dx = x - (ring.x + Math.cos(a) * mid);
    const dy = y - (ring.y + Math.sin(a) * mid);
    if (dx * dx + dy * dy <= cap * cap) return true;
  }
  return false;
}

function hitsOtherSolid(board: Board, ring: RingBody, x: number, y: number): boolean {
  return board.rings.some((other) => other.id !== ring.id && solidHolds(other, x, y));
}

function pointBlocked(board: Board, ring: RingBody, x: number, y: number, connector = false): boolean {
  if (connector) {
    for (const other of board.rings) {
      if (other.id !== ring.id && ringHolds(other, x, y)) return true;
    }
  }
  for (const bar of board.bars) {
    const seg = barSegment(bar, bar.t);
    if (distToSegment(x, y, seg.ax, seg.ay, seg.bx, seg.by) <= bar.half) return true;
    const buckle = board.latches.find((latch) => latch.barId === bar.id && latch.release === 'sleeve');
    if (buckle && buckleHolds(bar, x, y, buckle.x, buckle.y)) return true;
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

function ringBodySamples(ring: RingBody): { x: number; y: number; connector: boolean }[] {
  const samples: { x: number; y: number; connector: boolean }[] = [];
  const band: { x: number; y: number }[] = [];
  pushRingSamples(band, ring);
  for (const p of band) samples.push({ ...p, connector: false });
  for (const p of connectorSamples(ring)) samples.push({ ...p, connector: true });
  return samples;
}

function nearPoint(points: { x: number; y: number }[], x: number, y: number): boolean {
  return points.some((p) => Math.hypot(p.x - x, p.y - y) < 0.12);
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

function distToBars(board: Board, x: number, y: number): number {
  let best = Infinity;
  for (const bar of board.bars) {
    const seg = barSegment(bar, bar.t);
    best = Math.min(best, distToSegment(x, y, seg.ax, seg.ay, seg.bx, seg.by));
  }
  return best;
}

/** The handle contact farthest from the ring center. The stem root is closer than the clasp. */
function outerPatch(ring: RingBody, fresh: { x: number; y: number }[]): { x: number; y: number } {
  let nearest = fresh[0];
  let best = Math.hypot(nearest.x - ring.x, nearest.y - ring.y);
  for (const p of fresh) {
    const d = Math.hypot(p.x - ring.x, p.y - ring.y);
    if (d > best) {
      best = d;
      nearest = p;
    }
  }
  const patch = fresh.filter((p) => Math.hypot(p.x - nearest.x, p.y - nearest.y) < 0.08);
  return centroid(patch);
}

/** Band samples buried in another ring. The deepest bite is the contact, not a handle already seated elsewhere. */
function ringPatch(board: Board, ring: RingBody, fresh: { x: number; y: number }[]): { x: number; y: number } {
  let nearest = fresh[0];
  let best = -1;
  for (const p of fresh) {
    let depth = 0;
    for (const other of board.rings) {
      if (other.id === ring.id || !solidHolds(other, p.x, p.y)) continue;
      depth = Math.max(depth, pointBandDepth(other, p.x, p.y));
    }
    if (depth > best) {
      best = depth;
      nearest = p;
    }
  }
  const patch = fresh.filter((p) => Math.hypot(p.x - nearest.x, p.y - nearest.y) < 0.08);
  return centroid(patch);
}

/** One contact patch. Averaging the left and right sides lands in the hole. */
function nearestPatch(board: Board, fresh: { x: number; y: number }[]): { x: number; y: number } {
  let nearest = fresh[0];
  let best = distToBars(board, nearest.x, nearest.y);
  for (const p of fresh) {
    const d = distToBars(board, p.x, p.y);
    if (d < best) {
      best = d;
      nearest = p;
    }
  }
  const patch = fresh.filter((p) => Math.hypot(p.x - nearest.x, p.y - nearest.y) < 0.08);
  return centroid(patch);
}

/** First new contact along the push. A long probe would average in later overlaps. */
function ringStrikePoint(board: Board, ring: RingBody, sign: number): { x: number; y: number } | null {
  const saved = ring.theta;
  const dir = Math.sign(sign) || 1;
  const beforeMove = ringBodySamples(ring);
  const beforeFixed = fixedHits(board, ring);
  const seen = new Set(beforeFixed.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
  const alreadyTouching = beforeFixed.filter(() => true);
  for (const p of beforeMove) {
    if (pointBlocked(board, ring, p.x, p.y, p.connector) || (!p.connector && hitsOtherSolid(board, ring, p.x, p.y))) alreadyTouching.push(p);
  }
  const meets = (p: { x: number; y: number; connector: boolean }) =>
    pointBlocked(board, ring, p.x, p.y, p.connector) || (!p.connector && hitsOtherSolid(board, ring, p.x, p.y));
  try {
    for (const extra of [0.012, 0.024, 0.04]) {
      ring.theta = wrapAngle(saved + dir * extra);
      const afterMove = ringBodySamples(ring);
      const fresh: { x: number; y: number; connector?: boolean }[] = [];
      for (let i = 0; i < afterMove.length; i++) {
        const next = afterMove[i];
        const prev = beforeMove[i];
        if (!prev) continue;
        if (meets(next) && !meets(prev)) fresh.push(next);
      }
      for (const p of fixedHits(board, ring)) {
        if (!seen.has(`${p.x.toFixed(3)},${p.y.toFixed(3)}`)) fresh.push(p);
      }
      const claspFresh = fresh.filter((p) => p.connector);
      if (claspFresh.length > 0) return outerPatch(ring, claspFresh);
      const opened = fresh.filter((p) => !nearPoint(alreadyTouching, p.x, p.y));
      if (opened.length > 0) {
        const againstBar = opened.some((p) => distToBars(board, p.x, p.y) <= 0.2);
        return againstBar ? nearestPatch(board, opened) : ringPatch(board, ring, opened);
      }
    }
    const already = fixedHits(board, ring);
    const band: { x: number; y: number }[] = [];
    for (const p of beforeMove) {
      if (p.connector) {
        if (pointBlocked(board, ring, p.x, p.y, true)) already.push(p);
      } else if (hitsOtherSolid(board, ring, p.x, p.y)) band.push(p);
    }
    if (band.length > 0) return ringPatch(board, ring, band);
    return already.length > 0 ? nearestPatch(board, already) : null;
  } finally {
    ring.theta = saved;
  }
}

/** Where this push first meets the other part. Presentation only. */
export function strikePoint(board: Board, kind: 'ring' | 'bar', id: string, sign: number): { x: number; y: number } | null {
  if (kind === 'ring') {
    const ring = board.rings.find((item) => item.id === id);
    return ring ? ringStrikePoint(board, ring, sign) : null;
  }
  const bar = board.bars.find((item) => item.id === id);
  return bar ? barStrikePoint(board, bar, sign) : null;
}

function barTouchPoint(bar: BarBody, t: number, ring: RingBody): { x: number; y: number } | null {
  const seg = barSegment(bar, t);
  const samples: { x: number; y: number }[] = [];
  pushRingSamples(samples, ring);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const p of samples) {
    const d = distToSegment(p.x, p.y, seg.ax, seg.ay, seg.bx, seg.by);
    if (d <= bar.half && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) return best;
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = seg.ax + (seg.bx - seg.ax) * u;
    const y = seg.ay + (seg.by - seg.ay) * u;
    if (ringHolds(ring, x, y)) return { x, y };
  }
  return null;
}

/** First place the capsule meets a ring while sliding this way. */
function barStrikePoint(board: Board, bar: BarBody, sign: number): { x: number; y: number } | null {
  const saved = bar.t;
  const dir = Math.sign(sign) || 1;
  const overlap = (t: number, ring: RingBody) => barOverlapAmount(bar, t, ring);
  try {
    for (const extra of [0.01, 0.02, 0.04, 0.08]) {
      const next = saved + dir * extra;
      bar.t = next;
      for (const ring of board.rings) {
        if (overlap(next, ring) <= overlap(saved, ring) + 1e-4) continue;
        const at = barTouchPoint(bar, next, ring);
        if (at) return at;
      }
      for (const other of board.bars) {
        if (other.id === bar.id) continue;
        if (barsOverlapAmount(bar, next, other) <= barsOverlapAmount(bar, saved, other) + 1e-4) continue;
        const seg = barSegment(bar, next);
        const otherSeg = barSegment(other, other.t);
        const vx = seg.bx - seg.ax;
        const vy = seg.by - seg.ay;
        const len2 = vx * vx + vy * vy || 1;
        const ox = (otherSeg.ax + otherSeg.bx) / 2;
        const oy = (otherSeg.ay + otherSeg.by) / 2;
        const u = Math.max(0, Math.min(1, ((ox - seg.ax) * vx + (oy - seg.ay) * vy) / len2));
        return { x: seg.ax + vx * u, y: seg.ay + vy * u };
      }
    }
    return null;
  } finally {
    bar.t = saved;
  }
}
