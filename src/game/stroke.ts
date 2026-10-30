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
  /** The piece under the finger cannot move, so leaving it must play the directional wobble. */
  refuse: boolean;
};

export type AimStep =
  | { type: 'idle' }
  | { type: 'release'; id: string; from: AimPoint | null; refuse: boolean }
  | { type: 'stuck'; hit: IntentHit; along: number }
  | { type: 'watch' }
  | { type: 'lock'; hit: IntentHit; from: AimPoint };

/**
 * Which hit this sample follows while the finger is still choosing.
 * An immovable piece stays only while the finger is inside its outer contour.
 * An operable piece stays until another hit leads, so a near tie does not wipe its travel.
 * `rest` is the best hit after the current immovable piece has been removed.
 */
export function seekTarget(
  aimId: string | null,
  refuse: boolean,
  inside: boolean,
  kept: IntentHit | null,
  lead: IntentHit | null,
  rest: IntentHit | null,
): IntentHit | null {
  if (aimId && refuse) return inside && kept ? kept : rest;
  if (kept && (kept.neg || kept.pos)) return !lead || lead.id === kept.id ? kept : lead;
  if (lead && (!kept || lead.id !== kept.id)) return lead;
  return rest;
}

export function emptyAim(): Aim {
  return { at: null, id: null, along: 0, cross: 0, refuse: false };
}

function liveReady(hit: IntentHit, along: number, cross: number, clear: number): boolean {
  const sign = Math.sign(along);
  const can = sign > 0 ? hit.pos : sign < 0 ? hit.neg : false;
  return can && Math.abs(along) > Math.abs(cross) * INTENT_AXIS && Math.abs(along) >= clear;
}

/**
 * One sample while the finger is still choosing.
 * A switch releases the previous piece and starts the new one in the same sample.
 * Travel accumulated on the previous piece is not reused, so the arrival sample cannot lock.
 */
export function stepAim(board: Board, aim: Aim, hit: IntentHit | null, world: AimPoint, clear: number): { aim: Aim; steps: AimStep[] } {
  if (!hit) {
    const previous = aim.id;
    return {
      aim: { ...emptyAim(), at: world },
      steps: previous ? [{ type: 'release', id: previous, from: aim.at, refuse: aim.refuse }] : [{ type: 'idle' }],
    };
  }
  if (!hit.neg && !hit.pos) {
    const arrived = aim.id !== hit.id;
    let along = aim.at ? strokeTravel(board, hit, aim.at.x, aim.at.y, world.x, world.y).along : 0;
    if (Math.abs(along) < 1e-4 && aim.at) along = world.x - aim.at.x || world.y - aim.at.y;
    const next: Aim = { at: world, id: hit.id, along: 0, cross: 0, refuse: true };
    const steps: AimStep[] = [];
    if (arrived && aim.id) steps.push({ type: 'release', id: aim.id, from: aim.at, refuse: aim.refuse });
    steps.push({ type: 'stuck', hit, along });
    return { aim: next, steps };
  }
  const switched = aim.id !== null && aim.id !== hit.id;
  let along = switched ? 0 : aim.along;
  let cross = switched ? 0 : aim.cross;
  if (!switched && aim.id === hit.id && aim.at) {
    const travel = strokeTravel(board, hit, aim.at.x, aim.at.y, world.x, world.y);
    along += travel.along;
    cross += travel.cross;
  }
  const next: Aim = { at: world, id: hit.id, along, cross, refuse: false };
  const steps: AimStep[] = [];
  if (switched) steps.push({ type: 'release', id: aim.id as string, from: aim.at, refuse: aim.refuse });
  if (!switched && liveReady(hit, along, cross, clear) && aim.at && aim.id === hit.id) {
    steps.push({ type: 'lock', hit, from: aim.at });
    return { aim: emptyAim(), steps };
  }
  steps.push({ type: 'watch' });
  return { aim: next, steps };
}
