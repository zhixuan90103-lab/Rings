/**
 * Authored joints on one axis.
 * A blocking pin forbids the ring angles where the solid covers it.
 * A stop forbids a fixed arc and is not a retainer.
 * A handle is a connector on its owner ring. It is not a pin.
 * A latch keeps its bar until the sleeve is clear, or an old window contains t.
 */

import { gapCovers, signedDelta, wrapAngle } from './angle';
import {
  clampAngle,
  clampLinear,
  freeArcs,
  freeLinear,
  hardForbidden,
  pinForbidden,
  type CircInterval,
  type LinInterval,
} from './interval';
import { PART, connectorLayout } from './parts';
import {
  barOverlapAmount,
  barsOverlapAmount,
  barStillInBuckle,
  buckleOverlapAmount,
  claspDragBlocked,
  claspPoses,
  connectorHitsRing,
} from './volume';

export type RingBody = {
  id: string;
  kind: 'ring';
  x: number;
  y: number;
  inner: number;
  outer: number;
  gap: number;
  theta: number;
  /** Authored color. Omitted rings keep the color implied by their id. */
  color?: number;
  /** Stems and handles on this ring. Empty when it has none. */
  connectors: RingConnector[];
};

/** One stem plus one clasp. `stem` is the straight rod length, in the same units as `outer`. */
export type RingConnector = {
  angle: number;
  stem: number;
  /** Ring this handle is meant to lock. The clasp still has to sit in that ring. */
  target: string | null;
};

export type BarBody = {
  id: string;
  kind: 'bar';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  half: number;
  /** Half-length of the visible capsule, in world units along the rail. */
  grip: number;
  t: number;
  color?: number;
};

export type Pin = {
  id: string;
  /**
   * Who wears this pin.
   * A ring id owns a one-way block. A bar id owns only the silver mark on that bar.
   * Null is a world pin and keeps whichever ring it sits in.
   * A handle is not a pin. It lives on `RingBody.connectors`.
   */
  ownerId: string | null;
  localAngle: number;
  localRadius: number;
  x: number;
  y: number;
  /** World `catch` only keeps a ring. It does not stop the turn and it is not a handle. */
  role: 'block' | 'stop' | 'catch';
  /** Stop pins hard-limit this ring and do not retain it. */
  limitRingId: string | null;
  stopHalf: number;
};

/**
 * Silver buckle or an old release window. It belongs to one bar and keeps that bar only.
 * `sleeve` uses the drawn buckle at x, y. `window` releases when t is inside [t0, t1].
 */
export type Latch = {
  id: string;
  barId: string;
  x: number;
  y: number;
  t0: number;
  t1: number;
  release: 'sleeve' | 'window';
};

export type Board = {
  rings: RingBody[];
  bars: BarBody[];
  pins: Pin[];
  latches: Latch[];
  /** When set, ring and bar volumes block each other. */
  volumes?: boolean;
};

export type Drag =
  | { kind: 'ring'; id: string; theta: number; x: number; y: number }
  | { kind: 'bar'; id: string; t: number; x: number; y: number };

export function ringById(board: Board, id: string): RingBody | undefined {
  return board.rings.find((r) => r.id === id);
}

export function barById(board: Board, id: string): BarBody | undefined {
  return board.bars.find((b) => b.id === id);
}

export function syncPins(board: Board): void {
  for (const pin of board.pins) {
    if (!pin.ownerId) continue;
    const owner = ringById(board, pin.ownerId);
    if (!owner) continue;
    const a = owner.theta + pin.localAngle;
    pin.x = owner.x + Math.cos(a) * pin.localRadius;
    pin.y = owner.y + Math.sin(a) * pin.localRadius;
  }
}

function dist(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0);
}

function inBand(ring: RingBody, x: number, y: number): boolean {
  const d = dist(ring.x, ring.y, x, y);
  return d >= ring.inner && d <= ring.outer;
}

export function ringSolidContains(ring: RingBody, x: number, y: number): boolean {
  if (!inBand(ring, x, y)) return false;
  const alpha = Math.atan2(y - ring.y, x - ring.x);
  return !gapCovers(ring.theta, alpha, ring.gap);
}

function blockingPoints(board: Board, ring: RingBody): { x: number; y: number; hard: boolean; half: number }[] {
  const points: { x: number; y: number; hard: boolean; half: number }[] = [];
  for (const pin of board.pins) {
    if (pin.role === 'block' && pin.ownerId !== ring.id && inBand(ring, pin.x, pin.y)) {
      points.push({ x: pin.x, y: pin.y, hard: false, half: 0 });
    }
    if (pin.role === 'stop' && pin.limitRingId === ring.id) {
      points.push({ x: pin.x, y: pin.y, hard: true, half: pin.stopHalf });
    }
  }
  return points;
}

/** Pin levels only. Volume levels step the overlap instead of sweeping free arcs. */
export function ringFreeArcs(board: Board, ring: RingBody): CircInterval[] {
  const forbidden = [];
  for (const point of blockingPoints(board, ring)) {
    const alpha = Math.atan2(point.y - ring.y, point.x - ring.x);
    const interval = point.hard ? hardForbidden(alpha, point.half) : pinForbidden(alpha, ring.gap);
    if (interval) forbidden.push(interval);
  }
  return freeArcs(forbidden);
}

/** A step is blocked when a clear pair starts to touch, or an existing overlap gets deeper. */
function overlapGrew(before: number, now: number): boolean {
  return (before <= 1e-4 && now > 1e-4) || (before > 1e-4 && now > before + 1e-4);
}

function ringBlockDepth(board: Board, ring: RingBody): number {
  let depth = 0;
  for (const bar of board.bars) {
    depth += barOverlapAmount(bar, bar.t, ring);
    const buckle = board.latches.find((latch) => latch.barId === bar.id && latch.release === 'sleeve');
    if (buckle) depth += buckleOverlapAmount(bar, ring, buckle.x, buckle.y);
  }
  return depth;
}

function barBlockDepth(board: Board, bar: BarBody, t: number): number {
  let depth = 0;
  for (const ring of board.rings) depth += barOverlapAmount(bar, t, ring);
  for (const other of board.bars) {
    if (other.id !== bar.id) depth += barsOverlapAmount(bar, t, other);
  }
  return depth;
}

/** Smallest accepted slice. A larger stride never skips a solid this thin. */
const FINE_ANGLE = 0.012;

function ringStride(ring: RingBody): number {
  const band = Math.max(ring.outer - ring.inner, 0.02);
  const thin = band * 0.5 * 0.62;
  let reach = ring.outer;
  for (const connector of ring.connectors) reach = Math.max(reach, ring.outer + connector.stem + band);
  return Math.max(FINE_ANGLE, thin / Math.max(reach, 0.2));
}

function ringSliceBlocked(board: Board, ring: RingBody, from: number, to: number): boolean {
  ring.theta = from;
  syncPins(board);
  const depthBefore = ringBlockDepth(board, ring);
  const tiesBefore = claspPoses(board, ring);
  ring.theta = to;
  syncPins(board);
  return claspDragBlocked(tiesBefore, claspPoses(board, ring)) || overlapGrew(depthBefore, ringBlockDepth(board, ring));
}

/** Largest prefix of `step` that stays legal. A failed far pose is not kept. */
function takePrefix(step: number, fine: number, blocked: (distance: number) => boolean, apply: (distance: number) => void): number {
  if (!blocked(step)) {
    apply(step);
    return step;
  }
  let lo = 0;
  let hi = step;
  while (hi - lo > fine) {
    const mid = (lo + hi) / 2;
    if (!blocked(mid)) lo = mid;
    else hi = mid;
  }
  apply(lo);
  return lo;
}

function takeRing(board: Board, ring: RingBody, sign: number, step: number): number {
  const from = ring.theta;
  const at = (distance: number) => wrapAngle(from + sign * distance);
  return takePrefix(
    step,
    FINE_ANGLE,
    (distance) => ringSliceBlocked(board, ring, from, at(distance)),
    (distance) => {
      ring.theta = at(distance);
      syncPins(board);
    },
  );
}

export function rotateRing(board: Board, ring: RingBody, delta: number): void {
  if (!board.volumes) {
    ring.theta = clampAngle(ring.theta, delta, ringFreeArcs(board, ring));
    syncPins(board);
    return;
  }
  const sign = Math.sign(delta);
  if (sign === 0) return;
  let left = Math.abs(delta);
  const stride = ringStride(ring);
  while (left > 1e-4) {
    const step = Math.min(stride, left);
    const gained = takeRing(board, ring, sign, step);
    if (gained < step - 1e-4) return;
    left -= gained;
  }
}

function barPoint(bar: BarBody, t: number): { x: number; y: number } {
  return {
    x: bar.x0 + (bar.x1 - bar.x0) * t,
    y: bar.y0 + (bar.y1 - bar.y0) * t,
  };
}

/** Pin levels only. A t is blocked when the bar center lies in a ring's annulus solid. */
export function barBlocked(board: Board, bar: BarBody): LinInterval[] {
  const steps = 48;
  const blocked: LinInterval[] = [];
  let run: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const hit = board.rings.some((ring) => ringSolidContains(ring, barPoint(bar, t).x, barPoint(bar, t).y));
    if (hit && run === null) run = t;
    if (!hit && run !== null) {
      blocked.push({ a: run, b: t });
      run = null;
    }
  }
  if (run !== null) blocked.push({ a: run, b: 1 });
  return blocked;
}

const FINE_T = 0.008;

function barStride(board: Board, bar: BarBody): number {
  const rail = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) || 1;
  let thin = bar.half > 0 ? bar.half : 0.08;
  for (const ring of board.rings) {
    const band = Math.max(ring.outer - ring.inner, 0.02);
    thin = Math.min(thin, band * 0.5 * 0.62);
  }
  return Math.max(FINE_T, thin / rail);
}

function barSliceBlocked(board: Board, bar: BarBody, from: number, to: number): boolean {
  return overlapGrew(barBlockDepth(board, bar, from), barBlockDepth(board, bar, to));
}

function takeBar(board: Board, bar: BarBody, sign: number, step: number): number {
  const from = bar.t;
  return takePrefix(
    step,
    FINE_T,
    (distance) => barSliceBlocked(board, bar, from, from + sign * distance),
    (distance) => {
      bar.t = from + sign * distance;
    },
  );
}

export function moveBar(board: Board, bar: BarBody, target: number): void {
  if (!board.volumes) {
    const free = freeLinear(barBlocked(board, bar), 0, 1);
    bar.t = clampLinear(bar.t, target, free);
    return;
  }
  const sign = Math.sign(target - bar.t);
  if (sign === 0) return;
  let left = Math.abs(target - bar.t);
  const stride = barStride(board, bar);
  while (left > 1e-4) {
    const step = Math.min(stride, left);
    const gained = takeBar(board, bar, sign, step);
    if (gained < step - 1e-4) return;
    left -= gained;
  }
}

export function projectBar(bar: BarBody, x: number, y: number): number {
  const dx = bar.x1 - bar.x0;
  const dy = bar.y1 - bar.y0;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-8) return bar.t;
  return ((x - bar.x0) * dx + (y - bar.y0) * dy) / len2;
}

function catchReach(ring: RingBody): number {
  return ring.outer + (ring.outer - ring.inner) * 0.85;
}

function pinHolds(ring: RingBody, pin: { role: string; x: number; y: number }): boolean {
  const d = Math.hypot(pin.x - ring.x, pin.y - ring.y);
  if (pin.role === 'catch') return d <= catchReach(ring) && d >= ring.inner * 0.4;
  return inBand(ring, pin.x, pin.y);
}

function handlesMeet(a: RingBody, b: RingBody): boolean {
  return connectorHitsRing(a, b) || connectorHitsRing(b, a);
}

/** Where the arc is mounted, in world XY. A seated arc center sits on the other ring, so the gap uses this point. */
export function handlePoint(owner: RingBody, connector: RingConnector): { x: number; y: number } {
  const width = owner.outer * PART.bandRatio;
  const metrics = connectorLayout(owner.outer, width, connector.stem);
  const world = owner.theta + connector.angle;
  return {
    x: owner.x + Math.cos(world) * metrics.claspDist,
    y: owner.y + Math.sin(world) * metrics.claspDist,
  };
}

function aimedAt(owner: RingBody, connector: RingConnector, ring: RingBody): boolean {
  if (connector.target !== ring.id) return false;
  const point = handlePoint(owner, connector);
  const alpha = Math.atan2(point.y - ring.y, point.x - ring.x);
  return gapCovers(ring.theta, alpha, ring.gap) && !connectorHitsRing(owner, ring);
}

/** The dragged ring is the captive. Its own gap does not free a handle it owns. */
function handleReleasable(board: Board, ring: RingBody): boolean {
  return board.rings.some((owner) => owner.id !== ring.id && owner.connectors.some((connector) => aimedAt(owner, connector, ring)));
}

function linked(a: RingBody, b: RingBody): boolean {
  if (handlesMeet(a, b)) return true;
  if (a.connectors.some((connector) => connector.target === b.id)) return true;
  return b.connectors.some((connector) => connector.target === a.id);
}

function retainers(board: Board, id: string): number {
  const ring = ringById(board, id);
  if (ring) {
    let n = 0;
    for (const other of board.rings) {
      if (other.id !== ring.id && linked(ring, other)) n += 1;
    }
    for (const pin of board.pins) {
      if (pin.role !== 'block' && pin.role !== 'catch') continue;
      if (pin.ownerId && ringById(board, pin.ownerId)) continue;
      if (pinHolds(ring, pin)) n += 1;
    }
    return n;
  }
  return board.latches.filter((latch) => latch.barId === id).length;
}

/** World pins drop when the gap covers them. A handle drops only through `releaseHandles`. */
function pinReleased(ring: RingBody, pin: Board['pins'][number]): boolean {
  if (pin.role !== 'block' && pin.role !== 'catch') return false;
  if (pin.ownerId && pin.ownerId === ring.id) return false;
  if (!pinHolds(ring, pin)) return false;
  const alpha = Math.atan2(pin.y - ring.y, pin.x - ring.x);
  return gapCovers(ring.theta, alpha, ring.gap);
}

function releaseHandles(board: Board, ring: RingBody): void {
  for (const owner of board.rings) {
    if (owner.id === ring.id) continue;
    for (const connector of owner.connectors) {
      if (aimedAt(owner, connector, ring)) connector.target = null;
    }
  }
}

function nudgeRingOneWay(board: Board, ring: RingBody, sign: number, maxTurn: number): boolean {
  const start = ring.theta;
  const depth = ringBlockDepth(board, ring);
  const ties = claspPoses(board, ring);
  for (let walked = 0.012; walked <= maxTurn + 1e-6; walked += 0.012) {
    ring.theta = wrapAngle(start + sign * Math.min(walked, maxTurn));
    syncPins(board);
    if (!board.pins.some((pin) => pinReleased(ring, pin)) && !handleReleasable(board, ring)) continue;
    if (overlapGrew(depth, ringBlockDepth(board, ring)) || claspDragBlocked(ties, claspPoses(board, ring))) break;
    return true;
  }
  ring.theta = start;
  syncPins(board);
  return false;
}

/** §4 lift. `pad` is the 6% arc along the band. Drag direction first, then the other way. */
export function nudgeRing(board: Board, ring: RingBody, sign: number, pad: number): void {
  if (pad <= 0) return;
  syncPins(board);
  if (board.pins.some((pin) => pinReleased(ring, pin)) || handleReleasable(board, ring)) return;
  const lever = Math.max((ring.inner + ring.outer) / 2, 1e-4);
  const maxTurn = pad / lever;
  const first = sign === 0 ? 1 : sign;
  if (nudgeRingOneWay(board, ring, first, maxTurn)) return;
  nudgeRingOneWay(board, ring, -first, maxTurn);
}

export function settle(board: Board, drag: Drag): string[] {
  syncPins(board);
  if (drag.kind === 'ring') {
    const ring = ringById(board, drag.id);
    if (!ring) return [];
    releaseHandles(board, ring);
    board.pins = board.pins.filter((pin) => !pinReleased(ring, pin));
  } else {
    const bar = barById(board, drag.id);
    if (!bar) return [];
    board.latches = board.latches.filter((latch) => {
      if (latch.barId !== bar.id) return true;
      if (latch.release === 'sleeve') return barStillInBuckle(bar, latch.x, latch.y);
      return bar.t < latch.t0 || bar.t > latch.t1;
    });
  }
  return cascade(board);
}

function cascade(board: Board): string[] {
  const left: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    syncPins(board);
    const ids = [...board.rings.map((r) => r.id), ...board.bars.map((b) => b.id)];
    for (const id of ids) {
      if (retainers(board, id) > 0) continue;
      left.push(id);
      board.rings = board.rings.filter((r) => r.id !== id);
      board.bars = board.bars.filter((b) => b.id !== id);
      board.pins = board.pins.filter((p) => p.ownerId !== id && p.limitRingId !== id);
      board.latches = board.latches.filter((l) => l.barId !== id);
      changed = true;
      break;
    }
  }
  return left;
}

export function beginDrag(board: Board, hit: { kind: 'ring'; id: string } | { kind: 'bar'; id: string }, x: number, y: number): Drag | null {
  if (hit.kind === 'ring') {
    const ring = ringById(board, hit.id);
    if (!ring) return null;
    return { kind: 'ring', id: ring.id, theta: ring.theta, x, y };
  }
  const bar = barById(board, hit.id);
  if (!bar) return null;
  return { kind: 'bar', id: bar.id, t: bar.t, x, y };
}

/** Tangential arc at the ring band. Motion inside the hole uses the band radius as the lever. */
function tangentialStep(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number, lever: number): number {
  const rx = x0 - cx;
  const ry = y0 - cy;
  const lever2 = Math.max(rx * rx + ry * ry, lever * lever);
  return (rx * (y1 - y0) - ry * (x1 - x0)) / lever2;
}

/** Moves the piece. Returns the signed step collision did not apply. */
export function dragTo(board: Board, drag: Drag, x: number, y: number): number {
  if (drag.kind === 'ring') {
    const ring = ringById(board, drag.id);
    if (!ring) return 0;
    const before = ring.theta;
    const lever = (ring.inner + ring.outer) / 2;
    const span = Math.hypot(x - drag.x, y - drag.y);
    const steps = Math.max(1, Math.ceil(span / Math.max(lever, 1e-4)));
    let x0 = drag.x;
    let y0 = drag.y;
    let requested = 0;
    for (let i = 1; i <= steps; i++) {
      const x1 = drag.x + ((x - drag.x) * i) / steps;
      const y1 = drag.y + ((y - drag.y) * i) / steps;
      const delta = tangentialStep(ring.x, ring.y, x0, y0, x1, y1, lever);
      requested += delta;
      rotateRing(board, ring, delta);
      x0 = x1;
      y0 = y1;
    }
    drag.x = x;
    drag.y = y;
    return requested - signedDelta(before, ring.theta);
  }
  const bar = barById(board, drag.id);
  if (!bar) return 0;
  const before = bar.t;
  const requested = projectBar(bar, x, y) - projectBar(bar, drag.x, drag.y);
  moveBar(board, bar, before + requested);
  drag.x = x;
  drag.y = y;
  return before + requested - bar.t;
}

export function cancelDrag(board: Board, drag: Drag): void {
  if (drag.kind === 'ring') {
    const ring = ringById(board, drag.id);
    if (ring) ring.theta = wrapAngle(drag.theta);
  } else {
    const bar = barById(board, drag.id);
    if (bar) bar.t = drag.t;
  }
  syncPins(board);
}
