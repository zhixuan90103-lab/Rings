/**
 * Authored joints on one axis.
 * A blocking pin forbids the ring angles where the solid covers it.
 * A stop forbids a fixed arc and is not a retainer.
 * A latch is a retainer until the bar sits in its window on pointerup.
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
import {
  barOverlapAmount,
  barsOverlapAmount,
  barStillInBuckle,
  buckleOverlapAmount,
  claspCenterDistance,
  claspStepBlocked,
  connectorCoreDepth,
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
   * A ring id owns a clasp (`catch`) or a one-way block.
   * A bar id owns only the silver mark on that bar.
   * Null is a world pin and keeps whichever ring it sits in.
   */
  ownerId: string | null;
  localAngle: number;
  localRadius: number;
  x: number;
  y: number;
  /** `catch` is a ring's clasp. It keeps both rings and does not stop the caught ring's turn. */
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

type ClaspTie = { kind: 'owner' | 'captive'; dist: number; depth: number };

function claspTies(board: Board, ring: RingBody): ClaspTie[] {
  const ties: ClaspTie[] = [];
  for (const other of board.rings) {
    if (other.id === ring.id) continue;
    if (ring.connectors.length > 0) {
      ties.push({
        kind: 'owner',
        dist: claspCenterDistance(ring, other),
        depth: connectorCoreDepth(ring, other),
      });
    }
    if (other.connectors.length > 0) {
      ties.push({
        kind: 'captive',
        dist: claspCenterDistance(other, ring),
        depth: connectorCoreDepth(other, ring),
      });
    }
  }
  return ties;
}

function claspBlocked(before: ClaspTie[], after: ClaspTie[]): boolean {
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) {
    if (before[i].kind !== after[i].kind) continue;
    if (claspStepBlocked(before[i].kind, before[i].dist, before[i].depth, after[i].dist, after[i].depth)) return true;
  }
  return false;
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
  while (left > 1e-4) {
    const step = Math.min(0.012, left);
    const previous = ring.theta;
    const depthBefore = ringBlockDepth(board, ring);
    const tiesBefore = claspTies(board, ring);
    ring.theta = wrapAngle(ring.theta + sign * step);
    syncPins(board);
    if (claspBlocked(tiesBefore, claspTies(board, ring)) || overlapGrew(depthBefore, ringBlockDepth(board, ring))) {
      ring.theta = previous;
      syncPins(board);
      return;
    }
    left -= step;
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

export function moveBar(board: Board, bar: BarBody, target: number): void {
  if (!board.volumes) {
    const free = freeLinear(barBlocked(board, bar), 0, 1);
    bar.t = clampLinear(bar.t, target, free);
    return;
  }
  const sign = Math.sign(target - bar.t);
  if (sign === 0) return;
  let left = Math.abs(target - bar.t);
  while (left > 1e-4) {
    const step = Math.min(0.008, left);
    const previous = bar.t;
    const before = barBlockDepth(board, bar, previous);
    bar.t = previous + sign * step;
    if (overlapGrew(before, barBlockDepth(board, bar, bar.t))) {
      bar.t = previous;
      return;
    }
    left -= step;
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

function retainers(board: Board, id: string): number {
  const ring = ringById(board, id);
  if (ring) {
    let n = 0;
    for (const other of board.rings) {
      if (other.id !== ring.id && handlesMeet(ring, other)) n += 1;
    }
    for (const pin of board.pins) {
      if (pin.role !== 'block' && pin.role !== 'catch') continue;
      if (!pin.ownerId) {
        if (pinHolds(ring, pin)) n += 1;
        continue;
      }
      if (pin.ownerId === ring.id) {
        if (pin.role === 'catch' && board.rings.some((other) => other.id !== ring.id && pinHolds(other, pin))) n += 1;
        continue;
      }
      if (ringById(board, pin.ownerId) && pinHolds(ring, pin)) n += 1;
    }
    return n;
  }
  return board.latches.filter((latch) => latch.barId === id).length;
}

export function settle(board: Board, drag: Drag): string[] {
  syncPins(board);
  if (drag.kind === 'ring') {
    const ring = ringById(board, drag.id);
    if (!ring) return [];
    board.pins = board.pins.filter((pin) => {
      if ((pin.role !== 'block' && pin.role !== 'catch') || pin.ownerId === ring.id) return true;
      if (board.volumes && pin.role === 'catch' && pin.ownerId) {
        const owner = ringById(board, pin.ownerId);
        if (!owner || !pinHolds(ring, pin)) return true;
        const alpha = Math.atan2(pin.y - ring.y, pin.x - ring.x);
        return !(gapCovers(ring.theta, alpha, ring.gap) && !connectorHitsRing(owner, ring));
      }
      if (!pinHolds(ring, pin)) return true;
      const alpha = Math.atan2(pin.y - ring.y, pin.x - ring.x);
      return !gapCovers(ring.theta, alpha, ring.gap);
    });
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

export function pick(
  board: Board,
  x: number,
  y: number,
): { kind: 'ring'; id: string } | { kind: 'bar'; id: string } | null {
  let best: { kind: 'ring' | 'bar'; id: string; score: number } | null = null;
  for (const ring of board.rings) {
    const d = dist(ring.x, ring.y, x, y);
    if (d < ring.inner - 0.08 || d > ring.outer + 0.12) continue;
    const score = Math.abs(d - (ring.inner + ring.outer) / 2);
    if (!best || score < best.score) best = { kind: 'ring', id: ring.id, score };
  }
  for (const bar of board.bars) {
    const t = Math.min(1, Math.max(0, projectBar(bar, x, y)));
    const p = barPoint(bar, t);
    const rail = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) || 1;
    const along = (t - bar.t) * rail;
    const grip = bar.grip > 0 ? bar.grip : 0.45;
    if (Math.abs(along) > grip + 0.12) continue;
    const d = dist(p.x, p.y, x, y);
    if (d > bar.half + 0.22) continue;
    if (!best || d < best.score) best = { kind: 'bar', id: bar.id, score: d };
  }
  if (!best) return null;
  return best.kind === 'ring' ? { kind: 'ring', id: best.id } : { kind: 'bar', id: best.id };
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
