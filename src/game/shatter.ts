/**
 * Unlock shatter. Numbers are the settled look: sparse rounded chips on the
 * drawn shape, a weak random outward speed, then one falling arc that shrinks.
 * Chips do not touch locked pieces and do not cast shadows.
 */

import * as THREE from 'three';
import type { BarBody, RingBody } from './board';
import { FALL_Z } from './fall';
import { PART, buckleMetrics, connectorLayout } from './parts';

/** Settled shatter. Placement, size, and motion all read from here. */
export const SHATTER = {
  chip: 0.075,
  step: 0.16,
  depth: 0.08,
  bevel: 0.015,
  scaleMin: 0.55,
  scaleSpan: 0.6,
  speedMax: 1.6,
  gravity: -30,
  gravityIn: 0.28,
  shrinkSeconds: 0.55,
  shrinkFloor: 0.12,
  buckle: 0xc8c7c5,
} as const;

export type Shatter = {
  mesh: THREE.InstancedMesh;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  spin: Float32Array;
  pitch: Float32Array;
  roll: Float32Array;
  theta: Float32Array;
  scale: Float32Array;
  count: number;
  age: number;
  dead: boolean;
};

let chipGeometry: THREE.ExtrudeGeometry | null = null;

function sharedChipGeometry(): THREE.ExtrudeGeometry {
  if (chipGeometry) return chipGeometry;
  const half = SHATTER.chip * 0.46;
  const radius = half * 0.42;
  const shape = new THREE.Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.absarc(half - radius, -half + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(half, half - radius);
  shape.absarc(half - radius, half - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-half + radius, half);
  shape.absarc(-half + radius, half - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-half, -half + radius);
  shape.absarc(-half + radius, -half + radius, radius, Math.PI, Math.PI * 1.5, false);
  const depth = SHATTER.depth;
  const bevel = SHATTER.bevel;
  chipGeometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  chipGeometry.translate(0, 0, -(depth + bevel * 2) / 2);
  return chipGeometry;
}

function tile(x0: number, y0: number, x1: number, y1: number, into: { x: number; y: number }[], keep?: (x: number, y: number) => boolean): void {
  const w = Math.max(x1 - x0, SHATTER.step);
  const h = Math.max(y1 - y0, SHATTER.step);
  const nx = Math.max(1, Math.round(w / SHATTER.step));
  const ny = Math.max(1, Math.round(h / SHATTER.step));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = x0 + ((i + 0.5) * w) / nx;
      const y = y0 + ((j + 0.5) * h) / ny;
      if (keep && !keep(x, y)) continue;
      into.push({ x, y });
    }
  }
}

function rotate(x: number, y: number, angle: number, originX: number, originY: number): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: originX + c * x - s * y, y: originY + s * x + c * y };
}

/** Chips in world space covering the ring band, gap caps, stems, and clasps. */
export function ringChipPoints(ring: RingBody): { x: number; y: number }[] {
  const local: { x: number; y: number }[] = [];
  const outer = ring.outer;
  const band = outer * PART.bandRatio;
  const inner = outer - band;
  const open = Math.min(Math.max(ring.gap, 0.2), Math.PI);
  const a0 = open / 2;
  const a1 = Math.PI * 2 - open / 2;
  const radial = Math.max(1, Math.round(band / SHATTER.step));
  for (let k = 0; k < radial; k++) {
    const radius = inner + ((k + 0.5) * band) / radial;
    const span = a1 - a0;
    const count = Math.max(3, Math.round((span * radius) / SHATTER.step));
    for (let i = 0; i < count; i++) {
      const angle = a0 + ((i + 0.5) * span) / count;
      local.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  }
  const mid = (inner + outer) / 2;
  for (const angle of [a0, a1]) local.push({ x: Math.cos(angle) * mid, y: Math.sin(angle) * mid });
  for (const connector of ring.connectors) {
    const layout = connectorLayout(outer, band, connector.stem);
    const stem: { x: number; y: number }[] = [];
    tile(
      layout.stemDist - layout.stemLen / 2,
      -layout.stemW / 2,
      layout.stemDist + layout.stemLen / 2,
      layout.stemW / 2,
      stem,
    );
    const half = layout.claspLen / 2 / Math.max(layout.bend, 1e-4);
    const along = Math.max(1, Math.round(layout.claspLen / SHATTER.step));
    const across = Math.max(1, Math.round(layout.claspW / SHATTER.step));
    for (let i = 0; i < along; i++) {
      const arc = Math.PI / 2 - half + (2 * half * (i + 0.5)) / along;
      for (let j = 0; j < across; j++) {
        const u = -layout.claspW / 2 + ((j + 0.5) * layout.claspW) / across;
        const lx = Math.cos(arc) * (layout.bend + u);
        const ly = -layout.bend + Math.sin(arc) * (layout.bend + u);
        const rot = Math.PI / 2;
        stem.push({
          x: Math.cos(rot) * lx - Math.sin(rot) * ly + layout.claspDist,
          y: Math.sin(rot) * lx + Math.cos(rot) * ly,
        });
      }
    }
    for (const point of stem) local.push(rotate(point.x, point.y, connector.angle, 0, 0));
  }
  return local.map((point) => rotate(point.x, point.y, ring.theta, ring.x, ring.y));
}

export function barChipPoints(bar: BarBody): { x: number; y: number }[] {
  const length = bar.grip * 2;
  const width = bar.half * 2;
  const local: { x: number; y: number }[] = [];
  const core = Math.max(0, length / 2 - width / 2);
  const radius = width / 2;
  tile(-length / 2, -width / 2, length / 2, width / 2, local, (x, y) => {
    const dx = Math.max(0, Math.abs(x) - core);
    return dx * dx + y * y <= radius * radius;
  });
  const originX = bar.x0 + (bar.x1 - bar.x0) * bar.t;
  const originY = bar.y0 + (bar.y1 - bar.y0) * bar.t;
  const angle = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
  return local.map((point) => rotate(point.x, point.y, angle, originX, originY));
}

/** Buckle chips in the buckle group's local frame, before its world rotation. */
export function buckleChipPoints(width: number): { x: number; y: number }[] {
  const basis = PART.outer * 2 * PART.scale;
  const { sleeveLen, sleeveW, gripSpan, gripStick } = buckleMetrics(width, basis);
  const local: { x: number; y: number }[] = [];
  tile(-sleeveLen / 2, -sleeveW / 2, sleeveLen / 2, sleeveW / 2, local);
  for (const side of [-1, 1]) {
    const y = side * (sleeveW / 2 + gripStick / 2);
    tile(-gripSpan / 2, y - gripStick / 2, gripSpan / 2, y + gripStick / 2, local);
  }
  return local;
}

export function makeShatter(
  parent: THREE.Object3D,
  points: { x: number; y: number }[],
  originX: number,
  originY: number,
  color: number,
): Shatter | null {
  if (points.length === 0) return null;
  const count = points.length;
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02 });
  const mesh = new THREE.InstancedMesh(sharedChipGeometry(), material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const dummy = new THREE.Object3D();
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const spin = new Float32Array(count);
  const pitch = new Float32Array(count);
  const roll = new Float32Array(count);
  const theta = new Float32Array(count);
  const scale = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = points[i].x;
    y[i] = points[i].y;
    const dx = x[i] - originX;
    const dy = y[i] - originY;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = Math.random() * SHATTER.speedMax;
    vx[i] = (dx / dist) * speed;
    vy[i] = (dy / dist) * speed;
    spin[i] = (Math.random() - 0.5) * 4;
    pitch[i] = (Math.random() - 0.5) * 5;
    roll[i] = (Math.random() - 0.5) * 5;
    theta[i] = Math.random() * Math.PI * 2;
    scale[i] = SHATTER.scaleMin + Math.random() * SHATTER.scaleSpan;
    dummy.position.set(x[i], y[i], FALL_Z);
    dummy.rotation.set(0, 0, theta[i]);
    dummy.scale.setScalar(scale[i]);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return { mesh, x, y, vx, vy, spin, pitch, roll, theta, scale, count, age: 0, dead: false };
}

/** Gravity grows in over `gravityIn`, then stays at `gravity`. One continuous arc. */
export function shatterGravity(age: number): number {
  const u = Math.min(1, age / SHATTER.gravityIn);
  const ease = u * u * (3 - 2 * u);
  return SHATTER.gravity * ease;
}

/** Shrink starts as the arc bends down, and floors so chips stay visible. */
export function shatterShrink(age: number): number {
  const fall = Math.max(0, age - SHATTER.gravityIn * 0.35);
  return Math.max(SHATTER.shrinkFloor, 1 - fall / SHATTER.shrinkSeconds);
}

const dummy = new THREE.Object3D();

export function stepShatters(shatters: Shatter[], viewBottom: number, dt: number): void {
  for (const shatter of shatters) {
    if (shatter.dead) continue;
    shatter.age += dt;
    const gravity = shatterGravity(shatter.age);
    const shrink = shatterShrink(shatter.age);
    let alive = 0;
    for (let i = 0; i < shatter.count; i++) {
      shatter.vy[i] += gravity * dt;
      shatter.x[i] += shatter.vx[i] * dt;
      shatter.y[i] += shatter.vy[i] * dt;
      shatter.theta[i] += shatter.spin[i] * dt;
      if (shatter.y[i] > viewBottom) alive += 1;
      dummy.position.set(shatter.x[i], shatter.y[i], FALL_Z);
      dummy.rotation.set(shatter.pitch[i] * shatter.age, shatter.roll[i] * shatter.age, shatter.theta[i]);
      dummy.scale.setScalar(shatter.y[i] > viewBottom ? shatter.scale[i] * shrink : 0);
      dummy.updateMatrix();
      shatter.mesh.setMatrixAt(i, dummy.matrix);
    }
    shatter.mesh.instanceMatrix.needsUpdate = true;
    if (alive === 0) shatter.dead = true;
  }
}

export function disposeShatter(shatter: Shatter): void {
  shatter.mesh.parent?.remove(shatter.mesh);
  shatter.mesh.material instanceof THREE.Material && shatter.mesh.material.dispose();
  shatter.mesh.dispose();
}

export function releaseRing(parent: THREE.Object3D, ring: RingBody, color: number): Shatter | null {
  return makeShatter(parent, ringChipPoints(ring), ring.x, ring.y, color);
}

export function releaseBar(parent: THREE.Object3D, bar: BarBody, color: number): Shatter | null {
  const originX = bar.x0 + (bar.x1 - bar.x0) * bar.t;
  const originY = bar.y0 + (bar.y1 - bar.y0) * bar.t;
  return makeShatter(parent, barChipPoints(bar), originX, originY, color);
}

/** Buckle pose is the marker already on screen: position and Z rotation. */
export function releaseBuckle(
  parent: THREE.Object3D,
  width: number,
  pose: { x: number; y: number; angle: number },
): Shatter | null {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  const points = buckleChipPoints(width).map((point) => ({
    x: pose.x + c * point.x - s * point.y,
    y: pose.y + s * point.x + c * point.y,
  }));
  return makeShatter(parent, points, pose.x, pose.y, SHATTER.buckle);
}
