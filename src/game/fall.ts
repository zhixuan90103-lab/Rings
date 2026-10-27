import type { BarBody, RingBody } from './board';

/** Gravity after a piece leaves the rule board. There is no floor. Locked pieces stay still. */

export type FallBody = {
  id: string;
  kind: 'ring' | 'bar';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  theta: number;
  spin: number;
  dead: boolean;
};

const GRAVITY = -30;

export function fallFromRing(ring: RingBody): FallBody {
  return {
    id: ring.id,
    kind: 'ring',
    x: ring.x,
    y: ring.y,
    vx: (Math.random() - 0.5) * 0.4,
    vy: 0.2,
    radius: ring.outer,
    theta: ring.theta,
    spin: (Math.random() - 0.5) * 6,
    dead: false,
  };
}

/** The silver rivet leaves with its bar, from wherever it was locked. */
export function fallFromRivet(id: string, x: number, y: number, theta: number): FallBody {
  return {
    id,
    kind: 'bar',
    x,
    y,
    vx: (Math.random() - 0.5) * 0.4,
    vy: 0.15,
    radius: 0.16,
    theta,
    spin: (Math.random() - 0.5) * 4.5,
    dead: false,
  };
}

export function fallFromBar(bar: BarBody): FallBody {
  const x = bar.x0 + (bar.x1 - bar.x0) * bar.t;
  const y = bar.y0 + (bar.y1 - bar.y0) * bar.t;
  return {
    id: bar.id,
    kind: 'bar',
    x,
    y,
    vx: 0,
    vy: 0.15,
    radius: Math.max(bar.half, 0.18),
    theta: Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0),
    spin: (Math.random() - 0.5) * 4.5,
    dead: false,
  };
}

/** In front of locked rings (z 0) and bars (z 0.2). Falling pieces do not rest on them. */
export const FALL_Z = 0.85;

export function stepFalls(bodies: FallBody[], viewBottom: number, dt: number): void {
  for (const body of bodies) {
    if (body.dead) continue;
    body.vy += GRAVITY * dt;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.theta += body.spin * dt;
    if (body.y + body.radius < viewBottom) body.dead = true;
  }
}
