/**
 * Tunable play haptics. Four events in ROTATE-RINGS §4:
 * lock a piece, a collision after it has moved, the ready-to-clear glow
 * starting to brighten, and a release that clears.
 * The gear panel writes these. Play reads them at the moment it fires.
 */

import { haptics } from '../utils/haptics';

export type HapticKind = 'grab' | 'hit' | 'ready' | 'clear';

export type HapticPair = { intensity: number; sharpness: number };

export type HapticFeel = Record<HapticKind, HapticPair>;

export const HAPTIC_FEEL_DEFAULT: HapticFeel = {
  grab: { intensity: 0.3, sharpness: 0.3 },
  hit: { intensity: 0.3, sharpness: 1 },
  ready: { intensity: 0.4, sharpness: 0.59 },
  clear: { intensity: 0.45, sharpness: 0.33 },
};

const KEY = 'rings.haptic-feel';

const labels: Record<HapticKind, string> = {
  grab: '点击',
  hit: '撞击',
  ready: '变亮',
  clear: '消除',
};

export function hapticLabel(kind: HapticKind): string {
  return labels[kind];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function pair(value: unknown, fallback: HapticPair): HapticPair {
  if (!value || typeof value !== 'object') return { ...fallback };
  const raw = value as { intensity?: unknown; sharpness?: unknown };
  return {
    intensity: clamp01(typeof raw.intensity === 'number' ? raw.intensity : fallback.intensity),
    sharpness: clamp01(typeof raw.sharpness === 'number' ? raw.sharpness : fallback.sharpness),
  };
}

export function hapticFeel(): HapticFeel {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(HAPTIC_FEEL_DEFAULT);
    const data = JSON.parse(raw) as Partial<HapticFeel>;
    return {
      grab: pair(data.grab, HAPTIC_FEEL_DEFAULT.grab),
      hit: pair(data.hit, HAPTIC_FEEL_DEFAULT.hit),
      ready: pair(data.ready, HAPTIC_FEEL_DEFAULT.ready),
      clear: pair(data.clear, HAPTIC_FEEL_DEFAULT.clear),
    };
  } catch {
    return structuredClone(HAPTIC_FEEL_DEFAULT);
  }
}

export function setHapticPair(kind: HapticKind, next: HapticPair): void {
  const feel = hapticFeel();
  feel[kind] = {
    intensity: clamp01(next.intensity),
    sharpness: clamp01(next.sharpness),
  };
  localStorage.setItem(KEY, JSON.stringify(feel));
}

export function resetHapticFeel(): void {
  localStorage.removeItem(KEY);
}

export function pulseHaptic(kind: HapticKind): void {
  const pair = hapticFeel()[kind];
  void haptics.playTransient(pair.intensity, pair.sharpness);
}
