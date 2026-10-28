import * as THREE from 'three';
import {
  BAR_RECOIL_WORLD,
  CLICK_RECOIL_SCALE,
  RING_RECOIL_MAX,
  beginRecoil,
  heldSign,
  releaseHold,
  stepRecoil,
  wobbleOffset,
  type Recoil,
} from './recoil';
import { disposeSparkBurst, makeSparkBurst, stepSparkBurst, type SparkBurst } from './sparks';

const GLOW = 0.16;
const GLOW_SECONDS = 0.18;
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

type Pose = { id: string; kind: 'ring' | 'bar'; body: Recoil };

/** Wobble, hold, glow, and sparks. None of it writes the rule pose. */
export function mountFeedback(root: THREE.Object3D) {
  let pose: Pose | null = null;
  let sparks: SparkBurst[] = [];
  let glow: { mesh: THREE.Object3D; left: number } | null = null;
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

  function clearPose(): void {
    pose = null;
  }

  function arm(): void {
    state.armed = true;
    state.free = 0;
    clearPose();
  }

  function barMax(length: number): number {
    return BAR_RECOIL_WORLD / Math.max(length, 1e-4);
  }

  function play(id: string, kind: 'ring' | 'bar', rejected: number, max: number, fromClick: boolean): void {
    if (!fromClick && pose?.id === id) return;
    const body = beginRecoil(rejected, fromClick ? max * CLICK_RECOIL_SCALE : max);
    if (body) pose = { id, kind, body };
  }

  return {
    state,
    holding(id: string): boolean {
      return pose?.id === id && pose.body.hold === true;
    },
    holdSign(id: string): number {
      if (pose?.id !== id || !pose.body.hold) return 0;
      return pose.body.sign;
    },
    offset(id: string): number {
      if (pose?.id !== id) return 0;
      return wobbleOffset(pose.body);
    },
    holdRing(id: string, rejected: number): void {
      const sign = heldSign(pose?.id === id && pose.body.hold ? pose.body.sign : null, rejected);
      if (sign === null || (pose?.id === id && pose.body.hold)) return;
      const body = beginRecoil(sign, RING_RECOIL_MAX, true);
      if (body) pose = { id, kind: 'ring', body };
    },
    stopBar(id: string, rejected: number, length: number): void {
      play(id, 'bar', rejected, barMax(length), false);
    },
    click(id: string, kind: 'ring' | 'bar', length: number): void {
      const max = kind === 'ring' ? RING_RECOIL_MAX : barMax(length);
      play(id, kind, 1, max, true);
    },
    releaseHold(): void {
      if (pose?.body.hold) releaseHold(pose.body);
    },
    clearPose,
    arm,
    impact(mesh: THREE.Object3D, at: { x: number; y: number } | null, color: number): void {
      if (at) {
        const burst = makeSparkBurst(at.x, at.y, color);
        sparks.push(burst);
        root.add(burst.root);
      }
      if (glow && glow.mesh !== mesh) setGlow(glow.mesh, 0);
      setGlow(mesh, GLOW);
      glow = { mesh, left: GLOW_SECONDS };
    },
    step(dt: number): void {
      if (pose && stepRecoil(pose.body, dt)) pose = null;
      if (glow) {
        glow.left -= dt;
        setGlow(glow.mesh, Math.max(0, glow.left / GLOW_SECONDS) * GLOW);
        if (glow.left <= 0) glow = null;
      }
      sparks = sparks.filter((burst) => {
        if (!stepSparkBurst(burst, dt)) return true;
        root.remove(burst.root);
        disposeSparkBurst(burst);
        return false;
      });
    },
    busy(): boolean {
      return pose !== null || glow !== null || sparks.length > 0;
    },
    clear(): void {
      clearPose();
      for (const burst of sparks) {
        root.remove(burst.root);
        disposeSparkBurst(burst);
      }
      sparks = [];
      if (glow) setGlow(glow.mesh, 0);
      glow = null;
      state.armed = true;
      state.free = 0;
    },
  };
}
