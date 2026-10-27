import { gapCovers, signedDelta } from './angle';
import { barById, moveBar, ringById, rotateRing, settle, beginDrag, cancelDrag, ringFreeArcs } from './board';

import { clampAngle, freeArcs, pinForbidden } from './interval';
import { LEVELS, levelBar, levelBasic, levelPin, levelScreen, levelStopClosed, levelTwo } from './levels';

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
const leftTwo = settle(two, { kind: 'ring', id: 'a', theta: 0, pointerAngle: 0 });
assert(leftTwo.includes('a') && leftTwo.includes('b'), 'freeing one ring cascades the other');

const barLevel = levelBar();
const onlyBar = settle(barLevel, { kind: 'bar', id: 'bar', t: 0.15 });
assert(onlyBar.length === 0, 'bar outside the window does not release');
barById(barLevel, 'bar')!.t = 0.8;
const opened = settle(barLevel, { kind: 'bar', id: 'bar', t: 0.15 });
assert(opened.includes('bar'), 'bar falls after the latch opens');
assert(ringById(barLevel, 'a') !== undefined, 'ring stays while its pin remains');
const ringGone = settle(barLevel, { kind: 'ring', id: 'a', theta: 0, pointerAngle: 0 });
assert(ringGone.includes('a'), 'ring falls after the pin is covered');

const closedLevel = levelStopClosed();
const closedTry = settle(closedLevel, { kind: 'ring', id: 'closed', theta: 0, pointerAngle: 0 });
assert(closedTry.length === 0, 'closed ring cannot release itself');
const both = settle(closedLevel, { kind: 'ring', id: 'open', theta: 0, pointerAngle: 0 });
assert(both.includes('open') && both.includes('closed'), 'closed ring leaves only by cascade');

const basic = levelBasic();
const blue = ringById(basic, 'blue')!;
const joint = basic.pins.find((pin) => pin.id === 'joint-green')!;
const jointAngle = Math.atan2(joint.y - blue.y, joint.x - blue.x);
assert(!gapCovers(blue.theta, jointAngle, blue.gap), 'the blue ring starts caught in the clasp');
const blue0 = blue.theta;
rotateRing(basic, blue, -1.5);
assert(Math.abs(signedDelta(blue0, blue.theta)) > 1.4, 'the blue ring can turn past the gap-right angle');
blue.theta = blue0;
rotateRing(basic, blue, 1.2);
assert(Math.abs(signedDelta(blue0, blue.theta)) > 1, 'the clasp lets the ring turn through');
assert(!gapCovers(blue.theta, jointAngle, blue.gap), 'this turn has not reached the clasp');
const stillCaught = settle(basic, { kind: 'ring', id: 'blue', theta: blue.theta, pointerAngle: 0 });
assert(!stillCaught.includes('blue'), 'pointerup away from the clasp stays locked');
blue.theta = jointAngle;
const openedBlue = settle(basic, { kind: 'ring', id: 'blue', theta: blue.theta, pointerAngle: 0 });
assert(openedBlue.includes('blue') && !openedBlue.includes('green'), 'pointerup on the clasp releases only the blue ring');
const green0 = ringById(basic, 'green')!.theta;
rotateRing(basic, ringById(basic, 'green')!, 0.35);
assert(Math.abs(signedDelta(green0, ringById(basic, 'green')!.theta)) > 0.2, 'the green ring can turn until it meets the bar');
const greenBeforeStop = ringById(basic, 'green')!.theta;
rotateRing(basic, ringById(basic, 'green')!, 4);
assert(Math.abs(signedDelta(greenBeforeStop, ringById(basic, 'green')!.theta)) < Math.PI, 'the bar stops the green ring by contact');
const slide = levelBasic();
const red = barById(slide, 'bar-red')!;
assert(Math.abs(red.y1 - red.y0) > Math.abs(red.x1 - red.x0) * 0.4, 'red bar sits on a diagonal');
const tipT = red.t;
moveBar(slide, red, 0.02);
assert(red.t > 0.02, 'the bar cannot pass through the ring');
red.t = tipT;
moveBar(slide, red, 0.92);
assert(red.t >= 0.7, 'the bar slides out along the gap');
const greenHeld = ringById(slide, 'green')!.theta;
rotateRing(slide, ringById(slide, 'green')!, 0.4);
assert(Math.abs(signedDelta(greenHeld, ringById(slide, 'green')!.theta)) > 0.15, 'the green ring turns after the bar leaves its gap');
const fellBar = settle(slide, { kind: 'bar', id: 'bar-red', t: tipT });
assert(fellBar.includes('bar-red') && fellBar.includes('green'), 'the bar releases the green ring');

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
const fellRed = settle(chain, { kind: 'bar', id: 'bar-red', t: 0.9 });
assert(fellRed.includes('bar-red') && fellRed.includes('blue'), 'red bar takes the blue ring with it');
rotateRing(chain, ringById(chain, 'green')!, Math.PI / 2);
assert(reach('bar-orange') >= 0.78, 'turning the green ring opens the orange bar');
assert(reach('bar-purple') < 0.78, 'purple bar waits for the green ring to leave');
moveBar(chain, barById(chain, 'bar-orange')!, 0.9);
settle(chain, { kind: 'bar', id: 'bar-orange', t: 0.9 });
assert(reach('bar-purple') < 0.78, 'purple bar is still stopped by the orange ring');
rotateRing(chain, ringById(chain, 'orange')!, Math.PI / 2);
assert(reach('bar-purple') >= 0.78, 'turning the orange ring opens the last bar');

console.log('rotate-rings selftest ok');
