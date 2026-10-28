/**
 * Decides which piece a press means, then hands the motion to dragTo.
 * Hit slop and the sleeve nudge are fractions of the 390-wide design.
 * They convert through the same zoom as the pointer.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { signedDelta } from './angle';
import { barById, moveBar, projectBar, ringById, rotateRing, syncPins, type BarBody, type Board } from './board';
import { VIEW_H } from './camera';
import { PART, buckleMetrics } from './parts';
import { barCovers, barSegment, barStillInBuckle, buckleCovers, ringCovers } from './volume';

/** Outer grab, beyond the drawn band or bar, as a fraction of design width. */
export const INTENT_PAD = 0.1;
/** Travel that confirms turn-versus-slide, as a fraction of design width. */
export const INTENT_WINDOW = 0.02;
/** How close a sleeve may be, in design-width fraction, before a lift finishes the exit. */
export const INTENT_SLEEVE = 0.02;
/** Along-axis travel, as a fraction of design width, before a clear stroke may change the score. */
export const INTENT_CLEAR = 0.01;

/**
 * One table with `docs/ROTATE-RINGS.md` §4. Lower wins.
 * The gaps between bands are larger than `moves + clearAxis`.
 */
const SCORE = {
  liveSolid: 0,
  liveFoot: 6,
  stuckSolid: 10,
  stuckFoot: 12,
  pad: 18,
  footNearCap: 3,
  tie: 0.05,
  ray: 0.05,
  moves: 3,
  clearAxis: 1.2,
  lock: 0.75,
  axis: 1.5,
} as const;

export type IntentPlace = 'solid' | 'foot' | 'pad';

export type IntentHit = {
  kind: 'ring' | 'bar';
  id: string;
  /** Where the press sits on this piece. Closer places score better. */
  place: IntentPlace;
  neg: boolean;
  pos: boolean;
  /** Distance from the piece's midline or center, in world units. Smaller is closer. */
  near: number;
  /** The ray hit this piece. A tie-break only. */
  ray: boolean;
};

/** World length of a design-width fraction at the current camera zoom. */
export function intentWorld(fraction: number, zoom: number): number {
  return (fraction * DESIGN_WIDTH * VIEW_H) / DESIGN_HEIGHT / Math.max(zoom, 1e-4);
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
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

function hitOf(
  kind: 'ring' | 'bar',
  id: string,
  place: IntentPlace,
  neg: boolean,
  pos: boolean,
  near: number,
  ray: boolean,
): IntentHit {
  return { kind, id, place, neg, pos, near, ray };
}

const PLACE_RANK: Record<IntentPlace, number> = { solid: 0, foot: 1, pad: 2 };

function barPad(bar: BarBody, x: number, y: number, pad: number, free: { neg: boolean; pos: boolean }): number | null {
  if (!free.neg && !free.pos) return null;
  const rail = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) || 1;
  const along = (projectBar(bar, x, y) - bar.t) * rail;
  const grip = bar.grip > 0 ? bar.grip : 0.45;
  const across = distToBar(bar, x, y);
  if (across > bar.half + pad || Math.abs(along) > grip + pad) return null;
  const pastPos = along > grip;
  const pastNeg = along < -grip;
  if (pastPos && !free.pos) return null;
  if (pastNeg && !free.neg) return null;
  return Math.max(0, across - bar.half);
}

function distToBar(bar: BarBody, x: number, y: number): number {
  const seg = barSegment(bar, bar.t);
  const abx = seg.bx - seg.ax;
  const aby = seg.by - seg.ay;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-8) return dist(x, y, seg.ax, seg.ay);
  const t = Math.max(0, Math.min(1, ((x - seg.ax) * abx + (y - seg.ay) * aby) / len2));
  return dist(x, y, seg.ax + abx * t, seg.ay + aby * t);
}

/**
 * Every piece the press could mean. A closer place on the same piece replaces a farther one.
 * The ray never adds a piece that the geometry missed.
 */
export function listCandidates(board: Board, x: number, y: number, pad: number, rayIds: string[] = []): IntentHit[] {
  const hits: IntentHit[] = [];
  const put = (hit: IntentHit) => {
    const at = hits.findIndex((item) => item.id === hit.id);
    if (at < 0) {
      hits.push(hit);
      return;
    }
    if (PLACE_RANK[hit.place] < PLACE_RANK[hits[at].place]) hits[at] = hit;
  };
  for (const ring of board.rings) {
    const free = freeRing(board, ring.id);
    const ray = rayIds.includes(ring.id);
    const d = dist(ring.x, ring.y, x, y);
    const mid = (ring.inner + ring.outer) / 2;
    if (ringCovers(ring, x, y)) put(hitOf('ring', ring.id, 'solid', free.neg, free.pos, Math.abs(d - mid), ray));
    else if (d <= ring.outer) put(hitOf('ring', ring.id, 'foot', free.neg, free.pos, d, false));
    else if ((free.neg || free.pos) && d <= ring.outer + pad) {
      put(hitOf('ring', ring.id, 'pad', free.neg, free.pos, d - ring.outer, ray));
    }
  }
  for (const bar of board.bars) {
    const free = freeBar(board, bar.id);
    const ray = rayIds.includes(bar.id);
    const onBuckle = board.latches.some(
      (latch) => latch.barId === bar.id && latch.release === 'sleeve' && buckleCovers(bar, x, y, latch.x, latch.y),
    );
    if (barCovers(bar, x, y) || onBuckle) put(hitOf('bar', bar.id, 'solid', free.neg, free.pos, distToBar(bar, x, y), ray));
    else {
      const near = barPad(bar, x, y, pad, free);
      if (near !== null) put(hitOf('bar', bar.id, 'pad', free.neg, free.pos, near, ray));
    }
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

/** This gesture's axis actually changes the piece. A blocked direction does not. */
function moves(hit: IntentHit, along: number): boolean {
  if (along > 1e-4) return hit.pos;
  if (along < -1e-4) return hit.neg;
  return false;
}

function band(hit: IntentHit): number {
  const stuck = !hit.neg && !hit.pos;
  if (hit.place === 'solid') return stuck ? SCORE.stuckSolid : SCORE.liveSolid;
  if (hit.place === 'foot') return stuck ? SCORE.stuckFoot : SCORE.liveFoot;
  return SCORE.pad;
}

/** Distance only separates footprints. Elsewhere it is a tie-break under `SCORE.lock`. */
function nearness(hit: IntentHit): number {
  if (hit.place === 'foot') return Math.min(hit.near, SCORE.footNearCap);
  return Math.min(hit.near, 2) * SCORE.tie;
}

function intentScore(hit: IntentHit, along: number, cross: number, gesture: boolean): number {
  let score = band(hit) + nearness(hit) - (hit.ray ? SCORE.ray : 0);
  if (!gesture || !moves(hit, along)) return score;
  score -= SCORE.moves;
  if (Math.abs(along) > Math.abs(cross) * SCORE.axis) score -= SCORE.clearAxis;
  return score;
}

/** The lower score wins. A lead of `SCORE.lock` locks before the window; a tie waits until `decided`. */
export function chooseIntent(
  board: Board,
  hits: IntentHit[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  decided: boolean,
  clearAt = intentWorld(INTENT_CLEAR, 1),
): IntentHit | null {
  if (hits.length === 0) return null;
  const ranked = hits
    .map((hit) => {
      const travel = travelOf(board, hit, x0, y0, x1, y1);
      const clear =
        Math.abs(travel.along) > Math.abs(travel.cross) * SCORE.axis && Math.abs(travel.along) >= clearAt;
      return { hit, score: intentScore(hit, travel.along, travel.cross, decided || clear) };
    })
    .sort((a, b) => a.score - b.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!second || best.score + SCORE.lock < second.score || decided) return best.hit;
  return null;
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
