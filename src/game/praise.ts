/**
 * Praise for a clear. The rank is separate from the candy label.
 * 0 is silence. 1 Great, 2 Perfect, 3 Excellent, 4 Amazing.
 */

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

export function showPraise(x: number, y: number, rank: number): void {
  const host = document.getElementById('ui-root');
  if (!host || rank <= 0) return;
  const line = LINES[Math.min(rank, LINES.length) - 1];
  const id = `praise-fill-${serial}`;
  serial += 1;

  const node = document.createElement('div');
  node.className = 'praise';
  node.style.left = `${x}px`;
  node.style.top = `${y - PRAISE_LIFT}px`;
  const width = line.text.length * 30 + 36;
  node.innerHTML = `<svg viewBox="0 0 ${width} 84" width="${width * 0.605}" height="50.82" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line.top}"/>
        <stop offset="55%" stop-color="${line.top}"/>
        <stop offset="100%" stop-color="${line.bottom}"/>
      </linearGradient>
    </defs>
    <text x="${width / 2}" y="62" text-anchor="middle"
      fill="url(#${id})" stroke="#ffffff" stroke-width="13" stroke-linejoin="round" paint-order="stroke">${line.text}</text>
  </svg>`;
  host.append(node);
  node.addEventListener('animationend', (event) => {
    if (event.target !== node || event.animationName !== 'praise-rise') return;
    node.remove();
  });
}
