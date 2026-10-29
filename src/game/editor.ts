import type { PlayHandles } from './play';
import { hapticFeel, hapticLabel, pulseHaptic, resetHapticFeel, setHapticPair, type HapticKind } from './hapticFeel';
import type { BarBody, Board, RingBody } from './board';
import { syncPins } from './board';
import { wrapAngle } from './angle';
import { PART, connectorLayout } from './parts';
import {
  PALETTE,
  colorsClash,
  connectorAtHandle,
  followLockedHandles,
  createLevel,
  deleteLevel,
  emptyBoard,
  fetchLevelCount,
  freshColor,
  loadLevel,
  makeRing,
  alignColumns,
  saveLevel,
  stripHandlePins,
} from './levelio';

const GRID = 0.1;
const TURN_STEP = Math.PI / 12;
const AXIS_HIT = 0.13;
const CENTER_GAP = 0.16;
const TURN_HIT = 0.12;

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
  let count = 1;
  let gridOn = true;
  let settingsOpen = false;
  let mode: 'edit' | 'play' = 'edit';
  let sheet = true;
  let authored: Board = emptyBoard();
  let selection: Selection = null;
  let draft: { ringId: string; grow: { x: number; y: number; angle: number } | null } | null = null;
  let drag: {
    kind: 'free' | 'x' | 'y' | 'turn';
    px: number;
    py: number;
    ox: number;
    oy: number;
    base: number;
  } | null = null;

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
    else syncGuides();
  }

  function render(): void {
    if (!levelHost || !editorPanel) return;
    levelHost.replaceChildren();
    document.getElementById('hud-settings')?.classList.toggle('is-on', settingsOpen);
    document.getElementById('hud-settings')?.setAttribute('aria-pressed', settingsOpen ? 'true' : 'false');
    editorPanel.replaceChildren();
    if (settingsOpen) editorPanel.append(settingsPane());
    levelHost.append(button('上一关', () => void open(level <= 1 ? count : level - 1)));
    const current = document.createElement('span');
    current.textContent = `第 ${level} 关`;
    current.style.alignSelf = 'center';
    current.style.fontWeight = '700';
    levelHost.append(current);
    levelHost.append(button('下一关', () => void open(level >= count ? 1 : level + 1)));
    const jump = document.createElement('input');
    jump.type = 'number';
    jump.min = '1';
    jump.max = String(count);
    jump.step = '1';
    jump.value = String(level);
    jump.ariaLabel = '跳到第几关';
    jump.title = `跳到第几关，共 ${count} 关`;
    jump.style.width = '4.5rem';
    jump.addEventListener('change', () => {
      const next = Math.round(Number(jump.value));
      if (!Number.isFinite(next)) return;
      void open(Math.min(count, Math.max(1, next)));
    });
    levelHost.append(jump);
    levelHost.append(button('加关', () => void addLevel()));
    levelHost.append(button('删关', () => void removeLevel()));
    levelHost.append(button(mode === 'edit' ? '试玩' : '编辑', () => toggleMode()));
    levelHost.append(button('对齐', () => alignSides()));
    levelHost.append(button('保存', () => void persist()));

    if (mode === 'play') {
      play.setGuides(null);
      return;
    }

    editorPanel.append(selectionLine());

    const tools = document.createElement('div');
    tools.className = 'row';
    tools.append(button('网格', () => {
      gridOn = !gridOn;
      render();
    }, gridOn));
    tools.append(button('加环', () => addRing()));
    tools.append(button('加杆', () => addBar()));
    tools.append(button('加手柄', () => beginHandle(), draft !== null));
    if (selection?.kind === 'ring' && selection.connector !== null) {
      tools.append(button('删除柄', () => removeHandle()));
    }
    if (selection) tools.append(button('删除', () => removeSelected()));
    tools.append(button(sheet ? '收起' : '属性', () => {
      sheet = !sheet;
      render();
    }, sheet));
    editorPanel.append(slider('镜头', play.zoomT(), 0, 1, 0.01, (t) => play.setZoomT(t)));
    editorPanel.append(slider('上下', play.panT(), 0, 1, 0.01, (t) => play.setPanT(t)));
    editorPanel.append(tools);
    if (selection?.kind === 'ring') {
      const ring = ringOf(selection.id);
      if (ring && ring.connectors.length > 0) {
        const handles = document.createElement('div');
        handles.className = 'row';
        ring.connectors.forEach((_, index) => {
          handles.append(button(`柄 ${index + 1}`, () => {
            selection = { kind: 'ring', id: ring.id, connector: index };
            render();
          }, selection?.kind === 'ring' && selection.connector === index));
        });
        editorPanel.append(handles);
      }
    }

    if (!sheet) {
      syncGuides();
      return;
    }
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
    syncGuides();
  }

  function beginHandle(): void {
    if (draft) {
      draft = null;
      setStatus('');
      render();
      return;
    }
    if (selection?.kind !== 'ring') {
      setStatus('先选一只环');
      return;
    }
    draft = { ringId: selection.id, grow: null };
    drag = null;
    setStatus('点生长位置');
    render();
  }

  function finishHandle(world: { x: number; y: number }): void {
    const ring = draft ? ringOf(draft.ringId) : undefined;
    if (!draft || !ring) {
      draft = null;
      return;
    }
    const placed = connectorAtHandle(ring, world.x, world.y);
    if (!placed) return;
    const connector = { angle: placed.angle, stem: placed.stem, target: null as string | null };
    ring.connectors.push(connector);
    const hit = play.pickAt(world);
    if (hit?.kind === 'ring' && hit.id !== ring.id) {
      if (colorsClash(authored, ring.id, hit.id)) {
        setStatus('相连的两件颜色不能一样');
      } else {
        connector.target = hit.id;
        followLockedHandles(authored, ring.id);
        setStatus('');
      }
    }
    selection = { kind: 'ring', id: ring.id, connector: ring.connectors.length - 1 };
    draft = null;
    commit();
  }

  function piecePose(): { x: number; y: number; arm: number; turn: number; body: number; angle: number } | null {
    if (selection?.kind === 'ring') {
      const ring = ringOf(selection.id);
      if (!ring) return null;
      return { x: ring.x, y: ring.y, arm: ring.outer + 0.32, turn: ring.outer + 0.18, body: ring.outer, angle: ring.theta };
    }
    if (selection?.kind === 'bar') {
      const bar = barOf(selection.id);
      if (!bar) return null;
      const span = Math.hypot(bar.x1 - bar.x0, bar.y1 - bar.y0) / 2;
      return {
        x: (bar.x0 + bar.x1) / 2,
        y: (bar.y0 + bar.y1) / 2,
        arm: span + 0.28,
        turn: Math.max(span, bar.grip) + 0.22,
        body: Math.max(span, bar.grip),
        angle: Math.atan2(bar.y1 - bar.y0, bar.x1 - bar.x0),
      };
    }
    return null;
  }

  function hitGizmo(world: { x: number; y: number }): 'turn' | 'x' | 'y' | null {
    if (draft) return null;
    const pose = piecePose();
    if (!pose) return null;
    const dx = world.x - pose.x;
    const dy = world.y - pose.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= pose.body) return null;
    if (Math.abs(dist - pose.turn) <= TURN_HIT) return 'turn';
    const onX = Math.abs(dy) <= AXIS_HIT && Math.abs(dx) <= pose.arm && Math.abs(dx) > CENTER_GAP;
    const onY = Math.abs(dx) <= AXIS_HIT && Math.abs(dy) <= pose.arm && Math.abs(dy) > CENTER_GAP;
    if (onX && !onY) return 'x';
    if (onY && !onX) return 'y';
    if (onX && onY) return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    return null;
  }

  function snapGrid(value: number): number {
    return Math.round(value / GRID) * GRID;
  }

  function snapTurn(value: number): number {
    return Math.round(value / TURN_STEP) * TURN_STEP;
  }

  function setCenter(x: number, y: number): void {
    if (selection?.kind === 'ring') {
      const ring = ringOf(selection.id);
      if (!ring) return;
      ring.x = x;
      ring.y = y;
      followLockedHandles(authored, ring.id);
      return;
    }
    if (selection?.kind === 'bar') {
      const bar = barOf(selection.id);
      if (!bar) return;
      moveBar(bar, x - (bar.x0 + bar.x1) / 2, y - (bar.y0 + bar.y1) / 2);
    }
  }

  function setAngle(angle: number): void {
    if (selection?.kind === 'ring') {
      const ring = ringOf(selection.id);
      if (!ring) return;
      ring.theta = wrapAngle(angle);
      return;
    }
    if (selection?.kind === 'bar') {
      const bar = barOf(selection.id);
      if (!bar) return;
      spinBar(bar, angle);
    }
  }

  function syncGuides(cursor?: { x: number; y: number }): void {
    if (mode !== 'edit') {
      play.setGuides(null);
      return;
    }
    const pose = draft ? null : piecePose();
    const grow = draft?.grow;
    play.setGuides({
      grid: gridOn,
      move: pose ? { x: pose.x, y: pose.y, arm: pose.arm } : null,
      turn: pose ? { x: pose.x, y: pose.y, radius: pose.turn } : null,
      handle: grow ? { x: grow.x, y: grow.y, x2: cursor?.x, y2: cursor?.y } : null,
    });
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
      followLockedHandles(authored, ring.id);
      commit(false);
    }));
    root.append(numberField('位置 y', ring.y, 0.01, (value) => {
      ring.y = value;
      followLockedHandles(authored, ring.id);
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

  function removeHandle(): void {
    if (selection?.kind !== 'ring' || selection.connector === null) return;
    const ring = ringOf(selection.id);
    if (!ring) return;
    ring.connectors.splice(selection.connector, 1);
    selection = { kind: 'ring', id: ring.id, connector: null };
    commit();
  }

  function handleNear(world: { x: number; y: number }, ring: RingBody): number | null {
    const band = ring.outer * PART.bandRatio;
    let bestIndex: number | null = null;
    let bestDistance = 0.28;
    for (let index = 0; index < ring.connectors.length; index += 1) {
      const connector = ring.connectors[index];
      const layout = connectorLayout(ring.outer, band, connector.stem);
      const aim = ring.theta + connector.angle;
      const x = ring.x + Math.cos(aim) * layout.claspDist;
      const y = ring.y + Math.sin(aim) * layout.claspDist;
      const distance = Math.hypot(world.x - x, world.y - y);
      if (distance > bestDistance) continue;
      bestDistance = distance;
      bestIndex = index;
    }
    return bestIndex;
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
    draft = null;
    drag = null;
    play.setEditing(mode === 'edit');
    play.replace(structuredClone(authored));
    if (selection && mode === 'edit') play.select(selection.id);
    setStatus(mode === 'edit' ? `编辑第 ${level} 关` : '');
    render();
  }

  async function addLevel(): Promise<void> {
    try {
      const index = await createLevel();
      count = await fetchLevelCount();
      await open(index);
      setStatus(`已添加第 ${index} 关`);
    } catch (error) {
      setStatus(`加关失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function removeLevel(): Promise<void> {
    if (count <= 1) {
      setStatus('至少留一关');
      return;
    }
    if (!window.confirm(`删除第 ${level} 关？后面的关会往前补。`)) return;
    try {
      await deleteLevel(level);
      count = await fetchLevelCount();
      await open(Math.min(level, count));
      setStatus('已删除');
    } catch (error) {
      setStatus(`删关失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function open(index: number): Promise<void> {
    count = await fetchLevelCount();
    level = Math.min(Math.max(1, index), count);
    selection = null;
    draft = null;
    drag = null;
    authored = await loadLevel(level);
    hud.setLevel(level);
    hud.resetMoves();
    play.setEditing(mode === 'edit');
    commit();
    play.frame();
    setStatus(mode === 'edit' ? `编辑第 ${level} 关` : '');
  }

  function alignSides(): void {
    alignColumns(authored);
    commit();
    play.frame();
    render();
    setStatus(`第 ${level} 关左右两列已对齐`);
  }

  async function persist(): Promise<void> {
    try {
      await saveLevel(level, authored);
      setStatus(`已保存第 ${level} 关`);
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  function settingsPane(): HTMLDivElement {
    const pane = document.createElement('div');
    pane.className = 'settings';
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
    if (draft) {
      node.textContent = draft.grow ? '再点把手位置' : '点生长位置';
      return node;
    }
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
    const place = ring
      ? `  x ${ring.x.toFixed(2)}  y ${ring.y.toFixed(2)}  ${toDegrees(ring.theta).toFixed(1)}°`
      : '';
    node.append(swatch, document.createTextNode(`选中 ${colorName}${kind} ${selection.id}${handle}${place}`));
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
    void open(level >= count ? 1 : level + 1);
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
    if (draft) {
      const ring = ringOf(draft.ringId);
      if (!ring) {
        draft = null;
        render();
        return;
      }
      if (!draft.grow) {
        const dx = world.x - ring.x;
        const dy = world.y - ring.y;
        if (Math.hypot(dx, dy) > ring.outer + 0.4) {
          draft = null;
          setStatus('');
          render();
          return;
        }
        const aim = Math.atan2(dy, dx);
        const radius = (ring.inner + ring.outer) / 2;
        draft.grow = {
          x: ring.x + Math.cos(aim) * radius,
          y: ring.y + Math.sin(aim) * radius,
          angle: wrapAngle(aim - ring.theta),
        };
        setStatus('点把手位置');
        render();
        return;
      }
      finishHandle(world);
      return;
    }
    const gizmo = hitGizmo(world);
    const hit = gizmo ? null : play.pickAt(world);
    if (!gizmo && !hit) {
      selection = null;
      play.select(null);
      drag = null;
      render();
      return;
    }
    if (hit) {
      if (hit.kind === 'ring') {
        const ring = ringOf(hit.id);
        const connector = ring ? handleNear(world, ring) : null;
        selection = { kind: 'ring', id: hit.id, connector };
      } else {
        selection = { kind: 'bar', id: hit.id };
      }
    }
    const pose = piecePose();
    if (!pose || !selection) return;
    const pointerA = Math.atan2(world.y - pose.y, world.x - pose.x);
    drag = {
      kind: gizmo === 'turn' ? 'turn' : gizmo === 'x' ? 'x' : gizmo === 'y' ? 'y' : 'free',
      px: world.x,
      py: world.y,
      ox: pose.x,
      oy: pose.y,
      base: gizmo === 'turn' ? pose.angle - pointerA : pose.angle,
    };
    canvas.setPointerCapture(event.pointerId);
    play.select(selection.id);
    syncGuides();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (mode !== 'edit') return;
    const world = play.pointerWorld(event, false);
    if (!world) return;
    if (draft?.grow) {
      syncGuides(world);
      return;
    }
    if (!drag || !selection) return;
    if (drag.kind === 'turn') {
      const pointerA = Math.atan2(world.y - drag.oy, world.x - drag.ox);
      const angle = drag.base + pointerA;
      setAngle(gridOn ? snapTurn(angle) : angle);
    } else {
      let x = drag.kind === 'y' ? drag.ox : drag.ox + (world.x - drag.px);
      let y = drag.kind === 'x' ? drag.oy : drag.oy + (world.y - drag.py);
      if (gridOn) {
        if (drag.kind !== 'y') x = snapGrid(x);
        if (drag.kind !== 'x') y = snapGrid(y);
      }
      setCenter(x, y);
    }
    stripHandlePins(authored);
    play.pose(structuredClone(authored));
    play.select(selection.id);
    syncGuides();
  });

  canvas.addEventListener('pointerup', () => {
    if (mode !== 'edit') return;
    drag = null;
    render();
  });

  void open(1);

  return { advance, replay };
}
