import type { Board, RingBody } from './board';
import { syncPins } from './board';
import { wrapAngle } from './angle';
import { boardBounds } from './camera';
import { PART, connectorLayout, connectorMetrics } from './parts';
import type { RingConnector } from './board';

export const LEVEL_COUNT = 5;

let bundledLevels: Record<string, Board> = {};

/** Called once at startup with the JSON packed by Vite. Tests leave this empty. */
export function usePackedLevels(levels: Record<string, Board>): void {
  bundledLevels = levels;
}

function bundledBoard(index: number): Board | undefined {
  const entry = Object.entries(bundledLevels).find(([file]) => file.endsWith(`/${index}.json`));
  return entry?.[1];
}

function bundledCount(): number {
  let count = 0;
  for (let n = 1; n <= 99; n += 1) {
    if (!bundledBoard(n)) break;
    count = n;
  }
  return count;
}

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

/** Drop handle pins left over from older saves. The arc on `connectors` is the handle. */
export function stripHandlePins(board: Board): void {
  board.pins = board.pins.filter((pin) => !pin.id.startsWith('catch:'));
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

function normalizeLevel(data: Board): Board {
  data.rings ??= [];
  data.bars ??= [];
  data.pins ??= [];
  data.latches ??= [];
  data.volumes = true;
  for (const ring of data.rings) ring.connectors ??= [];
  stripHandlePins(data);
  return data;
}

export async function loadLevel(index: number): Promise<Board> {
  if (import.meta.env.DEV) {
    const response = await fetch(`./levels/${index}.json`);
    if (response.ok) {
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('json')) return normalizeLevel((await response.json()) as Board);
    }
  }
  const packed = bundledBoard(index);
  if (!packed) return emptyBoard();
  return normalizeLevel(structuredClone(packed));
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

function stemForDistance(owner: RingBody, distance: number): number {
  const { band, bend } = claspReach(owner, 0);
  return Math.max(0.02, distance - bend - owner.outer + band * 0.2);
}

/**
 * Angle and stem that put the visible clasp on this world point.
 * The drawn clasp sits at `claspDist`. The arc center used by alignment is one bend farther out.
 * Angle 0 is +X, counterclockwise.
 */
export function connectorAtHandle(
  owner: RingBody,
  claspX: number,
  claspY: number,
): { angle: number; stem: number } | null {
  const dx = claspX - owner.x;
  const dy = claspY - owner.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-4) return null;
  const band = owner.outer * PART.bandRatio;
  return {
    angle: wrapAngle(Math.atan2(dy, dx) - owner.theta),
    stem: Math.max(0.02, distance - owner.outer + band * 0.2),
  };
}

/** Angle and stem that put the clasp's arc center on this world point. Angle 0 is +X, counterclockwise. */
export function connectorAtClasp(
  owner: RingBody,
  claspX: number,
  claspY: number,
): { angle: number; stem: number } | null {
  const dx = claspX - owner.x;
  const dy = claspY - owner.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-4) return null;
  return {
    angle: wrapAngle(Math.atan2(dy, dx) - owner.theta),
    stem: stemForDistance(owner, distance),
  };
}

/** Rings farther out than this share one x on their side. */
const SIDE_COLUMN = 1;

/**
 * Pull the left column onto one x and the right column onto the opposite x.
 * The shared distance is the average of those rings' current distances from x = 0.
 * Rings between the columns stay where they were placed.
 */
function alignSideColumns(board: Board): void {
  const sides = board.rings.filter((ring) => Math.abs(ring.x) >= SIDE_COLUMN);
  if (sides.length < 2) return;
  const span = sides.reduce((sum, ring) => sum + Math.abs(ring.x), 0) / sides.length;
  for (const ring of sides) ring.x = Math.sign(ring.x) * span;
}

/** Point the handle at the target and set its length so the clasp center is the ring center. */
function aimConnector(owner: RingBody, connector: RingConnector, target: RingBody): void {
  const dx = target.x - owner.x;
  const dy = target.y - owner.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-4) return;
  connector.angle = wrapAngle(Math.atan2(dy, dx) - owner.theta);
  connector.stem = stemForDistance(owner, distance);
}

/**
 * Keep the placed ring centers. Side columns share one x.
 * Each handle is then aimed so its clasp center lands on the target ring.
 * Angle 0 stays +X, counterclockwise.
 */
function aimConnectors(board: Board): void {
  for (const owner of board.rings) {
    for (const connector of owner.connectors) {
      if (!connector.target) continue;
      const target = board.rings.find((ring) => ring.id === connector.target);
      if (!target || target.id === owner.id) continue;
      aimConnector(owner, connector, target);
    }
  }
}

/**
 * Keep bound handles seated while one ring moves.
 * Handles on this ring stay aimed at their targets.
 * Handles on other rings that lock this ring stay aimed at it.
 * A farther ring gets a longer stem. Unbound handles are left alone.
 */
export function followLockedHandles(board: Board, movedId: string): void {
  const moved = board.rings.find((ring) => ring.id === movedId);
  if (!moved) return;
  for (const connector of moved.connectors) {
    if (!connector.target) continue;
    const target = board.rings.find((ring) => ring.id === connector.target);
    if (!target || target.id === moved.id) continue;
    aimConnector(moved, connector, target);
  }
  for (const other of board.rings) {
    if (other.id === movedId) continue;
    for (const connector of other.connectors) {
      if (connector.target !== movedId) continue;
      aimConnector(other, connector, moved);
    }
  }
}

/** Pull side rings onto one shared left x and one shared right x, then re-aim handles. */
export function alignColumns(board: Board): void {
  alignSideColumns(board);
  aimConnectors(board);
}

export function seatConnectors(board: Board): void {
  for (const owner of board.rings) {
    for (const connector of owner.connectors) bindConnector(board, owner, connector);
  }
  alignColumns(board);
}

/** Shift the whole level so its drawn bounds sit on the screen center, (0, 0). */
export function centerBoard(board: Board): void {
  const box = boardBounds(board);
  if (!Number.isFinite(box.minX)) return;
  const dx = (box.minX + box.maxX) / 2;
  const dy = (box.minY + box.maxY) / 2;
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

/** How many levels ship in order from 1. The phone build uses the files packed into the app. */
export async function fetchLevelCount(): Promise<number> {
  if (import.meta.env.DEV) {
    let count = 0;
    for (let n = 1; n <= 99; n += 1) {
      const response = await fetch(`./levels/${n}.json`);
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.includes('json')) break;
      count = n;
    }
    if (count > 0) return count;
  }
  return Math.max(bundledCount(), 1);
}

export async function createLevel(): Promise<number> {
  const response = await fetch('./__levels', { method: 'POST' });
  if (!response.ok) throw new Error(await response.text());
  const data = (await response.json()) as { index: number };
  return data.index;
}

export async function deleteLevel(index: number): Promise<void> {
  const response = await fetch(`./__levels/${index}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await response.text());
}

export async function saveLevel(index: number, board: Board): Promise<void> {
  stripHandlePins(board);
  const response = await fetch(`./__levels/${index}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(board, null, 2),
  });
  if (!response.ok) throw new Error(await response.text());
}
