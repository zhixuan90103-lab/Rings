import * as THREE from 'three';

const SPARK_COUNT = 9;

export type SparkBurst = {
  root: THREE.Group;
  bits: THREE.Mesh[];
  velocities: Float32Array;
  life: Float32Array;
  age: number;
  duration: number;
};

/** Small discs. WebGPU drops textured points that have no uv. */
export function makeSparkBurst(x: number, y: number, color: number): SparkBurst {
  const root = new THREE.Group();
  const bits: THREE.Mesh[] = [];
  const velocities = new Float32Array(SPARK_COUNT * 2);
  const life = new Float32Array(SPARK_COUNT);
  const geometry = new THREE.CircleGeometry(0.055 * 0.7, 10);
  for (let i = 0; i < SPARK_COUNT; i++) {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.position.set(x, y, 0.45);
    mesh.renderOrder = 20;
    root.add(mesh);
    bits.push(mesh);
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.55 + Math.random() * 1.1;
    velocities[i * 2] = Math.cos(angle) * speed;
    velocities[i * 2 + 1] = Math.sin(angle) * speed + 0.2;
    life[i] = 0.16 + Math.random() * 0.16;
  }
  return { root, bits, velocities, life, age: 0, duration: 0.34 };
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
    burst.velocities[i * 2 + 1] -= 16 * dt;
    const scale = 1 - burst.age / life;
    mesh.scale.setScalar(scale);
  }
  return burst.age >= burst.duration;
}

export function disposeSparkBurst(burst: SparkBurst): void {
  const geometry = burst.bits[0]?.geometry;
  for (const mesh of burst.bits) (mesh.material as THREE.Material).dispose();
  geometry?.dispose();
}
