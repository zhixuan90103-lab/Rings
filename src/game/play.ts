/**
 * Board on the XY plane. Orthographic camera looks along −Z.
 * Angle 0 is +X, counterclockwise, and mesh.rotation.z is that same θ.
 * Pieces match the reference: round tube rings, capsule bars, metal sleeves.
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  isInDesignBounds,
  type StageLayout,
} from '../adapt/design';
import { PART, barWithBuckle, discRing, ringWithConnectors } from './parts';
import {
  beginDrag,
  cancelDrag,
  dragTo,
  moveBar,
  nudgeRing,
  ringById,
  settle,
  syncPins,
  barById,
  type Board,
  type Drag,
} from './board';
import { signedDelta } from './angle';
import { disposeShatter, releaseBar, releaseBuckle, releaseRing, SHATTER, stepShatters, type Shatter } from './shatter';
import { LEVELS } from './levels';
import level1 from '../../public/levels/1.json';
import { dragEffect, mountFeedback } from './feedback';
import { breakPraise, freshPraise, notePraiseClear, showPraise, type PraiseCombo } from './praise';
import { strikePoint } from './volume';
import { pulseHaptic } from './hapticFeel';
import {
  INTENT_CLEAR,
  INTENT_PAD,
  INTENT_SLEEVE,
  INTENT_WINDOW,
  chooseIntent,
  intentWorld,
  listCandidates,
  sleeveGap,
  type IntentHit,
} from './intent';
import {
  boardBounds,
  cameraForFit,
  beginTwoFinger,
  clampCamera,
  editorFrame,
  editorZoom,
  editorZoomT,
  largestRing,
  stepTwoFinger,
  zoomCap,
  type TwoFinger,
  FRAME_MARGIN,
  frameFor,
  designFromWorld,
  viewSize,
  worldFromDesign,
  type Aabb,
  type Frame,
  type UsableRect,
} from './camera';

export type PlayHandles = {
  resize: () => void;
  dispose: () => void;
  load: (index: number) => void;
  replace: (next: Board) => void;
  pose: (next: Board) => void;
  copy: () => Board;
  setEditing: (on: boolean) => void;
  pointerWorld: (event: PointerEvent, clampToDesign: boolean) => { x: number; y: number } | null;
  pickAt: (world: { x: number; y: number }) => { kind: 'ring'; id: string } | { kind: 'bar'; id: string } | null;
  select: (id: string | null) => void;
  frame: () => void;
  zoomT: () => number;
  setZoomT: (t: number) => void;
  panT: () => number;
  setPanT: (t: number) => void;
};

type PieceView = {
  id: string;
  kind: 'ring' | 'bar';
  mesh: THREE.Object3D;
  falling: boolean;
};



function plastic(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02 });
}

function colorOf(id: string): number {
  if (id.includes('green')) return 0x3dcc73;
  if (id.includes('orange')) return 0xff8a2a;
  if (id.includes('purple')) return 0xa86bff;
  if (id.includes('red')) return 0xff564c;
  return 0x3aa8ff;
}

/** Silver sleeve around a bar. CylinderGeometry points along +Y before the Z spin. */
function jointMesh(role: 'block' | 'stop', half: number, grip: number): THREE.Object3D {
  if (role === 'stop') {
    return new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 8), plastic(0xf87171));
  }
  const radius = half * 1.38;
  const sleeveLength = Math.max(half * 1.15, grip * 0.2);
  const metal = new THREE.MeshStandardMaterial({ color: 0xe7edf2, metalness: 0.55, roughness: 0.34 });
  const shaft = Math.max(0.02, sleeveLength - radius * 2);
  const geometry = new THREE.CapsuleGeometry(radius, shaft, 8, 20);
  geometry.rotateZ(Math.PI / 2);
  return new THREE.Mesh(geometry, metal);
}

function disposeObject(object: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const list = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of list) materials.add(material);
    }
  });
  for (const material of materials) material.dispose();
}

export function mountPlay(options: {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  canvas: HTMLCanvasElement;
  getLayout: () => StageLayout | null;
  onStatus: (text: string) => void;
  onScore?: (points: number) => void;
  onRelease: () => void;
  onCleared?: () => void;
}): PlayHandles {
  const { scene, camera, canvas, onStatus, onScore, onRelease, onCleared } = options;
  const root = new THREE.Group();
  scene.add(root);

  let board: Board = LEVELS[0].make();
  let levelIndex = 0;
  let editing = false;
  let views: PieceView[] = [];
  let markers: THREE.Object3D[] = [];
  let shatters: Shatter[] = [];
  let feltInvalid = false;
  let drag: Drag | null = null;
  let dragMoved = false;
  let nudgeSign = 0;
  let nudgeBroken = false;
  let frameApplied = 0;
  let pending: { hits: IntentHit[]; x0: number; y0: number; dx: number; dy: number; samples: { x: number; y: number }[] } | null = null;
  let pointerId: number | null = null;
  const fingers = new Map<number, { dx: number; dy: number }>();
  let pinch: TwoFinger | null = null;
  let hold = false;
  let fitted = true;
  let panT = 0.5;
  let awaitingNext = false;
  const praise: PraiseCombo = freshPraise();
  let clearLeft = 0;
  let bounds: Aabb = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let limits: Frame = frameFor(bounds, { left: FRAME_MARGIN, top: FRAME_MARGIN, right: DESIGN_WIDTH - FRAME_MARGIN, bottom: DESIGN_HEIGHT - FRAME_MARGIN });
  let chromeKey = '';
  const feedback = mountFeedback(root);

  let last = performance.now();

  const raycaster = new THREE.Raycaster();
  let selectedId: string | null = null;
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0x2a2118, side: THREE.DoubleSide, depthTest: false }),
  );
  halo.visible = false;
  halo.renderOrder = 8;
  root.add(halo);

  function placeHalo(): void {
    if (!editing || !selectedId) {
      halo.visible = false;
      return;
    }
    const ring = ringById(board, selectedId);
    if (ring) {
      halo.visible = true;
      halo.position.set(ring.x, ring.y, 0.42);
      halo.rotation.z = 0;
      const radius = ring.outer + 0.07;
      halo.scale.set(radius, radius, 1);
      return;
    }
    const bar = barById(board, selectedId);
    if (!bar) {
      halo.visible = false;
      return;
    }
    halo.visible = true;
    halo.position.set(
      bar.x0 + (bar.x1 - bar.x0) * bar.t,
      bar.y0 + (bar.y1 - bar.y0) * bar.t,
      0.5,
    );
    halo.rotation.z = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
    halo.scale.set(bar.grip + 0.12, bar.half + 0.1, 1);
  }

  function praiseAt(x: number, y: number, cleared: number): void {
    const design = designFromWorld(x, y, camera.position.x, camera.position.y, camera.zoom);
    showPraise(design.x, design.y, cleared);
  }

  function designToWorld(dx: number, dy: number): { x: number; y: number } {
    return worldFromDesign(dx, dy, camera.position.x, camera.position.y, camera.zoom);
  }

  function applyCamera(x: number, y: number, zoom: number): void {
    camera.position.set(x, y, 12);
    camera.zoom = zoom;
    camera.lookAt(x, y, 0);
    camera.updateProjectionMatrix();
  }

  function usableRect(): UsableRect {
    const stage = canvas.parentElement;
    const stageRect = stage?.getBoundingClientRect();
    let top = FRAME_MARGIN;
    let bottom = DESIGN_HEIGHT - FRAME_MARGIN;
    const left = FRAME_MARGIN;
    const right = DESIGN_WIDTH - FRAME_MARGIN;
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return { left, top, right, bottom };
    }
    const designY = (clientY: number) => ((clientY - stageRect.top) / stageRect.height) * DESIGN_HEIGHT;
    const header = document.querySelector('#ui-root header');
    const dock = document.querySelector('#dock');
    if (header) top = Math.max(top, designY(header.getBoundingClientRect().bottom) + FRAME_MARGIN);
    if (dock) {
      const dockRect = dock.getBoundingClientRect();
      if (dockRect.height > 0) bottom = Math.min(bottom, designY(dockRect.top) - FRAME_MARGIN);
    }
    if (bottom - top < 80) return { left, top: FRAME_MARGIN, right, bottom: DESIGN_HEIGHT - FRAME_MARGIN };
    return { left, top, right, bottom };
  }

  function refreshLimits(refit: boolean): void {
    const usable = usableRect();
    limits = frameFor(bounds, usable);
    const reference = level1 as Board;
    const referenceBounds = boardBounds(reference);
    const referenceZoom = frameFor(referenceBounds, usable).minZoom;
    limits.maxZoom = zoomCap(largestRing(board), limits.minZoom, largestRing(reference), referenceZoom);
    if (refit) {
      panT = 0.5;
      const fit = cameraForFit(bounds, limits);
      applyCamera(fit.x, fit.y, fit.zoom);
      fitted = true;
      return;
    }
    if (editing) return;
    const next = clampCamera(camera.position.x, camera.position.y, camera.zoom, bounds, limits);
    applyCamera(next.x, next.y, next.zoom);
  }

  function resize(): void {
    const { w, h } = viewSize();
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    refreshLimits(fitted);
    chromeKey = chromeStamp();
  }

  function chromeStamp(): string {
    const rect = usableRect();
    return `${Math.round(rect.top)}:${Math.round(rect.bottom)}`;
  }

  function clearViews(): void {
    for (const view of views) {
      const node = view.mesh.parent && view.mesh.parent !== root ? view.mesh.parent : view.mesh;
      disposeObject(node);
      root.remove(node);
    }
    for (const marker of markers) {
      disposeObject(marker);
      root.remove(marker);
    }
    views = [];
    markers = [];
    for (const shatter of shatters) disposeShatter(shatter);
    shatters = [];
  }

  function addMarker(mesh: THREE.Object3D, x: number, y: number, pinId?: string): void {
    mesh.position.set(x, y, 0.2);
    if (pinId) mesh.userData.pinId = pinId;
    root.add(mesh);
    markers.push(mesh);
  }

  function build(): void {
    clearViews();
    syncPins(board);
    showLevel();
    bounds = boardBounds(board);
    placeHalo();
  }

  function syncMeshes(): void {
    for (const view of views) {
      if (view.falling) continue;
      if (view.kind === 'ring') {
        const ring = ringById(board, view.id);
        if (!ring) continue;
        view.mesh.position.set(ring.x, ring.y, 0);
        view.mesh.rotation.z = ring.theta;
      } else {
        const bar = barById(board, view.id);
        if (!bar) continue;
        const x = bar.x0 + (bar.x1 - bar.x0) * bar.t;
        const y = bar.y0 + (bar.y1 - bar.y0) * bar.t;
        view.mesh.position.set(x, y, 0.2);
        view.mesh.rotation.z = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
      }
    }
    for (const marker of markers) {
      const pinId = marker.userData.pinId as string | undefined;
      const pin = board.pins.find((item) => item.id === pinId);
      if (pin) marker.position.set(pin.x, pin.y, 0.2);
      if (!editing) continue;
      const barId = marker.userData.barId as string | undefined;
      const bar = barId ? barById(board, barId) : undefined;
      if (!bar) continue;
      marker.position.set(
        bar.x0 + (bar.x1 - bar.x0) * bar.t,
        bar.y0 + (bar.y1 - bar.y0) * bar.t,
        0.2,
      );
      marker.rotation.z = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
    }
    applyFeedback();
    placeHalo();
  }

  function applyFeedback(): void {
    for (const view of views) {
      if (view.falling) continue;
      const offset = feedback.offset(view.id);
      if (offset === 0) continue;
      if (view.kind === 'ring') {
        view.mesh.rotation.z += offset;
        continue;
      }
      const bar = barById(board, view.id);
      if (!bar) continue;
      view.mesh.position.x += (bar.x1 - bar.x0) * offset;
      view.mesh.position.y += (bar.y1 - bar.y0) * offset;
    }
  }

  function showImpact(kind: 'ring' | 'bar', id: string, sign: number, sparks: boolean): void {
    const view = views.find((item) => item.id === id && !item.falling);
    if (!view) return;
    const ring = ringById(board, id);
    const bar = barById(board, id);
    const color = ring?.color ?? bar?.color ?? colorOf(id);
    feedback.impact(view.mesh, sparks ? strikePoint(board, kind, id, sign) : null, color);
    if (sparks) pulseHaptic('hit');
    else feelInvalid();
  }

  function feelInvalid(): void {
    if (feltInvalid) return;
    feltInvalid = true;
    pulseHaptic('invalid');
  }

  function worldFromEvent(event: PointerEvent, clampToDesign: boolean): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const dx = ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH;
    const dy = ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT;
    if (clampToDesign && !isInDesignBounds(dx, dy)) return null;
    return designToWorld(dx, dy);
  }

  function pickByRay(world: { x: number; y: number }): { kind: 'ring'; id: string } | { kind: 'bar'; id: string } | null {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    raycaster.set(new THREE.Vector3(world.x, world.y, camera.position.z), dir);
    const meshes = views.filter((view) => !view.falling).map((view) => view.mesh);
    const hits = raycaster.intersectObjects(meshes, true);
    if (hits.length > 0) {
      let node: THREE.Object3D | null = hits[0].object;
      while (node && !node.userData.pieceId) node = node.parent;
      const id = node?.userData.pieceId as string | undefined;
      const view = views.find((item) => item.id === id);
      if (view) return view.kind === 'ring' ? { kind: 'ring', id: view.id } : { kind: 'bar', id: view.id };
    }
    return null;
  }

  function noteSlide(delta: number): void {
    if (Math.abs(delta) < 1e-5) return;
    const sign = Math.sign(delta);
    if (nudgeSign === 0) nudgeSign = sign;
    else if (sign !== nudgeSign) nudgeBroken = true;
  }

  function applySample(world: { x: number; y: number }): number {
    if (!drag) return 0;
    const before = dragPose(drag);
    if (drag.kind === 'bar') {
      const bar = barById(board, drag.id);
      if (bar) {
        const dx = bar.x1 - bar.x0;
        const dy = bar.y1 - bar.y0;
        const len2 = dx * dx + dy * dy || 1;
        const t1 = ((world.x - bar.x0) * dx + (world.y - bar.y0) * dy) / len2;
        const t0 = ((drag.x - bar.x0) * dx + (drag.y - bar.y0) * dy) / len2;
        noteSlide(t1 - t0);
      }
    } else {
      const ring = ringById(board, drag.id);
      if (ring) {
        const lever = (ring.inner + ring.outer) / 2;
        const rx = drag.x - ring.x;
        const ry = drag.y - ring.y;
        const lever2 = Math.max(rx * rx + ry * ry, lever * lever);
        noteSlide((rx * (world.y - drag.y) - ry * (world.x - drag.x)) / lever2);
      }
    }
    const rejected = dragTo(board, drag, world.x, world.y);
    const after = dragPose(drag);
    frameApplied = drag.kind === 'ring' ? signedDelta(before, after) : after - before;
    if (Math.abs(frameApplied) >= 1e-4) {
      dragMoved = true;
      if (feedback.holding(drag.id)) feedback.clearPose();
    }
    return rejected;
  }

  function lockPending(event: PointerEvent, decided: boolean): void {
    if (!pending || drag) return;
    const held = pending;
    const last = held.samples[held.samples.length - 1];
    const hit = chooseIntent(
      board,
      held.hits,
      held.x0,
      held.y0,
      last.x,
      last.y,
      decided,
      intentWorld(INTENT_CLEAR, camera.zoom),
    );
    if (!hit) {
      if (!decided) return;
      pending = null;
      pointerId = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      return;
    }
    const next = beginDrag(board, hit, held.x0, held.y0);
    pending = null;
    if (!next) return;
    drag = next;
    feltInvalid = false;
    pulseHaptic('grab');
    nudgeSign = 0;
    nudgeBroken = false;
    dragMoved = false;
    feedback.arm();
    let rejected = 0;
    for (const sample of held.samples.slice(1)) rejected = applySample(sample);
    showDragEffect(rejected);
  }

  function rememberFinger(event: { clientX: number; clientY: number }): { dx: number; dy: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const dx = ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH;
    const dy = ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT;
    return { dx, dy };
  }

  function dropPiece(cancel: boolean): void {
    if (drag && cancel) cancelDrag(board, drag);
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    drag = null;
    dragMoved = false;
    pending = null;
    nudgeSign = 0;
    nudgeBroken = false;
    pointerId = null;
    lastStamp = -1;
    feedback.clearPose();
    syncMeshes();
  }

  function beginPinch(): void {
    const pts = [...fingers.values()];
    if (pts.length !== 2) return;
    const midX = (pts[0].dx + pts[1].dx) / 2;
    const midY = (pts[0].dy + pts[1].dy) / 2;
    const dist = Math.hypot(pts[0].dx - pts[1].dx, pts[0].dy - pts[1].dy);
    pinch = beginTwoFinger(camera.position.x, camera.position.y, camera.zoom, midX, midY, dist);
  }

  function applyPinch(): void {
    if (!pinch) return;
    const pts = [...fingers.values()];
    if (pts.length !== 2) return;
    const dist = Math.hypot(pts[0].dx - pts[1].dx, pts[0].dy - pts[1].dy);
    const midX = (pts[0].dx + pts[1].dx) / 2;
    const midY = (pts[0].dy + pts[1].dy) / 2;
    const step = stepTwoFinger(pinch, midX, midY, dist, camera.position.x, camera.position.y, camera.zoom, bounds, limits);
    pinch = step.gesture;
    if (!step.camera) return;
    applyCamera(step.camera.x, step.camera.y, step.camera.zoom);
    fitted = false;
  }

  function onPointerDown(event: PointerEvent): void {
    if (editing) return;
    const point = rememberFinger(event);
    if (!point || !isInDesignBounds(point.dx, point.dy)) return;
    fingers.set(event.pointerId, point);
    if (fingers.size > 2) {
      dropPiece(true);
      pinch = null;
      hold = true;
      return;
    }
    if (fingers.size === 2) {
      dropPiece(true);
      hold = true;
      beginPinch();
      return;
    }
    if (hold || pointerId !== null) return;
    const world = designToWorld(point.dx, point.dy);
    const ray = pickByRay(world);
    const hits = listCandidates(board, world.x, world.y, intentWorld(INTENT_PAD, camera.zoom), ray ? [ray.id] : []);
    if (hits.length === 0) return;
    pending = { hits, x0: world.x, y0: world.y, dx: point.dx, dy: point.dy, samples: [{ x: world.x, y: world.y }] };
    pointerId = event.pointerId;
    lastStamp = event.timeStamp;
    canvas.setPointerCapture(event.pointerId);
    if (chooseIntent(board, hits, world.x, world.y, world.x, world.y, false, intentWorld(INTENT_CLEAR, camera.zoom))) {
      lockPending(event, true);
    }
  }

  function dragPose(current: Drag): number {
    if (current.kind === 'ring') return ringById(board, current.id)?.theta ?? 0;
    return barById(board, current.id)?.t ?? 0;
  }

  let lastStamp = -1;

  function pointerPoints(event: PointerEvent): PointerEvent[] {
    const list = event.getCoalescedEvents?.() ?? [];
    const events = list.length > 0 ? [...list] : [event];
    const last = events[events.length - 1];
    if (list.length > 0 && (!last || event.timeStamp > last.timeStamp)) events.push(event);
    const fresh: PointerEvent[] = [];
    for (const point of events) {
      if (point.timeStamp <= lastStamp) continue;
      lastStamp = point.timeStamp;
      fresh.push(point);
    }
    return fresh.length > 0 ? fresh : [event];
  }

  function onPointerMove(event: PointerEvent): void {
    if (fingers.has(event.pointerId)) {
      const point = rememberFinger(event);
      if (point) fingers.set(event.pointerId, point);
      if (pinch) {
        applyPinch();
        return;
      }
    }
    if (hold || event.pointerId !== pointerId) return;
    const points = pointerPoints(event);
    if (pending) {
      for (const point of points) {
        const world = worldFromEvent(point, false);
        if (world) pending.samples.push(world);
      }
      const finger = rememberFinger(event);
      const travel = finger ? Math.hypot(finger.dx - pending.dx, finger.dy - pending.dy) : 0;
      lockPending(event, travel >= INTENT_WINDOW * DESIGN_WIDTH);
      return;
    }
    if (!drag) return;
    let rejected = 0;
    let applied = 0;
    let saw = false;
    for (const point of points) {
      const world = worldFromEvent(point, false);
      if (!world) continue;
      if (drag.kind === 'ring' && feedback.holding(drag.id)) {
        const ring = ringById(board, drag.id);
        const latched = feedback.holdSign(drag.id);
        if (ring && latched !== 0) {
          const lever = Math.max((ring.inner + ring.outer) / 2, 1e-4);
          const rx = drag.x - ring.x;
          const ry = drag.y - ring.y;
          const lever2 = Math.max(rx * rx + ry * ry, lever * lever);
          const requested = (rx * (world.y - drag.y) - ry * (world.x - drag.x)) / lever2;
          const back = intentWorld(INTENT_WINDOW, camera.zoom) / lever;
          if (Math.sign(requested) === Math.sign(latched) || Math.abs(requested) < back) continue;
        }
      }
      rejected = applySample(world);
      applied += frameApplied;
      saw = true;
    }
    if (!saw) return;
    frameApplied = applied;
    showDragEffect(rejected);
  }

  function showDragEffect(rejected: number): void {
    if (!drag) return;
    const effect = dragEffect({
      kind: drag.kind,
      moved: dragMoved,
      applied: frameApplied,
      rejected,
      armed: feedback.state.armed,
      free: feedback.state.free,
    });
    const blocked = effect.type === 'hit' || effect.type === 'hold' || effect.type === 'stop';
    if (effect.type === 'hit' || effect.type === 'stop') breakPraise(praise);
    if (blocked && (effect.type === 'hit' || feedback.state.armed)) {
      feedback.state.armed = false;
      feedback.state.free = 0;
      showImpact(drag.kind, drag.id, effect.type === 'hit' ? effect.sign : Math.sign(rejected) || 1, effect.type === 'hit');
    }
    if (effect.type === 'free') {
      feedback.state.armed = effect.armed;
      feedback.state.free = effect.free;
    } else if (effect.type === 'hold') {
      feedback.holdRing(drag.id, rejected);
    } else if (effect.type === 'stop') {
      const bar = barById(board, drag.id);
      const length = bar ? Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) : 1;
      feedback.stopBar(drag.id, rejected, length);
    }
    syncMeshes();
  }

  function finishPointer(event: PointerEvent, cancel: boolean): void {
    if (event.pointerId !== pointerId) return;
    if (pending) lockPending(event, true);
    if (!drag) return;
    const clicked = drag;
    const moved = dragMoved;
    if (cancel) cancelDrag(board, drag);
    else {
      if (drag.kind === 'bar') {
        if (!nudgeBroken && nudgeSign !== 0) {
          const bar = barById(board, drag.id);
          const gap = bar ? sleeveGap(board, bar, nudgeSign) : null;
          const pad = intentWorld(INTENT_SLEEVE, camera.zoom);
          if (bar && gap !== null && gap <= pad) {
            const rail = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) || 1;
            moveBar(board, bar, bar.t + (nudgeSign * (gap + 1e-3)) / rail);
          }
        }
      } else {
        const ring = ringById(board, drag.id);
        if (ring) nudgeRing(board, ring, nudgeSign, intentWorld(INTENT_SLEEVE, camera.zoom));
      }
      const snapshotRings = board.rings.map((ring) => ({ ...ring }));
      const snapshotBars = board.bars.map((bar) => ({ ...bar }));
      const left = settle(board, drag);
      let scored = 0;
      for (const id of left) {
        const ring = snapshotRings.find((item) => item.id === id);
        const bar = snapshotBars.find((item) => item.id === id);
        const view = views.find((item) => item.id === id);
        if (!view) continue;
        view.falling = true;
        view.mesh.visible = false;
        if (ring) {
          scored += 100;
          const chips = releaseRing(root, ring, ring.color ?? colorOf(ring.id));
          if (chips) shatters.push(chips);
        } else if (bar) {
          const chips = releaseBar(root, bar, bar.color ?? colorOf(bar.id));
          if (chips) shatters.push(chips);
          const rivet = markers.find((marker) => marker.userData.barId === id);
          if (rivet) {
            const metal = releaseBuckle(root, bar.half * 2, {
              x: rivet.position.x,
              y: rivet.position.y,
              angle: rivet.rotation.z,
            });
            if (metal) shatters.push(metal);
          }
        }
      }
      buildMarkersOnly();
      if (left.length > 0) {
        const targetId = left.includes(drag.id) ? drag.id : left[0];
        const ring = snapshotRings.find((item) => item.id === targetId);
        const bar = snapshotBars.find((item) => item.id === targetId);
        const show = notePraiseClear(praise, left.length);
        if (show > 0) {
          if (ring) praiseAt(ring.x, ring.y, show);
          else if (bar) {
            praiseAt(
              bar.x0 + (bar.x1 - bar.x0) * bar.t,
              bar.y0 + (bar.y1 - bar.y0) * bar.t,
              show,
            );
          }
        }
      }
      if (scored > 0) onScore?.(scored);
      if (left.length > 0) {
        pulseHaptic('clear');
        onRelease();
      }
      if (board.rings.length === 0 && board.bars.length === 0) awaitingNext = true;
    }
    drag = null;
    dragMoved = false;
    pending = null;
    nudgeSign = 0;
    nudgeBroken = false;
    pointerId = null;
    const stayed = views.some((view) => view.id === clicked.id && !view.falling);
    const held = feedback.holding(clicked.id);
    if (cancel || !stayed) feedback.clearPose();
    else if (held) feedback.releaseHold();
    else if (!moved) {
      const bar = barById(board, clicked.id);
      const length = bar ? Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) : 1;
      feedback.click(clicked.id, clicked.kind, length);
      feelInvalid();
    } else feedback.clearPose();
    syncMeshes();
  }

  function showLevel(): void {
    const { outer, depth, scale } = PART;
    for (const ring of board.rings) {
      const ringOuter = ring.outer;
      const ringBand = ringOuter * PART.bandRatio;
      const ringDepth = depth * (ringOuter / (outer * scale));
      const tint = ring.color ?? colorOf(ring.id);
      const mesh = ring.connectors.length > 0
        ? ringWithConnectors(ringOuter, ringBand, ring.gap, ringDepth, tint, ring.connectors)
        : discRing(ringOuter, ringBand, ring.gap, ringDepth, tint);
      mesh.position.set(ring.x, ring.y, 0);
      mesh.rotation.z = ring.theta;
      mesh.userData.pieceId = ring.id;
      root.add(mesh);
      views.push({ id: ring.id, kind: 'ring', mesh, falling: false });
    }
    for (const bar of board.bars) {
      const basis = outer * 2 * scale;
      const stick = barWithBuckle(bar.grip * 2, basis, bar.half * 2, depth * scale, bar.color ?? colorOf(bar.id));
      const capsule = stick.children[0];
      capsule.userData.pieceId = bar.id;
      const x = bar.x0 + (bar.x1 - bar.x0) * bar.t;
      const y = bar.y0 + (bar.y1 - bar.y0) * bar.t;
      capsule.position.set(x, y, 0.2);
      capsule.rotation.z = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
      root.add(capsule);
      views.push({ id: bar.id, kind: 'bar', mesh: capsule, falling: false });
      const buckle = new THREE.Group();
      for (const child of [...stick.children]) buckle.add(child);
      const latch = board.latches.find((item) => item.barId === bar.id && item.release === 'sleeve');
      buckle.position.set(latch?.x ?? x, latch?.y ?? y, 0.2);
      buckle.rotation.z = capsule.rotation.z;
      buckle.userData.barId = bar.id;
      root.add(buckle);
      markers.push(buckle);
    }
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !obj.userData.fakeShadow && !obj.userData.noShadow) obj.castShadow = true;
    });
  }

  function buildMarkersOnly(): void {
    for (const marker of markers) {
      disposeObject(marker);
      root.remove(marker);
    }
    markers = [];
    syncPins(board);
    const { outer, depth, scale } = PART;
    const basis = outer * 2 * scale;
    for (const latch of board.latches) {
      if (latch.release !== 'sleeve') continue;
      const bar = barById(board, latch.barId);
      if (!bar) continue;
      const stick = barWithBuckle(bar.grip * 2, basis, bar.half * 2, depth * scale, bar.color ?? colorOf(bar.id));
      stick.remove(stick.children[0]);
      stick.position.set(latch.x, latch.y, 0.2);
      stick.rotation.z = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
      stick.userData.barId = bar.id;
      root.add(stick);
      markers.push(stick);
    }
    for (const pin of board.pins) {
      if (pin.ownerId && ringById(board, pin.ownerId)) continue;
      const bar = pin.ownerId ? barById(board, pin.ownerId) : undefined;
      const marker = jointMesh(
        pin.role === 'stop' && pin.stopHalf > 0.02 ? 'stop' : 'block',
        bar?.half ?? 0.2,
        bar?.grip ?? 0.9,
      );
      if (bar) marker.rotation.z = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
      addMarker(marker, pin.x, pin.y, pin.id);
    }
  }

  function releaseFinger(event: PointerEvent, cancel: boolean): void {
    fingers.delete(event.pointerId);
    if (pinch && fingers.size !== 2) pinch = null;
    if (fingers.size === 0) hold = false;
    else if (pinch === null && fingers.size > 0) hold = true;
    finishPointer(event, cancel);
  }

  function onPointerUp(event: PointerEvent): void {
    releaseFinger(event, false);
  }

  function onPointerCancel(event: PointerEvent): void {
    releaseFinger(event, true);
  }

  function applyEditorView(zoom: number): void {
    const fit = cameraForFit(bounds, limits);
    const frame = editorFrame(fit, zoom, panT, viewSize().h);
    applyCamera(frame.x, frame.y, frame.zoom);
    fitted = false;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  function frame(now: number): void {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const viewBottom = camera.position.y - viewSize().h / 2 / Math.max(camera.zoom, 1e-4);
    stepShatters(shatters, viewBottom - SHATTER.chip, dt);
    shatters = shatters.filter((shatter) => {
      if (!shatter.dead) return true;
      disposeShatter(shatter);
      return false;
    });
    feedback.step(dt);
    const stamp = chromeStamp();
    if (stamp !== chromeKey) {
      chromeKey = stamp;
      refreshLimits(fitted);
    }
    if (drag || feedback.busy()) syncMeshes();
    if (awaitingNext && !editing) {
      clearLeft += dt;
      if (clearLeft >= 1) {
        awaitingNext = false;
        clearLeft = 0;
        onCleared?.();
      }
    } else {
      clearLeft = 0;
    }
  }

  options.renderer.setAnimationLoop(() => {
    frame(performance.now());
    options.renderer.render(scene, camera);
  });

  function load(index: number): void {
    levelIndex = (index + LEVELS.length) % LEVELS.length;
    drag = null;
    dragMoved = false;
    pointerId = null;
    fingers.clear();
    pinch = null;
    hold = false;
    awaitingNext = false;
    clearLeft = 0;
    breakPraise(praise);
    feedback.clear();
    board = LEVELS[levelIndex].make();
    build();
    refreshLimits(true);
    onStatus(LEVELS[levelIndex]?.name ?? '关卡');
  }

  resize();
  load(0);

  function replace(next: Board): void {
    drag = null;
    dragMoved = false;
    pointerId = null;
    feedback.clear();
    board = next;
    fingers.clear();
    pinch = null;
    hold = false;
    awaitingNext = false;
    clearLeft = 0;
    breakPraise(praise);
    build();
    refreshLimits(false);
  }

  function pose(next: Board): void {
    board = next;
    syncPins(board);
    syncMeshes();
  }

  return {
    resize,
    load,
    replace,
    pose,
    copy: () => structuredClone(board),
    setEditing: (on: boolean) => {
      if (on === editing) return;
      editing = on;
      fingers.clear();
      pinch = null;
      hold = false;
      awaitingNext = false;
      clearLeft = 0;
      drag = null;
      dragMoved = false;
        pointerId = null;
      placeHalo();
    },
    frame: () => refreshLimits(true),
    zoomT: () => editorZoomT(limits.minZoom, camera.zoom),
    setZoomT: (t: number) => {
      if (!editing) return;
      applyEditorView(editorZoom(limits.minZoom, t));
    },
    panT: () => panT,
    setPanT: (t: number) => {
      if (!editing) return;
      panT = Math.min(1, Math.max(0, t));
      applyEditorView(camera.zoom);
    },
    pointerWorld: worldFromEvent,
    pickAt: pickByRay,
    select: (id: string | null) => {
      selectedId = id;
      placeHalo();
    },
    dispose: () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      options.renderer.setAnimationLoop(null);
      clearViews();
      scene.remove(root);
    },
  };
}

