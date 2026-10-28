import * as THREE from 'three';

const SPARK_COUNT = 9;
const SPARK_RADIUS = 0.055 * 0.7;
const SPARK_GRAVITY = 16;

export type SparkBurst = {
  root: THREE.Group;
  bits: THREE.Mesh[];
  velocities: Float32Array;
  life: Float32Array;
  age: number;
  duration: number;
};

const sparkGeometry = new THREE.CircleGeometry(SPARK_RADIUS, 10);
const sparkPool: SparkBurst[] = [];

function createSparkBurst(): SparkBurst {
  const root = new THREE.Group();
  const bits: THREE.Mesh[] = [];
  const material = new THREE.MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
  });
  for (let i = 0; i < SPARK_COUNT; i++) {
    const mesh = new THREE.Mesh(sparkGeometry, material);
    mesh.renderOrder = 20;
    mesh.visible = false;
    root.add(mesh);
    bits.push(mesh);
  }
  return {
    root,
    bits,
    velocities: new Float32Array(SPARK_COUNT * 2),
    life: new Float32Array(SPARK_COUNT),
    age: 0,
    duration: 0.34,
  };
}

/** Small discs. WebGPU drops textured points that have no uv. */
export function makeSparkBurst(x: number, y: number, color: number): SparkBurst {
  const burst = sparkPool.pop() ?? createSparkBurst();
  const material = burst.bits[0].material;
  if (material instanceof THREE.MeshBasicMaterial) material.color.setHex(color);
  burst.age = 0;
  burst.root.visible = true;
  for (let i = 0; i < SPARK_COUNT; i++) {
    const mesh = burst.bits[i];
    mesh.visible = true;
    mesh.position.set(x, y, 0.45);
    mesh.scale.setScalar(1);
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.55 + Math.random() * 1.1;
    burst.velocities[i * 2] = Math.cos(angle) * speed;
    burst.velocities[i * 2 + 1] = Math.sin(angle) * speed + 0.2;
    burst.life[i] = 0.16 + Math.random() * 0.16;
  }
  stepSparkBurst(burst, 1 / 60);
  return burst;
}

export function stepSparkBurst(burst: SparkBurst, dt: number): boolean {
  burst.age += dt;
  for (let i = 0; i < burst.bits.length; i++) {
    const mesh = burst.bits[i];
    const life = burst.life[i];
    if (burst.age >= life) {
      mesh.visible = false;
      continue;
    }
    mesh.position.x += burst.velocities[i * 2] * dt;
    mesh.position.y += burst.velocities[i * 2 + 1] * dt;
    burst.velocities[i * 2 + 1] -= SPARK_GRAVITY * dt;
    const scale = 1 - burst.age / life;
    mesh.scale.setScalar(scale);
  }
  return burst.age >= burst.duration;
}

sparkPool.push(createSparkBurst(), createSparkBurst());

export function disposeSparkBurst(burst: SparkBurst): void {
  burst.root.removeFromParent();
  burst.root.visible = false;
  for (const mesh of burst.bits) mesh.visible = false;
  sparkPool.push(burst);
}
