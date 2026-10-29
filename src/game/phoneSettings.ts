import { hapticFeel, hapticLabel, resetHapticFeel, setHapticPair, type HapticKind } from './hapticFeel';

/** Phone gear: haptic test and the play intensities. Not the level editor. */
export function mountPhoneSettings(): void {
  const gear = document.getElementById('hud-settings');
  const panel = document.getElementById('haptic-panel');
  const tune = document.getElementById('haptic-tune');
  if (!(gear instanceof HTMLButtonElement) || !panel || !tune) return;

  fillTune(tune);

  gear.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    panel.classList.toggle('is-open', open);
    panel.toggleAttribute('hidden', !open);
    gear.classList.toggle('is-on', open);
    gear.setAttribute('aria-pressed', open ? 'true' : 'false');
  });
}

function fillTune(tune: HTMLElement): void {
  tune.replaceChildren();
  const kinds: HapticKind[] = ['grab', 'hit', 'ready', 'clear'];
  const title = document.createElement('p');
  title.className = 'panel-title';
  title.textContent = '试玩震动';
  tune.append(title);
  for (const kind of kinds) tune.append(row(kind));
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '恢复默认';
  reset.addEventListener('click', () => {
    resetHapticFeel();
    fillTune(tune);
  });
  tune.append(reset);
}

function row(kind: HapticKind): HTMLDivElement {
  const feel = hapticFeel()[kind];
  const line = document.createElement('div');
  line.className = 'haptic-row';
  const head = document.createElement('div');
  head.className = 'haptic-head';
  const name = document.createElement('span');
  name.textContent = hapticLabel(kind);
  head.append(name);
  line.append(head, slider('强度', feel.intensity, (value) => {
    setHapticPair(kind, { intensity: value, sharpness: hapticFeel()[kind].sharpness });
  }), slider('锐度', feel.sharpness, (value) => {
    setHapticPair(kind, { intensity: hapticFeel()[kind].intensity, sharpness: value });
  }));
  return line;
}

function slider(name: string, value: number, onInput: (value: number) => void): HTMLLabelElement {
  const node = document.createElement('label');
  node.className = 'editor-slider';
  const caption = document.createElement('span');
  caption.textContent = `${name} ${value.toFixed(2)}`;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(value);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    caption.textContent = `${name} ${next.toFixed(2)}`;
    onInput(next);
  });
  node.append(caption, input);
  return node;
}
