import type { PlayHandles } from './play';
import { hapticFeel, hapticLabel, pulseHaptic, resetHapticFeel, setHapticPair, type HapticKind } from './hapticFeel';
import type { BarBody, Board, RingBody } from './board';
import { syncPins } from './board';
import { wrapAngle } from './angle';
import { PART } from './parts';
import {
  LEVEL_COUNT,
  PALETTE,
  colorsClash,
  defaultStem,
  emptyBoard,
  freshColor,
  loadLevel,
  makeRing,
  centerBoard,
  saveLevel,
  seatConnectors,
  stripHandlePins,
} from './levelio';

type Tool = 'move' | 'turn';

type Selection =
  | { kind: 'ring'; id: string; connector: number | null }
  | { kind: 'bar'; id: string }
  | null;

/**
 * Level editor on #ui-root. Edit mode drags pieces. Play mode uses the puzzle rules.
 * Angle 0 is +X and increases counterclockwise, the same θ the meshes use.
 */
export function mountEditor(
  play: PlayHandles,
  setStatus: (text: string) => void,
  hud: { setLevel: (level: number) => void; resetMoves: () => void } = {
    setLevel: () => {},
    resetMoves: () => {},
  },
): { advance: () => void; replay: () => void } {
  const levelHost = document.getElementById('levels');
  const editorPanel = document.getElementById('editor');
  if (!levelHost || !editorPanel) return { advance: () => {}, replay: () => {} };

  let level = 1;
  let tool: Tool = 'move';
  let levelMode = false;
  let settingsOpen = false;
  let mode: 'edit' | 'play' = 'play';
  let sheet = false;
  let authored: Board = emptyBoard();
  let selection: Selection = null;
  let drag: { x: number; y: number; x0: number; y0: number; x1: number; y1: number } | null = null;

  function ringOf(id: string): RingBody | undefined {
    return authored.rings.find((ring) => ring.id === id);
  }

  function barOf(id: string): BarBody | undefined {
    return authored.bars.find((bar) => bar.id === id);
  }

  function alignBuckles(): void {
    for (const bar of authored.bars) {
      const latch = authored.latches.find((item) => item.barId === bar.id && item.release === 'sleeve');
      if (!latch) continue;
      latch.x = bar.x0 + (bar.x1 - bar.x0) * bar.t;
      latch.y = bar.y0 + (bar.y1 - bar.y0) * bar.t;
    }
  }

  function commit(refreshUi = true): void {
    alignBuckles();
    stripHandlePins(authored);
    syncPins(authored);
    play.replace(structuredClone(authored));
    play.setEditing(mode === 'edit');
    if (selection) play.select(selection.id);
    if (refreshUi) render();
  }

  function render(): void {
    if (!levelHost || !editorPanel) return;
    document.getElementById('dock')?.classList.toggle('is-compact', !levelMode && !settingsOpen);
    levelHost.replaceChildren();
    document.getElementById('hud-settings')?.classList.toggle('is-on', settingsOpen);
    document.getElementById('hud-settings')?.setAttribute('aria-pressed', settingsOpen ? 'true' : 'false');
    editorPanel.replaceChildren();
    if (settingsOpen) editorPanel.append(settingsPane());
    if (!levelMode) {
      play.setEditing(false);
      return;
    }
    for (let n = 1; n <= LEVEL_COUNT; n += 1) {
      levelHost.append(button(String(n), () => void open(n), n === level));
    }
    levelHost.append(button(mode === 'edit' ? '试玩' : '编辑', () => toggleMode()));
    levelHost.append(button('保存', () => void persist()));

    if (mode === 'play') return;

    editorPanel.append(selectionLine());

    const tools = document.createElement('div');
    tools.className = 'row';
    tools.append(button('移动', () => { tool = 'move'; render(); }, tool === 'move'));
    tools.append(button('转动', () => { tool = 'turn'; render(); }, tool === 'turn'));
    tools.append(button('加环', () => addRing()));
    tools.append(button('加杆', () => addBar()));
    if (selection) tools.append(button('删除', () => removeSelected()));
    tools.append(button(sheet ? '收起' : '属性', () => {
      sheet = !sheet;
      render();
    }, sheet));
    editorPanel.append(slider('镜头', play.zoomT(), 0, 1, 0.01, (t) => play.setZoomT(t)));
    editorPanel.append(slider('上下', play.panT(), 0, 1, 0.01, (t) => play.setPanT(t)));
    editorPanel.append(tools);

    if (!sheet) return;
    const detail = document.createElement('div');
    detail.className = 'editor-sheet';
    editorPanel.append(detail);
    if (!selection) {
      const note = document.createElement('p');
      note.className = 'log';
      note.textContent = '先点一个部件。拖空白处可以看全画面。';
      detail.append(note);
      return;
    }
    if (selection.kind === 'ring') renderRing(detail, selection.id, selection.connector);
    else renderBar(detail, selection.id);
  }

  function renderRing(root: HTMLElement, id: string, connectorIndex: number | null): void {
    const ring = ringOf(id);
    if (!ring) return;
    root.append(label(`环 ${ring.id}`));
    root.append(slider('大小', ring.outer, 0.35, 1.3, 0.01, (value) => {
      ring.outer = value;
      ring.inner = value * (1 - PART.bandRatio);
      commit(false);
    }));
    root.append(numberField('位置 x', ring.x, 0.01, (value) => {
      ring.x = value;
      commit(false);
    }));
    root.append(numberField('位置 y', ring.y, 0.01, (value) => {
      ring.y = value;
      commit(false);
    }));
    root.append(numberField('角度 °', toDegrees(ring.theta), 0.1, (value) => {
      ring.theta = fromDegrees(value);
      commit(false);
    }));
    const colors = document.createElement('div');
    colors.className = 'row';
    for (const color of PALETTE) {
      const chip = button('', () => setRingColor(ring, color));
      chip.style.background = `#${color.toString(16).padStart(6, '0')}`;
      chip.style.minWidth = '28px';
      if (ring.color === color) chip.style.outline = '2px solid #fff';
      colors.append(chip);
    }
    root.append(colors);
    root.append(button('加柄', () => {
      ring.connectors.push({ angle: 0, stem: defaultStem(ring.outer), target: null });
      selection = { kind: 'ring', id, connector: ring.connectors.length - 1 };
      commit();
    }));
    ring.connectors.forEach((_, index) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.append(button(`柄 ${index + 1}`, () => {
        selection = { kind: 'ring', id, connector: index };
        render();
      }, connectorIndex === index));
      root.append(row);
    });
    if (connectorIndex === null) return;
    const connector = ring.connectors[connectorIndex];
    if (!connector) return;
    root.append(numberField('柄的角度 °', toDegrees(connector.angle), 0.1, (value) => {
      connector.angle = fromDegrees(value);
      commit(false);
    }));
    root.append(slider('直杆长度', connector.stem, 0.04, 1.2, 0.01, (value) => {
      connector.stem = value;
      commit(false);
    }));
    const pick = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '不连接';
    pick.append(none);
    for (const other of authored.rings) {
      if (other.id === ring.id) continue;
      const option = document.createElement('option');
      option.value = other.id;
      option.textContent = other.id;
      option.disabled = colorsClash(authored, ring.id, other.id);
      if (connector.target === other.id) option.selected = true;
      pick.append(option);
    }
    pick.addEventListener('change', () => {
      const target = pick.value || null;
      if (target && colorsClash(authored, ring.id, target)) {
        setStatus('相连的两件颜色不能一样');
        render();
        return;
      }
      connector.target = target;
      commit();
    });
    root.append(pick);
    root.append(button('删这只柄', () => {
      ring.connectors.splice(connectorIndex, 1);
      selection = { kind: 'ring', id, connector: null };
      commit();
    }));
  }

  function renderBar(root: HTMLElement, id: string): void {
    const bar = barOf(id);
    if (!bar) return;
    root.append(label(`杆 ${bar.id}`));
    const angle = Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0);
    root.append(numberField('位置 x', (bar.x0 + bar.x1) / 2, 0.01, (value) => {
      moveBar(bar, value - (bar.x0 + bar.x1) / 2, 0);
      commit(false);
    }));
    root.append(numberField('位置 y', (bar.y0 + bar.y1) / 2, 0.01, (value) => {
      moveBar(bar, 0, value - (bar.y0 + bar.y1) / 2);
      commit(false);
    }));
    root.append(numberField('角度 °', toDegrees(angle), 0.1, (value) => {
      spinBar(bar, fromDegrees(value));
      commit(false);
    }));
    root.append(slider('棍长', bar.grip * 2, 0.3, 3, 0.01, (value) => {
      bar.grip = value / 2;
      commit(false);
    }));
  }

  function setRingColor(ring: RingBody, color: number): void {
    const previous = ring.color;
    ring.color = color;
    for (const connector of ring.connectors) {
      if (connector.target && colorsClash(authored, ring.id, connector.target)) {
        ring.color = previous;
        setStatus('这只环和它锁住的环不能同色');
        render();
        return;
      }
    }
    for (const other of authored.rings) {
      if (other.connectors.some((connector) => connector.target === ring.id) && colorsClash(authored, other.id, ring.id)) {
        ring.color = previous;
        setStatus('这只环和锁住它的环不能同色');
        render();
        return;
      }
    }
    commit();
  }

  function addRing(): void {
    const ring = makeRing(authored);
    while (authored.rings.some((item) => item.id === ring.id)) ring.id = `${ring.id}b`;
    authored.rings.push(ring);
    selection = { kind: 'ring', id: ring.id, connector: null };
    commit();
  }

  function addBar(): void {
    const n = authored.bars.length + 1;
    const id = `bar-${n}`;
    const color = freshColor(authored);
    authored.bars.push({
      id,
      kind: 'bar',
      x0: -0.9,
      y0: -0.4 * n,
      x1: 0.9,
      y1: -0.4 * n,
      half: (PART.outer * PART.bandRatio * PART.scale) / 2,
      grip: 0.72 * PART.scale * 1.5,
      t: 0.5,
      color,
    });
    authored.latches.push({
      id: `buckle-${id}`,
      barId: id,
      x: 0,
      y: -0.4 * n,
      t0: 0,
      t1: 0,
      release: 'sleeve',
    });
    selection = { kind: 'bar', id };
    commit();
  }

  function removeSelected(): void {
    if (!selection) return;
    if (selection.kind === 'ring') {
      authored.rings = authored.rings.filter((ring) => ring.id !== selection?.id);
      for (const ring of authored.rings) {
        for (const connector of ring.connectors) {
          if (connector.target === selection?.id) connector.target = null;
        }
      }
      authored.pins = authored.pins.filter((pin) => pin.ownerId !== selection?.id);
    } else {
      authored.bars = authored.bars.filter((bar) => bar.id !== selection?.id);
      authored.latches = authored.latches.filter((latch) => latch.barId !== selection?.id);
    }
    selection = null;
    commit();
  }

  function toggleMode(): void {
    mode = mode === 'edit' ? 'play' : 'edit';
    if (mode === 'play') sheet = false;
    drag = null;
    play.setEditing(mode === 'edit');
    play.replace(structuredClone(authored));
    if (selection && mode === 'edit') play.select(selection.id);
    setStatus(mode === 'edit' ? `编辑第 ${level} 关` : '');
    render();
  }

  async function open(index: number): Promise<void> {
    level = index;
    mode = levelMode ? 'edit' : 'play';
    selection = null;
    drag = null;
    authored = await loadLevel(index);
    hud.setLevel(level);
    hud.resetMoves();
    play.setEditing(true);
    commit();
    play.frame();
    setStatus(mode === 'edit' ? `编辑第 ${level} 关` : '');
  }

  async function persist(): Promise<void> {
    try {
      seatConnectors(authored);
      centerBoard(authored);
      commit();
      play.frame();
      await saveLevel(level, authored);
      setStatus(`已保存第 ${level} 关，已对准并放到画面中心`);
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  function settingsPane(): HTMLDivElement {
    const pane = document.createElement('div');
    pane.className = 'settings';
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = '关卡模式';
    row.append(name);
    row.append(button(levelMode ? '开' : '关', () => {
      levelMode = !levelMode;
      settingsOpen = false;
      sheet = false;
      selection = null;
      mode = levelMode ? 'edit' : 'play';
      play.setEditing(levelMode);
      play.select(null);
      if (levelMode) commit();
      else render();
    }, levelMode));
    pane.append(row);
    pane.append(hapticPane());
    return pane;
  }

  function hapticPane(): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'haptic-tune';
    const title = document.createElement('p');
    title.className = 'panel-title';
    title.textContent = '震动';
    box.append(title);
    const kinds: HapticKind[] = ['grab', 'hit', 'clear'];
    for (const kind of kinds) box.append(hapticRow(kind));
    const reset = button('恢复默认', () => {
      resetHapticFeel();
      render();
    });
    box.append(reset);
    return box;
  }

  function hapticRow(kind: HapticKind): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'haptic-row';
    const name = document.createElement('span');
    name.textContent = hapticLabel(kind);
    const feel = hapticFeel()[kind];
    const intensity = tuneSlider('强度', feel.intensity, (value) => {
      setHapticPair(kind, { intensity: value, sharpness: hapticFeel()[kind].sharpness });
    });
    const sharpness = tuneSlider('锐度', feel.sharpness, (value) => {
      setHapticPair(kind, { intensity: hapticFeel()[kind].intensity, sharpness: value });
    });
    const head = document.createElement('div');
    head.className = 'haptic-head';
    head.append(name, button('试', () => pulseHaptic(kind)));
    row.append(head, intensity, sharpness);
    return row;
  }

  function tuneSlider(name: string, value: number, onInput: (value: number) => void): HTMLLabelElement {
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
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    node.append(caption, input);
    return node;
  }

  function button(text: string, onClick: () => void, pressed = false): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    if (pressed) node.classList.add('is-on');
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return node;
  }

  function selectionLine(): HTMLParagraphElement {
    const node = document.createElement('p');
    node.className = 'pick';
    if (!selection) {
      node.textContent = '还没选中';
      return node;
    }
    const ring = selection.kind === 'ring' ? ringOf(selection.id) : undefined;
    const bar = selection.kind === 'bar' ? barOf(selection.id) : undefined;
    const color = ring?.color ?? bar?.color;
    const swatch = document.createElement('span');
    swatch.className = 'pick-swatch';
    if (color !== undefined) swatch.style.background = `#${color.toString(16).padStart(6, '0')}`;
    const names: Record<number, string> = {
      0x3aa8ff: '蓝',
      0x3dcc73: '绿',
      0xff564c: '红',
      0xff8a2a: '橙',
      0xa86bff: '紫',
      0xf2c14e: '黄',
    };
    const colorName = color !== undefined ? names[color] ?? '' : '';
    const kind = ring ? '环' : '杆';
    const handle = selection.kind === 'ring' && selection.connector !== null ? ` · 柄 ${selection.connector + 1}` : '';
    node.append(swatch, document.createTextNode(`选中 ${colorName}${kind} ${selection.id}${handle}`));
    return node;
  }

  function label(text: string): HTMLParagraphElement {
    const node = document.createElement('p');
    node.className = 'panel-title';
    node.textContent = text;
    return node;
  }

  function toDegrees(radians: number): number {
    const wrapped = ((radians * 180) / Math.PI) % 360;
    const degrees = wrapped < 0 ? wrapped + 360 : wrapped;
    return Math.round(degrees * 10) / 10;
  }

  function fromDegrees(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  function numberField(
    name: string,
    value: number,
    step: number,
    onValue: (value: number) => void,
  ): HTMLLabelElement {
    const node = document.createElement('label');
    node.className = 'editor-slider';
    node.textContent = name;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(Math.round(value * 1000) / 1000);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      if (!Number.isFinite(next)) return;
      onValue(next);
    });
    node.append(input);
    return node;
  }

  function slider(
    name: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onInput: (value: number) => void,
  ): HTMLLabelElement {
    const node = document.createElement('label');
    node.className = 'editor-slider';
    const caption = document.createElement('span');
    const places = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    const show = (next: number) => {
      caption.textContent = `${name} ${next.toFixed(places)}`;
    };
    show(value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      show(next);
      onInput(next);
    });
    node.append(caption, input);
    return node;
  }

  function spinBar(bar: BarBody, angle: number): void {
    const cx = (bar.x0 + bar.x1) / 2;
    const cy = (bar.y0 + bar.y1) / 2;
    const span = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) / 2;
    bar.x0 = cx - Math.cos(angle) * span;
    bar.y0 = cy - Math.sin(angle) * span;
    bar.x1 = cx + Math.cos(angle) * span;
    bar.y1 = cy + Math.sin(angle) * span;
    const latch = authored.latches.find((item) => item.barId === bar.id && item.release === 'sleeve');
    if (latch) {
      latch.x = cx;
      latch.y = cy;
    }
  }

  function moveBar(bar: BarBody, dx: number, dy: number): void {
    bar.x0 += dx;
    bar.y0 += dy;
    bar.x1 += dx;
    bar.y1 += dy;
    const latch = authored.latches.find((item) => item.barId === bar.id && item.release === 'sleeve');
    if (latch) {
      latch.x += dx;
      latch.y += dy;
    }
  }

  const advance = (): void => {
    if (mode === 'edit') return;
    void open(level >= LEVEL_COUNT ? 1 : level + 1);
  };

  const replay = (): void => {
    if (mode === 'edit') return;
    void open(level);
  };

  document.getElementById('hud-settings')?.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    render();
  });

  const canvas = document.querySelector('#stage canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return { advance, replay };

  canvas.addEventListener('pointerdown', (event) => {
    if (mode !== 'edit') return;
    const world = play.pointerWorld(event, true);
    if (!world) return;
    const hit = play.pickAt(world);
    if (!hit) {
      selection = null;
      play.select(null);
      render();
      return;
    }
    selection = hit.kind === 'ring' ? { kind: 'ring', id: hit.id, connector: selection?.kind === 'ring' && selection.id === hit.id ? selection.connector : null } : { kind: 'bar', id: hit.id };
    const bar = hit.kind === 'bar' ? barOf(hit.id) : undefined;
    drag = {
      x: world.x,
      y: world.y,
      x0: bar?.x0 ?? 0,
      y0: bar?.y0 ?? 0,
      x1: bar?.x1 ?? 0,
      y1: bar?.y1 ?? 0,
    };
    canvas.setPointerCapture(event.pointerId);
    render();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (mode !== 'edit' || !drag || !selection) return;
    const world = play.pointerWorld(event, false);
    if (!world) return;
    if (selection.kind === 'ring') {
      const ring = ringOf(selection.id);
      if (!ring) return;
      if (tool === 'move') {
        ring.x += world.x - drag.x;
        ring.y += world.y - drag.y;
        drag.x = world.x;
        drag.y = world.y;
      } else {
        const lever = (ring.inner + ring.outer) / 2;
        const rx = drag.x - ring.x;
        const ry = drag.y - ring.y;
        const lever2 = Math.max(rx * rx + ry * ry, lever * lever);
        ring.theta = wrapAngle(ring.theta + (rx * (world.y - drag.y) - ry * (world.x - drag.x)) / lever2);
        drag.x = world.x;
        drag.y = world.y;
      }
    } else {
      const bar = barOf(selection.id);
      if (!bar) return;
      if (tool === 'move') {
        moveBar(bar, world.x - drag.x, world.y - drag.y);
        drag.x = world.x;
        drag.y = world.y;
      } else {
        const cx = (drag.x0 + drag.x1) / 2;
        const cy = (drag.y0 + drag.y1) / 2;
        const a0 = Math.atan2(drag.y - cy, drag.x - cx);
        const a1 = Math.atan2(world.y - cy, world.x - cx);
        const base = Math.atan2(drag.y1 - drag.y0, drag.x1 - drag.x0);
        spinBar(bar, base + (a1 - a0));
      }
    }
    stripHandlePins(authored);
    play.pose(structuredClone(authored));
    play.select(selection.id);
  });

  canvas.addEventListener('pointerup', () => {
    if (mode !== 'edit') return;
    drag = null;
    render();
  });

  void open(1);

  return { advance, replay };
}
