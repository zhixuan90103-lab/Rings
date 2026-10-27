/**
 * Standalone flat pieces and the two combinations that use them.
 * A ring connector (stem + clasp) can be attached at any outer angle, more than once.
 * A bar buckle belongs only on a capsule bar.
 */

import * as THREE from 'three';

export const PART = {
  outer: 0.72,
  bandRatio: 0.28,
  gap: 1.75,
  depth: 0.18,
  scale: 0.9,
} as const;

const BUCKLE_COLOR = 0xc8c7c5;

export function plastic(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02 });
}

export function discRing(outer: number, band: number, gap: number, depth: number, color: number): THREE.Mesh {
  const inner = outer - band;
  const open = Math.min(Math.max(gap, 0.2), Math.PI);
  const a0 = open / 2;
  const a1 = Math.PI * 2 - open / 2;
  const mid = (outer + inner) / 2;
  const cap = band / 2;
  const bevelSize = cap * 0.5;
  const outerIn = outer - bevelSize;
  const innerIn = inner + bevelSize;
  const capIn = (outerIn - innerIn) / 2;
  const shape = new THREE.Shape();
  const endCap = (angle: number, fromInner: boolean) => {
    const start = fromInner ? angle + Math.PI : angle;
    shape.absarc(Math.cos(angle) * mid, Math.sin(angle) * mid, capIn, start, start + Math.PI, false);
  };
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

/** Length runs along local +X. Straight ends stay square; long edges keep a fillet. */
export function straightBar(length: number, width: number, depth: number, material: THREE.Material): THREE.Mesh {
  const r = Math.min(width * 0.28, depth * 0.45);
  const x = -width / 2;
  const y = -depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.absarc(x + width - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + width, y + depth - r);
  shape.absarc(x + width - r, y + depth - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + depth);
  shape.absarc(x + r, y + depth - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 8 });
  geometry.translate(0, 0, -length / 2);
  geometry.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export function capsuleBar(length: number, width: number, depth: number, color: number): THREE.Mesh {
  const radius = width / 2;
  const bevelSize = radius * 0.5;
  const lengthIn = Math.max(0.02, length - bevelSize * 2);
  const widthIn = Math.max(0.02, width - bevelSize * 2);
  const radiusIn = widthIn / 2;
  const straight = Math.max(0.001, lengthIn - widthIn);
  const shape = new THREE.Shape();
  shape.moveTo(-straight / 2, -radiusIn);
  shape.lineTo(straight / 2, -radiusIn);
  shape.absarc(straight / 2, 0, radiusIn, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-straight / 2, radiusIn);
  shape.absarc(-straight / 2, 0, radiusIn, Math.PI / 2, Math.PI * 1.5, false);
  const bevelThickness = depth * 0.48;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 8,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -(depth + bevelThickness * 2) / 2);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, plastic(color));
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

/**
 * Same length, width and square ends as the straight clasp.
 * The long axis follows the outer ring it rests on. Local origin is the clasp center.
 * Local -Y points at that ring's center.
 */
function claspProfile(width: number, depth: number): { u: number; v: number }[] {
  const r = Math.min(width * 0.28, depth * 0.45);
  const hw = width / 2;
  const hd = depth / 2;
  const pts: { u: number; v: number }[] = [];
  const corner = (cx: number, cy: number, a0: number, a1: number) => {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      pts.push({ u: cx + Math.cos(t) * r, v: cy + Math.sin(t) * r });
    }
  };
  corner(-hw + r, -hd + r, Math.PI, Math.PI * 1.5);
  corner(hw - r, -hd + r, -Math.PI / 2, 0);
  corner(hw - r, hd - r, 0, Math.PI / 2);
  corner(-hw + r, hd - r, Math.PI / 2, Math.PI);
  return pts;
}

/** Bent clasp. Long edges keep the straight bar's fillet. The two ends stay square cuts. */
function bentClasp(length: number, width: number, depth: number, radius: number, material: THREE.Material): THREE.Mesh {
  const profile = claspProfile(width, depth);
  const half = length / 2 / radius;
  const steps = 18;
  const positions: number[] = [];
  const indices: number[] = [];
  const count = profile.length;
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 - half + (2 * half * i) / steps;
    const radialX = Math.cos(a);
    const radialY = Math.sin(a);
    for (const p of profile) {
      positions.push(radialX * (radius + p.u), -radius + radialY * (radius + p.u), p.v);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < count; j++) {
      const a = i * count + j;
      const b = i * count + ((j + 1) % count);
      const c = (i + 1) * count + j;
      const d = (i + 1) * count + ((j + 1) % count);
      indices.push(a, c, b, b, c, d);
    }
  }
  const cap = (station: number, outward: boolean) => {
    const base = station * count;
    for (let j = 1; j < count - 1; j++) {
      indices.push(base, base + (outward ? j + 1 : j), base + (outward ? j : j + 1));
    }
  };
  cap(0, false);
  cap(steps, true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

/** One stem plus one clasp, on the outside of a ring at `angle` (0 = +X). */
export function attachConnector(
  parent: THREE.Object3D,
  outer: number,
  band: number,
  depth: number,
  material: THREE.Material,
  angle: number,
): void {
  const stemLen = band * 2.5 * (2 / 3);
  const stemW = band * 0.88;
  const claspLen = band * 2.1 * (5 / 6);
  const claspW = band * 1.4;
  const stemDist = outer + stemLen * 0.5 - band * 0.2;
  const claspDist = stemDist + stemLen * 0.5;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const stem = straightBar(stemLen, stemW, depth, material);
  stem.position.set(c * stemDist, s * stemDist, 0);
  stem.rotation.z = angle;
  parent.add(stem);
  const clasp = bentClasp(claspLen, claspW, depth, outer - band / 2, material);
  clasp.position.set(c * claspDist, s * claspDist, 0.08);
  clasp.rotation.z = angle + Math.PI / 2;
  parent.add(clasp);
}

/** Ring plus any number of connectors. Connectors share the ring color. */
export function ringWithConnectors(
  outer: number,
  band: number,
  gap: number,
  depth: number,
  color: number,
  angles: number[],
): THREE.Group {
  const group = new THREE.Group();
  const ring = discRing(outer, band, gap, depth, color);
  ring.position.z = 0.04;
  group.add(ring);
  const material = plastic(color);
  for (const angle of angles) attachConnector(group, outer, band, depth, material, angle);
  return group;
}

/** Capsule plus one centered buckle. Buckle size follows the unstretched bar length. The buckle stays fixed when the capsule slides. */
export function barWithBuckle(length: number, buckleBasis: number, width: number, depth: number, color: number): THREE.Group {
  const group = new THREE.Group();
  group.add(capsuleBar(length, width, depth, color));
  const sleeveLen = buckleBasis * 0.32 * (2 / 3);
  const sleeveW = width * 1.3;
  const metal = new THREE.MeshStandardMaterial({ color: BUCKLE_COLOR, metalness: 0.04, roughness: 0.38 });
  const sleeve = straightBar(sleeveLen, sleeveW, depth * 1.2, metal);
  sleeve.position.z = 0.03;
  sleeve.castShadow = false;
  sleeve.userData.noShadow = true;
  group.add(sleeve);
  group.add(fakeShadow(sleeveLen, sleeveW, 0.016, -0.014));
  const gripSpan = sleeveLen * 0.62 * 0.7;
  const gripStick = width * 0.48 * 0.7;
  for (const side of [-1, 1]) {
    const grip = straightBar(gripSpan, gripStick, depth * 1.2, metal);
    const y = side * (sleeveW / 2 + gripStick / 2);
    grip.position.set(0, y, 0.03);
    grip.castShadow = false;
    grip.userData.noShadow = true;
    group.add(grip);
    group.add(fakeShadow(gripSpan, gripStick, 0.016, y - 0.014));
  }
  return group;
}
