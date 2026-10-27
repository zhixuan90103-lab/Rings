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
import { barHitsRing, ringVolumeHit } from './volume';

export type RingBody = {
  id: string;
  kind: 'ring';
  x: number;
  y: number;
  inner: number;
  outer: number;
  gap: number;
  theta: number;
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
};

export type Pin = {
  id: string;
  /** Ring that carries this pin. Null is a fixed world pin. */
  ownerId: string | null;
  localAngle: number;
  localRadius: number;
  x: number;
  y: number;
  /** `catch` keeps the ring until pointerup, and does not stop the turn. */
  role: 'block' | 'stop' | 'catch';
  /** Stop pins hard-limit this ring and do not retain it. */
  limitRingId: string | null;
  stopHalf: number;
};

export type Latch = {
  id: string;
  ringId: string;
  barId: string;
  x: number;
  y: number;
  t0: number;
  t1: number;
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
  | { kind: 'ring'; id: string; theta: number; pointerAngle: number }
  | { kind: 'bar'; id: string; t: number };

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
  for (const latch of board.latches) {
    if (latch.ringId === ring.id && inBand(ring, latch.x, latch.y)) {
      points.push({ x: latch.x, y: latch.y, hard: false, half: 0 });
    }
  }
  return points;
}

function volumeForbidden(board: Board, ring: RingBody): CircInterval[] {
  const saved = ring.theta;
  const steps = 180;
  const hits: LinInterval[] = [];
  let run: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    ring.theta = angle;
    const hit = Math.abs(signedDelta(saved, angle)) > 1e-3 && ringVolumeHit(board, ring);
    if (hit && run === null) run = angle;
    if (!hit && run !== null) {
      hits.push({ a: run, b: angle });
      run = null;
    }
  }
  ring.theta = saved;
  if (run !== null) hits.push({ a: run, b: Math.PI * 2 });
  return hits.map((hit) => ({ start: hit.a, length: hit.b - hit.a }));
}

export function ringFreeArcs(board: Board, ring: RingBody): CircInterval[] {
  const forbidden = [];
  for (const point of blockingPoints(board, ring)) {
    const alpha = Math.atan2(point.y - ring.y, point.x - ring.x);
    const interval = point.hard ? hardForbidden(alpha, point.half) : pinForbidden(alpha, ring.gap);
    if (interval) forbidden.push(interval);
  }
  if (board.volumes) forbidden.push(...volumeForbidden(board, ring));
  return freeArcs(forbidden);
}

export function rotateRing(board: Board, ring: RingBody, delta: number): void {
  ring.theta = clampAngle(ring.theta, delta, ringFreeArcs(board, ring));
  syncPins(board);
}

function barPoint(bar: BarBody, t: number): { x: number; y: number } {
  return {
    x: bar.x0 + (bar.x1 - bar.x0) * t,
    y: bar.y0 + (bar.y1 - bar.y0) * t,
  };
}

/** Sample the rail. A t is blocked when that point lies in a locked ring's solid. */
export function barBlocked(board: Board, bar: BarBody): LinInterval[] {
  const steps = 48;
  const blocked: LinInterval[] = [];
  let run: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const hit = board.volumes
      ? board.rings.some((ring) => barHitsRing(bar, t, ring))
      : board.rings.some((ring) => ringSolidContains(ring, barPoint(bar, t).x, barPoint(bar, t).y));
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
  const free = freeLinear(barBlocked(board, bar), 0, 1);
  bar.t = clampLinear(bar.t, target, free);
}

export function projectBar(bar: BarBody, x: number, y: number): number {
  const dx = bar.x1 - bar.x0;
  const dy = bar.y1 - bar.y0;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-8) return bar.t;
  return ((x - bar.x0) * dx + (y - bar.y0) * dy) / len2;
}

function retainers(board: Board, id: string): number {
  const ring = ringById(board, id);
  if (ring) {
    let n = 0;
    for (const pin of board.pins) {
      if ((pin.role === 'block' || pin.role === 'catch') && pin.ownerId !== ring.id && inBand(ring, pin.x, pin.y)) n += 1;
    }
    for (const latch of board.latches) {
      if (latch.ringId === ring.id) n += 1;
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
      if (!inBand(ring, pin.x, pin.y)) return true;
      const alpha = Math.atan2(pin.y - ring.y, pin.x - ring.x);
      return !gapCovers(ring.theta, alpha, ring.gap);
    });
  } else {
    const bar = barById(board, drag.id);
    if (!bar) return [];
    board.latches = board.latches.filter((latch) => {
      if (latch.barId !== bar.id) return true;
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
      board.latches = board.latches.filter((l) => l.ringId !== id && l.barId !== id);
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
    return {
      kind: 'ring',
      id: ring.id,
      theta: ring.theta,
      pointerAngle: Math.atan2(y - ring.y, x - ring.x),
    };
  }
  const bar = barById(board, hit.id);
  if (!bar) return null;
  return { kind: 'bar', id: bar.id, t: bar.t };
}

export function dragTo(board: Board, drag: Drag, x: number, y: number): void {
  if (drag.kind === 'ring') {
    const ring = ringById(board, drag.id);
    if (!ring) return;
    const pointerAngle = Math.atan2(y - ring.y, x - ring.x);
    const delta = signedDelta(drag.pointerAngle, pointerAngle);
    drag.pointerAngle = pointerAngle;
    rotateRing(board, ring, delta);
    return;
  }
  const bar = barById(board, drag.id);
  if (!bar) return;
  moveBar(board, bar, projectBar(bar, x, y));
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
