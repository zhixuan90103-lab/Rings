/**
 * Unlock praise at a design-space point. Candy type matches the reference:
 * heavy rounded letters, white stroke, top-to-bottom color.
 */

/** Weakest to best. The caller passes 1..4. */
const LINES = [
  { text: 'Great!', top: '#c8ff72', bottom: '#2fbe28' },
  { text: 'Perfect', top: '#ffe56a', bottom: '#ff8a1a' },
  { text: 'Excellent!', top: '#9ad8ff', bottom: '#2b86ff' },
  { text: 'Amazing', top: '#ee9bff', bottom: '#7a34ee' },
] as const;

let serial = 0;

export function showPraise(x: number, y: number, cleared: number): void {
  const host = document.getElementById('ui-root');
  if (!host) return;
  const line = LINES[Math.min(Math.max(cleared, 1), LINES.length) - 1];
  const id = `praise-fill-${serial}`;
  serial += 1;

  const node = document.createElement('div');
  node.className = 'praise';
  node.style.left = `${x}px`;
  node.style.top = `${y - 56}px`;
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
