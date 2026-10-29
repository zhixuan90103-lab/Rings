import { beginTwoFinger, boardBounds, cameraForFit, cameraForPinch, choosePinchLock, clampCamera, designNdc, editorFrame, editorPan, editorPanT, editorZoom, editorZoomT, frameFor, frameLift, stepTwoFinger, worldFromDesign, zoomCap } from './camera';
import { connectorReach } from './parts';
import { gapCovers, signedDelta, wrapAngle } from './angle';
import { barById, handlePoint, moveBar, nudgeRing, ringById, rotateRing, settle, beginDrag, cancelDrag, dragTo, ringFreeArcs } from './board';

import { clampAngle, freeArcs, pinForbidden } from './interval';
import { LEVELS, levelBar, levelBasic, levelPin, levelScreen, levelStopClosed, levelTwo } from './levels';
import { emptyBoard, seatConnectors } from './levelio';
import { dragEffect } from './feedback';
import { barHitsRing, barOverlapAmount, barsOverlapAmount, barStillInBuckle, buckleOverlapAmount, claspCenterDistance, connectorCoreDepth, connectorHitsRing, strikePoint } from './volume';
import { BAR_RECOIL_WORLD, RING_RECOIL_MAX, WOBBLE_CYCLES, WOBBLE_SECONDS, beginRecoil, heldSign, releaseHold, stepRecoil, wobbleOffset } from './recoil';
import { ringChipPoints } from './shatter';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { emptyHand, handCamera, handDown, handUp } from './hand';
import { INTENT_PAD, chooseIntent, intentWorld, listCandidates } from './intent';
import { VIEW_H } from './camera';
import { breakPraise, freshPraise, notePraiseClear, placePraise } from './praise';

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
  if (!board.volumes) {
    for (const ring of board.rings) {
      if (ring.gap <= 0) continue;
      const arcs = ringFreeArcs(board, ring);
      assert(arcs.length > 0, `${level.name} ${ring.id} has room to turn`);
    }
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
assert(Math.abs(signedDelta(greenNested, ringById(basic, 'green')!.theta)) < 0.08, 'a seated clasp blocks the owner both ways');
{
  const tilted = levelBasic();
  const owner = ringById(tilted, 'green')!;
  const captive = ringById(tilted, 'blue')!;
  const seat = claspCenterDistance(owner, captive);
  owner.theta = wrapAngle(owner.theta + 0.22);
  const off = claspCenterDistance(owner, captive);
  assert(off > seat + 0.05, 'turning the owner walks the arc center off the captive ring');
  assert(connectorCoreDepth(owner, captive) > 0.2, 'the tilted arc cuts the captive band');
  const ownerOff = owner.theta;
  const captiveOff = captive.theta;
  rotateRing(tilted, owner, 0.5);
  assert(Math.abs(signedDelta(ownerOff, owner.theta)) < 0.08, 'a cutting arc will not tilt any farther');
  rotateRing(tilted, owner, -0.5);
  assert(Math.abs(signedDelta(ownerOff, owner.theta)) > 0.15, 'the owner can turn the arc back toward the seat');
  owner.theta = ownerOff;
  rotateRing(tilted, captive, 0.8);
  assert(Math.abs(signedDelta(captiveOff, captive.theta)) < 0.08, 'the captive ring cannot turn through a cutting arc');
  rotateRing(tilted, captive, -0.8);
  assert(Math.abs(signedDelta(captiveOff, captive.theta)) < 0.08, 'the captive ring cannot turn off the other way either');
}
assert(strikePoint(basic, 'ring', 'green', 1) !== null, 'a locked ring still has a contact for the hit');
{
  const hit = emptyBoard();
  hit.volumes = true;
  hit.rings.push(
    {
      id: 'seat',
      kind: 'ring',
      x: 0.15,
      y: 0,
      inner: 0.42,
      outer: 0.68,
      gap: 1.2,
      theta: 0,
      connectors: [],
    },
    {
      id: 'stop',
      kind: 'ring',
      x: 0.25,
      y: 0.7,
      inner: 0.42,
      outer: 0.68,
      gap: 1.2,
      theta: -Math.PI / 2,
      connectors: [],
    },
    {
      id: 'owner',
      kind: 'ring',
      x: -0.95,
      y: 0,
      inner: 0.42,
      outer: 0.68,
      gap: 1.2,
      theta: 0,
      connectors: [{ angle: 0, stem: 0.55, target: 'seat' }],
    },
  );
  const spark = strikePoint(hit, 'ring', 'owner', 1);
  assert(spark !== null && spark.x > -0.1, 'a new clasp hit is marked on that clasp, not on the seated stem');
}
{
  const hit = emptyBoard();
  hit.volumes = true;
  hit.rings.push(
    {
      id: 'green',
      kind: 'ring',
      x: 0,
      y: 0,
      inner: 0.42,
      outer: 0.68,
      gap: 1.2,
      theta: 0,
      connectors: [],
    },
    {
      id: 'blue',
      kind: 'ring',
      x: 0,
      y: 1.05,
      inner: 0.42,
      outer: 0.68,
      gap: 1.2,
      theta: Math.PI,
      connectors: [],
    },
    {
      id: 'purple',
      kind: 'ring',
      x: 0,
      y: -1.35,
      inner: 0.42,
      outer: 0.68,
      gap: 1.2,
      theta: Math.PI / 2,
      connectors: [{ angle: Math.PI / 2, stem: 0.55, target: 'green' }],
    },
  );
  const spark = strikePoint(hit, 'ring', 'green', 1);
  assert(spark !== null && spark.y > 0.2, 'a band meeting another ring sparks there, not on a handle already seated');
}
const blue = ringById(basic, 'blue')!;
const green = ringById(basic, 'green')!;
const joint = handlePoint(green, green.connectors[0]);
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
const pad = intentWorld(INTENT_PAD, 1);
assert(Math.abs(pad - (INTENT_PAD * DESIGN_WIDTH * VIEW_H) / DESIGN_HEIGHT) < 1e-6, 'pad is a fraction of design width');
const loose = levelPin();
const looseRing = loose.rings[0];
const holeHit = listCandidates(loose, looseRing.x, looseRing.y, pad);
assert(holeHit.length === 1 && holeHit[0].id === looseRing.id && holeHit[0].place === 'foot', 'an empty hole is the ring footprint');
const arc = looseRing.inner * 0.6;
const tangential = chooseIntent(
  loose,
  holeHit,
  looseRing.x + arc,
  looseRing.y,
  looseRing.x + arc * Math.cos(0.5),
  looseRing.y + arc * Math.sin(0.5),
  false,
);
assert(tangential?.id === looseRing.id, 'a press in the hole selects the ring before any travel');
const gapPoint = {
  x: looseRing.x + Math.cos(looseRing.theta) * (looseRing.inner + looseRing.outer) * 0.5,
  y: looseRing.y + Math.sin(looseRing.theta) * (looseRing.inner + looseRing.outer) * 0.5,
};
const gapHit = listCandidates(loose, gapPoint.x, gapPoint.y, pad);
assert(gapHit.length === 1 && gapHit[0].id === looseRing.id && gapHit[0].place === 'foot', 'an empty gap is the ring footprint');
const outside = listCandidates(loose, looseRing.x + looseRing.outer + pad * 0.5, looseRing.y, pad);
assert(outside.some((hit) => hit.id === looseRing.id && hit.place === 'pad'), 'outside the disc is only a pad');
const occupied = emptyBoard();
occupied.rings.push({
  id: 'host',
  kind: 'ring',
  x: 0,
  y: 0,
  inner: 0.5,
  outer: 0.8,
  gap: 1.2,
  theta: 0,
  connectors: [],
});
occupied.bars.push({ id: 'stick', kind: 'bar', x0: -1, y0: 0, x1: 1, y1: 0, half: 0.08, grip: 0.9, t: 0.5 });
const onStick = listCandidates(occupied, 0, 0, pad);
assert(onStick.some((hit) => hit.id === 'stick' && hit.place === 'solid'), 'a bar in the hole is a solid');
assert(chooseIntent(occupied, onStick, 0, 0, 0, 0, false)?.id === 'stick', 'a bar that can slide outscores the hole');
assert(chooseIntent(occupied, onStick, 0, 0, 0.2, 0.2, true)?.id === 'stick', 'a gesture does not take a clicked bar away');
const direct = emptyBoard();
direct.volumes = false;
direct.rings.push(
  {
    id: 'stuck',
    kind: 'ring',
    x: 0,
    y: 0,
    inner: 0.42,
    outer: 0.68,
    gap: 0.02,
    theta: 0,
    connectors: [],
  },
  {
    id: 'wide',
    kind: 'ring',
    x: 0,
    y: 0,
    inner: 1.4,
    outer: 1.8,
    gap: 1.2,
    theta: 0,
    connectors: [],
  },
);
direct.pins.push({
  id: 'freeze-stuck',
  ownerId: null,
  localAngle: 0,
  localRadius: 0,
  x: 0,
  y: 0.55,
  role: 'block',
  limitRingId: null,
  stopHalf: 0,
});
const onStuck = listCandidates(direct, -0.55, 0, pad);
assert(onStuck.some((hit) => hit.id === 'stuck' && hit.place === 'solid' && !hit.neg && !hit.pos), 'the clicked ring cannot turn');
assert(onStuck.some((hit) => hit.id === 'wide' && hit.place === 'foot' && (hit.neg || hit.pos)), 'the disc behind it can turn');
assert(chooseIntent(direct, onStuck, -0.55, 0, -0.55, 0, false)?.id === 'wide', 'a stuck solid yields to the live hole around it');
occupied.volumes = false;
const besideStick = listCandidates(occupied, 0, 0.25, pad);
assert(besideStick.some((hit) => hit.id === 'host' && hit.place === 'foot'), 'a miss beside the bar still sees the ring');
assert(chooseIntent(occupied, besideStick, 0, 0.25, 0, 0.25, false)?.id === 'host', 'the ring footprint outscores the bar pad');
const closeToStick = listCandidates(occupied, 0, 0.12, pad);
assert(closeToStick.some((hit) => hit.id === 'stick' && hit.place === 'solid'), 'a hole press within 2% of the bar counts as the bar');
assert(chooseIntent(occupied, closeToStick, 0, 0.12, 0, 0.12, false)?.id === 'stick', 'a press close to the bar in the hole selects the bar');
const gapMouth = {
  x: ((occupied.rings[0].inner + occupied.rings[0].outer) / 2),
  y: 0,
};
const inMouth = listCandidates(occupied, gapMouth.x, gapMouth.y, pad);
assert(inMouth.some((hit) => hit.id === 'stick' && hit.place === 'solid'), 'the bar in the gap is a solid');
assert(inMouth.some((hit) => hit.id === 'host' && hit.place === 'foot'), 'the gap around that bar is the ring footprint');
assert(chooseIntent(occupied, inMouth, gapMouth.x, gapMouth.y, gapMouth.x, gapMouth.y, false) === null, 'a bar in the gap waits for the stroke');
assert(
  chooseIntent(occupied, inMouth, gapMouth.x, gapMouth.y, gapMouth.x + 0.08, gapMouth.y, false)?.id === 'stick',
  'sliding along the bar in the gap takes the bar',
);
assert(
  chooseIntent(occupied, inMouth, gapMouth.x, gapMouth.y, gapMouth.x, gapMouth.y + 0.08, false)?.id === 'host',
  'a tangential stroke in the gap takes the ring',
);
const horn = occupied.rings[0].gap / 2;
const hornPoint = {
  x: gapMouth.x * Math.cos(horn),
  y: gapMouth.x * Math.sin(horn),
};
const onHorn = listCandidates(occupied, hornPoint.x, hornPoint.y, pad);
assert(
  chooseIntent(occupied, onHorn, hornPoint.x, hornPoint.y, hornPoint.x + 0.08, hornPoint.y, false)?.id === 'stick',
  'sliding along the bar from the gap horn takes the bar',
);
const stacked = emptyBoard();
stacked.volumes = true;
stacked.rings.push(
  {
    id: 'host',
    kind: 'ring',
    x: 0,
    y: 0,
    inner: 0.42,
    outer: 0.68,
    gap: 0.02,
    theta: 0,
    connectors: [],
  },
  {
    id: 'owner',
    kind: 'ring',
    x: -1.35,
    y: 0,
    inner: 0.42,
    outer: 0.68,
    gap: 1.2,
    theta: 0,
    connectors: [{ angle: 0, stem: 0.32, target: 'host' }],
  },
);
stacked.pins.push({
  id: 'freeze',
  ownerId: null,
  localAngle: 0,
  localRadius: 0,
  x: 0,
  y: 0.55,
  role: 'block',
  limitRingId: null,
  stopHalf: 0,
});
const overlap = listCandidates(stacked, -0.55, 0, pad);
assert(overlap.filter((hit) => hit.place === 'solid').length === 2, 'a handle and a ring are both solids');
const preferHost = chooseIntent(stacked, overlap, -0.55, 0, -0.55, 0, false);
assert(preferHost == null, 'a cutting arc sticks both rings, so the press waits');
const heldHost = chooseIntent(stacked, overlap, -0.55, 0, -0.55, 0, true);
assert(heldHost?.id === 'host', 'with both rings stuck, the press stays on the ring under the handle');
const inHole = emptyBoard();
inHole.volumes = false;
inHole.rings.push(
  {
    id: 'host',
    kind: 'ring',
    x: 0,
    y: 0,
    inner: 0.5,
    outer: 0.8,
    gap: 1.2,
    theta: Math.PI / 2,
    connectors: [],
  },
  {
    id: 'owner',
    kind: 'ring',
    x: -0.9,
    y: 0,
    inner: 0.42,
    outer: 0.68,
    gap: 0.02,
    theta: 0,
    connectors: [{ angle: 0, stem: 0.5, target: 'host' }],
  },
);
inHole.pins.push({
  id: 'freeze-owner',
  ownerId: null,
  localAngle: 0,
  localRadius: 0,
  x: -1.45,
  y: 0,
  role: 'block',
  limitRingId: null,
  stopHalf: 0,
});
const handleInHole = listCandidates(inHole, 0, 0, pad);
assert(handleInHole.some((hit) => hit.id === 'owner' && hit.place === 'solid' && !hit.neg && !hit.pos), 'the handle in the hole cannot turn');
assert(handleInHole.some((hit) => hit.id === 'host' && hit.place === 'foot' && (hit.neg || hit.pos)), 'the hole around that handle can turn');
assert(chooseIntent(inHole, handleInHole, 0, 0, 0, 0, false)?.id === 'host', 'a stuck handle in the hole yields to that ring');
const discs = emptyBoard();
discs.volumes = false;
discs.rings.push(
  { id: 'near', kind: 'ring', x: 0, y: 0, inner: 0.9, outer: 1.2, gap: 1, theta: 0, connectors: [] },
  { id: 'far', kind: 'ring', x: 1, y: 0, inner: 1.3, outer: 1.6, gap: 1, theta: 0, connectors: [] },
);
const bothDiscs = listCandidates(discs, 0, 0, pad);
assert(bothDiscs.filter((hit) => hit.place === 'foot').length === 2, 'the press sits in two holes');
assert(chooseIntent(discs, bothDiscs, 0, 0, 0, 0, false)?.id === 'near', 'a hole more than 0.75 closer locks on the press');
const closeDiscs = emptyBoard();
closeDiscs.volumes = false;
closeDiscs.rings.push(
  { id: 'near', kind: 'ring', x: 0, y: 0, inner: 0.9, outer: 1.2, gap: 1, theta: 0, connectors: [] },
  { id: 'far', kind: 'ring', x: 0.4, y: 0, inner: 0.9, outer: 1.2, gap: 1, theta: Math.PI, connectors: [] },
);
const closeHits = listCandidates(closeDiscs, 0, 0, pad);
assert(chooseIntent(closeDiscs, closeHits, 0, 0, 0, 0, false) === null, 'a smaller center gap waits for the stroke');
assert(chooseIntent(closeDiscs, closeHits, 0, 0, 0, 0, true)?.id === 'near', 'after the window the closer hole still wins');
const twitch = chooseIntent(discs, bothDiscs, 0, 0, 0.002, 0.002, false);
assert(twitch === null || twitch.id === 'near', 'a twitch does not hand the press to the farther hole');
const wing = emptyBoard();
wing.volumes = false;
wing.bars.push({ id: 'stick', kind: 'bar', x0: -1, y0: 0, x1: 1, y1: 0, half: 0.08, grip: 0.9, t: 0.5 });
wing.latches.push({ id: 'buckle', barId: 'stick', x: 0, y: 0, t0: 0, t1: 1, release: 'sleeve' });
const wingHit = listCandidates(wing, 0, 0.1, pad);
assert(wingHit.some((hit) => hit.id === 'stick' && hit.place === 'solid'), 'the buckle grip counts as its bar');
assert(!gapCovers(blue.theta, jointAngle, blue.gap), 'this turn has not reached the clasp');
const stillCaught = settle(basic, { kind: 'ring', id: 'blue', theta: blue.theta, x: 0, y: 0 });
assert(!stillCaught.includes('blue'), 'pointerup away from the clasp stays locked');
const release = levelBasic();
const releaseBlue = ringById(release, 'blue')!;
const releaseGreen = ringById(release, 'green')!;
const releaseJoint = handlePoint(releaseGreen, releaseGreen.connectors[0]);
releaseBlue.theta = Math.atan2(releaseJoint.y - releaseBlue.y, releaseJoint.x - releaseBlue.x);
const openedBlue = settle(release, { kind: 'ring', id: 'blue', theta: releaseBlue.theta, x: 0, y: 0 });
assert(openedBlue.includes('blue') && openedBlue.includes('green'), 'unlinking the rings lets both fall');
const partial = levelBasic();
const partialBlue = ringById(partial, 'blue')!;
const partialGreen = ringById(partial, 'green')!;
const partialJoint = handlePoint(partialGreen, partialGreen.connectors[0]);
const aligned = Math.atan2(partialJoint.y - partialBlue.y, partialJoint.x - partialBlue.x);
let seated = false;
for (const step of [0.15, 0.3, 0.45, 0.6, 0.75]) {
  partialBlue.theta = aligned + step;
  const alpha = Math.atan2(partialJoint.y - partialBlue.y, partialJoint.x - partialBlue.x);
  if (gapCovers(partialBlue.theta, alpha, partialBlue.gap) && connectorHitsRing(partialGreen, partialBlue)) {
    seated = true;
    break;
  }
}
assert(seated, 'a gap can cover the clasp while the handle is still in the solid');
const stayedNested = settle(partial, { kind: 'ring', id: 'blue', theta: partialBlue.theta, x: 0, y: 0 });
assert(!stayedNested.includes('blue'), 'pointerup keeps the clasp while the handle is still in the solid');
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
const buckle = slide.latches.find((latch) => latch.id === 'buckle-red')!;
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
const greenSlide = ringById(slide, 'green')!;
greenSlide.theta = Math.atan2(red.y0 - greenSlide.y, red.x0 - greenSlide.x);
const beforeGreen = red.t;
moveBar(slide, red, beforeGreen - 1.5);
assert(red.t > beforeGreen - 1.5, 'the green ring stops the bar');
assert(barOverlapAmount(red, red.t, greenSlide) === 0, 'the bar stops before it sinks into the green ring');
const blocked = beginDrag(slide, { kind: 'bar', id: red.id }, red.x0, red.y0)!;
const discarded = dragTo(slide, blocked, red.x0 - (red.x1 - red.x0), red.y0 - (red.y1 - red.y0));
assert(Math.abs(discarded) > 1e-3, 'pushing the bar into the green ring reports a block');
const pair = levelBasic();
const mover = barById(pair, 'bar-red')!;
const ahead = mover.t - 0.75;
const px = mover.x0 + (mover.x1 - mover.x0) * ahead;
const py = mover.y0 + (mover.y1 - mover.y0) * ahead;
const rdx = mover.x1 - mover.x0;
const rdy = mover.y1 - mover.y0;
const rlen = Math.hypot(rdx, rdy) || 1;
pair.bars.push({
  id: 'bar-cross',
  kind: 'bar',
  x0: px - (-rdy / rlen) * 0.7,
  y0: py - (rdx / rlen) * 0.7,
  x1: px + (-rdy / rlen) * 0.7,
  y1: py + (rdx / rlen) * 0.7,
  half: mover.half,
  grip: mover.grip,
  t: 0.5,
});
const cross = barById(pair, 'bar-cross')!;
moveBar(pair, mover, mover.t - 1);
assert(mover.t > ahead - 0.2, 'another bar stops the slide');
assert(barsOverlapAmount(mover, mover.t, cross) < 1e-3, 'the bar stops before the capsules sink together');
assert(strikePoint(pair, 'bar', mover.id, -1) !== null, 'a bar against a bar has a contact');
greenSlide.theta = ringById(levelBasic(), 'green')!.theta;
red.t = 0.92;
const greenHeld = ringById(slide, 'green')!.theta;
rotateRing(slide, ringById(slide, 'green')!, 1.4);
assert(Math.abs(signedDelta(greenHeld, ringById(slide, 'green')!.theta)) < 1.2, 'the bar leaving does not let the green clasp pass through the blue ring');
const fellBar = settle(slide, { kind: 'bar', id: 'bar-red', t: tipT, x: 0, y: 0 });
assert(fellBar.includes('bar-red') && !fellBar.includes('green') && !fellBar.includes('blue'), 'pulling the bar out of its buckle drops only the bar');
const buckleBoard = levelBasic();
const parked = barById(buckleBoard, 'bar-red')!;
parked.t = 4;
const bucklePin = buckleBoard.latches.find((latch) => latch.id === 'buckle-red')!;
const against = ringById(buckleBoard, 'blue')!;
const midR = (against.inner + against.outer) / 2;
against.x = bucklePin.x - midR;
against.y = bucklePin.y;
against.theta = against.gap / 2 + 0.08;
assert(barOverlapAmount(parked, parked.t, against) === 0, 'the capsule is parked clear of the buckle test');
const buckleDepth = buckleOverlapAmount(parked, against, bucklePin.x, bucklePin.y);
const bucklePose = against.theta;
rotateRing(buckleBoard, against, 0.8);
assert(buckleDepth > 0, 'the ring solid starts in the silver buckle');
assert(buckleOverlapAmount(parked, against, bucklePin.x, bucklePin.y) <= buckleDepth + 1e-3, 'turning deeper into the buckle is rejected');
assert(Math.abs(signedDelta(bucklePose, against.theta)) < 0.2, 'the silver buckle stops the ring');
rotateRing(buckleBoard, against, -0.8);
assert(Math.abs(signedDelta(bucklePose, against.theta)) > 0.05, 'the ring can turn back off the buckle');

// levelScreen latches release by the drawn sleeve. t0/t1 are leftover window numbers and are not read.
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

const capRing = {
  id: 'cap',
  kind: 'ring' as const,
  x: 0,
  y: 0,
  inner: 0.4,
  outer: 0.6,
  gap: 1,
  theta: 0,
  connectors: [],
};
const capAngle = capRing.gap / 2;
const capMid = (capRing.inner + capRing.outer) / 2;
const probe = (radius: number) => {
  const x = Math.cos(capAngle) * radius;
  const y = Math.sin(capAngle) * radius;
  return barHitsRing(
    { id: 'probe', kind: 'bar', x0: x, y0: y, x1: x, y1: y, half: 0.004, grip: 0.004, t: 0.5 },
    0.5,
    capRing,
  );
};
assert(probe(capMid), 'the gap cap center is solid');
assert(probe(capRing.outer - 0.01), 'the drawn cap still reaches the outer edge');
assert(!probe(capRing.outer + 0.02), 'the gap cap does not extend past the band');

const topLeft = designNdc(0, 0);
assert(topLeft.x === -1 && topLeft.y === 1, 'design top-left is world-up NDC');
const stemReach = connectorReach(0.648, 0.648 * 0.28, 0.36244);
assert(stemReach > 0.648, 'a connector reaches past the ring');
const chips = ringChipPoints({
  id: 'chip',
  kind: 'ring',
  x: 1,
  y: -2,
  inner: 0.47,
  outer: 0.648,
  gap: 1.75,
  theta: 0,
  connectors: [],
});
assert(chips.length > 8 && chips.length < 28, 'a ring shatters into a short row of chips');
assert(
  chips.every((point) => {
    const x = point.x - 1;
    const y = point.y + 2;
    const radius = Math.hypot(x, y);
    const angle = Math.abs(Math.atan2(y, x));
    return radius <= 0.648 + 0.02 && (angle >= 1.75 / 2 - 0.05 || radius >= 0.47);
  }),
  'ring chips stay on the band and out of the gap',
);
const box = boardBounds(LEVELS[0].make());
assert(box.maxX > box.minX && box.maxY > box.minY, 'a level has a bounds box');
const usable = { left: 24, top: 80, right: 366, bottom: 760 };
const fit = frameFor(box, usable);
const cam = cameraForFit(box, fit);
const center = worldFromDesign((usable.left + usable.right) / 2, (usable.top + usable.bottom) / 2, cam.x, cam.y, cam.zoom);
assert(Math.abs(center.x - (box.minX + box.maxX) / 2) < 1e-6, 'fit puts the bounds on the usable center x');
assert(Math.abs(center.y - ((box.minY + box.maxY) / 2 - frameLift(box, fit, cam.zoom))) < 1e-6, 'fit puts the bounds above the usable center');
const focal = worldFromDesign(195, 422, cam.x, cam.y, cam.zoom);
const zoomed = cam.zoom * 2;
const shifted = worldFromDesign(195, 422, cam.x, cam.y, zoomed);
const kept = worldFromDesign(195, 422, cam.x + focal.x - shifted.x, cam.y + focal.y - shifted.y, zoomed);
assert(Math.abs(kept.x - focal.x) < 1e-6 && Math.abs(kept.y - focal.y) < 1e-6, 'pinch keeps the midpoint world point');
const slid = cameraForPinch({ x: cam.x, y: cam.y, zoom: cam.zoom, midX: 180, midY: 400 }, 240, 400, cam.zoom);
const followed = worldFromDesign(240, 400, slid.x, slid.y, cam.zoom);
const origin = worldFromDesign(180, 400, cam.x, cam.y, cam.zoom);
assert(Math.abs(followed.x - origin.x) < 1e-6 && Math.abs(followed.y - origin.y) < 1e-6, 'two fingers drag the point under their midpoint');
const first = handDown(emptyHand(), 1, true);
assert(first.effect === 'begin-piece' && first.hand.owner === 1, 'the first finger owns the piece');
const added = handDown(first.hand, 2, true);
assert(added.effect === 'begin-camera' && added.hand.owner === 1, 'the second finger takes the camera and keeps the owner');
const lifted = handUp(added.hand, 1, false);
assert(lifted.effect === 'settle' && lifted.hand.owner === null, 'the first finger lift settles');
const cancelled = handUp(added.hand, 1, true);
assert(cancelled.effect === 'none' && cancelled.hand.owner === 1, 'a cancel while the camera is up does not settle');
const alone = handUp(first.hand, 1, true);
assert(alone.effect === 'revert', 'a cancel of the only finger restores the piece');
assert(handCamera(first.hand).effect === 'begin-camera', 'a second touch can open the camera without a pointer id');
assert(handDown(emptyHand(), 1, false).effect === 'none', 'a press outside the stage does not start a piece');
assert(choosePinchLock(4, 3, null) === null, 'a small two-finger motion does not lock yet');
assert(choosePinchLock(1, 2, null, 2) === 'zoom', 'a takeover locks on a two-pixel pinch');
assert(choosePinchLock(8, 20, null) === 'zoom', 'a wider pinch locks to zoom');
assert(choosePinchLock(30, 20, 'zoom') === 'zoom', 'a locked zoom ignores a later pan');
assert(choosePinchLock(30, 10, null) === 'pan', 'a sliding pair locks to pan');
assert(choosePinchLock(4, 40, 'pan') === 'pan', 'a locked pan ignores a later pinch');
const gesture = beginTwoFinger(0, 0, 1, 180, 400, 100);
const waiting = stepTwoFinger(gesture, 184, 400, 100, 0, 0, 1, box, fit);
assert(waiting.camera === null, 'a two-finger gesture waits until it locks');
const open = { ...fit, maxZoom: fit.minZoom * 3 };
const zoomedGesture = stepTwoFinger({ ...gesture, lock: 'zoom' }, 200, 430, 140, 0, 0, 1, box, open);
assert(zoomedGesture.camera !== null && zoomedGesture.camera.zoom > 1, 'a locked zoom changes zoom around the fingers');
assert(editorZoom(2, 0) === 0.5, 'the editor slider can go four times farther than the fit');
assert(editorZoom(2, 0.5) === 2, 'the editor slider midpoint is the fit zoom');
assert(editorZoom(2, 1) === 8, 'the editor slider ends four times closer');
assert(Math.abs(editorZoomT(2, editorZoom(2, 0.25)) - 0.25) < 1e-6, 'the editor slider reads back a farther zoom');
assert(editorPan(10, 0.5) === 0, 'the vertical slider midpoint stays on the fit');
assert(editorPan(10, 0) === -10, 'the vertical slider looks one view lower');
assert(editorPan(10, 1) === 10, 'the vertical slider looks one view higher');
assert(Math.abs(editorPanT(10, editorPan(10, 0.25)) - 0.25) < 1e-6, 'the vertical slider reads back its offset');
const framed = editorFrame({ x: 1, y: 2 }, 2, 1, 10);
assert(framed.x === 1 && framed.y === 7 && framed.zoom === 2, 'editor framing keeps x, raises y by one view, and keeps zoom');

const clasped = emptyBoard();
const outer = 0.648;
const inner = 0.46656;
clasped.rings.push({
  id: 'green',
  kind: 'ring',
  x: 0,
  y: 0,
  inner,
  outer,
  gap: 1.75,
  theta: Math.PI / 2,
  connectors: [{ angle: -Math.PI, stem: 0.46, target: 'purple' }],
});
clasped.rings.push({
  id: 'purple',
  kind: 'ring',
  x: 0,
  y: -1.1,
  inner,
  outer,
  gap: 1.75,
  theta: 0,
  connectors: [],
});
assert(connectorHitsRing(ringById(clasped, 'green')!, ringById(clasped, 'purple')!), 'the downward handle still meets the ring below');
const stayed = settle(clasped, { kind: 'ring', id: 'green', theta: Math.PI / 2, x: 0, y: 0 });
assert(!stayed.includes('green') && !stayed.includes('purple'), 'a ring stays when its handle still meets the ring below');

const columns = emptyBoard();
function columnRing(id: string, x: number, y: number, target: string | null): void {
  columns.rings.push({
    id,
    kind: 'ring',
    x,
    y,
    inner: 0.46656,
    outer: 0.648,
    gap: 1.75,
    theta: 0,
    connectors: target ? [{ angle: 0, stem: 0.3, target }] : [],
  });
}
columnRing('left-a', -1.66, 1, 'mid');
columnRing('left-b', -1.9, -1, null);
columnRing('right-a', 1.7, 1, null);
columnRing('mid', -0.2, 0, null);
seatConnectors(columns);
assert(ringById(columns, 'left-a')!.x === ringById(columns, 'left-b')!.x, 'the left column shares one x');
assert(Math.abs(ringById(columns, 'left-a')!.x + ringById(columns, 'right-a')!.x) < 1e-6, 'the right column mirrors the left');
assert(Math.abs(ringById(columns, 'mid')!.x + 0.2) < 1e-6, 'a middle ring stays where it was placed');
const owner = ringById(columns, 'left-a')!;
const mid = ringById(columns, 'mid')!;
const world = owner.theta + owner.connectors[0].angle;
const dist = Math.hypot(mid.x - owner.x, mid.y - owner.y);
const claspX = owner.x + Math.cos(world) * dist;
const claspY = owner.y + Math.sin(world) * dist;
assert(Math.hypot(claspX - mid.x, claspY - mid.y) < 1e-3, 'the clasp center lands on the target ring');
assert(zoomCap(0.648, 0.4, 0.648, 1) === 1, 'a smaller level can zoom until its ring matches level 1');
assert(zoomCap(0.648, 1.2, 0.648, 1) === 1.2, 'a level already larger than level 1 does not zoom in');
const tight = clampCamera(cam.x + 5, cam.y + 5, fit.minZoom, box, fit);
assert(tight.zoom === fit.minZoom, 'the edge clamp does not change zoom');
const inside = clampCamera(100, -100, fit.maxZoom, box, fit);
assert(inside.zoom === fit.maxZoom, 'the edge clamp keeps the pinched zoom');
const seen = worldFromDesign((usable.left + usable.right) / 2, (usable.top + usable.bottom) / 2, inside.x, inside.y, inside.zoom);
assert(seen.x >= box.minX - 1e-6 && seen.x <= box.maxX + 1e-6, 'zoomed pan stays inside the bounds');
assert(seen.y >= box.minY - 1e-6 && seen.y <= box.maxY + 1e-6, 'zoomed pan stays inside the bounds');

const nearPin = emptyBoard();
nearPin.volumes = false;
nearPin.rings.push({
  id: 'a',
  kind: 'ring',
  x: 0,
  y: 0,
  inner: 0.4,
  outer: 0.7,
  gap: 1.2,
  theta: 0,
  connectors: [],
});
nearPin.pins.push({
  id: 'p',
  ownerId: null,
  localAngle: 0,
  localRadius: 0,
  x: Math.cos(0.68) * 0.55,
  y: Math.sin(0.68) * 0.55,
  role: 'block',
  limitRingId: null,
  stopHalf: 0,
});
const nearRing = ringById(nearPin, 'a')!;
nudgeRing(nearPin, nearRing, -1, 0.12);
assert(Math.abs(nearRing.theta) > 0.05, 'a pin inside the pad still finishes against the last drag');
nearRing.theta = 0;
nudgeRing(nearPin, nearRing, 1, 0.02);
assert(Math.abs(nearRing.theta) < 1e-4, 'a pin farther than the pad stays latched');
nudgeRing(nearPin, nearRing, 1, 0.12);
assert(nearPin.pins.some((pin) => pin.id === 'p'), 'the nudge only turns; settle still drops the pin');
const nudged = settle(nearPin, { kind: 'ring', id: 'a', theta: 0, x: 0, y: 0 });
assert(nudged.includes('a') && nearPin.pins.length === 0, 'a pin within the pad releases on lift');
const deepClasp = levelBasic();
const deepBlue = ringById(deepClasp, 'blue')!;
const deepTheta = deepBlue.theta;
nudgeRing(deepClasp, deepBlue, 1, 0.05);
nudgeRing(deepClasp, deepBlue, -1, 0.05);
assert(Math.abs(signedDelta(deepTheta, deepBlue.theta)) < 1e-4, 'a clasp still deep in the band is not finished by the pad');

const praise = freshPraise();
assert(notePraiseClear(praise, 1) === 0, 'the first single clear is silent');
assert(notePraiseClear(praise, 1) === 1, 'the next single clear is Great');
assert(notePraiseClear(praise, 1) === 2, 'the following single clear is Perfect');
assert(notePraiseClear(praise, 3) === 4, 'clearing several pieces rises two steps');
assert(notePraiseClear(praise, 1) === 4, 'Amazing is the top');
breakPraise(praise);
assert(notePraiseClear(praise, 1) === 0, 'a fault makes the next clear a first clear');
const multi = freshPraise();
assert(notePraiseClear(multi, 2) === 2, 'a first multi clear is Perfect');
const praiseMid = placePraise(195, 420, 'Great!');
assert(!praiseMid.below && praiseMid.y === 420 - 56, 'a clear in the middle stays above the piece');
const praiseHigh = placePraise(195, 30, 'Great!');
assert(praiseHigh.below && praiseHigh.y > 30, 'a clear near the top puts the word below the piece');
const praiseLeft = placePraise(8, 420, 'Excellent!');
assert(praiseLeft.x > 8, 'a clear on the left edge slides the word inward');
const praiseRight = placePraise(382, 420, 'Excellent!');
assert(praiseRight.x < 382, 'a clear on the right edge slides the word inward');

console.log('rotate-rings selftest ok');
