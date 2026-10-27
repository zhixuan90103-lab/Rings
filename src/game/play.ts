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
import {
  beginDrag,
  cancelDrag,
  dragTo,
  pick,
  ringById,
  settle,
  syncPins,
  barById,
  type Board,
  type Drag,
} from './board';
import { fallFromBar, fallFromRing, stepFalls, type FallBody } from './fall';
import { LEVELS } from './levels';
import { TAU } from './angle';

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

class ArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly radius: number,
    private readonly a0: number,
    private readonly length: number,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = this.a0 + this.length * t;
    return target.set(Math.cos(a) * this.radius, Math.sin(a) * this.radius, 0);
  }
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

function makeRingMesh(inner: number, outer: number, gap: number, color: number): THREE.Group {
  const mid = (inner + outer) / 2;
  const tube = (outer - inner) / 2;
  const open = Math.min(Math.max(gap, 0), TAU - 0.05);
  const material = plastic(color);
  const group = new THREE.Group();
  const endA = open / 2;
  const endB = open / 2 + (TAU - open);
  const arcLength = TAU - open;
  const shell = new THREE.Mesh(
    new THREE.TubeGeometry(new ArcCurve(mid, endA, arcLength), 96, tube, 24, false),
    material,
  );
  shell.userData.layer = 'arc';
  group.add(shell);
  // Same radius as the tube, centered on the end, so the cap finishes the candy
  // rod instead of sitting outside it as a separate knob.
  for (const angle of [endA, endB]) {
    const joint = new THREE.Mesh(new THREE.SphereGeometry(tube, 24, 16), material);
    joint.position.set(Math.cos(angle) * mid, Math.sin(angle) * mid, 0);
    joint.userData.layer = 'joint';
    group.add(joint);
  }
  return group;
}

/** Flat open ring: annular top face, short side wall, like a thick frisbee. */
function makeDiscRing(outer: number, inner: number, gap: number, depth: number, color: number): THREE.Mesh {
  const open = Math.min(Math.max(gap, 0.2), Math.PI);
  const a0 = open / 2;
  const a1 = TAU - open / 2;
  const mid = (outer + inner) / 2;
  const cap = (outer - inner) / 2;
  const bevelSize = cap * 0.5;
  const outerIn = outer - bevelSize;
  const innerIn = inner + bevelSize;
  const capIn = (outerIn - innerIn) / 2;
  const endCap = (angle: number, fromInner: boolean) => {
    const cx = Math.cos(angle) * mid;
    const cy = Math.sin(angle) * mid;
    const start = fromInner ? angle + Math.PI : angle;
    shape.absarc(cx, cy, capIn, start, start + Math.PI, false);
  };
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerIn, a0, a1, false);
  endCap(a1, false);
  shape.absarc(0, 0, innerIn, a1, a0, true);
  endCap(a0, true);
  const bevelThickness = depth * 0.48;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 8,
    curveSegments: 48,
  });
  geometry.translate(0, 0, -(depth + bevelThickness * 2) / 2);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, plastic(color));
}

/** Flat bar: stadium top face, same bevel as the disc ring. Length includes the round ends. */
function makeDiscBar(
  length: number,
  width: number,
  depth: number,
  material: THREE.Material,
  ends: 'round' | 'straight' = 'round',
  bevel = true,
): THREE.Mesh {
  const radius = width / 2;
  if (ends === 'straight') {
    const radiusCorner = Math.min(width * 0.28, depth * 0.45);
    const shape = new THREE.Shape();
    const x = -width / 2;
    const y = -depth / 2;
    const w = width;
    const h = depth;
    const r = radiusCorner;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(x + w, y + h - r);
    shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    shape.lineTo(x + r, y + h);
    shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(x, y + r);
    shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: length,
      bevelEnabled: false,
      curveSegments: 8,
    });
    geometry.translate(0, 0, -length / 2);
    geometry.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
  }
  const bevelSize = bevel ? radius * 0.5 : 0;
  const lengthIn = Math.max(0.02, length - bevelSize * 2);
  const widthIn = Math.max(0.02, width - bevelSize * 2);
  const radiusIn = widthIn / 2;
  const shape = new THREE.Shape();
  const straight = Math.max(0.001, lengthIn - widthIn);
  shape.moveTo(-straight / 2, -radiusIn);
  shape.lineTo(straight / 2, -radiusIn);
  shape.absarc(straight / 2, 0, radiusIn, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-straight / 2, radiusIn);
  shape.absarc(-straight / 2, 0, radiusIn, Math.PI / 2, Math.PI * 1.5, false);
  const bevelThickness = bevel ? depth * 0.48 : 0;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel,
    bevelThickness,
    bevelSize,
    bevelSegments: 8,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -(depth + bevelThickness * 2) / 2);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function fakeShadow(length: number, width: number, x: number, y: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.shadowColor = 'rgba(70, 52, 36, 0.45)';
  ctx.shadowBlur = 7;
  ctx.fillStyle = 'rgba(70, 52, 36, 0.38)';
  ctx.beginPath();
  ctx.roundRect(28, 36, 72, 56, 12);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(length * 2.15, width * 2.35),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.position.set(x, y, -0.4);
  mesh.userData.fakeShadow = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function makeBarMesh(grip: number, half: number, color: number): THREE.Mesh {
  const length = Math.max(half * 2.4, grip * 2);
  const shaft = Math.max(0.02, length - half * 2);
  const geometry = new THREE.CapsuleGeometry(half, shaft, 8, 20);
  geometry.rotateZ(Math.PI / 2);
  return new THREE.Mesh(geometry, plastic(color));
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

  const groundY = -viewSize().h / 2 + 0.35;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(viewSize().w + 2, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xf6ead8, roughness: 1 }),
  );
  ground.position.set(0, groundY - 0.35, -0.2);
  scene.add(ground);

  let board: Board = LEVELS[0].make();
  let levelIndex = 0;
  let views: PieceView[] = [];
  let markers: THREE.Object3D[] = [];
  let drag: Drag | null = null;
  let pointerId: number | null = null;
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
      disposeObject(view.mesh);
      root.remove(view.mesh);
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
    // Proportion sheet only. Level pieces stay in the rules, but are not drawn.
    // Measured from the reference cluster: tube thickness ≈ 17% of the outer
    // diameter, gap ≈ 100°, bar length ≈ one outer diameter and thinner than
    // the tube, sleeve ≈ a quarter of the bar.
    showSpecimens();
    onStatus('基础件');
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
  }

  function worldFromEvent(event: PointerEvent): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const dx = ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH;
    const dy = ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT;
    if (!isInDesignBounds(dx, dy)) return null;
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
    return pick(board, world.x, world.y);
  }

  function onPointerDown(event: PointerEvent): void {
    if (pointerId !== null) return;
    const world = worldFromEvent(event);
    if (!world) return;
    const hit = pickByRay(world);
    if (!hit) return;
    const next = beginDrag(board, hit, world.x, world.y);
    if (!next) return;
    drag = next;
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId || !drag) return;
    const world = worldFromEvent(event);
    if (!world) return;
    dragTo(board, drag, world.x, world.y);
    syncMeshes();
  }

  function finishPointer(event: PointerEvent, cancel: boolean): void {
    if (event.pointerId !== pointerId || !drag) return;
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
    pointerId = null;
    syncMeshes();
  }

  function showSpecimens(): void {
    const outer = 0.72;
    const band = outer * 0.28;
    const ring = makeDiscRing(outer, outer - band, 1.75, 0.18, colorOf('blue'));
    ring.scale.setScalar(0.9);
    ring.position.set(0, 1.25, 0);
    ring.rotation.z = Math.PI / 2;
    root.add(ring);
    views.push({ id: 'specimen-ring', kind: 'ring', mesh: ring, falling: false });

    const joined = new THREE.Group();
    const joinedRing = makeDiscRing(outer, outer - band, 1.75, 0.18, colorOf('green'));
    joinedRing.position.z = 0.04;
    joined.add(joinedRing);
    const depth = 0.18;
    const green = plastic(colorOf('green'));
    const handleLen = band * 2.5 * (2 / 3);
    const handle = makeDiscBar(handleLen, band * 0.88, depth, green, 'straight', false);
    const handleX = -outer - handleLen * 0.5 + band * 0.2;
    handle.position.set(handleX, 0, 0);
    joined.add(handle);
    const claspLen = band * 2.1 * (5 / 6);
    const claspW = band * 1.4;
    const claspX = handleX - handleLen * 0.5;
    const clasp = makeDiscBar(claspLen, claspW, depth, green, 'straight', false);
    clasp.rotation.z = Math.PI / 2;
    clasp.position.set(claspX, 0, 0.08);
    joined.add(clasp);
    joined.scale.setScalar(0.9);
    joined.rotation.z = Math.PI / 2;
    joined.position.set(0, -0.15, 0);
    root.add(joined);
    views.push({ id: 'specimen-ring-joint', kind: 'ring', mesh: joinedRing, falling: false });

    const barLength = outer * 2 * ring.scale.x;
    const barWidth = band * ring.scale.x;
    const barDepth = 0.18 * ring.scale.x;
    const bar = makeDiscBar(barLength * 1.5, barWidth, barDepth, plastic(colorOf('red')));
    const sleeveLen = barLength * 0.32 * (2 / 3);
    const sleeveW = barWidth * 1.3;
    const metal = new THREE.MeshStandardMaterial({ color: 0xc8c7c5, metalness: 0.04, roughness: 0.38 });
    const sleeve = makeDiscBar(sleeveLen, sleeveW, barDepth * 1.2, metal, 'straight', false);
    sleeve.position.z = 0.03;
    const gripSpan = sleeveLen * 0.62 * 0.7;
    const gripStick = barWidth * 0.48 * 0.7;
    const stick = new THREE.Group();
    stick.add(bar);
    stick.add(sleeve);
    for (const side of [-1, 1]) {
      const grip = makeDiscBar(gripSpan, gripStick, barDepth * 1.2, metal, 'straight', false);
      grip.position.set(0, side * (sleeveW / 2 + gripStick / 2), 0.03);
      stick.add(grip);
      stick.add(fakeShadow(gripSpan, gripStick, grip.position.x + 0.016, grip.position.y - 0.014));
    }
    stick.add(fakeShadow(sleeveLen, sleeveW, 0.016, -0.014));
    stick.position.set(0, -1.7, 0);
    root.add(stick);
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !obj.userData.fakeShadow) obj.castShadow = true;
    });
    sleeve.castShadow = false;
    stick.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material === metal) obj.castShadow = false;
    });
    views.push({ id: 'specimen-bar', kind: 'bar', mesh: bar, falling: false });
    markers.push(sleeve);
  }

  function placeJoints(): void {
    for (const pin of board.pins) {
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

  function buildMarkersOnly(): void {
    for (const marker of markers) {
      disposeObject(marker);
      root.remove(marker);
    }
    markers = [];
    syncPins(board);
    placeJoints();
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
    stepFalls(falls, obstacles, groundY, dt);
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
    pointerId = null;
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
      scene.remove(ground);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
    },
  };
}

