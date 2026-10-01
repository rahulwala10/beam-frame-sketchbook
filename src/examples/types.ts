import type { Analysis } from '../engine/results';
import type { Spec } from '../engine/types';

export type SheetId = 'spans' | 'continuous' | 'portals' | 'frames' | 'trusses';

export interface Sheet {
  id: SheetId;
  title: string;
  intro: string;
}

export interface RangeParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  /** Slide on a logarithmic scale (for stiffness ratios and springs). */
  log?: boolean;
}

export interface ChoiceParam {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
}

export type Param = RangeParam | ChoiceParam;
export type Params = Record<string, number | string>;

export interface Check {
  label: string;
  /** Plain-text formula, e.g. "wL²/8". */
  formula: string;
  expected: number;
  actual: number;
  unit: 'kN' | 'kNm' | 'mm' | 'mrad';
  note?: string;
}

/** What a hand check can read from the solved model. All values are magnitudes unless stated. */
export interface CheckContext {
  p: Params;
  spec: Spec;
  a: Analysis;
  EI: number;
  /** Is load l applied? */
  on(l: number): boolean;
  /** Current fraction along its member of a point load or couple. */
  t(l: number): number;
  /** Reaction components [Rx, Ry, Mz] at a node (signed). */
  R(node: number): [number, number, number];
  /** Bending moment, shear, axial force at fraction t of a member (signed). */
  M(member: number, t: number): number;
  V(member: number, t: number): number;
  N(member: number, t: number): number;
  /** Largest sagging (+1), hogging (−1) or absolute (0) moment along a member, signed. */
  peakM(member: number, sign?: 1 | -1 | 0): number;
  /** Transverse deflection (m, signed, local y) at fraction t of a member. */
  v(member: number, t: number): number;
  /** Largest |transverse deflection| along a member, in m. */
  peakV(member: number): number;
  /** Global displacement [ux, uy] of a structure node, m. */
  disp(node: number): [number, number];
  /** Rotation of a structure node, rad (anticlockwise +). */
  rot(node: number): number;
  /** Is load l still where the example put it (member and position)? */
  inPlace(l: number): boolean;
}

export interface Example {
  id: string;
  sheet: SheetId;
  title: string;
  /** One or two sentences: what this structure is and why it is on the sheet. */
  blurb: string;
  /** Things to look for while playing with it. */
  notes: string[];
  params?: Param[];
  /** Multiplies the default deflection exaggeration (1 = deflections drawn at ~9% of the structure's size). */
  exaggerate?: number;
  build(p: Params): Spec;
  checks?(c: CheckContext): Check[];
}

export function defaults(ex: Example): Params {
  const p: Params = {};
  for (const q of ex.params ?? []) p[q.key] = q.value;
  return p;
}
