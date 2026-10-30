/**
 * One invalid wobble per piece. Starting or clearing one id does not touch the others.
 * The curve lives in recoil.ts. This list only keeps them apart.
 */

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

type Pose = { id: string; kind: 'ring' | 'bar'; body: Recoil };

export function mountWobbles() {
  let poses: Pose[] = [];

  function poseOf(id: string): Pose | undefined {
    return poses.find((item) => item.id === id);
  }

  function put(next: Pose): void {
    const index = poses.findIndex((item) => item.id === next.id);
    if (index >= 0) poses[index] = next;
    else poses.push(next);
  }

  function play(id: string, kind: 'ring' | 'bar', rejected: number, max: number, fromClick: boolean): void {
    if (!fromClick && poseOf(id)) return;
    const body = beginRecoil(rejected, fromClick ? max * CLICK_RECOIL_SCALE : max);
    if (body) put({ id, kind, body });
  }

  return {
    holding(id: string): boolean {
      return poseOf(id)?.body.hold === true;
    },
    holdSign(id: string): number {
      const pose = poseOf(id);
      if (!pose?.body.hold) return 0;
      return pose.body.sign;
    },
    offset(id: string): number {
      const pose = poseOf(id);
      return pose ? wobbleOffset(pose.body) : 0;
    },
    holdRing(id: string, rejected: number): void {
      const pose = poseOf(id);
      if (pose && !pose.body.hold) return;
      const sign = heldSign(pose?.body.hold ? pose.body.sign : null, rejected);
      if (sign === null || pose?.body.hold) return;
      const body = beginRecoil(sign, RING_RECOIL_MAX, true);
      if (body) put({ id, kind: 'ring', body });
    },
    stopBar(id: string, rejected: number, length: number): void {
      play(id, 'bar', rejected, BAR_RECOIL_WORLD / Math.max(length, 1e-4), false);
    },
    click(id: string, kind: 'ring' | 'bar', length: number): void {
      const max = kind === 'ring' ? RING_RECOIL_MAX : BAR_RECOIL_WORLD / Math.max(length, 1e-4);
      play(id, kind, 1, max, true);
    },
    release(id: string): void {
      const pose = poseOf(id);
      if (pose?.body.hold) releaseHold(pose.body);
    },
    /** Every ring still frozen at the tight angle starts its wobble now. */
    releaseHeld(): void {
      for (const pose of poses) {
        if (pose.body.hold) releaseHold(pose.body);
      }
    },
    clear(id?: string): void {
      poses = id ? poses.filter((item) => item.id !== id) : [];
    },
    step(dt: number): void {
      poses = poses.filter((item) => !stepRecoil(item.body, dt));
    },
    busy(): boolean {
      return poses.length > 0;
    },
  };
}
