import type { MemberSpec, Spec, Vec2 } from '../engine/types';
import { archPoints, chain, chk, down, flatTruss, num, range, ssMoment, sup, udl } from './kit';
import type { CheckContext, Example, Params } from './types';

const PANELS = 6;
const PANEL = 2;

function panelTruss(kind: 'pratt' | 'howe' | 'warren', p: Params): Spec {
  const h = num(p, 'h');
  const t = flatTruss(kind, PANELS, PANEL, h);
  const P = num(p, 'P');
  const loads = [];
  for (let i = 1; i < PANELS; i++) loads.push(down(t.bottomMemberTo(i), 1, P, { label: `Panel point ${i}` }));
  return { nodes: t.nodes, members: t.members, supports: [sup(t.bottom[0], 'pin'), sup(t.bottom[PANELS], 'roller')], loads };
}

/** Bending moment of the equivalent simple beam at x, from the panel loads that are on and in place. */
function panelMoment(c: CheckContext, x: number): number | null {
  const P = num(c.p, 'P');
  const pts: Array<{ x: number; P: number }> = [];
  for (let l = 0; l < c.spec.loads.length; l++) {
    if (!c.inPlace(l)) return null;
    if (c.on(l)) pts.push({ x: (l + 1) * PANEL, P });
  }
  return ssMoment(pts, PANELS * PANEL, x);
}

function archSpec(p: Params, opts: { shape?: 'parabola' | 'circle'; crownHinge?: boolean; tie?: boolean; n?: number }): { spec: Spec; n: number } {
  const L = num(p, 'L');
  const f = num(p, 'f');
  const n = opts.n ?? 16;
  const pts: Vec2[] = archPoints(opts.shape ?? 'parabola', L, f, n);
  const members: MemberSpec[] = chain(pts, (i) => ({ role: 'arch', hingeB: !!opts.crownHinge && i === n / 2 - 1 }));
  if (opts.tie) members.push({ a: 0, b: n, EA: 8e5, EI: 200, truss: true, role: 'tie' });
  return {
    spec: { nodes: pts, members, supports: [sup(0, 'pin'), sup(n, opts.tie ? 'roller' : 'pin')], loads: [] },
    n,
  };
}

const depth = (value: number) => range('h', 'Depth', 1, 3, 0.25, value, 'm');
const panelLoad = range('P', 'Panel load', 2, 30, 1, 10, 'kN');
const archSpan = range('L', 'Span', 8, 20, 1, 12, 'm');
const rise = (value = 3) => range('f', 'Rise', 1, 6, 0.25, value, 'm');
const archLoad = range('w', 'Load', 2, 20, 1, 10, 'kN/m');

export const trusses: Example[] = [
  {
    id: 'pratt-truss',
    sheet: 'trusses',
    title: 'Pratt truss',
    blurb: 'Six panels, pin-jointed, loaded at the bottom panel points. Diagonals slope down towards mid-span.',
    notes: [
      'Switch to the axial diagram: diagonals are in tension and verticals in compression, which suits steel, since long members in tension cannot buckle.',
      'The chords carry the bending: top chord in compression, bottom chord in tension, largest at mid-span.',
      'Chord force at mid-span is simply M/h, the beam moment divided by the depth.',
    ],
    params: [depth(2), panelLoad],
    build: (p) => panelTruss('pratt', p),
    checks: (c) => {
      const M = panelMoment(c, (PANELS / 2) * PANEL);
      if (M === null || M === 0) return [];
      const h = num(c.p, 'h');
      const top = c.spec.members.findIndex((m) => m.role === 'chord' && c.spec.nodes[m.a][1] > 0 && c.spec.nodes[m.a][0] === 2 * PANEL);
      return [chk('Top chord next to mid-span', 'M / h', M / h, c.N(top, 0.5), 'kN')];
    },
  },
  {
    id: 'howe-truss',
    sheet: 'trusses',
    title: 'Howe truss',
    blurb: 'The same truss with the diagonals turned the other way.',
    notes: [
      'Now the diagonals are in compression and the verticals in tension, the opposite of the Pratt.',
      'Good for timber with steel rods as verticals; the chords carry the same forces as before.',
    ],
    params: [depth(2), panelLoad],
    build: (p) => panelTruss('howe', p),
    checks: (c) => {
      const M = panelMoment(c, (PANELS / 2) * PANEL);
      if (M === null || M === 0) return [];
      const h = num(c.p, 'h');
      return [chk('Bottom chord next to mid-span', 'M / h', M / h, c.N(2, 0.5), 'kN')];
    },
  },
  {
    id: 'warren-truss',
    sheet: 'trusses',
    title: 'Warren truss',
    blurb: 'Equilateral-ish triangles with no verticals.',
    notes: [
      'Diagonals alternate between tension and compression along the span.',
      'Shear, and so diagonal force, is largest near the supports and drops towards mid-span.',
    ],
    params: [depth(1.75), panelLoad],
    build: (p) => panelTruss('warren', p),
    checks: (c) => {
      const M = panelMoment(c, (PANELS / 2) * PANEL);
      if (M === null || M === 0) return [];
      const h = num(c.p, 'h');
      const top = c.spec.members.findIndex((m) => c.spec.nodes[m.a][1] > 0 && c.spec.nodes[m.b][1] > 0 && Math.abs(c.spec.nodes[m.a][0] - 2.5 * PANEL) < 1e-9);
      return [chk('Top chord over mid-span', 'M / h', M / h, c.N(top, 0.5), 'kN')];
    },
  },
  {
    id: 'king-post',
    sheet: 'trusses',
    title: 'King post truss',
    blurb: 'Two rafters, a tie and a king post: the oldest roof truss there is.',
    notes: [
      'With only the apex load the king post does nothing at all: a zero-force member.',
      'Switch on the ceiling load and the king post wakes up, hanging the tie from the apex.',
      'The tie force P·L/4h doubles if you halve the rise.',
    ],
    params: [range('L', 'Span', 4, 12, 0.5, 8, 'm'), range('h', 'Rise', 1, 4, 0.25, 2, 'm'), range('P', 'Apex load', 5, 40, 1, 20, 'kN')],
    build: (p) => {
      const L = num(p, 'L');
      const h = num(p, 'h');
      const bar: Partial<MemberSpec> = { EI: 8000, EA: 8e5, truss: true };
      return {
        nodes: [
          [0, 0],
          [L, 0],
          [L / 2, h],
          [L / 2, 0],
        ],
        members: [
          { a: 0, b: 2, role: 'chord', ...bar },
          { a: 2, b: 1, role: 'chord', ...bar },
          { a: 0, b: 3, role: 'tie', ...bar },
          { a: 3, b: 1, role: 'tie', ...bar },
          { a: 2, b: 3, role: 'brace', ...bar },
        ],
        supports: [sup(0, 'pin'), sup(1, 'roller')],
        loads: [down(0, 1, num(p, 'P'), { label: 'Apex' }), down(2, 1, num(p, 'P') / 2, { label: 'Ceiling', on: false })],
      };
    },
    checks: (c) => {
      if (!c.inPlace(0) || !c.inPlace(1)) return [];
      const L = num(c.p, 'L');
      const h = num(c.p, 'h');
      const total = (c.on(0) ? num(c.p, 'P') : 0) + (c.on(1) ? num(c.p, 'P') / 2 : 0);
      if (!total) return [];
      const out = [chk('Tie force', '(P_apex + P_ceiling)·L / 4h', (total * L) / (4 * h), c.N(2, 0.5), 'kN')];
      if (c.on(1)) out.push(chk('King post force', 'P_ceiling', num(c.p, 'P') / 2, c.N(4, 0.5), 'kN'));
      return out;
    },
  },
  {
    id: 'wall-bracket',
    sheet: 'trusses',
    title: 'Wall bracket truss',
    blurb: 'A cantilever truss pinned to a wall at two points, carrying a load at its tip.',
    notes: [
      'The top chord is in tension and the bottom chord in compression, the reverse of a simply supported truss.',
      'Chord forces grow towards the wall in step with the cantilever moment: P·x / h.',
    ],
    params: [range('P', 'Tip load', 2, 30, 1, 10, 'kN')],
    build: (p) => {
      const top: Vec2[] = [
        [0, 1.5],
        [1.5, 1.5],
        [3, 1.5],
        [4.5, 1.5],
      ];
      const bottom: Vec2[] = [
        [0, 0],
        [1.5, 0],
        [3, 0],
        [4.5, 0],
      ];
      const bar: Partial<MemberSpec> = { EI: 8000, EA: 8e5, truss: true };
      const members: MemberSpec[] = [];
      const add = (a: number, b: number, role: MemberSpec['role']) => members.push({ a, b, role, ...bar });
      for (let i = 0; i < 3; i++) add(i, i + 1, 'chord');
      for (let i = 0; i < 3; i++) add(4 + i, 5 + i, 'chord');
      for (let i = 1; i < 4; i++) add(i, 4 + i, 'brace');
      for (let i = 0; i < 3; i++) add(i, 5 + i, 'brace');
      return {
        nodes: [...top, ...bottom],
        members,
        supports: [sup(0, 'pin', { face: [-1, 0] }), sup(4, 'pin', { face: [-1, 0] })],
        loads: [down(5, 1, num(p, 'P'))],
      };
    },
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const P = num(c.p, 'P');
      return [
        chk('Bottom chord at the wall', 'P·L / h', (P * 4.5) / 1.5, c.N(3, 0.5), 'kN'),
        chk('Top chord, first panel', 'P(L − a) / h', (P * 3) / 1.5, c.N(0, 0.5), 'kN'),
      ];
    },
  },
  {
    id: 'arch-parabolic',
    sheet: 'trusses',
    title: 'Parabolic arch, full load',
    blurb: 'A two-pinned parabolic arch under load spread evenly across its span.',
    notes: [
      'A parabola is the funicular shape for a uniform load: the arch carries it almost entirely in compression.',
      'The bending diagram is nearly empty. Switch to axial force to see where the load really goes.',
      'Flatten the arch and the thrust H ≈ wL²/8f climbs fast.',
    ],
    params: [archSpan, rise(), archLoad],
    build: (p) => {
      const { spec, n } = archSpec(p, {});
      spec.loads.push(udl(Array.from({ length: n }, (_, i) => i), num(p, 'w'), { projected: true }));
      return spec;
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const f = num(c.p, 'f');
      const w = num(c.p, 'w');
      return [chk('Horizontal thrust', '≈ wL² / 8f', (w * L * L) / (8 * f), c.R(0)[0], 'kN', 'A two-pinned arch loses a little thrust to shortening of the rib.')];
    },
  },
  {
    id: 'arch-three-pin-full',
    sheet: 'trusses',
    title: 'Three-pinned arch, full load',
    blurb: 'The same parabola with a hinge at the crown. Now the thrust follows from statics alone.',
    notes: ['Taking moments about the crown hinge gives H = wL²/8f exactly.', 'With the right shape and the right load, there is next to no bending anywhere.'],
    params: [archSpan, rise(), archLoad],
    build: (p) => {
      const { spec, n } = archSpec(p, { crownHinge: true });
      spec.loads.push(udl(Array.from({ length: n }, (_, i) => i), num(p, 'w'), { projected: true }));
      return spec;
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const f = num(c.p, 'f');
      const w = num(c.p, 'w');
      return [chk('Horizontal thrust', 'wL² / 8f', (w * L * L) / (8 * f), c.R(0)[0], 'kN'), chk('Vertical reactions', 'wL/2', (w * L) / 2, c.R(0)[1], 'kN')];
    },
  },
  {
    id: 'arch-three-pin-half',
    sheet: 'trusses',
    title: 'Three-pinned arch, half load',
    blurb: 'Load on one half only. The shape no longer matches the load.',
    notes: [
      'Large bending appears, sagging under the load and hogging in the unloaded half.',
      'The thrust halves to wL²/16f, but the bending makes this the critical case for most arches.',
    ],
    params: [archSpan, rise(), archLoad],
    build: (p) => {
      const { spec, n } = archSpec(p, { crownHinge: true });
      spec.loads.push(udl(Array.from({ length: n / 2 }, (_, i) => i), num(p, 'w'), { projected: true }));
      return spec;
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const f = num(c.p, 'f');
      const w = num(c.p, 'w');
      return [chk('Horizontal thrust', 'wL² / 16f', (w * L * L) / (16 * f), c.R(0)[0], 'kN'), chk('Reaction under the load', '3wL/8', (3 * w * L) / 8, c.R(0)[1], 'kN')];
    },
  },
  {
    id: 'arch-semicircle',
    sheet: 'trusses',
    title: 'Semicircular arch, crown load',
    blurb: 'A two-pinned semicircle with a single load at the crown.',
    notes: [
      'A circle is not the funicular for a point load, so bending is large near the haunches.',
      'Thrust is about P/π. The crown drops and the haunches bulge outwards.',
    ],
    params: [range('L', 'Span', 4, 12, 0.5, 8, 'm'), range('P', 'Crown load', 5, 50, 5, 20, 'kN')],
    build: (p) => {
      const L = num(p, 'L');
      const { spec, n } = archSpec({ L, f: L / 2 }, { shape: 'circle', n: 20 });
      spec.loads.push(down(n / 2 - 1, 1, num(p, 'P')));
      return spec;
    },
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const P = num(c.p, 'P');
      return [chk('Horizontal thrust', '≈ P/π', P / Math.PI, c.R(0)[0], 'kN', 'Classic result for a slender two-pinned semicircle, ignoring rib shortening; the model uses straight segments.')];
    },
  },
  {
    id: 'tied-arch',
    sheet: 'trusses',
    title: 'Tied arch',
    blurb: 'An arch on a pin and a roller, with a tie between its feet to take the thrust.',
    notes: [
      'The supports now only see vertical load: the tie keeps the thrust inside the structure.',
      'The tie stretches, the feet spread slightly, and the arch picks up a little bending as a result.',
    ],
    params: [archSpan, rise(), archLoad],
    build: (p) => {
      const { spec, n } = archSpec(p, { tie: true });
      spec.loads.push(udl(Array.from({ length: n }, (_, i) => i), num(p, 'w'), { projected: true }));
      return spec;
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const f = num(c.p, 'f');
      const w = num(c.p, 'w');
      return [chk('Tie force', '≈ wL² / 8f', (w * L * L) / (8 * f), c.N(c.spec.members.length - 1, 0.5), 'kN', 'Slightly less than wL²/8f: the tie and the rib both change length.')];
    },
  },
];
