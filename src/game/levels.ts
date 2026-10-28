import type { Board } from './board';
import { syncPins } from './board';
import { PART, connectorMetrics } from './parts';

function holdPin(id: string, host: Board['rings'][number]): Board['pins'][number] {
  const angle = host.theta + Math.PI;
  const radius = (host.inner + host.outer) / 2;
  return {
    id,
    ownerId: null,
    localAngle: 0,
    localRadius: 0,
    x: host.x + Math.cos(angle) * radius,
    y: host.y + Math.sin(angle) * radius,
    role: 'catch',
    limitRingId: null,
    stopHalf: 0,
  };
}

function ring(
  id: string,
  x: number,
  y: number,
  gap: number,
  theta: number,
): Board['rings'][number] {
  return { id, kind: 'ring', x, y, inner: 0.42, outer: 0.68, gap, theta, connectors: [] };
}

export function levelPin(): Board {
  const board: Board = {
    rings: [ring('a', 0, 0.4, 1.1, 0)],
    bars: [],
    pins: [
      {
        id: 'pin-a',
        ownerId: null,
        localAngle: 0,
        localRadius: 0,
        x: 0.55,
        y: 0.4,
        role: 'block',
        limitRingId: null,
        stopHalf: 0,
      },
    ],
    latches: [],
  };
  syncPins(board);
  return board;
}

export function levelTwo(): Board {
  const a = ring('a', -0.55, 0.45, 1.15, 0);
  const b = ring('b', 0.55, 0.45, 1.15, Math.PI);
  const board: Board = {
    rings: [a, b],
    bars: [],
    pins: [
      {
        id: 'pin-from-a',
        ownerId: 'a',
        localAngle: 0,
        localRadius: 0.55,
        x: 0,
        y: 0,
        role: 'block',
        limitRingId: null,
        stopHalf: 0,
      },
      {
        id: 'pin-from-b',
        ownerId: 'b',
        localAngle: 0,
        localRadius: 0.65,
        x: 0,
        y: 0,
        role: 'block',
        limitRingId: null,
        stopHalf: 0,
      },
    ],
    latches: [],
  };
  syncPins(board);
  return board;
}

export function levelBar(): Board {
  const board: Board = {
    rings: [ring('a', 0, 0.85, 1.2, 0.1)],
    bars: [
      {
        id: 'bar',
        kind: 'bar',
        x0: -1.35,
        y0: -0.35,
        x1: 1.35,
        y1: -0.35,
        half: 0.12,
        grip: 0.48,
        t: 0.15,
      },
    ],
    pins: [
      {
        id: 'pin-a',
        ownerId: null,
        localAngle: 0,
        localRadius: 0,
        x: Math.cos(0) * 0.55,
        y: 0.85 + Math.sin(0) * 0.55,
        role: 'block',
        limitRingId: null,
        stopHalf: 0,
      },
    ],
    latches: [
      {
        id: 'latch',
        barId: 'bar',
        x: Math.cos(0.2) * 0.55,
        y: 0.85 + Math.sin(0.2) * 0.55,
        t0: 0.72,
        t1: 1,
        release: 'window',
      },
    ],
  };
  syncPins(board);
  return board;
}

export function levelStopClosed(): Board {
  const open = ring('open', -0.15, 0.7, 1.05, 0);
  const closed = ring('closed', 0.62, 0.2, 0, 0);
  const board: Board = {
    rings: [open, closed],
    bars: [],
    pins: [
      {
        id: 'world',
        ownerId: null,
        localAngle: 0,
        localRadius: 0,
        x: open.x + 0.55,
        y: open.y,
        role: 'block',
        limitRingId: null,
        stopHalf: 0,
      },
      {
        id: 'stop',
        ownerId: null,
        localAngle: 0,
        localRadius: 0,
        x: open.x + Math.cos(0.55) * 0.55,
        y: open.y + Math.sin(0.55) * 0.55,
        role: 'stop',
        limitRingId: 'open',
        stopHalf: 0.28,
      },
      {
        id: 'holds-closed',
        ownerId: 'open',
        localAngle: -1.15,
        localRadius: 0.55,
        x: 0,
        y: 0,
        role: 'block',
        limitRingId: null,
        stopHalf: 0,
      },
    ],
    latches: [],
  };
  syncPins(board);
  return board;
}

/**
 * Blue and green are nested through each other's gaps, on one plane,
 * without overlapping. The green ring cannot turn. The red bar sits
 * diagonally in the blue gap and slides along that diagonal.
 */
export function levelBasic(): Board {
  const scale = PART.scale;
  const outer = PART.outer * scale;
  const inner = PART.outer * (1 - PART.bandRatio) * scale;
  const gap = PART.gap;
  const metrics = connectorMetrics(PART.outer, PART.outer * PART.bandRatio);
  const claspDist = metrics.claspDist * scale;
  const blueTheta = -2.35;
  const blueX = 0.15;
  const blueY = 0.45;
  const ux = Math.cos(blueTheta);
  const uy = Math.sin(blueTheta);
  const claspR = (inner + outer) / 2;
  const claspX = blueX + ux * claspR;
  const claspY = blueY + uy * claspR;
  const joint = Math.PI / 2;
  const greenTheta = blueTheta + Math.PI - joint;
  const green = ring(
    'green',
    claspX + ux * claspDist,
    claspY + uy * claspDist,
    gap,
    greenTheta,
  );
  green.connectors = [{
    angle: joint,
    stem: connectorMetrics(outer, outer * PART.bandRatio).stemLen,
    target: 'blue',
  }];
  const blue = ring('blue', blueX, blueY, gap, blueTheta + Math.PI);
  for (const item of [blue, green]) {
    item.inner = inner;
    item.outer = outer;
  }
  const grip = 0.72 * scale * 1.5;
  const gx = Math.cos(blue.theta);
  const gy = Math.sin(blue.theta);
  // Round cap sits in the gap mouth. The shaft stays outside the hole.
  const mouth = (inner + outer) / 2;
  const cx = blue.x + gx * (mouth + grip);
  const cy = blue.y + gy * (mouth + grip);
  const span = 1.9;
  const t = 0.2;
  const x0 = cx - gx * (t * span);
  const y0 = cy - gy * (t * span);
  const x1 = cx + gx * ((1 - t) * span);
  const y1 = cy + gy * ((1 - t) * span);
  const board: Board = {
    rings: [blue, green],
    bars: [
      {
        id: 'bar-red',
        kind: 'bar',
        x0,
        y0,
        x1,
        y1,
        half: (0.72 * 0.28 * scale) / 2,
        grip,
        t,
      },
    ],
    pins: [],
    latches: [
      { id: 'buckle-red', barId: 'bar-red', x: cx, y: cy, t0: 0, t1: 0, release: 'sleeve' },
    ],
    volumes: true,
  };
  syncPins(board);
  return board;
}

/**
 * One chain, top to bottom.
 * Each bar is held by the ring it crosses. Turn that ring until the
 * opening faces the bar, then slide the bar out. The ring below stays
 * shut until the piece above has left.
 */
export function levelScreen(): Board {
  const blue = ring('blue', 0.1, 1.15, 1.55, 0);
  const green = ring('green', -1.15, 0.53, 1.55, 0);
  const orange = ring('orange', 0.85, -0.71, 1.55, 0);
  for (const item of [blue, green, orange]) {
    item.inner = 0.3;
    item.outer = 0.72;
  }
  const board: Board = {
    rings: [blue, green, orange],
    bars: [
      { id: 'bar-red', kind: 'bar', x0: -1.2, y0: 1.77, x1: 1.6, y1: 1.77, half: 0.14, grip: 0.85, t: 0.33 },
      { id: 'bar-orange', kind: 'bar', x0: -2.35, y0: 1.15, x1: 1.7, y1: 1.15, half: 0.14, grip: 0.85, t: 0.2 },
      { id: 'bar-purple', kind: 'bar', x0: -2.35, y0: -0.09, x1: 1.85, y1: -0.09, half: 0.14, grip: 0.85, t: 0.2 },
    ],
    pins: [
      holdPin('hold-blue', blue),
      holdPin('hold-green', green),
      holdPin('hold-orange', orange),
    ],
    // Sleeve release, same as the old stopHalf 0 pins. The t0/t1 numbers are not read.
    latches: [
      { id: 'buckle-red', barId: 'bar-red', x: 0.1, y: 1.77, t0: 0.78, t1: 1, release: 'sleeve' },
      { id: 'buckle-orange', barId: 'bar-orange', x: -1.15, y: 1.15, t0: 0.78, t1: 1, release: 'sleeve' },
      { id: 'buckle-purple', barId: 'bar-purple', x: -1.12, y: -0.09, t0: 0.78, t1: 1, release: 'sleeve' },
    ],
  };
  syncPins(board);
  return board;
}

export const LEVELS: { name: string; make: () => Board }[] = [
  { name: '三件', make: levelBasic },
  { name: '从上往下拆', make: levelScreen },
  { name: '开口环 + 阻挡销', make: levelPin },
  { name: '双环互扣', make: levelTwo },
  { name: '滑杆 + 卡扣', make: levelBar },
  { name: '限位销 + 闭合环', make: levelStopClosed },
];
