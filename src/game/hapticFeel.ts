/**
 * Tunable play haptics. Defaults match the four events in ROTATE-RINGS §4.
 * The gear panel writes these. Play reads them at the moment it fires.
 */

import { haptics } from '../utils/haptics';

export type HapticKind = 'grab' | 'hit' | 'invalid' | 'clear';

export type HapticPair = { intensity: number; sharpness: number };

export type HapticFeel = Record<HapticKind, HapticPair>;

export const HAPTIC_FEEL_DEFAULT: HapticFeel = {
  grab: { intensity: 0.32, sharpness: 0.25 },
  hit: { intensity: 0.72, sharpness: 0.82 },
  invalid: { intensity: 0.45, sharpness: 0.3 },
  clear: { intensity: 0.9, sharpness: 0.55 },
};

const KEY = 'rings.haptic-feel';

const labels: Record<HapticKind, string> = {
  grab: '按住',
  hit: '撞击',
  invalid: '无效',
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
      invalid: pair(data.invalid, HAPTIC_FEEL_DEFAULT.invalid),
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
