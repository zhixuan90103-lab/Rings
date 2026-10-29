/**
 * Boot: safe-area → device preview → WebGPU design stage → minimal demo.
 * Replace this file (or add src/game/*) for real gameplay.
 * Keep: adapt/*, create-renderer, utils/haptics, DOM contract.
 */

import * as THREE from 'three';
import { Capacitor } from '@capacitor/core';
import {
  applyStageTransform,
  computeStageLayout,
  watchStageLayout,
  type StageLayout,
} from './adapt/design';
import {
  mountDevicePreview,
  type DevicePreviewController,
} from './adapt/devicePreview';
import { applyNativeClass, applySafeAreaCssVars } from './adapt/safeArea';
import { createRenderer, resizeToDesign } from './create-renderer';
import { haptics } from './utils/haptics';
import { mountPlay } from './game/play';
import { packedLevels } from './game/packedLevels';
import { usePackedLevels } from './game/levelio';
import { mountEditor } from './game/editor';
import { mountPlaySession } from './game/playSession';
import { mountPhoneSettings } from './game/phoneSettings';
import { mountResult } from './game/result';

/** Stop WebKit text loupe, callout, double-tap zoom, and rubber-band. Edge Home stays native. */
function blockWebViewGestures(): void {
  const editable = (target: EventTarget | null) =>
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  const stop = (event: Event) => {
    if (editable(event.target)) return;
    event.preventDefault();
  };
  document.addEventListener('touchmove', stop, { capture: true, passive: false });
  document.addEventListener('gesturestart', stop, { capture: true });
  document.addEventListener('selectstart', stop, { capture: true });
  document.addEventListener('contextmenu', stop, { capture: true });
}

blockWebViewGestures();

const shell = document.getElementById('shell')!;
const viewportEl = document.getElementById('viewport')!;
const stage = document.getElementById('stage')!;
const statusEl = document.getElementById('status');
const levelEl = document.getElementById('hud-level');
const counterEl = document.getElementById('hud-counter');
const logEl = document.getElementById('haptic-log');
let score = 0;
let shownScore = 0;
let scoreFrame = 0;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function setLevel(level: number): void {
  if (levelEl) levelEl.textContent = String(level);
}

function setScore(count: number, roll = true): void {
  score = count;
  if (!roll || !counterEl) {
    cancelAnimationFrame(scoreFrame);
    shownScore = count;
    if (counterEl) counterEl.textContent = String(count);
    return;
  }
  const from = shownScore;
  const to = count;
  const start = performance.now();
  cancelAnimationFrame(scoreFrame);
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / 480);
    const eased = 1 - (1 - t) ** 3;
    shownScore = Math.round(from + (to - from) * eased);
    if (counterEl) counterEl.textContent = String(shownScore);
    if (t < 1) scoreFrame = requestAnimationFrame(tick);
  };
  scoreFrame = requestAnimationFrame(tick);
}

function setLog(text: string): void {
  if (logEl) logEl.textContent = text;
}

async function boot(): Promise<void> {
  usePackedLevels(packedLevels);
  if (!document.body.classList.contains('page-editor')) mountPhoneSettings();
  applyNativeClass();

  const native = Capacitor.isNativePlatform();

  setStatus('');

  const renderer = await createRenderer({ container: stage });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6f1e8);

  scene.add(new THREE.HemisphereLight(0xfff8f2, 0xf3d7be, 1.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(1.6, 4.2, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe4cc, 0.28);
  fill.position.set(-3.2, -0.6, 5);
  scene.add(fill);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
  camera.position.set(0, 0, 12);
  camera.lookAt(0, 0, 0);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.pointerEvents = 'auto';

  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 24;
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0008;
  key.shadow.radius = 6;
  key.position.set(-0.55, 0.9, 12);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 30),
    new THREE.ShadowMaterial({ opacity: 0.28 }),
  );
  ground.receiveShadow = true;
  ground.position.z = -0.45;
  scene.add(ground);

  let latestLayout: StageLayout | null = null;
  let levels: { advance: () => void; replay: () => void } = {
    advance: () => {},
    replay: () => {},
  };
  const result = mountResult({
    replay: () => levels.replay(),
    next: () => levels.advance(),
  });

  const play = mountPlay({
    renderer,
    scene,
    camera,
    canvas: renderer.domElement,
    getLayout: () => latestLayout,
    onStatus: () => {},
    onScore: (points) => setScore(score + points),
    onCleared: () => result.show(),
  });
  let preview: DevicePreviewController;

  const onLayout = (layout: StageLayout) => {
    latestLayout = layout;
    applyStageTransform(stage, layout);
    applySafeAreaCssVars(native);
    resizeToDesign(renderer);
    play.resize();
  };

  preview = mountDevicePreview(shell, viewportEl, () => {
    const size = preview.getViewSize();
    onLayout(computeStageLayout(size.width, size.height, 'contain'));
  });

  const unwatch = watchStageLayout(onLayout, {
    mode: 'contain',
    getViewSize: () => preview.getViewSize(),
  });

  if (new URLSearchParams(window.location.search).has('debugFit')) {
    const log = () => {
      if (latestLayout) {
        console.info('[debugFit]', latestLayout, preview.getDevice());
      }
    };
    window.addEventListener('resize', log);
    log();
  }

  // Optional: document.body.classList.add('debug-safe-area')

  const hud = { setLevel, resetMoves: () => setScore(0, false) };
  levels = document.body.classList.contains('page-editor')
    ? mountEditor(play, setStatus, hud)
    : mountPlaySession(play, hud);

  if (haptics.isNativeIos()) {
    setLog(
      `native iOS · plugin=${haptics.isPluginAvailable()}\n` +
        (haptics.isPluginAvailable()
          ? '点「点我震动」应有马达反馈。'
          : '插件未注册：SceneDelegate 必须用 BridgeViewController。'),
    );
  } else {
    setLog(
      '当前不是 iOS App，点按钮不会有原生震动。\n' +
        '请 npm run ios:bootstrap → Xcode 选真机 Run。',
    );
  }

  document.querySelectorAll<HTMLElement>('[data-haptic]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-haptic');
      let result: unknown;
      switch (action) {
        case 'prepare':
          result = await haptics.prepare();
          break;
        case 'tap':
          result = await haptics.playTransient(0.55, 0.5);
          break;
        case 'impact':
          result = await haptics.impact('medium');
          break;
        case 'start':
          result = await haptics.startContinuous({
            intensity: 0.18,
            sharpness: 0.22,
          });
          break;
        case 'stop':
          result = await haptics.stopContinuous();
          break;
        default:
          result = { ok: false, reason: 'unknown' };
      }
      setLog(`${action} → ${JSON.stringify(result)}`);
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && haptics.isNativeIos()) {
      void haptics.prepare();
    }
  });

  window.addEventListener(
    'pagehide',
    () => {
      unwatch();
      preview.dispose();
      play.dispose();
      renderer.dispose();
    },
    { once: true },
  );
}

boot().catch((err) => {
  console.error(err);
  setStatus(`boot failed: ${err instanceof Error ? err.message : String(err)}`);
});
