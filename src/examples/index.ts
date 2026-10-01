import { continuous } from './continuous';
import { frames } from './frames';
import { portals } from './portals';
import { spans } from './spans';
import { trusses } from './trusses';
import type { Example, Sheet, SheetId } from './types';

export const SHEETS: Sheet[] = [
  { id: 'spans', title: 'Single spans', intro: 'Cantilevers, simple spans, propped and fixed-ended beams: the cases every engineer knows by heart.' },
  { id: 'continuous', title: 'Continuous & Gerber', intro: 'Overhangs, continuous beams, pattern loading, hinges, springs and settlement.' },
  { id: 'portals', title: 'Portals & gables', intro: 'Single-bay frames with fixed, pinned and three-pinned feet, under gravity and wind.' },
  { id: 'frames', title: 'Frames & bracing', intro: 'Bent cantilevers, multi-bay and multi-storey frames, bracing and Vierendeel action.' },
  { id: 'trusses', title: 'Trusses & arches', intro: 'Pin-jointed trusses, a wall bracket and arches from the funicular to the decidedly not.' },
];

export const EXAMPLES: Example[] = [...spans, ...continuous, ...portals, ...frames, ...trusses];

export function examplesOn(sheet: SheetId): Example[] {
  return EXAMPLES.filter((e) => e.sheet === sheet);
}

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export type { Example, Sheet, SheetId } from './types';
