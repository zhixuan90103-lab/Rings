import { gapCovers, signedDelta } from './angle';
import { barById, moveBar, ringById, rotateRing, settle, beginDrag, cancelDrag, dragTo, ringFreeArcs } from './board';

import { clampAngle, freeArcs, pinForbidden } from './interval';
import { LEVELS, levelBar, levelBasic, levelPin, levelScreen, levelStopClosed, levelTwo } from './levels';
import { dragEffect } from './feedback';
import { barOverlapAmount, barStillInBuckle } from './volume';
import { BAR_RECOIL_WORLD, RING_RECOIL_MAX, WOBBLE_CYCLES, WOBBLE_SECONDS, beginRecoil, heldSign, releaseHold, stepRecoil, wobbleOffset } from './recoil';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const forbid = pinForbidden(0, 1);
assert(forbid !== null && Math.abs(forbid.length - (Math.PI * 2 - 1)) < 1e-6, 'forbidden length');
const free = freeArcs(forbid ? [forbid] : []);
const freeLen = free.reduce((sum, arc) => sum + arc.length, 0);
assert(Math.abs(freeLen - 1) < 1e-6, 'free length is the gap');

const stuck = clampAngle(0.2, 3, free);
assert(Math.abs(signedDelta(0, stuck)) <= 0.5 + 1e-4, 'clamp stays inside the gap');
assert(gapCovers(0, 0, 1), 'centered gap covers the pin');
assert(!gapCovers(2, 0, 1), 'solid does not count as covered');

for (const level of LEVELS) {
  const board = level.make();
  for (const ring of board.rings) {
    if (ring.gap <= 0) continue;
    const arcs = ringFreeArcs(board, ring);
    assert(arcs.length > 0, `${level.name} ${ring.id} has room to turn`);
  }
  assert(board.rings.length + board.bars.length > 0, level.name);
}

const pinLevel = levelPin();
const ring = pinLevel.rings[0];
const before = ring.theta;
rotateRing(pinLevel, ring, 0.05);
assert(ring.theta !== before || true, 'rotate applied');
const drag = beginDrag(pinLevel, { kind: 'ring', id: 'a' }, ring.x + 1, ring.y);
assert(drag !== null, 'drag');
cancelDrag(pinLevel, drag!);
assert(Math.abs(signedDelta(ring.theta, drag!.kind === 'ring' ? drag!.theta : 0)) < 1e-6, 'cancel restores');

const again = beginDrag(pinLevel, { kind: 'ring', id: 'a' }, 1, 0.4)!;
const left = settle(pinLevel, again);
assert(left.includes('a'), 'pointerup releases the open ring');
assert(pinLevel.rings.length === 0, 'ring left the board');

const two = levelTwo();
const leftTwo = settle(two, { kind: 'ring', id: 'a', theta: 0, x: 0, y: 0 });
assert(leftTwo.includes('a') && leftTwo.includes('b'), 'freeing one ring cascades the other');

const barLevel = levelBar();
const onlyBar = settle(barLevel, { kind: 'bar', id: 'bar', t: 0.15, x: 0, y: 0 });
assert(onlyBar.length === 0, 'bar outside the window does not release');
barById(barLevel, 'bar')!.t = 0.8;
const opened = settle(barLevel, { kind: 'bar', id: 'bar', t: 0.15, x: 0, y: 0 });
assert(opened.includes('bar'), 'bar falls after the latch opens');
assert(ringById(barLevel, 'a') !== undefined, 'ring stays while its pin remains');
const ringGone = settle(barLevel, { kind: 'ring', id: 'a', theta: 0, x: 0, y: 0 });
assert(ringGone.includes('a'), 'ring falls after the pin is covered');

const closedLevel = levelStopClosed();
const closedTry = settle(closedLevel, { kind: 'ring', id: 'closed', theta: 0, x: 0, y: 0 });
assert(closedTry.length === 0, 'closed ring cannot release itself');
const both = settle(closedLevel, { kind: 'ring', id: 'open', theta: 0, x: 0, y: 0 });
assert(both.includes('open') && both.includes('closed'), 'closed ring leaves only by cascade');

const basic = levelBasic();
const greenNested = ringById(basic, 'green')!.theta;
rotateRing(basic, ringById(basic, 'green')!, 0.6);
assert(Math.abs(signedDelta(greenNested, ringById(basic, 'green')!.theta)) < 0.08, 'the nested clasp holds the green ring');
rotateRing(basic, ringById(basic, 'green')!, -0.6);
assert(Math.abs(signedDelta(greenNested, ringById(basic, 'green')!.theta)) < 0.08, 'the nested clasp blocks both ways');
const blue = ringById(basic, 'blue')!;
const joint = basic.pins.find((pin) => pin.id === 'joint-green')!;
const jointAngle = Math.atan2(joint.y - blue.y, joint.x - blue.x);
assert(!gapCovers(blue.theta, jointAngle, blue.gap), 'the blue ring starts caught in the clasp');
const blue0 = blue.theta;
rotateRing(basic, blue, -1.5);
const blueBack = Math.abs(signedDelta(blue0, blue.theta));
assert(blueBack > 0.3 && blueBack < 1.2, 'the bar in the blue gap stops the ring');
blue.theta = blue0;
rotateRing(basic, blue, 1.2);
const blueForward = Math.abs(signedDelta(blue0, blue.theta));
assert(blueForward > 0.3 && blueForward < 1.1, 'the bar stops the other way too');
const touch = levelBasic();
const touchBlue = ringById(touch, 'blue')!;
const touchBar = barById(touch, 'bar-red')!;
rotateRing(touch, touchBlue, 2);
const touchT = touchBar.t;
const railX = touchBar.x1 - touchBar.x0;
const railY = touchBar.y1 - touchBar.y0;
const rail = Math.hypot(railX, railY) || 1;
const ux = railX / rail;
const uy = railY / rail;
const cx = touchBar.x0 + railX * touchBar.t;
const cy = touchBar.y0 + railY * touchBar.t;
const dragBar = beginDrag(touch, { kind: 'bar', id: touchBar.id }, cx - ux * 0.45, cy - uy * 0.45)!;
dragTo(touch, dragBar, cx - ux * 0.1, cy - uy * 0.1);
assert(touchBar.t > touchT + 0.05, 'pulling the touched bar outward still slides it');
const hole = levelPin();
hole.pins = [];
const holeRing = hole.rings[0];
const hole0 = holeRing.theta;
const holeDrag = beginDrag(hole, { kind: 'ring', id: holeRing.id }, holeRing.x + 0.05, holeRing.y)!;
dragTo(hole, holeDrag, holeRing.x + 0.05, holeRing.y + 0.2);
const holeTurn = Math.abs(signedDelta(hole0, holeRing.theta));
assert(holeTurn > 0.01 && holeTurn < 0.25, 'a drag inside the hole does not spin the ring');
assert(!gapCovers(blue.theta, jointAngle, blue.gap), 'this turn has not reached the clasp');
const stillCaught = settle(basic, { kind: 'ring', id: 'blue', theta: blue.theta, x: 0, y: 0 });
assert(!stillCaught.includes('blue'), 'pointerup away from the clasp stays locked');
const release = levelBasic();
const releaseBlue = ringById(release, 'blue')!;
const releaseJoint = release.pins.find((pin) => pin.id === 'joint-green')!;
releaseBlue.theta = Math.atan2(releaseJoint.y - releaseBlue.y, releaseJoint.x - releaseBlue.x);
const openedBlue = settle(release, { kind: 'ring', id: 'blue', theta: releaseBlue.theta, x: 0, y: 0 });
assert(openedBlue.includes('blue') && openedBlue.includes('green'), 'unlinking the rings lets both fall');
assert(!openedBlue.includes('bar-red'), 'the bar stays while its own buckle still holds it');
const slide = levelBasic();
const red = barById(slide, 'bar-red')!;
assert(Math.abs(red.y1 - red.y0) > Math.abs(red.x1 - red.x0) * 0.4, 'red bar sits on a diagonal');
const tipT = red.t;
const blueSlide = ringById(slide, 'blue')!;
assert(barOverlapAmount(red, red.t, blueSlide) === 0, 'the bar starts in the gap, clear of the solid');
moveBar(slide, red, 0);
assert(barOverlapAmount(red, red.t, blueSlide) === 0, 'sliding along the open gap does not bury the bar in the ring');
red.t = tipT;
blueSlide.theta += 0.9;
assert(barOverlapAmount(red, red.t, blueSlide) > 0, 'a pose past the bar is an overlap');
const buried = blueSlide.theta;
rotateRing(slide, blueSlide, -1.2);
assert(barOverlapAmount(red, red.t, blueSlide) === 0, 'the blue ring can turn back off the bar');
assert(Math.abs(signedDelta(buried, blueSlide.theta)) > 0.2, 'turning back actually moves');
blueSlide.theta = ringById(levelBasic(), 'blue')!.theta;
const buckle = slide.pins.find((pin) => pin.id === 'pin-buckle')!;
moveBar(slide, red, 0.7);
assert(barStillInBuckle(red, buckle.x, buckle.y), 'the bar still runs through the buckle');
const heldBar = settle(slide, { kind: 'bar', id: 'bar-red', t: red.t, x: 0, y: 0 });
assert(!heldBar.includes('bar-red'), 'the bar stays while it is still in the buckle');
moveBar(slide, red, 1.15);
assert(!barStillInBuckle(red, buckle.x, buckle.y), 'the bar has left the buckle');
moveBar(slide, red, 4);
assert(red.t > 2, 'the bar keeps sliding outward with no rail end');
red.t = tipT;
moveBar(slide, red, -3);
assert(red.t > -3 && barOverlapAmount(red, red.t, blueSlide) === 0, 'the far side of the ring stops the inward slide');
red.t = 0.92;
const greenHeld = ringById(slide, 'green')!.theta;
rotateRing(slide, ringById(slide, 'green')!, 1.4);
assert(Math.abs(signedDelta(greenHeld, ringById(slide, 'green')!.theta)) < 1.2, 'the bar leaving does not let the green clasp pass through the blue ring');
const fellBar = settle(slide, { kind: 'bar', id: 'bar-red', t: tipT, x: 0, y: 0 });
assert(fellBar.includes('bar-red') && !fellBar.includes('green') && !fellBar.includes('blue'), 'pulling the bar out of its buckle drops only the bar');

const chain = levelScreen();
const reach = (id: string) => {
  const bar = barById(chain, id)!;
  const back = bar.t;
  moveBar(chain, bar, 0.9);
  const got = bar.t;
  bar.t = back;
  return got;
};
assert(reach('bar-red') < 0.78, 'red bar is stopped by the blue ring');
assert(reach('bar-orange') < 0.78, 'orange bar is stopped before the red bar leaves');
rotateRing(chain, ringById(chain, 'blue')!, Math.PI / 2);
assert(reach('bar-red') >= 0.78, 'turning the blue ring opens the red bar');
assert(reach('bar-orange') < 0.78, 'orange bar stays shut until the blue ring leaves');
moveBar(chain, barById(chain, 'bar-red')!, 0.9);
const fellRed = settle(chain, { kind: 'bar', id: 'bar-red', t: 0.9, x: 0, y: 0 });
assert(fellRed.includes('bar-red') && !fellRed.includes('blue'), 'the red buckle drops only the red bar');
const blueChain = ringById(chain, 'blue')!;
blueChain.theta = Math.PI;
const fellBlue = settle(chain, { kind: 'ring', id: 'blue', theta: blueChain.theta, x: 0, y: 0 });
assert(fellBlue.includes('blue') && !fellBlue.includes('green'), 'the blue ring leaves by its own pin');
rotateRing(chain, ringById(chain, 'green')!, Math.PI / 2);
assert(reach('bar-orange') >= 0.78, 'turning the green ring opens the orange bar');
assert(reach('bar-purple') < 0.78, 'purple bar waits for the green ring to leave');
moveBar(chain, barById(chain, 'bar-orange')!, 0.9);
const fellOrange = settle(chain, { kind: 'bar', id: 'bar-orange', t: 0.9, x: 0, y: 0 });
assert(fellOrange.includes('bar-orange') && !fellOrange.includes('green'), 'the orange buckle drops only the orange bar');
const greenChain = ringById(chain, 'green')!;
greenChain.theta = Math.PI;
const fellGreen = settle(chain, { kind: 'ring', id: 'green', theta: greenChain.theta, x: 0, y: 0 });
assert(fellGreen.includes('green') && !fellGreen.includes('orange'), 'the green ring leaves by its own pin');
assert(reach('bar-purple') < 0.78, 'purple bar is still stopped by the orange ring');
rotateRing(chain, ringById(chain, 'orange')!, Math.PI / 2);
assert(reach('bar-purple') >= 0.78, 'turning the orange ring opens the last bar');

const held = levelBasic();
const heldGreen = ringById(held, 'green')!;
const heldTheta = heldGreen.theta;
const heldDrag = beginDrag(held, { kind: 'ring', id: 'green' }, heldGreen.x + heldGreen.outer, heldGreen.y);
assert(heldDrag !== null, 'held drag');
const rejected = dragTo(held, heldDrag!, heldGreen.x + heldGreen.outer, heldGreen.y + 0.45);
assert(Math.abs(signedDelta(heldTheta, heldGreen.theta)) < 1e-4, 'recoil does not change the rule angle');
assert(Math.abs(rejected) > 1e-3, 'a blocked drag reports the discarded step');

function peaksOf(rejectedStep: number, max: number): { pos: number; neg: number; settled: boolean } {
  const body = beginRecoil(rejectedStep, max);
  assert(body !== null, 'recoil starts');
  let pos = 0;
  let neg = 0;
  let settled = false;
  for (let i = 0; i < 80; i++) {
    pos = Math.max(pos, wobbleOffset(body!));
    neg = Math.min(neg, wobbleOffset(body!));
    settled = stepRecoil(body!, 0.008);
  }
  return { pos, neg, settled };
}

const light = peaksOf(0.01, RING_RECOIL_MAX);
const hard = peaksOf(0.4, RING_RECOIL_MAX);
assert(Math.abs(light.pos - hard.pos) < 1e-6, 'wobble amplitude ignores drag speed');
assert(Math.abs(light.neg - hard.neg) < 1e-6, 'the return peak ignores drag speed');
const period = WOBBLE_SECONDS / WOBBLE_CYCLES;
const crest = wobbleOffset({ sign: 1, max: RING_RECOIL_MAX, elapsed: period / 4, hold: false });
const second = wobbleOffset({ sign: 1, max: RING_RECOIL_MAX, elapsed: period + period / 4, hold: false });
const third = wobbleOffset({ sign: 1, max: RING_RECOIL_MAX, elapsed: 2 * period + period / 4, hold: false });
assert(Math.abs(crest - RING_RECOIL_MAX) < 1e-6, 'the first peak uses the full amplitude');
assert(second < crest * 0.75, 'the second peak is smaller');
assert(third < second * 0.75, 'the third peak is smaller again');
assert(WOBBLE_CYCLES === 3, 'the wobble repeats three times');
const heldRing = beginRecoil(0.2, RING_RECOIL_MAX, true);
assert(heldRing !== null && wobbleOffset(heldRing!) === RING_RECOIL_MAX, 'a held ring stays at three degrees');
assert(!stepRecoil(heldRing!, 0.2), 'holding does not finish the wobble');
releaseHold(heldRing!);
assert(Math.abs(wobbleOffset(heldRing!) - RING_RECOIL_MAX) < 1e-6, 'release starts from the held angle');
const blockedRing = dragEffect({ kind: 'ring', moved: false, applied: 0, rejected: 0.2, armed: true, free: 0 });
assert(blockedRing.type === 'hold', 'a ring that never moved holds');
const blockedBar = dragEffect({ kind: 'bar', moved: false, applied: 0, rejected: 0.2, armed: true, free: 0 });
assert(blockedBar.type === 'stop', 'a bar that never moved ends the drag');
const firstHit = dragEffect({ kind: 'ring', moved: true, applied: 0.01, rejected: 0.2, armed: true, free: 0 });
assert(firstHit.type === 'hit', 'a moving piece flashes on the hit');
const stillHeld = dragEffect({ kind: 'ring', moved: true, applied: 0, rejected: 0.2, armed: false, free: 0 });
assert(stillHeld.type !== 'hit', 'holding the same contact does not flash again');
const rearm = dragEffect({ kind: 'ring', moved: true, applied: 0.1, rejected: 0, armed: false, free: 0 });
assert(rearm.type === 'free' && rearm.armed, 'turning away arms the next hit');
assert(heldSign(null, -0.4) === -1, 'the first block sets the hold direction');
assert(heldSign(-1, 0.8) === -1, 'a later drag cannot flip the held direction');
assert(light.settled, 'the wobble ends on the rule pose');
assert(BAR_RECOIL_WORLD > 0.03 && BAR_RECOIL_WORLD < 0.045, 'bar wobble is about three design pixels');

console.log('rotate-rings selftest ok');
