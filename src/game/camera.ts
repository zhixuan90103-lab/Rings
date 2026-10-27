/**
 * Orthographic window onto the XY board.
 * The camera sits on +Z and looks toward −Z, so screen-right is world +X
 * and screen-up is world +Y. Design y grows downward; world y grows upward.
 * Zoom and pan live on the camera. This module is the only place that turns
 * a design point into that window.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import type { Board } from './board';
import { buckleMetrics, connectorReach, PART } from './parts';

export const VIEW_H = 10;
/** Empty design pixels kept around the level, inside the chrome. */
export const FRAME_MARGIN = 24;

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

export type UsableRect = { left: number; top: number; right: number; bottom: number };

export type Frame = {
  minZoom: number;
  maxZoom: number;
  /** NDC of the usable rect's center. (0, 0) is the full design center. */
  nx: number;
  ny: number;
  /** World size of the usable rect when zoom is 1. */
  worldW: number;
  worldH: number;
};

export function viewSize(): { w: number; h: number } {
  return { w: VIEW_H * (DESIGN_WIDTH / DESIGN_HEIGHT), h: VIEW_H };
}

/** Design pixel to NDC. (0, 0) is the top-left of the 390×844 stage. */
export function designNdc(dx: number, dy: number): { x: number; y: number } {
  return {
    x: (dx / DESIGN_WIDTH) * 2 - 1,
    y: -((dy / DESIGN_HEIGHT) * 2 - 1),
  };
}

export function worldFromDesign(
  dx: number,
  dy: number,
  camX: number,
  camY: number,
  zoom: number,
): { x: number; y: number } {
  const ndc = designNdc(dx, dy);
  const { w, h } = viewSize();
  const z = Math.max(zoom, 1e-4);
  return {
    x: camX + (ndc.x * (w / 2)) / z,
    y: camY + (ndc.y * (h / 2)) / z,
  };
}

export function boardBounds(board: Board): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const ring of board.rings) {
    const band = ring.outer * PART.bandRatio;
    let reach = ring.outer;
    for (const connector of ring.connectors) {
      reach = Math.max(reach, connectorReach(ring.outer, band, connector.stem));
    }
    add(ring.x - reach, ring.y - reach);
    add(ring.x + reach, ring.y + reach);
  }
  const basis = PART.outer * 2 * PART.scale;
  for (const bar of board.bars) {
    const dx = bar.x1 - bar.x0;
    const dy = bar.y1 - bar.y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    for (const [cx, cy] of [[bar.x0, bar.y0], [bar.x1, bar.y1]] as const) {
      for (const along of [-bar.grip, bar.grip]) {
        for (const side of [-bar.half, bar.half]) {
          add(cx + ux * along + px * side, cy + uy * along + py * side);
        }
      }
    }
    const latch = board.latches.find((item) => item.barId === bar.id && item.release === 'sleeve');
    if (!latch) continue;
    const { sleeveLen, sleeveW } = buckleMetrics(bar.half * 2, basis);
    for (const along of [-sleeveLen / 2, sleeveLen / 2]) {
      for (const side of [-sleeveW / 2, sleeveW / 2]) {
        add(latch.x + ux * along + px * side, latch.y + uy * along + py * side);
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

export function frameFor(bounds: Aabb, usable: UsableRect): Frame {
  const { w, h } = viewSize();
  const widthPx = Math.max(usable.right - usable.left, 1);
  const heightPx = Math.max(usable.bottom - usable.top, 1);
  const worldW = (widthPx / DESIGN_WIDTH) * w;
  const worldH = (heightPx / DESIGN_HEIGHT) * h;
  const cx = (usable.left + usable.right) / 2;
  const cy = (usable.top + usable.bottom) / 2;
  const ndc = designNdc(cx, cy);
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-3);
  const minZoom = Math.min(worldW / bw, worldH / bh);
  return { minZoom, maxZoom: minZoom, nx: ndc.x, ny: ndc.y, worldW, worldH };
}

/** Largest ring radius on the board. Screen size is this times zoom. */
export function largestRing(board: Board): number {
  let outer = 0;
  for (const ring of board.rings) outer = Math.max(outer, ring.outer);
  return outer;
}

/**
 * Zoom where this level's largest ring matches the reference ring's size
 * at the reference fit zoom. Never below the level's own fit zoom.
 */
export function zoomCap(outer: number, minZoom: number, referenceOuter: number, referenceZoom: number): number {
  if (outer <= 0 || referenceOuter <= 0) return minZoom;
  return Math.max(minZoom, referenceZoom * (referenceOuter / outer));
}

/** Camera x/y is the center of the full stage, not the usable rect. */
export function cameraForFit(bounds: Aabb, frame: Frame): { x: number; y: number; zoom: number } {
  const { w, h } = viewSize();
  const zoom = frame.minZoom;
  const ox = (frame.nx * (w / 2)) / zoom;
  const oy = (frame.ny * (h / 2)) / zoom;
  return {
    x: (bounds.minX + bounds.maxX) / 2 - ox,
    y: (bounds.minY + bounds.maxY) / 2 - oy,
    zoom,
  };
}

/** Design pixels of movement before a two-finger gesture locks to zoom or pan. */
export const PINCH_LOCK_PX = 12;

export type PinchLock = 'zoom' | 'pan';

/** The first action to pass the lock distance wins for the rest of the gesture. */
export function choosePinchLock(
  midShift: number,
  distShift: number,
  previous: PinchLock | null,
): PinchLock | null {
  if (previous) return previous;
  if (midShift < PINCH_LOCK_PX && distShift < PINCH_LOCK_PX) return null;
  return distShift >= midShift ? 'zoom' : 'pan';
}

/** Puts the world point that was under the first midpoint under the current midpoint. */
export function cameraForPinch(
  start: { x: number; y: number; zoom: number; midX: number; midY: number },
  midX: number,
  midY: number,
  zoom: number,
): { x: number; y: number } {
  const world = worldFromDesign(start.midX, start.midY, start.x, start.y, start.zoom);
  const ndc = designNdc(midX, midY);
  const { w, h } = viewSize();
  const z = Math.max(zoom, 1e-4);
  return {
    x: world.x - (ndc.x * (w / 2)) / z,
    y: world.y - (ndc.y * (h / 2)) / z,
  };
}

/**
 * Pulls the usable window back inside the level, or the level back inside the
 * window when the level is smaller. Zoom is already final and is not changed.
 */
export function clampCamera(
  camX: number,
  camY: number,
  zoom: number,
  bounds: Aabb,
  frame: Frame,
): { x: number; y: number; zoom: number } {
  const { w, h } = viewSize();
  const z = Math.max(zoom, 1e-4);
  const halfW = frame.worldW / 2 / z;
  const halfH = frame.worldH / 2 / z;
  const ox = (frame.nx * (w / 2)) / z;
  const oy = (frame.ny * (h / 2)) / z;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const roomX = Math.abs(halfW - (bounds.maxX - bounds.minX) / 2);
  const roomY = Math.abs(halfH - (bounds.maxY - bounds.minY) / 2);
  const ux = Math.min(cx + roomX, Math.max(cx - roomX, camX + ox));
  const uy = Math.min(cy + roomY, Math.max(cy - roomY, camY + oy));
  return { x: ux - ox, y: uy - oy, zoom };
}
