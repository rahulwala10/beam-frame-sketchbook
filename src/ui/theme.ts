import { settings, type ThemeChoice } from './settings';

export interface Palette {
  paper: string;
  ink: string;
  inkSoft: string;
  faint: string;
  moment: string;
  shear: string;
  tension: string;
  compression: string;
  load: string;
  reaction: string;
  pull: string;
}

let palette: Palette | null = null;
const listeners = new Set<() => void>();

export function getPalette(): Palette {
  if (!palette) {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim() || '#000';
    palette = {
      paper: v('--paper'),
      ink: v('--ink'),
      inkSoft: v('--ink-soft'),
      faint: v('--ink-faint'),
      moment: v('--moment'),
      shear: v('--shear'),
      tension: v('--tension'),
      compression: v('--compression'),
      load: v('--load'),
      reaction: v('--reaction'),
      pull: v('--pull'),
    };
  }
  return palette;
}

export function onPaletteChange(fn: () => void): void {
  listeners.add(fn);
}

function changed(): void {
  palette = null;
  for (const fn of listeners) fn();
}

// Whatever the host page set before we touched it; "system" restores exactly that.
const hostTheme = document.documentElement.getAttribute('data-theme');

export function applyTheme(choice: ThemeChoice = settings.theme): void {
  const root = document.documentElement;
  if (choice !== 'system') root.setAttribute('data-theme', choice);
  else if (hostTheme) root.setAttribute('data-theme', hostTheme);
  else root.removeAttribute('data-theme');
  changed();
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', changed);
// The host page may set data-theme on the root itself.
new MutationObserver(changed).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
