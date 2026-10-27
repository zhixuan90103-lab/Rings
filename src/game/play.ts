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
  ringById,
  settle,
  syncPins,
  barById,
  type Board,
  type Drag,
} from './board';
import { signedDelta } from './angle';
import { fallFromBar, fallFromRing, stepFalls, type FallBody } from './fall';
import { LEVELS } from './levels';
import { BAR_RECOIL_WORLD, CLICK_RECOIL_SCALE, RING_RECOIL_MAX, beginRecoil, heldSign, releaseHold, stepRecoil, wobbleOffset, type Recoil } from './recoil';
import { disposeSparkBurst, makeSparkBurst, stepSparkBurst, type SparkBurst } from './sparks';
import { barStrikePoint, ringStrikePoint } from './volume';

const VIEW_H = 10;

export type PlayHandles = {
  resize: () => void;
  dispose: () => void;
  load: (index: number) => void;
};

type PieceView = {
  id: string;
  kind: 'ring' | 'bar';
  mesh: THREE.Object3D;
  falling: boolean;
};

function viewSize(): { w: number; h: number } {
  return { w: VIEW_H * (DESIGN_WIDTH / DESIGN_HEIGHT), h: VIEW_H };
}

function designToWorld(dx: number, dy: number): { x: number; y: number } {
  const { w, h } = viewSize();
  const nx = (dx / DESIGN_WIDTH) * 2 - 1;
  const ny = -((dy / DESIGN_HEIGHT) * 2 - 1);
  return { x: nx * (w / 2), y: ny * (h / 2) };
}

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
  onRelease: () => void;
}): PlayHandles {
  const { scene, camera, canvas, onStatus, onRelease } = options;
  const root = new THREE.Group();
  scene.add(root);

  let board: Board = LEVELS[0].make();
  let levelIndex = 0;
  let views: PieceView[] = [];
  let markers: THREE.Object3D[] = [];
  let drag: Drag | null = null;
  let dragMoved = false;
  let pointerId: number | null = null;
  let recoil: { id: string; kind: 'ring' | 'bar'; body: Recoil } | null = null;
  let sparks: SparkBurst[] = [];
  let glow: { mesh: THREE.Object3D; left: number } | null = null;
  let impactArmed = true;
  let freeSinceImpact = 0;
  let falls: FallBody[] = [];
  let last = performance.now();

  const raycaster = new THREE.Raycaster();

  function resize(): void {
    const { w, h } = viewSize();
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
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
    falls = [];
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
    onStatus(LEVELS[levelIndex]?.name ?? '关卡');
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
    }
    applyRecoil();
  }

  function barRecoilMax(id: string): number {
    const bar = barById(board, id);
    if (!bar) return 0;
    const len = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0);
    return BAR_RECOIL_WORLD / Math.max(len, 1e-4);
  }

  function clearRecoil(): void {
    recoil = null;
  }

  function noteRejected(id: string, kind: 'ring' | 'bar', rejected: number, fromClick = false): void {
    if (Math.abs(rejected) < 1e-4) return;
    if (!fromClick && recoil && recoil.id === id) return;
    const full = kind === 'ring' ? RING_RECOIL_MAX : barRecoilMax(id);
    const max = fromClick ? full * CLICK_RECOIL_SCALE : full;
    const body = beginRecoil(rejected, max);
    if (!body) return;
    recoil = { id, kind, body };
  }

  function ringIsHeld(id: string): boolean {
    return recoil?.id === id && recoil.body.hold === true;
  }

  function holdRing(id: string, rejected: number): void {
    const sign = heldSign(ringIsHeld(id) ? recoil!.body.sign : null, rejected);
    if (sign === null) return;
    if (ringIsHeld(id)) return;
    const body = beginRecoil(sign, RING_RECOIL_MAX, true);
    if (!body) return;
    recoil = { id, kind: 'ring', body };
  }

  function clearSparks(): void {
    for (const burst of sparks) {
      root.remove(burst.root);
      disposeSparkBurst(burst);
    }
    sparks = [];
    if (glow) setGlow(glow.mesh, 0);
    glow = null;
    impactArmed = true;
    freeSinceImpact = 0;
  }

  function setGlow(mesh: THREE.Object3D, intensity: number): void {
    mesh.traverse((node) => {
      const material = (node as THREE.Mesh).material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.setHex(0xffc98a);
        material.emissiveIntensity = intensity;
      }
    });
  }

  function spawnImpact(kind: 'ring' | 'bar', id: string, sign: number): void {
    const view = views.find((item) => item.id === id && !item.falling);
    if (!view) return;
    const ring = kind === 'ring' ? ringById(board, id) : null;
    const bar = kind === 'bar' ? barById(board, id) : null;
    const contact = ring ? ringStrikePoint(board, ring, sign) : bar ? barStrikePoint(board, bar, sign) : null;
    if (contact) {
      const burst = makeSparkBurst(contact.x, contact.y, colorOf(id));
      sparks.push(burst);
      root.add(burst.root);
    }
    if (glow && glow.mesh !== view.mesh) setGlow(glow.mesh, 0);
    setGlow(view.mesh, 0.16);
    glow = { mesh: view.mesh, left: 0.18 };
  }

  function applyRecoil(): void {
    if (!recoil) return;
    const view = views.find((item) => item.id === recoil!.id && !item.falling);
    if (!view) return;
    const offset = wobbleOffset(recoil.body);
    if (view.kind === 'ring') {
      view.mesh.rotation.z += offset;
      return;
    }
    const bar = barById(board, view.id);
    if (!bar) return;
    view.mesh.position.x += (bar.x1 - bar.x0) * offset;
    view.mesh.position.y += (bar.y1 - bar.y0) * offset;
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
    const { w, h } = viewSize();
    const ndc = new THREE.Vector2((world.x / (w / 2)), (world.y / (h / 2)));
    raycaster.setFromCamera(ndc, camera);
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

  function onPointerDown(event: PointerEvent): void {
    if (pointerId !== null) return;
    const world = worldFromEvent(event, true);
    if (!world) return;
    const hit = pickByRay(world);
    if (!hit) return;
    const next = beginDrag(board, hit, world.x, world.y);
    if (!next) return;
    drag = next;
    dragMoved = false;
    impactArmed = true;
    freeSinceImpact = 0;
    clearRecoil();
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
  }

  function dragPose(current: Drag): number {
    if (current.kind === 'ring') return ringById(board, current.id)?.theta ?? 0;
    return barById(board, current.id)?.t ?? 0;
  }

  function stopInvalidDrag(event: PointerEvent): void {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = null;
    dragMoved = false;
    pointerId = null;
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId || !drag) return;
    if (drag.kind === 'ring' && ringIsHeld(drag.id)) {
      syncMeshes();
      return;
    }
    const samples = event.getCoalescedEvents?.() ?? [];
    const events = samples.length > 0 ? samples : [event];
    const before = dragPose(drag);
    let rejected = 0;
    for (const sample of events) {
      const world = worldFromEvent(sample, false);
      if (!world) continue;
      rejected += dragTo(board, drag, world.x, world.y);
    }
    const after = dragPose(drag);
    const applied = drag.kind === 'ring' ? signedDelta(before, after) : after - before;
    if (Math.abs(applied) >= 1e-4) {
      dragMoved = true;
      if (recoil?.id === drag.id) clearRecoil();
    }
    const hitWall = dragMoved && Math.abs(rejected) > 1e-4;
    if (hitWall && impactArmed) {
      impactArmed = false;
      freeSinceImpact = 0;
      spawnImpact(drag.kind, drag.id, Math.sign(rejected) || 1);
    } else if (!hitWall && Math.abs(applied) > 1e-4) {
      freeSinceImpact += Math.abs(applied);
      const rearm = drag.kind === 'ring' ? 0.08 : 0.03;
      if (freeSinceImpact > rearm) impactArmed = true;
    }
    if (!dragMoved && Math.abs(rejected) > 1e-4) {
      if (drag.kind === 'ring') holdRing(drag.id, rejected);
      else {
        noteRejected(drag.id, drag.kind, rejected);
        stopInvalidDrag(event);
      }
      syncMeshes();
      return;
    }
    syncMeshes();
  }

  function finishPointer(event: PointerEvent, cancel: boolean): void {
    if (event.pointerId !== pointerId || !drag) return;
    const clicked = drag;
    const moved = dragMoved;
    if (cancel) cancelDrag(board, drag);
    else {
      const snapshotRings = board.rings.map((ring) => ({ ...ring }));
      const snapshotBars = board.bars.map((bar) => ({ ...bar }));
      const left = settle(board, drag);
      for (const id of left) {
        const ring = snapshotRings.find((item) => item.id === id);
        const bar = snapshotBars.find((item) => item.id === id);
        const view = views.find((item) => item.id === id);
        if (!view) continue;
        view.falling = true;
        if (ring) falls.push(fallFromRing(ring));
        else if (bar) falls.push(fallFromBar(bar));
      }
      buildMarkersOnly();
      if (left.length > 0) onRelease();
    }
    drag = null;
    dragMoved = false;
    pointerId = null;
    const stayed = views.some((view) => view.id === clicked.id && !view.falling);
    const heldBody = recoil?.id === clicked.id && recoil.body.hold ? recoil.body : null;
    if (cancel || !stayed) clearRecoil();
    else if (heldBody) releaseHold(heldBody);
    else if (!moved) noteRejected(clicked.id, clicked.kind, 1, true);
    else clearRecoil();
    syncMeshes();
  }

  function showLevel(): void {
    const { outer, gap, depth, scale } = PART;
    const band = outer * PART.bandRatio;
    for (const ring of board.rings) {
      const mesh = ring.id === 'green'
        ? ringWithConnectors(outer, band, gap, depth, colorOf(ring.id), [Math.PI / 2])
        : discRing(outer, band, gap, depth, colorOf(ring.id));
      mesh.scale.setScalar(scale);
      mesh.position.set(ring.x, ring.y, 0);
      mesh.rotation.z = ring.theta;
      mesh.userData.pieceId = ring.id;
      root.add(mesh);
      views.push({ id: ring.id, kind: 'ring', mesh, falling: false });
    }
    for (const bar of board.bars) {
      const basis = outer * 2 * scale;
      const stick = barWithBuckle(basis * 1.5, basis, band * scale, depth * scale, colorOf(bar.id));
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
      const pin = board.pins.find((item) => item.ownerId === bar.id && item.stopHalf === 0);
      buckle.position.set(pin?.x ?? x, pin?.y ?? y, 0.2);
      buckle.rotation.z = capsule.rotation.z;
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
    const band = outer * PART.bandRatio;
    const basis = outer * 2 * scale;
    for (const pin of board.pins) {
      if (pin.ownerId && ringById(board, pin.ownerId)) continue;
      if (pin.role === 'stop' && pin.stopHalf === 0 && pin.ownerId) {
        const bar = barById(board, pin.ownerId);
        const stick = barWithBuckle(basis * 1.5, basis, band * scale, depth * scale, colorOf(bar?.id ?? 'red'));
        stick.remove(stick.children[0]);
        stick.position.set(pin.x, pin.y, 0.2);
        if (bar) stick.rotation.z = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
        root.add(stick);
        markers.push(stick);
        continue;
      }
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

  function onPointerUp(event: PointerEvent): void {
    finishPointer(event, false);
  }

  function onPointerCancel(event: PointerEvent): void {
    finishPointer(event, true);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  function frame(now: number): void {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const obstacles = board.rings.map((ring) => ({ x: ring.x, y: ring.y, radius: ring.outer }));
    for (const bar of board.bars) {
      const x = bar.x0 + (bar.x1 - bar.x0) * bar.t;
      const y = bar.y0 + (bar.y1 - bar.y0) * bar.t;
      obstacles.push({ x, y, radius: bar.half + 0.12 });
    }
    stepFalls(falls, obstacles, -viewSize().h / 2, dt);
    if (recoil && stepRecoil(recoil.body, dt)) recoil = null;
    if (drag || recoil) syncMeshes();
    if (glow) {
      glow.left -= dt;
      setGlow(glow.mesh, Math.max(0, glow.left / 0.18) * 0.16);
      if (glow.left <= 0) glow = null;
    }
    sparks = sparks.filter((burst) => {
      const done = stepSparkBurst(burst, dt);
      if (!done) return true;
      root.remove(burst.root);
      disposeSparkBurst(burst);
      return false;
    });
    for (const body of falls) {
      const view = views.find((item) => item.id === body.id);
      if (!view) continue;
      view.mesh.position.set(body.x, body.y, 0.1);
      view.mesh.rotation.z = body.theta;
      if (body.dead) view.mesh.visible = false;
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
    clearRecoil();
    clearSparks();
    board = LEVELS[levelIndex].make();
    build();
  }

  resize();
  load(0);

  return {
    resize,
    load,
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

