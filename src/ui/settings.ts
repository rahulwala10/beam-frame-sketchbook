import type { SheetId } from '../examples';

export type DiagramKind = 'M' | 'V' | 'N' | 'none';
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  sheet: SheetId;
  diagram: DiagramKind;
  reactions: boolean;
  values: boolean;
  inflection: boolean;
  sameScale: boolean;
  quiz: boolean;
  theme: ThemeChoice;
}

const KEY = 'beam-frame-sketchbook';

const DEFAULTS: Settings = {
  sheet: 'spans',
  diagram: 'M',
  reactions: false,
  values: false,
  inflection: false,
  sameScale: false,
  quiz: false,
  theme: 'system',
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), quiz: false };
  } catch {
    // Storage can be unavailable (private windows, previews); defaults are fine.
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();
const listeners = new Set<(changed: Partial<Settings>) => void>();

export function update(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Ignore: settings simply won't be remembered.
  }
  for (const fn of listeners) fn(patch);
}

export function onSettings(fn: (changed: Partial<Settings>) => void): void {
  listeners.add(fn);
}

export const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
