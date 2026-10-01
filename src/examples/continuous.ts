import { beamLine, chk, chkSigned, down, EI, num, range, settle, sup, udl } from './kit';
import type { Example } from './types';

export const continuous: Example[] = [
  {
    id: 'overhang-tip',
    sheet: 'continuous',
    title: 'Overhang, tip load',
    blurb: 'A simple span with an overhang and a load on the end of it, like a balcony beam running back into the building.',
    notes: [
      'The far support has to pull down: a holding-down reaction of P·a/L.',
      'The back span lifts upwards even though every load points down.',
      'Hogging moment P·a over the near support, falling linearly to zero at both ends.',
    ],
    params: [range('L', 'Back span', 3, 8, 0.5, 5, 'm'), range('a', 'Overhang', 0.5, 3, 0.25, 2, 'm'), range('P', 'Load', 5, 40, 5, 20, 'kN')],
    build: (p) => {
      const L = num(p, 'L');
      return {
        ...beamLine([0, L, L + num(p, 'a')]),
        supports: [sup(0, 'pin'), sup(1, 'roller')],
        loads: [down(1, 1, num(p, 'P'))],
      };
    },
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const L = num(c.p, 'L');
      const a = num(c.p, 'a');
      const P = num(c.p, 'P');
      return [
        chk('Holding-down force at A', 'P·a / L', (P * a) / L, c.R(0)[1], 'kN'),
        chk('Reaction at B', 'P(L + a) / L', (P * (L + a)) / L, c.R(1)[1], 'kN'),
        chk('Moment over B', 'P·a', P * a, c.M(1, 0), 'kNm'),
      ];
    },
  },
  {
    id: 'double-overhang-udl',
    sheet: 'continuous',
    title: 'Double overhang, uniform load',
    blurb: 'Supports set in from both ends. Slide the overhang and balance the moments.',
    notes: [
      'Hogging wa²/2 over each support, sagging wL²/8 − wa²/2 at mid-span.',
      'Make the overhang about 0.35 of the main span and the hogging and sagging peaks come out equal: the most economical layout.',
      'Two points of contraflexure appear once the overhang is long enough.',
    ],
    params: [range('L', 'Main span', 3, 8, 0.5, 6, 'm'), range('a', 'Overhangs', 0.5, 3, 0.25, 1.5, 'm'), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const L = num(p, 'L');
      const a = num(p, 'a');
      return {
        ...beamLine([0, a, a + L, 2 * a + L]),
        supports: [sup(1, 'pin'), sup(2, 'roller')],
        loads: [udl([0, 1, 2], num(p, 'w'))],
      };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const a = num(c.p, 'a');
      const w = num(c.p, 'w');
      return [
        chk('Moment over the supports', 'wa²/2', (w * a * a) / 2, c.M(1, 0), 'kNm'),
        chkSigned('Mid-span moment', 'wL²/8 − wa²/2', (w * L * L) / 8 - (w * a * a) / 2, c.M(1, 0.5), 'kNm'),
      ];
    },
  },
  {
    id: 'double-overhang-ends',
    sheet: 'continuous',
    title: 'Double overhang, end loads',
    blurb: 'Loads only at the two tips. The span between the supports carries no load at all.',
    notes: [
      'Between the supports the shear is zero and the moment is a constant −P·a: pure bending again.',
      'So the middle span curves upwards into a circular arc while the tips droop.',
    ],
    params: [range('L', 'Main span', 3, 8, 0.5, 6, 'm'), range('a', 'Overhangs', 0.5, 3, 0.25, 1.5, 'm'), range('P', 'Each load', 5, 40, 5, 15, 'kN')],
    build: (p) => {
      const L = num(p, 'L');
      const a = num(p, 'a');
      const P = num(p, 'P');
      return {
        ...beamLine([0, a, a + L, 2 * a + L]),
        supports: [sup(1, 'pin'), sup(2, 'roller')],
        loads: [down(0, 0, P), down(2, 1, P)],
      };
    },
    checks: (c) => {
      if (!c.on(0) || !c.on(1) || !c.inPlace(0) || !c.inPlace(1)) return [];
      const a = num(c.p, 'a');
      const P = num(c.p, 'P');
      return [
        chk('Moment between the supports', 'P·a', P * a, c.M(1, 0.5), 'kNm'),
        chk('Each reaction', 'P', P, c.R(1)[1], 'kN'),
      ];
    },
  },
  {
    id: 'two-span-udl',
    sheet: 'continuous',
    title: 'Two spans, both loaded',
    blurb: 'A beam running continuously over three supports with both spans loaded.',
    notes: [
      'The middle support takes 10/8 of a span load, more than half the total.',
      'Hogging wL²/8 over the middle support, the same size as the simple-span sagging moment.',
      'Each span behaves like a propped cantilever: the slope over the middle support is zero by symmetry.',
    ],
    params: [range('L', 'Each span', 3, 8, 0.5, 5, 'm'), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const L = num(p, 'L');
      return {
        ...beamLine([0, L, 2 * L]),
        supports: [sup(0, 'pin'), sup(1, 'roller'), sup(2, 'roller')],
        loads: [udl([0, 1], num(p, 'w'))],
      };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [
        chk('Middle reaction', '10wL/8', (10 * w * L) / 8, c.R(1)[1], 'kN'),
        chk('End reaction', '3wL/8', (3 * w * L) / 8, c.R(0)[1], 'kN'),
        chk('Moment over the middle', 'wL²/8', (w * L * L) / 8, c.M(0, 1), 'kNm'),
      ];
    },
  },
  {
    id: 'two-span-pattern',
    sheet: 'continuous',
    title: 'Two spans, one loaded',
    blurb: 'The same continuous beam with only one span loaded. Pattern loading in its simplest form.',
    notes: [
      'The unloaded span lifts. Its far support has to hold the beam down with wL/16.',
      'Hogging over the middle halves to wL²/16, so the loaded span sags more than when both spans are loaded.',
      'Designers check both patterns: full load for the support, alternate spans for the mid-span.',
    ],
    params: [range('L', 'Each span', 3, 8, 0.5, 5, 'm'), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const L = num(p, 'L');
      return {
        ...beamLine([0, L, 2 * L]),
        supports: [sup(0, 'pin'), sup(1, 'roller'), sup(2, 'roller')],
        loads: [udl([0], num(p, 'w'))],
      };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [
        chk('Moment over the middle', 'wL²/16', (w * L * L) / 16, c.M(0, 1), 'kNm'),
        chk('Holding-down force at C', 'wL/16', (w * L) / 16, c.R(2)[1], 'kN'),
        chk('Reaction at A', '7wL/16', (7 * w * L) / 16, c.R(0)[1], 'kN'),
      ];
    },
  },
  {
    id: 'three-span-udl',
    sheet: 'continuous',
    title: 'Three spans, all loaded',
    blurb: 'Three equal spans with every span loaded.',
    notes: [
      'Hogging 0.1wL² over the inner supports; the end spans sag about 0.08wL².',
      'The inner supports carry 1.1wL each, the outer ones 0.4wL.',
      'The middle span hardly sags: continuity on both sides holds it up.',
    ],
    params: [range('L', 'Each span', 3, 8, 0.5, 5, 'm'), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const L = num(p, 'L');
      return {
        ...beamLine([0, L, 2 * L, 3 * L]),
        supports: [sup(0, 'pin'), sup(1, 'roller'), sup(2, 'roller'), sup(3, 'roller')],
        loads: [udl([0, 1, 2], num(p, 'w'))],
      };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [
        chk('Moment over B', '0.1wL²', 0.1 * w * L * L, c.M(0, 1), 'kNm'),
        chk('End reaction', '0.4wL', 0.4 * w * L, c.R(0)[1], 'kN'),
        chk('Inner reaction', '1.1wL', 1.1 * w * L, c.R(1)[1], 'kN'),
      ];
    },
  },
  {
    id: 'three-span-alternate',
    sheet: 'continuous',
    title: 'Three spans, outer spans loaded',
    blurb: 'Load the two end spans and leave the middle empty.',
    notes: [
      'The empty middle span bows upwards under a constant hogging moment of wL²/20.',
      'This pattern gives the largest sagging moment in the end spans.',
    ],
    params: [range('L', 'Each span', 3, 8, 0.5, 5, 'm'), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const L = num(p, 'L');
      return {
        ...beamLine([0, L, 2 * L, 3 * L]),
        supports: [sup(0, 'pin'), sup(1, 'roller'), sup(2, 'roller'), sup(3, 'roller')],
        loads: [udl([0], num(p, 'w')), udl([2], num(p, 'w'))],
      };
    },
    checks: (c) => {
      if (!c.on(0) || !c.on(1)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [chk('Moment over B and C', 'wL²/20', (w * L * L) / 20, c.M(1, 0.5), 'kNm')];
    },
  },
  {
    id: 'fixed-two-rollers',
    sheet: 'continuous',
    title: 'Fixed beam over two rollers',
    blurb: 'Built in at the left, then running over two rollers. One point load in the long span.',
    notes: [
      'The short end span kicks up as the long span deflects: the moment carries over the roller.',
      'Slide the load into the short span and the long span lifts instead.',
    ],
    params: [range('P', 'Load', 5, 50, 5, 25, 'kN')],
    build: (p) => ({
      ...beamLine([0, 2.5, 5.5, 8]),
      supports: [sup(0, 'fixed'), sup(2, 'roller'), sup(3, 'roller')],
      loads: [down(0, 1, num(p, 'P'))],
    }),
  },
  {
    id: 'gerber-fixed',
    sheet: 'continuous',
    title: 'Gerber beam, one hinge',
    blurb: 'A propped cantilever with a hinge cut into it. The hinge removes the redundancy: everything follows from statics.',
    notes: [
      'The moment is zero at the hinge, and the beam kinks there.',
      'The suspended span acts as a simple beam; it hangs its reaction wb/2 on the tip of the cantilever.',
      'Slide the hinge position in the panel and watch the wall moment change.',
    ],
    params: [range('L', 'Length', 4, 10, 0.5, 6, 'm'), range('a', 'Hinge from the wall', 1, 4, 0.25, 2, 'm'), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const L = num(p, 'L');
      const a = Math.min(num(p, 'a'), L - 0.5);
      const g = beamLine([0, a, L]);
      g.members[0].hingeB = true;
      return { ...g, supports: [sup(0, 'fixed'), sup(2, 'roller')], loads: [udl([0, 1], num(p, 'w'))] };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const a = Math.min(num(c.p, 'a'), L - 0.5);
      const b = L - a;
      const w = num(c.p, 'w');
      return [
        chk('Roller reaction', 'wb/2', (w * b) / 2, c.R(2)[1], 'kN'),
        chk('Moment at the wall', 'wa²/2 + (wb/2)·a', (w * a * a) / 2 + ((w * b) / 2) * a, c.M(0, 0), 'kNm'),
      ];
    },
  },
  {
    id: 'gerber-cantilevered',
    sheet: 'continuous',
    title: 'Cantilevered and suspended spans',
    blurb: 'A classic bridge arrangement: an anchor span cantilevers past its support and carries a short suspended span on a hinge.',
    notes: [
      'Statically determinate, so it shrugs off settlement and temperature without extra stress.',
      'Hogging over the pier comes from the overhang load plus the suspended span reaction.',
    ],
    params: [range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const g = beamLine([0, 6, 7.5, 10]);
      g.members[1].hingeB = true;
      return { ...g, supports: [sup(0, 'pin'), sup(1, 'roller'), sup(3, 'roller')], loads: [udl([0, 1, 2], num(p, 'w'))] };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const w = num(c.p, 'w');
      const e = 1.5;
      const s = 2.5;
      return [
        chk('End reaction of the suspended span', 'ws/2', (w * s) / 2, c.R(3)[1], 'kN'),
        chk('Moment over the pier', 'we²/2 + (ws/2)·e', (w * e * e) / 2 + ((w * s) / 2) * e, c.M(1, 0), 'kNm'),
      ];
    },
  },
  {
    id: 'spring-support',
    sheet: 'continuous',
    title: 'Two spans on a spring',
    blurb: 'The middle support is a spring, like a beam bearing on a softer beam or on soil.',
    notes: [
      'A soft spring and the beam acts as one long simple span; a stiff one and it becomes a continuous beam.',
      'Move the stiffness slider and watch the hogging moment over the spring appear.',
    ],
    params: [range('k', 'Spring stiffness', 100, 1_000_000, 1, 5000, 'kN/m', true), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => ({
      ...beamLine([0, 4, 8]),
      supports: [sup(0, 'pin'), sup(1, 'spring', { ky: num(p, 'k') }), sup(2, 'roller')],
      loads: [udl([0, 1], num(p, 'w'))],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const k = num(c.p, 'k');
      const w = num(c.p, 'w');
      const d0 = (5 * w * 8 ** 4) / (384 * c.EI);
      const f = 8 ** 3 / (48 * c.EI);
      return [chk('Spring force', 'δ₀ / (L³/48EI + 1/k)', d0 / (f + 1 / k), c.R(1)[1], 'kN')];
    },
  },
  {
    id: 'continuous-settlement',
    sheet: 'continuous',
    title: 'Two spans, middle support sinks',
    blurb: 'The middle support of a continuous beam settles. Switch the floor load on to see the two effects add up.',
    notes: [
      'Settlement alone produces sagging 3EIΔ/L² over the middle support, as if it were pulling the beam down.',
      'Under load, settlement relieves the hogging over the middle and loads up the spans.',
    ],
    params: [range('L', 'Each span', 3, 8, 0.5, 5, 'm'), range('d', 'Settlement', 2, 30, 1, 10, 'mm'), range('w', 'Floor load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const L = num(p, 'L');
      return {
        ...beamLine([0, L, 2 * L]),
        supports: [sup(0, 'pin'), sup(1, 'roller'), sup(2, 'roller')],
        loads: [settle(1, -num(p, 'd') / 1000, { label: 'Settlement' }), udl([0, 1], num(p, 'w'), { on: false })],
      };
    },
    checks: (c) => {
      const L = num(c.p, 'L');
      const d = num(c.p, 'd') / 1000;
      const w = num(c.p, 'w');
      const settleM = c.on(0) ? (3 * EI * d) / (L * L) : 0;
      const loadM = c.on(1) ? -(w * L * L) / 8 : 0;
      if (!c.on(0) && !c.on(1)) return [];
      return [chkSigned('Moment over the middle', '3EIΔ/L² − wL²/8 (as applied)', settleM + loadM, c.M(0, 1), 'kNm')];
    },
  },
  {
    id: 'stepped-beam',
    sheet: 'continuous',
    title: 'Simple span, stiffer middle',
    blurb: 'The middle third is four times as stiff, like a beam with cover plates.',
    notes: [
      'The moments are exactly those of a uniform beam. A determinate beam gets its moments from statics alone.',
      'Only the deflection changes. Curvature M/EI drops where the beam is stiffer, so the middle stays flatter.',
    ],
    params: [range('k', 'Middle stiffness', 1, 10, 0.5, 4, '× EI'), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => ({
      ...beamLine([0, 2, 4, 6], (i) => ({ EI: i === 1 ? EI * num(p, 'k') : EI })),
      supports: [sup(0, 'pin'), sup(3, 'roller')],
      loads: [udl([0, 1, 2], num(p, 'w'))],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const w = num(c.p, 'w');
      return [
        chk('Mid-span moment', 'wL²/8', (w * 36) / 8, c.M(1, 0.5), 'kNm'),
        chk('Each reaction', 'wL/2', w * 3, c.R(0)[1], 'kN'),
      ];
    },
  },
  {
    id: 'moving-load',
    sheet: 'continuous',
    title: 'Moving load on two spans',
    blurb: 'One wheel load on a two-span bridge. Drag it across and watch both spans respond.',
    notes: [
      'In the first span it pushes that span down and lifts the second; the far support pulls down.',
      'Hogging over the middle support peaks with the load at about 0.58 of the span.',
      'This is an influence line traced by hand: the structure’s response as the load moves.',
    ],
    params: [range('P', 'Wheel load', 10, 80, 5, 40, 'kN')],
    build: (p) => ({
      ...beamLine([0, 5, 10]),
      supports: [sup(0, 'pin'), sup(1, 'roller'), sup(2, 'roller')],
      loads: [down(0, 0.4, num(p, 'P'), { label: 'Wheel' })],
    }),
  },
];
