import * as THREE from 'three';
import { mountWobbles } from './wobbles';
import { disposeSparkBurst, makeSparkBurst, stepSparkBurst, type SparkBurst } from './sparks';

const GLOW = 0.16;
const GLOW_SECONDS = 0.18;
/** Steady prompt while a lift would remove the piece. A small lift of the piece's own color. */
const HINT = 0.35;
/** How long the prompt takes to reach full strength, and to go back out. */
const HINT_SECONDS = 0.08;
const RING_REARM = 0.08;
const BAR_REARM = 0.03;

export type DragNotice = {
  kind: 'ring' | 'bar';
  moved: boolean;
  applied: number;
  rejected: number;
  armed: boolean;
  free: number;
};

export type DragEffect =
  | { type: 'hit'; sign: number; armed: false; free: 0 }
  | { type: 'hold' }
  | { type: 'stop' }
  | { type: 'free'; armed: boolean; free: number };

/** One sample of a drag. Pose changes stay outside this. */
export function dragEffect(notice: DragNotice): DragEffect {
  const hit = notice.moved && Math.abs(notice.rejected) > 1e-4;
  if (hit && notice.armed) {
    return { type: 'hit', sign: Math.sign(notice.rejected) || 1, armed: false, free: 0 };
  }
  if (!hit && Math.abs(notice.applied) > 1e-4) {
    const free = notice.free + Math.abs(notice.applied);
    const rearm = notice.kind === 'ring' ? RING_REARM : BAR_REARM;
    return { type: 'free', armed: notice.armed || free > rearm, free };
  }
  if (!notice.moved && Math.abs(notice.rejected) > 1e-4) {
    return notice.kind === 'ring' ? { type: 'hold' } : { type: 'stop' };
  }
  return { type: 'free', armed: notice.armed, free: notice.free };
}

/** Glow, sparks, and the per-piece wobble list. None of it writes the rule pose. */
export function mountFeedback(root: THREE.Object3D) {
  const wobbles = mountWobbles();
  let sparks: SparkBurst[] = [];
  let glow: { mesh: THREE.Object3D; left: number } | null = null;
  let hints: { mesh: THREE.Object3D; level: number; target: number }[] = [];
  const state = { armed: true, free: 0 };

  function setGlow(mesh: THREE.Object3D, intensity: number): void {
    mesh.traverse((node) => {
      const material = (node as THREE.Mesh).material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.setHex(0xffc98a);
        material.emissiveIntensity = intensity;
      }
    });
  }

  /** Own-color hint only. Callers skip this while impact owns the mesh. `level` is 0..1. */
  function paintHint(mesh: THREE.Object3D, level: number): void {
    mesh.traverse((node) => {
      const material = (node as THREE.Mesh).material;
      if (!(material instanceof THREE.MeshStandardMaterial)) return;
      if (level <= 0) {
        material.emissiveIntensity = 0;
        return;
      }
      material.emissive.copy(material.color);
      material.emissiveIntensity = HINT * level;
    });
  }

  function hintLevel(mesh: THREE.Object3D): number {
    return hints.find((item) => item.mesh === mesh)?.level ?? 0;
  }

  /** Impact is leaving this mesh. Restore a hint that is still up, otherwise go dark. */
  function releaseImpact(mesh: THREE.Object3D): void {
    const level = hintLevel(mesh);
    if (level > 0) paintHint(mesh, level);
    else setGlow(mesh, 0);
  }

  function arm(id?: string): void {
    state.armed = true;
    state.free = 0;
    wobbles.clear(id);
  }

  return {
    state,
    holding: wobbles.holding,
    holdSign: wobbles.holdSign,
    offset: wobbles.offset,
    holdRing: wobbles.holdRing,
    stopBar: wobbles.stopBar,
    click: wobbles.click,
    releaseHold: wobbles.release,
    releaseHeld: wobbles.releaseHeld,
    clearPose: () => wobbles.clear(),
    clearIf: (id: string) => wobbles.clear(id),
    arm,
    /** Pieces a lift would remove. The light eases in and out over `HINT_SECONDS`. */
    hint(meshes: THREE.Object3D[]): void {
      for (const item of hints) item.target = meshes.includes(item.mesh) ? 1 : 0;
      for (const mesh of meshes) {
        if (!hints.some((item) => item.mesh === mesh)) hints.push({ mesh, level: 0, target: 1 });
      }
      hints = hints.filter((item) => item.target > 0 || item.level > 0);
    },
    impact(mesh: THREE.Object3D, at: { x: number; y: number } | null, color: number): void {
      if (at) {
        const burst = makeSparkBurst(at.x, at.y, color);
        sparks.push(burst);
        root.add(burst.root);
      }
      if (glow && glow.mesh !== mesh) releaseImpact(glow.mesh);
      setGlow(mesh, GLOW);
      glow = { mesh, left: GLOW_SECONDS };
    },
    step(dt: number): void {
      wobbles.step(dt);
      if (glow) {
        glow.left -= dt;
        setGlow(glow.mesh, Math.max(0, glow.left / GLOW_SECONDS) * GLOW);
        if (glow.left <= 0) {
          const mesh = glow.mesh;
          glow = null;
          releaseImpact(mesh);
        }
      }
      const hintStep = dt / HINT_SECONDS;
      for (const item of hints) {
        if (item.level < item.target) item.level = Math.min(item.target, item.level + hintStep);
        else if (item.level > item.target) item.level = Math.max(item.target, item.level - hintStep);
        if (glow?.mesh === item.mesh) continue;
        paintHint(item.mesh, item.level);
      }
      hints = hints.filter((item) => item.target > 0 || item.level > 0);
      sparks = sparks.filter((burst) => {
        if (!stepSparkBurst(burst, dt)) return true;
        root.remove(burst.root);
        disposeSparkBurst(burst);
        return false;
      });
    },
    busy(): boolean {
      return wobbles.busy() || glow !== null || sparks.length > 0 || hints.length > 0;
    },
    clear(): void {
      wobbles.clear();
      for (const burst of sparks) {
        root.remove(burst.root);
        disposeSparkBurst(burst);
      }
      sparks = [];
      if (glow) setGlow(glow.mesh, 0);
      glow = null;
      for (const item of hints) paintHint(item.mesh, 0);
      hints = [];
      state.armed = true;
      state.free = 0;
    },
  };
}
