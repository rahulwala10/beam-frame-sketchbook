import type {
  LineLoad,
  MemberSpec,
  MomentLoad,
  PointLoad,
  Settlement,
  SupportKind,
  SupportSpec,
  Vec2,
} from '../engine/types';
import type { Check, ChoiceParam, Params, RangeParam } from './types';

/** Default steel section: E = 200 GPa, I = 2.0e-4 m⁴, A = 8.0e-3 m². */
export const EI = 40_000;
export const EA = 1.6e6;

export const num = (p: Params, key: string): number => Number(p[key]);
export const str = (p: Params, key: string): string => String(p[key]);

export function range(key: string, label: string, min: number, max: number, step: number, value: number, unit?: string, log = false): RangeParam {
  return { key, label, min, max, step, value, unit, log };
}

export function choice(key: string, label: string, options: Array<[string, string]>, value: string): ChoiceParam {
  return { key, label, options: options.map(([v, l]) => ({ value: v, label: l })), value };
}

export const sup = (node: number, kind: SupportKind, extra: Partial<SupportSpec> = {}): SupportSpec => ({ node, kind, ...extra });

/** Downward point load of P kN. */
export const down = (member: number, t: number, P: number, extra: Partial<PointLoad> = {}): PointLoad => ({
  kind: 'point',
  member,
  t,
  F: [0, -P],
  ...extra,
});

/** Point load with global components. */
export const force = (member: number, t: number, Fx: number, Fy: number, extra: Partial<PointLoad> = {}): PointLoad => ({
  kind: 'point',
  member,
  t,
  F: [Fx, Fy],
  ...extra,
});

/** Downward distributed load of w kN/m along the members. */
export const udl = (members: number[], w: number, extra: Partial<LineLoad> = {}): LineLoad => ({
  kind: 'line',
  members,
  w: [0, -w],
  ...extra,
});

export const lineLoad = (members: number[], w: Vec2 | number, extra: Partial<LineLoad> = {}): LineLoad => ({
  kind: 'line',
  members,
  w,
  ...extra,
});

export const couple = (member: number, t: number, M: number, extra: Partial<MomentLoad> = {}): MomentLoad => ({
  kind: 'moment',
  member,
  t,
  M,
  ...extra,
});

export const settle = (node: number, dy: number, extra: Partial<Settlement> = {}): Settlement => ({
  kind: 'settle',
  node,
  d: [0, dy],
  ...extra,
});

/** Collinear horizontal members through the given x positions. */
export function beamLine(xs: number[], member: Partial<MemberSpec> | ((i: number) => Partial<MemberSpec>) = {}): { nodes: Vec2[]; members: MemberSpec[] } {
  const nodes: Vec2[] = xs.map((x) => [x, 0]);
  const members: MemberSpec[] = xs.slice(1).map((_, i) => ({
    a: i,
    b: i + 1,
    EI,
    role: 'beam',
    ...(typeof member === 'function' ? member(i) : member),
  }));
  return { nodes, members };
}

/** Members joining consecutive points. */
export function chain(points: Vec2[], member: Partial<MemberSpec> | ((i: number) => Partial<MemberSpec>) = {}): MemberSpec[] {
  return points.slice(1).map((_, i) => ({
    a: i,
    b: i + 1,
    EI,
    ...(typeof member === 'function' ? member(i) : member),
  }));
}

export interface Portal {
  nodes: Vec2[];
  members: MemberSpec[];
  baseL: number;
  baseR: number;
  kneeL: number;
  kneeR: number;
  colL: number;
  colR: number;
  /** Beam members from left to right (two when there is a crown node). */
  beams: number[];
  crown?: number;
}

/** Single-bay portal. Columns get EIc, the beam EIb. A crown node splits the beam, optionally with a hinge. */
export function portal(L: number, h: number, opts: { EIb?: number; EIc?: number; crown?: 'node' | 'hinge' } = {}): Portal {
  const EIb = opts.EIb ?? EI;
  const EIc = opts.EIc ?? EI;
  const nodes: Vec2[] = [
    [0, 0],
    [0, h],
  ];
  const members: MemberSpec[] = [{ a: 0, b: 1, EI: EIc, role: 'column' }];
  const beams: number[] = [];
  let crown: number | undefined;
  if (opts.crown) {
    nodes.push([L / 2, h]);
    crown = 2;
    beams.push(members.length);
    members.push({ a: 1, b: 2, EI: EIb, role: 'beam', hingeB: opts.crown === 'hinge' });
    nodes.push([L, h]);
    beams.push(members.length);
    members.push({ a: 2, b: 3, EI: EIb, role: 'beam' });
  } else {
    nodes.push([L, h]);
    beams.push(members.length);
    members.push({ a: 1, b: 2, EI: EIb, role: 'beam' });
  }
  const kneeR = nodes.length - 1;
  nodes.push([L, 0]);
  const baseR = nodes.length - 1;
  const colR = members.length;
  members.push({ a: kneeR, b: baseR, EI: EIc, role: 'column' });
  return { nodes, members, baseL: 0, baseR, kneeL: 1, kneeR, colL: 0, colR, beams, crown };
}

export interface Grid {
  nodes: Vec2[];
  members: MemberSpec[];
  /** Node on column line i at level j (j = 0 is the ground). */
  node(i: number, j: number): number;
  /** Column on line i in storey j (j ≥ 1). */
  col(i: number, j: number): number;
  /** Beam in bay i at level j (j ≥ 1). */
  beam(i: number, j: number): number;
  beamsAt(j: number): number[];
}

/** Rectangular multi-bay, multi-storey frame. */
export function grid(bays: number[], storeys: number[], opts: { EIb?: number; EIc?: number; pinnedBeams?: boolean } = {}): Grid {
  const xs = [0];
  for (const b of bays) xs.push(xs[xs.length - 1] + b);
  const ys = [0];
  for (const s of storeys) ys.push(ys[ys.length - 1] + s);
  const nodes: Vec2[] = [];
  const id = (i: number, j: number) => j * xs.length + i;
  for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) nodes.push([xs[i], ys[j]]);
  const members: MemberSpec[] = [];
  const colIdx = new Map<string, number>();
  const beamIdx = new Map<string, number>();
  for (let j = 1; j < ys.length; j++) {
    for (let i = 0; i < xs.length; i++) {
      colIdx.set(`${i},${j}`, members.length);
      members.push({ a: id(i, j - 1), b: id(i, j), EI: opts.EIc ?? EI, role: 'column' });
    }
    for (let i = 0; i < bays.length; i++) {
      beamIdx.set(`${i},${j}`, members.length);
      members.push({
        a: id(i, j),
        b: id(i + 1, j),
        EI: opts.EIb ?? EI,
        role: 'beam',
        hingeA: opts.pinnedBeams,
        hingeB: opts.pinnedBeams,
      });
    }
  }
  return {
    nodes,
    members,
    node: id,
    col: (i, j) => colIdx.get(`${i},${j}`)!,
    beam: (i, j) => beamIdx.get(`${i},${j}`)!,
    beamsAt: (j) => bays.map((_, i) => beamIdx.get(`${i},${j}`)!),
  };
}

export interface FlatTruss {
  nodes: Vec2[];
  members: MemberSpec[];
  bottom: number[];
  top: number[];
  /** Bottom chord member ending at bottom node i (i ≥ 1). */
  bottomMemberTo: (i: number) => number;
  topChord: number[];
  bottomChord: number[];
}

/** Parallel-chord truss with n panels of width a and depth h. */
export function flatTruss(kind: 'pratt' | 'howe' | 'warren', n: number, a: number, h: number, bar: Partial<MemberSpec> = {}): FlatTruss {
  const nodes: Vec2[] = [];
  const members: MemberSpec[] = [];
  const bottom: number[] = [];
  const top: number[] = [];
  const topChord: number[] = [];
  const bottomChord: number[] = [];
  const add = (p: number, q: number, role: MemberSpec['role']) => {
    members.push({ a: p, b: q, EI: 8000, EA: 8e5, truss: true, role, ...bar });
    return members.length - 1;
  };
  for (let i = 0; i <= n; i++) {
    nodes.push([i * a, 0]);
    bottom.push(nodes.length - 1);
  }
  const bottomTo: number[] = [];
  for (let i = 0; i < n; i++) {
    bottomTo[i + 1] = add(bottom[i], bottom[i + 1], 'chord');
    bottomChord.push(bottomTo[i + 1]);
  }
  if (kind === 'warren') {
    for (let i = 0; i < n; i++) {
      nodes.push([(i + 0.5) * a, h]);
      top.push(nodes.length - 1);
    }
    for (let i = 0; i < n - 1; i++) topChord.push(add(top[i], top[i + 1], 'chord'));
    for (let i = 0; i < n; i++) {
      add(bottom[i], top[i], 'brace');
      add(top[i], bottom[i + 1], 'brace');
    }
  } else {
    top[0] = -1;
    for (let i = 1; i < n; i++) {
      nodes.push([i * a, h]);
      top[i] = nodes.length - 1;
    }
    for (let i = 1; i < n - 1; i++) topChord.push(add(top[i], top[i + 1], 'chord'));
    add(bottom[0], top[1], 'chord');
    add(top[n - 1], bottom[n], 'chord');
    for (let i = 1; i < n; i++) add(bottom[i], top[i], 'brace');
    const half = n / 2;
    for (let i = 1; i < n - 1; i++) {
      // Pratt diagonals slope down towards mid-span (tension under gravity); Howe the other way.
      const leftHalf = i + 0.5 < half;
      if (kind === 'pratt') {
        if (leftHalf) add(top[i], bottom[i + 1], 'brace');
        else add(bottom[i], top[i + 1], 'brace');
      } else if (leftHalf) {
        add(bottom[i], top[i + 1], 'brace');
      } else {
        add(top[i], bottom[i + 1], 'brace');
      }
    }
  }
  return { nodes, members, bottom, top, bottomMemberTo: (i) => bottomTo[i], topChord, bottomChord };
}

/** Points on a parabolic (rise f) or circular arch from (0,0) to (L,0). */
export function archPoints(shape: 'parabola' | 'circle', L: number, f: number, n: number): Vec2[] {
  const pts: Vec2[] = [];
  if (shape === 'parabola') {
    for (let k = 0; k <= n; k++) {
      const x = (L * k) / n;
      pts.push([x, (4 * f * x * (L - x)) / (L * L)]);
    }
  } else {
    const R = (L * L / 4 + f * f) / (2 * f);
    const yc = f - R;
    const half = Math.asin(L / 2 / R);
    for (let k = 0; k <= n; k++) {
      const th = -half + (2 * half * k) / n;
      pts.push([L / 2 + R * Math.sin(th), yc + R * Math.cos(th)]);
    }
    pts[0] = [0, 0];
    pts[n] = [L, 0];
  }
  return pts;
}

/** Simply supported bending moment at x for point loads {x, P} on span L. */
export function ssMoment(loads: Array<{ x: number; P: number }>, L: number, x: number): number {
  let RA = 0;
  for (const l of loads) RA += (l.P * (L - l.x)) / L;
  let M = RA * x;
  for (const l of loads) if (l.x < x) M -= l.P * (x - l.x);
  return M;
}

/** A hand check comparing magnitudes; values in kN, kNm or m (converted to mm). */
export function chk(label: string, formula: string, expected: number, actual: number, unit: Check['unit'], note?: string): Check {
  const f = unit === 'mm' || unit === 'mrad' ? 1000 : 1;
  return { label, formula, expected: Math.abs(expected) * f, actual: Math.abs(actual) * f, unit, note };
}

/** Same, keeping signs (for quantities that can change sign as you move a slider). */
export function chkSigned(label: string, formula: string, expected: number, actual: number, unit: Check['unit'], note?: string): Check {
  const f = unit === 'mm' || unit === 'mrad' ? 1000 : 1;
  return { label, formula, expected: expected * f, actual: actual * f, unit, note };
}

export const AXIAL_NOTE = 'The hand formula ignores axial shortening; the model includes it.';
