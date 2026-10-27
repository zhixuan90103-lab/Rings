import type { BarBody, RingBody } from './board';

/** Gravity after a piece leaves the rule board. Locked pieces are static obstacles. */

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

const GRAVITY = -14;
const REST = 0.18;

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
    spin: (Math.random() - 0.5) * 2,
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
    spin: (Math.random() - 0.5) * 1.5,
    dead: false,
  };
}

export function stepFalls(
  bodies: FallBody[],
  obstacles: { x: number; y: number; radius: number }[],
  groundY: number,
  dt: number,
): void {
  for (const body of bodies) {
    if (body.dead) continue;
    body.vy += GRAVITY * dt;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.theta += body.spin * dt;

    if (body.y - body.radius < groundY) {
      body.y = groundY + body.radius;
      if (body.vy < 0) body.vy = -body.vy * REST;
      body.vx *= 0.98;
      body.spin *= 0.98;
    }

    for (const obstacle of obstacles) {
      const dx = body.x - obstacle.x;
      const dy = body.y - obstacle.y;
      const min = body.radius + obstacle.radius;
      const d = Math.hypot(dx, dy);
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d;
      const ny = dy / d;
      body.x = obstacle.x + nx * min;
      body.y = obstacle.y + ny * min;
      const vn = body.vx * nx + body.vy * ny;
      if (vn < 0) {
        body.vx -= vn * nx;
        body.vy -= vn * ny;
      }
    }

    if (body.y < groundY - 6) body.dead = true;
  }
}
