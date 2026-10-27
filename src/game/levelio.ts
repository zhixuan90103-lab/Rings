import type { Board, RingBody } from './board';
import { syncPins } from './board';
import { wrapAngle } from './angle';
import { PART, connectorLayout, connectorMetrics } from './parts';
import type { RingConnector } from './board';

export const LEVEL_COUNT = 5;

export const PALETTE = [0x3aa8ff, 0x3dcc73, 0xff564c, 0xff8a2a, 0xa86bff, 0xf2c14e];

export function defaultOuter(): number {
  return PART.outer * PART.scale;
}

export function defaultStem(outer: number): number {
  return connectorMetrics(outer, outer * PART.bandRatio).stemLen;
}

export function emptyBoard(): Board {
  return { rings: [], bars: [], pins: [], latches: [], volumes: true };
}

/** Catch pins follow each handle so play still releases them by the existing rules. */
export function syncCatchPins(board: Board): void {
  board.pins = board.pins.filter((pin) => !pin.id.startsWith('catch:'));
  for (const ring of board.rings) {
    const band = ring.outer * PART.bandRatio;
    ring.connectors.forEach((connector, index) => {
      const layout = connectorLayout(ring.outer, band, connector.stem);
      board.pins.push({
        id: `catch:${ring.id}:${index}`,
        ownerId: ring.id,
        localAngle: connector.angle,
        localRadius: layout.claspDist,
        x: 0,
        y: 0,
        role: 'catch',
        limitRingId: null,
        stopHalf: 0,
      });
    });
  }
  syncPins(board);
}

export function pieceColor(board: Board, id: string): number | undefined {
  return board.rings.find((ring) => ring.id === id)?.color ?? board.bars.find((bar) => bar.id === id)?.color;
}

export function linkedIds(board: Board, id: string): string[] {
  const ids = new Set<string>();
  for (const ring of board.rings) {
    for (const connector of ring.connectors) {
      if (ring.id === id && connector.target) ids.add(connector.target);
      if (connector.target === id) ids.add(ring.id);
    }
  }
  return [...ids];
}

export function colorsClash(board: Board, a: string, b: string): boolean {
  const left = pieceColor(board, a);
  const right = pieceColor(board, b);
  return left !== undefined && left === right;
}

function hexToHue(color: number): number {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  if (span === 0) return 0;
  const hue = max === r ? (g - b) / span + (g < b ? 6 : 0) : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return hue * 60;
}

function hueDistance(left: number, right: number): number {
  const gap = Math.abs(hexToHue(left) - hexToHue(right)) % 360;
  return Math.min(gap, 360 - gap);
}

function hslToHex(hue: number, saturation: number, lightness: number): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const match = lightness - chroma / 2;
  const rgb = section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0] : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma] : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const channel = (value: number) => Math.round((value + match) * 255);
  return (channel(rgb[0]) << 16) | (channel(rgb[1]) << 8) | channel(rgb[2]);
}

export function freshColor(board: Board): number {
  const used = new Set<number>();
  for (const ring of board.rings) if (ring.color !== undefined) used.add(ring.color);
  for (const bar of board.bars) if (bar.color !== undefined) used.add(bar.color);
  const free = PALETTE.find((color) => !used.has(color));
  if (free !== undefined) return free;
  const taken = [...used];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const base = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const sign = Math.random() < 0.5 ? -1 : 1;
    const hue = (hexToHue(base) + sign * (20 + Math.random() * 24) + 360) % 360;
    const color = hslToHex(hue, 0.66 + Math.random() * 0.14, 0.52 + Math.random() * 0.08);
    if (taken.every((existing) => hueDistance(existing, color) > 14)) return color;
  }
  return hslToHex(Math.random() * 360, 0.7, 0.56);
}

export function makeRing(board: Board): RingBody {
  const outer = defaultOuter();
  const n = board.rings.length + 1;
  return {
    id: `ring-${n}`,
    kind: 'ring',
    x: 0,
    y: 0.2 * n,
    inner: outer * (1 - PART.bandRatio),
    outer,
    gap: PART.gap,
    theta: 0,
    color: freshColor(board),
    connectors: [],
  };
}

export async function loadLevel(index: number): Promise<Board> {
  const response = await fetch(`./levels/${index}.json`);
  if (!response.ok) return emptyBoard();
  const data = (await response.json()) as Board;
  data.rings ??= [];
  data.bars ??= [];
  data.pins ??= [];
  data.latches ??= [];
  data.volumes = true;
  for (const ring of data.rings) ring.connectors ??= [];
  syncCatchPins(data);
  return data;
}

function claspReach(owner: RingBody, stem: number): { band: number; bend: number; reach: number } {
  const band = owner.outer * PART.bandRatio;
  const layout = connectorLayout(owner.outer, band, stem);
  return { band, bend: layout.bend, reach: layout.claspDist + layout.bend };
}

/** Arc center of this handle. That is the point the locked ring should sit on. */
function claspCenter(owner: RingBody, connector: RingConnector): { x: number; y: number } {
  const world = owner.theta + connector.angle;
  const { reach } = claspReach(owner, connector.stem);
  return { x: owner.x + Math.cos(world) * reach, y: owner.y + Math.sin(world) * reach };
}

function bindConnector(board: Board, owner: RingBody, connector: RingConnector): void {
  if (connector.target && board.rings.some((ring) => ring.id === connector.target)) return;
  const center = claspCenter(owner, connector);
  let best: { id: string; distance: number } | null = null;
  for (const ring of board.rings) {
    if (ring.id === owner.id) continue;
    const distance = Math.hypot(ring.x - center.x, ring.y - center.y);
    if (distance > ring.outer) continue;
    if (!best || distance < best.distance) best = { id: ring.id, distance };
  }
  connector.target = best?.id ?? null;
}

type SeatLink = {
  owner: RingBody;
  connector: RingConnector;
  target: RingBody;
  ux: number;
  uy: number;
  stem: number;
  /** Distance off the handle ray. A handle pointed the wrong way stays last. */
  perp: number;
  primary: boolean;
};

/** A stem more than twice the shortest in a run keeps its own length. */
const STEM_UNIFY_RATIO = 2;

function stemForDistance(owner: RingBody, distance: number): number {
  const { band, bend } = claspReach(owner, 0);
  return Math.max(0.02, distance - bend - owner.outer + band * 0.2);
}

function shareStemLengths(links: SeatLink[]): void {
  const ordered = [...links].sort((a, b) => a.stem - b.stem);
  let start = 0;
  while (start < ordered.length) {
    let end = start;
    while (
      end + 1 < ordered.length
      && ordered[end + 1].stem <= ordered[start].stem * STEM_UNIFY_RATIO
    ) {
      end += 1;
    }
    const group = ordered.slice(start, end + 1);
    const mid = group.reduce((sum, link) => sum + link.stem, 0) / group.length;
    for (const link of group) {
      link.stem = mid;
      link.connector.stem = mid;
    }
    start = end + 1;
  }
}

/**
 * Seat every aimed handle once.
 * Each ring is placed by a single handle, so saving again does not tug it
 * between two clasps. Close stem lengths share one value. A handle with no
 * target binds to the ring its clasp is already sitting on.
 * Angle 0 stays +X, counterclockwise.
 */
export function seatConnectors(board: Board): void {
  for (const owner of board.rings) {
    for (const connector of owner.connectors) bindConnector(board, owner, connector);
  }
  const links: SeatLink[] = [];
  for (const owner of board.rings) {
    for (const connector of owner.connectors) {
      if (!connector.target) continue;
      const target = board.rings.find((ring) => ring.id === connector.target);
      if (!target || target.id === owner.id) continue;
      const dx = target.x - owner.x;
      const dy = target.y - owner.y;
      const world = owner.theta + connector.angle;
      const ux = Math.cos(world);
      const uy = Math.sin(world);
      const along = dx * ux + dy * uy;
      const off = Math.abs(dx * uy - dy * ux);
      if (Math.hypot(dx, dy) < 1e-4) continue;
      links.push({
        owner,
        connector,
        target,
        ux,
        uy,
        stem: stemForDistance(owner, along > 0.2 ? along : Math.hypot(dx, dy)),
        perp: along > 0.2 ? off : Number.POSITIVE_INFINITY,
        primary: false,
      });
    }
  }
  const incoming = new Map<string, SeatLink[]>();
  for (const link of links) {
    const list = incoming.get(link.target.id) ?? [];
    list.push(link);
    incoming.set(link.target.id, list);
  }
  for (const list of incoming.values()) {
    list.sort((a, b) => a.perp - b.perp || a.owner.id.localeCompare(b.owner.id));
    const chosen = list[0];
    chosen.primary = true;
    if (chosen.perp === Number.POSITIVE_INFINITY) {
      const dx = chosen.target.x - chosen.owner.x;
      const dy = chosen.target.y - chosen.owner.y;
      const world = Math.atan2(dy, dx);
      chosen.connector.angle = wrapAngle(world - chosen.owner.theta);
      chosen.ux = Math.cos(world);
      chosen.uy = Math.sin(world);
      chosen.perp = 0;
      chosen.stem = stemForDistance(chosen.owner, Math.hypot(dx, dy));
    }
  }
  for (const link of links) {
    if (!link.primary && link.connector.stem > 0) link.stem = link.connector.stem;
  }
  shareStemLengths(links);

  const placed = new Set<string>();
  const visiting = new Set<string>();
  const ensure = (ring: RingBody): void => {
    if (placed.has(ring.id) || visiting.has(ring.id)) return;
    visiting.add(ring.id);
    const link = incoming.get(ring.id)?.find((item) => item.primary);
    if (link) ensure(link.owner);
    if (link && placed.has(link.owner.id)) {
      const { reach } = claspReach(link.owner, link.connector.stem);
      ring.x = link.owner.x + link.ux * reach;
      ring.y = link.owner.y + link.uy * reach;
    }
    visiting.delete(ring.id);
    placed.add(ring.id);
  };
  for (const ring of board.rings) ensure(ring);

  const claspError = (link: SeatLink): number => {
    const { reach } = claspReach(link.owner, link.connector.stem);
    const cx = link.owner.x + link.ux * reach;
    const cy = link.owner.y + link.uy * reach;
    return Math.hypot(link.target.x - cx, link.target.y - cy);
  };
  const putTargetOnClasp = (link: SeatLink): void => {
    const { reach } = claspReach(link.owner, link.connector.stem);
    link.target.x = link.owner.x + link.ux * reach;
    link.target.y = link.owner.y + link.uy * reach;
  };
  const walking = new Set<string>();
  const follow = (ring: RingBody): void => {
    if (walking.has(ring.id)) return;
    walking.add(ring.id);
    for (const out of links) {
      if (out.owner.id !== ring.id) continue;
      putTargetOnClasp(out);
      follow(out.target);
    }
    walking.delete(ring.id);
  };
  const slid = new Set<string>();
  const pullOwner = (link: SeatLink): void => {
    if (slid.has(`${link.owner.id}>${link.target.id}`)) return;
    slid.add(`${link.owner.id}>${link.target.id}`);
    const { reach } = claspReach(link.owner, link.connector.stem);
    link.owner.x = link.target.x - link.ux * reach;
    link.owner.y = link.target.y - link.uy * reach;
    follow(link.owner);
    settle(link.owner);
  };
  const settle = (ring: RingBody): void => {
    for (const link of incoming.get(ring.id) ?? []) {
      if (claspError(link) < 1e-3) continue;
      pullOwner(link);
    }
  };
  for (const link of links) {
    if (link.primary || claspError(link) < 1e-3) continue;
    const dx = link.target.x - link.owner.x;
    const dy = link.target.y - link.owner.y;
    const along = dx * link.ux + dy * link.uy;
    if (along <= 0.2) {
      const world = Math.atan2(dy, dx);
      link.connector.angle = wrapAngle(world - link.owner.theta);
      link.ux = Math.cos(world);
      link.uy = Math.sin(world);
    }
    putTargetOnClasp(link);
    follow(link.target);
    settle(link.target);
  }
}

/** Shift the whole level so its drawn bounds sit on the screen center, (0, 0). */
export function centerBoard(board: Board): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const ring of board.rings) {
    add(ring.x - ring.outer, ring.y - ring.outer);
    add(ring.x + ring.outer, ring.y + ring.outer);
  }
  for (const bar of board.bars) {
    const cx = bar.x0 + (bar.x1 - bar.x0) * bar.t;
    const cy = bar.y0 + (bar.y1 - bar.y0) * bar.t;
    const len = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) || 1;
    const ux = (bar.x1 - bar.x0) / len;
    const uy = (bar.y1 - bar.y0) / len;
    for (const sign of [-1, 1]) {
      add(cx + ux * bar.grip * sign - uy * bar.half, cy + uy * bar.grip * sign + ux * bar.half);
      add(cx + ux * bar.grip * sign + uy * bar.half, cy + uy * bar.grip * sign - ux * bar.half);
    }
  }
  if (!Number.isFinite(minX)) return;
  const dx = (minX + maxX) / 2;
  const dy = (minY + maxY) / 2;
  if (Math.hypot(dx, dy) < 1e-4) return;
  for (const ring of board.rings) {
    ring.x -= dx;
    ring.y -= dy;
  }
  for (const bar of board.bars) {
    bar.x0 -= dx;
    bar.y0 -= dy;
    bar.x1 -= dx;
    bar.y1 -= dy;
  }
  for (const pin of board.pins) {
    pin.x -= dx;
    pin.y -= dy;
  }
  for (const latch of board.latches) {
    latch.x -= dx;
    latch.y -= dy;
  }
  syncPins(board);
}

export async function saveLevel(index: number, board: Board): Promise<void> {
  syncCatchPins(board);
  const response = await fetch(`./__levels/${index}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(board, null, 2),
  });
  if (!response.ok) throw new Error(await response.text());
}
