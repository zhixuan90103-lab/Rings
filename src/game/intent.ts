/**
 * Decides which piece a press means, then hands the motion to dragTo.
 * Hit slop and the sleeve nudge are fractions of the 390-wide design.
 * They convert through the same zoom as the pointer.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { signedDelta } from './angle';
import { barById, moveBar, ringById, rotateRing, syncPins, type BarBody, type Board } from './board';
import { VIEW_H } from './camera';
import { PART, buckleMetrics } from './parts';
import { barStillInBuckle } from './volume';

/** Outer grab, beyond the drawn band or bar, as a fraction of design width. */
export const INTENT_PAD = 0.1;
/** Travel that confirms turn-versus-slide, as a fraction of design width. */
export const INTENT_WINDOW = 0.02;
/** How close a sleeve may be, in design-width fraction, before a lift finishes the exit. */
export const INTENT_SLEEVE = 0.06;

export type IntentHit = {
  kind: 'ring' | 'bar';
  id: string;
  base: boolean;
  neg: boolean;
  pos: boolean;
  score: number;
};

/** World length of a design-width fraction at the current camera zoom. */
export function intentWorld(fraction: number, zoom: number): number {
  return (fraction * DESIGN_WIDTH * VIEW_H) / DESIGN_HEIGHT / Math.max(zoom, 1e-4);
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function projectBar(bar: BarBody, x: number, y: number): number {
  const dx = bar.x1 - bar.x0;
  const dy = bar.y1 - bar.y0;
  const len2 = dx * dx + dy * dy || 1;
  return ((x - bar.x0) * dx + (y - bar.y0) * dy) / len2;
}

function freeRing(board: Board, id: string): { neg: boolean; pos: boolean } {
  const ring = ringById(board, id);
  if (!ring) return { neg: false, pos: false };
  const theta = ring.theta;
  const probe = 0.04;
  rotateRing(board, ring, probe);
  const pos = Math.abs(signedDelta(theta, ring.theta)) > 1e-4;
  ring.theta = theta;
  syncPins(board);
  rotateRing(board, ring, -probe);
  const neg = Math.abs(signedDelta(theta, ring.theta)) > 1e-4;
  ring.theta = theta;
  syncPins(board);
  return { neg, pos };
}

function freeBar(board: Board, id: string): { neg: boolean; pos: boolean } {
  const bar = barById(board, id);
  if (!bar) return { neg: false, pos: false };
  const t = bar.t;
  const probe = 0.03;
  moveBar(board, bar, t + probe);
  const pos = bar.t > t + 1e-4;
  bar.t = t;
  syncPins(board);
  moveBar(board, bar, t - probe);
  const neg = bar.t < t - 1e-4;
  bar.t = t;
  syncPins(board);
  return { neg, pos };
}

/** Base hits are the drawn band or bar. The hole and the outer pad are enlarged, and only while that axis can still move. */
export function listCandidates(board: Board, x: number, y: number, pad: number, baseIds: string[] = []): IntentHit[] {
  const hits: IntentHit[] = [];
  for (const ring of board.rings) {
    const d = dist(ring.x, ring.y, x, y);
    const mid = (ring.inner + ring.outer) / 2;
    const band = (ring.outer - ring.inner) / 2;
    const onBase = d >= ring.inner && d <= ring.outer;
    const onPad = d <= ring.outer + pad;
    const ray = baseIds.includes(ring.id);
    if (!onBase && !onPad && !ray) continue;
    const free = freeRing(board, ring.id);
    const base = onBase || ray;
    if (!base && !free.neg && !free.pos) continue;
    const score = d < ring.inner ? ring.inner - d + band : Math.abs(d - mid);
    hits.push({ kind: 'ring', id: ring.id, base, neg: free.neg, pos: free.pos, score });
  }
  for (const bar of board.bars) {
    const rail = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) || 1;
    const t = projectBar(bar, x, y);
    const px = bar.x0 + (bar.x1 - bar.x0) * t;
    const py = bar.y0 + (bar.y1 - bar.y0) * t;
    const along = (t - bar.t) * rail;
    const grip = bar.grip > 0 ? bar.grip : 0.45;
    const d = dist(px, py, x, y);
    const onBase = Math.abs(along) <= grip && d <= bar.half;
    const onPad = Math.abs(along) <= grip + pad && d <= bar.half + pad;
    const ray = baseIds.includes(bar.id);
    if (!onBase && !onPad && !ray) continue;
    const free = freeBar(board, bar.id);
    const base = onBase || ray;
    if (!base && !free.neg && !free.pos) continue;
    hits.push({ kind: 'bar', id: bar.id, base, neg: free.neg, pos: free.pos, score: d });
  }
  return hits;
}

function travelOf(board: Board, hit: IntentHit, x0: number, y0: number, x1: number, y1: number): { along: number; cross: number } {
  if (hit.kind === 'ring') {
    const ring = ringById(board, hit.id);
    if (!ring) return { along: 0, cross: 0 };
    const lever = (ring.inner + ring.outer) / 2;
    const rx = x0 - ring.x;
    const ry = y0 - ring.y;
    const lever2 = Math.max(rx * rx + ry * ry, lever * lever);
    const along = ((rx * (y1 - y0) - ry * (x1 - x0)) / lever2) * lever;
    const r0 = Math.hypot(rx, ry);
    const r1 = Math.hypot(x1 - ring.x, y1 - ring.y);
    return { along, cross: r1 - r0 };
  }
  const bar = barById(board, hit.id);
  if (!bar) return { along: 0, cross: 0 };
  const rail = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) || 1;
  const ux = (bar.x1 - bar.x0) / rail;
  const uy = (bar.y1 - bar.y0) / rail;
  const dx = x1 - x0;
  const dy = y1 - y0;
  return { along: dx * ux + dy * uy, cross: dx * -uy + dy * ux };
}

function signAllowed(hit: IntentHit, along: number): boolean {
  if (hit.base) return true;
  if (along >= 0 && hit.pos) return true;
  if (along <= 0 && hit.neg) return true;
  return false;
}

/**
 * A clear axis locks early. A diagonal waits until `decided`, then the nearest press wins.
 * Enlarged hits ignore motion into an already blocked direction.
 */
export function chooseIntent(
  board: Board,
  hits: IntentHit[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  decided: boolean,
): IntentHit | null {
  if (hits.length === 0) return null;
  const ranked = hits
    .map((hit) => ({ hit, ...travelOf(board, hit, x0, y0, x1, y1) }))
    .filter((item) => signAllowed(item.hit, item.along));
  if (ranked.length === 0) return decided ? null : null;
  const clear = ranked
    .filter((item) => Math.abs(item.along) > Math.abs(item.cross) * 1.5 && Math.abs(item.along) > 1e-4)
    .sort((a, b) => Math.abs(b.along) - Math.abs(a.along));
  if (clear.length === 1 || (clear.length > 1 && Math.abs(clear[0].along) > Math.abs(clear[1].along) * 1.5)) {
    return clear[0].hit;
  }
  if (!decided) return null;
  return [...ranked].sort((a, b) => a.hit.score - b.hit.score)[0].hit;
}

/** World distance still needed to slide this bar out of its sleeve, in the given t sign. Null when this lift should not nudge. */
export function sleeveGap(board: Board, bar: BarBody, sign: number): number | null {
  if (sign === 0) return null;
  const latch = board.latches.find((item) => item.barId === bar.id && item.release === 'sleeve');
  if (!latch || !barStillInBuckle(bar, latch.x, latch.y)) return null;
  const rail = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) || 1;
  const ux = (bar.x1 - bar.x0) / rail;
  const uy = (bar.y1 - bar.y0) / rail;
  const frameX = bar.x0 + (bar.x1 - bar.x0) * bar.t;
  const frameY = bar.y0 + (bar.y1 - bar.y0) * bar.t;
  const along = (latch.x - frameX) * ux + (latch.y - frameY) * uy;
  const { sleeveLen } = buckleMetrics(bar.half * 2, PART.outer * 2 * PART.scale);
  const limit = (bar.grip > 0 ? bar.grip : 0.45) + sleeveLen / 2;
  const gap = sign > 0 ? along + limit : limit - along;
  if (gap <= 0) return null;
  return gap;
}
