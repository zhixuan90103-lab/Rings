/**
 * Which piece a moving finger is choosing, before play.ts turns or slides it.
 * The rules are docs/ROTATE-RINGS.md §4.
 */

import type { Board } from './board';
import { INTENT_AXIS, strokeTravel, type IntentHit } from './intent';

export type AimPoint = { x: number; y: number };

export type Aim = {
  at: AimPoint | null;
  id: string | null;
  along: number;
  cross: number;
};

export type AimStep =
  | { type: 'idle' }
  | { type: 'release'; id: string }
  | { type: 'stuck'; hit: IntentHit; along: number }
  | { type: 'watch' }
  | { type: 'lock'; hit: IntentHit; from: AimPoint };

export function emptyAim(): Aim {
  return { at: null, id: null, along: 0, cross: 0 };
}

function liveReady(hit: IntentHit, along: number, cross: number, clear: number): boolean {
  const sign = Math.sign(along);
  const can = sign > 0 ? hit.pos : sign < 0 ? hit.neg : false;
  return can && Math.abs(along) > Math.abs(cross) * INTENT_AXIS && Math.abs(along) >= clear;
}

/** One sample while the finger is still choosing. */
export function stepAim(board: Board, aim: Aim, hit: IntentHit | null, world: AimPoint, clear: number): { aim: Aim; step: AimStep } {
  if (!hit) {
    const previous = aim.id;
    return { aim: { ...emptyAim(), at: world }, step: previous ? { type: 'release', id: previous } : { type: 'idle' } };
  }
  if (!hit.neg && !hit.pos) {
    const arrived = aim.id !== hit.id;
    const along = !arrived && aim.at ? strokeTravel(board, hit, aim.at.x, aim.at.y, world.x, world.y).along : 0;
    const next: Aim = { at: world, id: hit.id, along: 0, cross: 0 };
    if (arrived && aim.id) return { aim: next, step: { type: 'release', id: aim.id } };
    return { aim: next, step: { type: 'stuck', hit, along } };
  }
  const switched = aim.id !== null && aim.id !== hit.id;
  let along = switched ? 0 : aim.along;
  let cross = switched ? 0 : aim.cross;
  if (aim.id === hit.id && aim.at) {
    const travel = strokeTravel(board, hit, aim.at.x, aim.at.y, world.x, world.y);
    along += travel.along;
    cross += travel.cross;
  }
  const next: Aim = { at: world, id: hit.id, along, cross };
  if (liveReady(hit, along, cross, clear) && aim.at && aim.id === hit.id) {
    return { aim: emptyAim(), step: { type: 'lock', hit, from: aim.at } };
  }
  return { aim: next, step: switched ? { type: 'release', id: aim.id as string } : { type: 'watch' } };
}
