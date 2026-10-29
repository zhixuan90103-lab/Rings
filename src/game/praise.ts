/**
 * Praise for a clear. The rank is separate from the candy label.
 * 0 is silence. 1 Great, 2 Perfect, 3 Excellent, 4 Amazing.
 * The word stays inside the 390×844 stage, including its rise.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';

export type PraiseCombo = {
  /** 0 before any shown word. Caps at 4. */
  rank: number;
  /** A streak has already had its first clear. */
  live: boolean;
};

const LINES = [
  { text: 'Great!', top: '#c8ff72', bottom: '#2fbe28' },
  { text: 'Perfect', top: '#ffe56a', bottom: '#ff8a1a' },
  { text: 'Excellent!', top: '#9ad8ff', bottom: '#2b86ff' },
  { text: 'Amazing', top: '#ee9bff', bottom: '#7a34ee' },
] as const;

/** Points for one cleared ring. Index 0 is the silent first clear. */
const CLEAR_POINTS = [100, 200, 300, 400, 500];

/** Rank 0 is 100. Great 200, Perfect 300, Excellent 400, Amazing 500. */
export function clearPoints(rank: number): number {
  const index = Math.max(0, Math.min(CLEAR_POINTS.length - 1, rank));
  return CLEAR_POINTS[index] ?? 100;
}

export function freshPraise(): PraiseCombo {
  return { rank: 0, live: false };
}

/** A collision fault or a new board. The next clear is a first clear again. */
export function breakPraise(combo: PraiseCombo): void {
  combo.rank = 0;
  combo.live = false;
}

/**
 * One successful clear.
 * A first single clear stays silent. A first multi clear shows Perfect.
 * Later clears rise one step, or two when several pieces leave together.
 * Returns 0 when nothing should be shown.
 */
export function notePraiseClear(combo: PraiseCombo, cleared: number): number {
  const steps = cleared >= 2 ? 2 : 1;
  if (!combo.live) {
    combo.live = true;
    combo.rank = steps >= 2 ? 2 : 0;
    return combo.rank;
  }
  combo.rank = Math.min(LINES.length, combo.rank + steps);
  return combo.rank;
}

let serial = 0;

const PRAISE_LIFT = 56;
const PRAISE_RISE = 28;
const PRAISE_DRIFT = 4;
const PRAISE_EDGE = 8;
const WORD_POP = 1.08;
const WORD_SHADOW = 4;

type WordLayout = { viewW: number; viewH: number; drawW: number; drawH: number };

/** The SVG view box and the size it is drawn at. Placement uses the same box. */
function wordLayout(text: string): WordLayout {
  const viewW = text.length * 30 + 36;
  const viewH = 84;
  return { viewW, viewH, drawW: viewW * 0.605, drawH: 50.82 };
}

/** Laid-out size at the biggest moment of the pop, plus the drop shadow. */
export function praiseSize(text: string): { w: number; h: number } {
  const word = wordLayout(text);
  return { w: word.drawW * WORD_POP, h: word.drawH * WORD_POP + WORD_SHADOW };
}

/**
 * Center of the word in design pixels.
 * Prefer 56px above the piece. Flip below when that rise would leave the stage.
 * Shift sideways so the drifted word stays on screen.
 */
export function placePraise(x: number, y: number, text: string): { x: number; y: number; below: boolean } {
  const { w, h } = praiseSize(text);
  const halfW = w / 2;
  const halfH = h / 2;
  const minX = PRAISE_EDGE + halfW;
  const maxX = DESIGN_WIDTH - PRAISE_EDGE - halfW - PRAISE_DRIFT;
  const cx = Math.min(Math.max(x, minX), maxX);
  const minY = PRAISE_EDGE + halfH;
  const maxY = DESIGN_HEIGHT - PRAISE_EDGE - halfH;
  const above = y - PRAISE_LIFT;
  if (above - PRAISE_RISE >= minY && above <= maxY) return { x: cx, y: above, below: false };
  let below = y + PRAISE_LIFT;
  if (below + PRAISE_RISE > maxY) below = maxY - PRAISE_RISE;
  if (below < minY) below = minY;
  return { x: cx, y: below, below: true };
}

export function showPraise(x: number, y: number, rank: number): void {
  const host = document.getElementById('ui-root');
  if (!host || rank <= 0) return;
  const line = LINES[Math.min(rank, LINES.length) - 1];
  const id = `praise-fill-${serial}`;
  serial += 1;
  const spot = placePraise(x, y, line.text);
  const word = wordLayout(line.text);

  const node = document.createElement('div');
  node.className = spot.below ? 'praise is-below' : 'praise';
  node.style.left = `${spot.x}px`;
  node.style.top = `${spot.y}px`;
  node.innerHTML = `<svg viewBox="0 0 ${word.viewW} ${word.viewH}" width="${word.drawW}" height="${word.drawH}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line.top}"/>
        <stop offset="55%" stop-color="${line.top}"/>
        <stop offset="100%" stop-color="${line.bottom}"/>
      </linearGradient>
    </defs>
    <text x="${word.viewW / 2}" y="62" text-anchor="middle"
      fill="url(#${id})" stroke="#ffffff" stroke-width="13" stroke-linejoin="round" paint-order="stroke">${line.text}</text>
  </svg>`;
  host.append(node);
  node.addEventListener('animationend', (event) => {
    if (event.target !== node) return;
    if (event.animationName !== 'praise-rise' && event.animationName !== 'praise-drop') return;
    node.remove();
  });
}
