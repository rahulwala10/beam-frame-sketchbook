import { beamLine, chk, couple, down, num, range, settle, sup, udl } from './kit';
import type { Example } from './types';

const SQ3 = Math.sqrt(3);

export const spans: Example[] = [
  {
    id: 'cantilever-tip-load',
    sheet: 'spans',
    title: 'Cantilever, tip load',
    blurb: 'Built into a wall at one end, free at the other, with a single load. The reference case every other beam is compared with.',
    notes: [
      'Hogging moment grows in a straight line from zero at the load to P·a at the wall.',
      'Shear is constant between the wall and the load, and zero beyond it.',
      'Grab the tip and pull along the beam: it hardly moves. Axial stiffness EA/L is thousands of times the bending stiffness 3EI/L³.',
    ],
    params: [range('L', 'Length', 2, 8, 0.5, 5, 'm'), range('P', 'Load', 5, 50, 5, 20, 'kN')],
    build: (p) => ({ ...beamLine([0, num(p, 'L')]), supports: [sup(0, 'fixed')], loads: [down(0, 1, num(p, 'P'))] }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const P = num(c.p, 'P');
      const a = c.t(0) * L;
      return [
        chk('Reaction at the wall', 'P', P, c.R(0)[1], 'kN'),
        chk('Moment at the wall', 'P·a', P * a, c.M(0, 0), 'kNm'),
        chk('Tip deflection', 'P·a²(3L − a) / 6EI', (P * a * a * (3 * L - a)) / (6 * c.EI), c.v(0, 1), 'mm'),
      ];
    },
  },
  {
    id: 'cantilever-udl',
    sheet: 'spans',
    title: 'Cantilever, uniform load',
    blurb: 'The same cantilever carrying its load spread evenly, like a balcony slab strip.',
    notes: [
      'The moment curve is a parabola, steepest at the wall where the shear is largest.',
      'Spreading the load over the length cuts the tip deflection: wL⁴/8EI against PL³/3EI for the same total load.',
    ],
    params: [range('L', 'Length', 2, 8, 0.5, 5, 'm'), range('w', 'Load', 2, 20, 1, 8, 'kN/m')],
    build: (p) => ({ ...beamLine([0, num(p, 'L')]), supports: [sup(0, 'fixed')], loads: [udl([0], num(p, 'w'))] }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [
        chk('Moment at the wall', 'wL²/2', (w * L * L) / 2, c.M(0, 0), 'kNm'),
        chk('Tip deflection', 'wL⁴ / 8EI', (w * L ** 4) / (8 * c.EI), c.v(0, 1), 'mm'),
      ];
    },
  },
  {
    id: 'cantilever-couple',
    sheet: 'spans',
    title: 'Cantilever, end couple',
    blurb: 'A pure couple at the free end. No force at all, just a twist.',
    notes: [
      'The moment is the same everywhere, so the curvature is too: the beam bends into a true circular arc.',
      'There is no shear and no vertical reaction. The wall only supplies a moment.',
      'Drag the couple along the beam: only the part between the wall and the couple bends; the rest stays straight and simply tilts.',
    ],
    params: [range('L', 'Length', 2, 8, 0.5, 5, 'm'), range('M', 'Couple', 5, 60, 5, 30, 'kNm')],
    build: (p) => ({ ...beamLine([0, num(p, 'L')]), supports: [sup(0, 'fixed')], loads: [couple(0, 1, -num(p, 'M'))] }),
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const L = num(c.p, 'L');
      const M = num(c.p, 'M');
      return [
        chk('Moment along the beam', 'M₀', M, c.M(0, 0.5), 'kNm'),
        chk('Tip deflection', 'M₀L² / 2EI', (M * L * L) / (2 * c.EI), c.v(0, 1), 'mm'),
        chk('Tip rotation', 'M₀L / EI', (M * L) / c.EI, c.rot(1), 'mrad'),
      ];
    },
  },
  {
    id: 'ss-point-load',
    sheet: 'spans',
    title: 'Simply supported, point load',
    blurb: 'A pin at one end, a roller at the other, and one load you can slide along the span.',
    notes: [
      'The bending moment is a triangle with its peak under the load: P·a·b/L.',
      'Each support carries the share of the load given by the lever rule. Slide the load and watch the reactions trade places.',
      'Maximum deflection is never far from mid-span, even when the load is near a support.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('P', 'Load', 5, 60, 5, 30, 'kN')],
    build: (p) => ({
      ...beamLine([0, num(p, 'L')]),
      supports: [sup(0, 'pin'), sup(1, 'roller')],
      loads: [down(0, 0.5, num(p, 'P'))],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const P = num(c.p, 'P');
      const a = c.t(0) * L;
      const b = L - a;
      return [
        chk('Reaction at A', 'P·b / L', (P * b) / L, c.R(0)[1], 'kN'),
        chk('Moment under the load', 'P·a·b / L', (P * a * b) / L, c.M(0, c.t(0)), 'kNm'),
        chk('Deflection under the load', 'P·a²b² / 3EIL', (P * a * a * b * b) / (3 * c.EI * L), c.v(0, c.t(0)), 'mm'),
      ];
    },
  },
  {
    id: 'ss-udl',
    sheet: 'spans',
    title: 'Simply supported, uniform load',
    blurb: 'The most common beam in practice: a floor joist or lintel carrying a uniform load.',
    notes: [
      'Shear falls linearly and crosses zero at mid-span, exactly where the moment peaks at wL²/8.',
      'Deflection 5wL⁴/384EI grows with the fourth power of the span: double the span and it deflects 16 times as much.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('w', 'Load', 2, 30, 1, 10, 'kN/m')],
    build: (p) => ({ ...beamLine([0, num(p, 'L')]), supports: [sup(0, 'pin'), sup(1, 'roller')], loads: [udl([0], num(p, 'w'))] }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [
        chk('Each reaction', 'wL/2', (w * L) / 2, c.R(0)[1], 'kN'),
        chk('Mid-span moment', 'wL²/8', (w * L * L) / 8, c.M(0, 0.5), 'kNm'),
        chk('Mid-span deflection', '5wL⁴ / 384EI', (5 * w * L ** 4) / (384 * c.EI), c.v(0, 0.5), 'mm'),
      ];
    },
  },
  {
    id: 'ss-two-loads',
    sheet: 'spans',
    title: 'Four-point bending',
    blurb: 'Two equal loads at the third points. This is how beams are tested in the lab.',
    notes: [
      'Between the loads the shear is zero and the moment is constant: pure bending.',
      'With constant moment the middle third bends into a circular arc.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('P', 'Each load', 5, 40, 5, 15, 'kN')],
    build: (p) => ({
      ...beamLine([0, num(p, 'L')]),
      supports: [sup(0, 'pin'), sup(1, 'roller')],
      loads: [down(0, 1 / 3, num(p, 'P')), down(0, 2 / 3, num(p, 'P'))],
    }),
    checks: (c) => {
      if (!c.on(0) || !c.on(1) || !c.inPlace(0) || !c.inPlace(1)) return [];
      const L = num(c.p, 'L');
      const P = num(c.p, 'P');
      const a = L / 3;
      return [
        chk('Moment between the loads', 'P·a', P * a, c.M(0, 0.5), 'kNm'),
        chk('Mid-span deflection', 'P·a(3L² − 4a²) / 24EI', (P * a * (3 * L * L - 4 * a * a)) / (24 * c.EI), c.v(0, 0.5), 'mm'),
      ];
    },
  },
  {
    id: 'ss-triangular',
    sheet: 'spans',
    title: 'Simply supported, triangular load',
    blurb: 'Load rising from zero to w₀, like soil or water pressure on a vertical plank.',
    notes: [
      'The heavier end takes two thirds of the load.',
      'Peak moment w₀L²/9√3 sits at L/√3 from the light end, where the shear is zero, not at mid-span.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('w', 'Peak load', 5, 40, 1, 15, 'kN/m')],
    build: (p) => ({
      ...beamLine([0, num(p, 'L')]),
      supports: [sup(0, 'pin'), sup(1, 'roller')],
      loads: [udl([0], num(p, 'w'), { ramp: [0, 1] })],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [
        chk('Reaction at the light end', 'w₀L/6', (w * L) / 6, c.R(0)[1], 'kN'),
        chk('Reaction at the heavy end', 'w₀L/3', (w * L) / 3, c.R(1)[1], 'kN'),
        chk('Peak moment', 'w₀L² / 9√3', (w * L * L) / (9 * SQ3), c.M(0, 1 / SQ3), 'kNm'),
      ];
    },
  },
  {
    id: 'ss-end-couple',
    sheet: 'spans',
    title: 'Simply supported, end couple',
    blurb: 'A couple applied at the roller end, like the moment a continuous beam passes to its end span.',
    notes: [
      'The supports respond with an equal and opposite pair of forces, M₀/L, one up and one down.',
      'The moment diagram is a triangle from zero at the pin to M₀ at the couple.',
      'Slide the couple to mid-span: the moment jumps by M₀ there and the beam bends into an S.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('M', 'Couple', 5, 60, 5, 30, 'kNm')],
    build: (p) => ({
      ...beamLine([0, num(p, 'L')]),
      supports: [sup(0, 'pin'), sup(1, 'roller')],
      loads: [couple(0, 1, num(p, 'M'))],
    }),
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const L = num(c.p, 'L');
      const M = num(c.p, 'M');
      return [
        chk('Support forces', 'M₀/L', M / L, c.R(0)[1], 'kN'),
        chk('Moment at the couple', 'M₀', M, c.M(0, 1), 'kNm'),
        chk('Largest deflection', 'M₀L² / 9√3·EI', (M * L * L) / (9 * SQ3 * c.EI), c.peakV(0), 'mm'),
      ];
    },
  },
  {
    id: 'propped-udl',
    sheet: 'spans',
    title: 'Propped cantilever, uniform load',
    blurb: 'Fixed at one end, propped on a roller at the other. One redundant reaction.',
    notes: [
      'The prop takes 3/8 of the load, the wall 5/8.',
      'Hogging wL²/8 at the wall, sagging 9wL²/128 at 5L/8 from the wall.',
      'Watch for the point of contraflexure at L/4 from the wall, where the moment changes sign.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('w', 'Load', 2, 30, 1, 10, 'kN/m')],
    build: (p) => ({ ...beamLine([0, num(p, 'L')]), supports: [sup(0, 'fixed'), sup(1, 'roller')], loads: [udl([0], num(p, 'w'))] }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [
        chk('Prop reaction', '3wL/8', (3 * w * L) / 8, c.R(1)[1], 'kN'),
        chk('Moment at the wall', 'wL²/8', (w * L * L) / 8, c.M(0, 0), 'kNm'),
        chk('Largest sagging moment', '9wL²/128', (9 * w * L * L) / 128, c.peakM(0, 1), 'kNm'),
        chk('Largest deflection', '0.00542·wL⁴/EI', (0.0054161 * w * L ** 4) / c.EI, c.peakV(0), 'mm'),
      ];
    },
  },
  {
    id: 'propped-point',
    sheet: 'spans',
    title: 'Propped cantilever, point load',
    blurb: 'The propped cantilever again, with a single load you can move.',
    notes: [
      'With the load at mid-span the prop carries 5P/16 and the wall moment is 3PL/16.',
      'Slide the load towards the wall and the prop reaction drops away quickly.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('P', 'Load', 5, 60, 5, 30, 'kN')],
    build: (p) => ({
      ...beamLine([0, num(p, 'L')]),
      supports: [sup(0, 'fixed'), sup(1, 'roller')],
      loads: [down(0, 0.5, num(p, 'P'))],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const P = num(c.p, 'P');
      const a = c.t(0) * L;
      const b = L - a;
      const RB = (P * a * a * (3 * L - a)) / (2 * L ** 3);
      return [
        chk('Prop reaction', 'P·a²(3L − a) / 2L³', RB, c.R(1)[1], 'kN'),
        chk('Moment at the wall', 'P·a·b(L + b) / 2L²', (P * a * b * (L + b)) / (2 * L * L), c.M(0, 0), 'kNm'),
        chk('Moment under the load', 'R_B·b', RB * b, c.M(0, c.t(0)), 'kNm'),
      ];
    },
  },
  {
    id: 'fixed-udl',
    sheet: 'spans',
    title: 'Fixed–fixed, uniform load',
    blurb: 'Both ends fully fixed. The stiffest way to support a single span.',
    notes: [
      'End moments wL²/12 are twice the mid-span moment wL²/24. Together they add up to the simple-span wL²/8.',
      'Deflection is one fifth of the simply supported beam: wL⁴/384EI.',
      'Two points of contraflexure, at 0.211L from each end.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('w', 'Load', 2, 30, 1, 10, 'kN/m')],
    build: (p) => ({ ...beamLine([0, num(p, 'L')]), supports: [sup(0, 'fixed'), sup(1, 'fixed')], loads: [udl([0], num(p, 'w'))] }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [
        chk('End moments', 'wL²/12', (w * L * L) / 12, c.M(0, 0), 'kNm'),
        chk('Mid-span moment', 'wL²/24', (w * L * L) / 24, c.M(0, 0.5), 'kNm'),
        chk('Mid-span deflection', 'wL⁴ / 384EI', (w * L ** 4) / (384 * c.EI), c.v(0, 0.5), 'mm'),
      ];
    },
  },
  {
    id: 'fixed-point',
    sheet: 'spans',
    title: 'Fixed–fixed, point load',
    blurb: 'A built-in beam with one load. Move it and see which end works harder.',
    notes: [
      'The end nearer the load picks up the larger fixed-end moment: P·a·b²/L² and P·a²·b/L².',
      'At mid-span: PL/8 at each end and PL/8 under the load, deflection PL³/192EI.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('P', 'Load', 5, 60, 5, 30, 'kN')],
    build: (p) => ({
      ...beamLine([0, num(p, 'L')]),
      supports: [sup(0, 'fixed'), sup(1, 'fixed')],
      loads: [down(0, 0.5, num(p, 'P'))],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const P = num(c.p, 'P');
      const a = c.t(0) * L;
      const b = L - a;
      return [
        chk('Moment at A', 'P·a·b² / L²', (P * a * b * b) / (L * L), c.M(0, 0), 'kNm'),
        chk('Moment at B', 'P·a²·b / L²', (P * a * a * b) / (L * L), c.M(0, 1), 'kNm'),
        chk('Deflection under the load', 'P·a³b³ / 3EIL³', (P * a ** 3 * b ** 3) / (3 * c.EI * L ** 3), c.v(0, c.t(0)), 'mm'),
      ];
    },
  },
  {
    id: 'fixed-settlement',
    sheet: 'spans',
    title: 'Fixed–fixed, sinking support',
    blurb: 'No load at all. One end of a built-in beam settles by Δ.',
    notes: [
      'Moments appear from nothing: 6EIΔ/L² at each end, opposite in sign. Only an indeterminate structure does this.',
      'The beam takes an S shape with contraflexure exactly at mid-span.',
      'Stiffer beams suffer more. Settlement moments grow with EI, which is why stiff structures need careful foundations.',
    ],
    params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('d', 'Settlement', 5, 40, 1, 15, 'mm')],
    build: (p) => ({
      ...beamLine([0, num(p, 'L')]),
      supports: [sup(0, 'fixed'), sup(1, 'fixed')],
      loads: [settle(1, -num(p, 'd') / 1000, { label: 'Settlement' })],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const d = num(c.p, 'd') / 1000;
      return [
        chk('End moments', '6EIΔ / L²', (6 * c.EI * d) / (L * L), c.M(0, 0), 'kNm'),
        chk('Shear', '12EIΔ / L³', (12 * c.EI * d) / L ** 3, c.V(0, 0.5), 'kN'),
      ];
    },
  },
  {
    id: 'fixed-guided',
    sheet: 'spans',
    title: 'Fixed end, sliding clamp',
    blurb: 'The far end can slide up and down but cannot rotate, like one storey of a column in a sway frame.',
    notes: [
      'Equal and opposite end moments of PL/2: double curvature with contraflexure at mid-span.',
      'Deflection PL³/12EI is a quarter of a plain cantilever of the same length.',
    ],
    params: [range('L', 'Length', 2, 8, 0.5, 5, 'm'), range('P', 'Load', 5, 50, 5, 20, 'kN')],
    build: (p) => ({
      ...beamLine([0, num(p, 'L')]),
      supports: [sup(0, 'fixed'), sup(1, 'slide')],
      loads: [down(0, 1, num(p, 'P'), { draggable: false })],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const P = num(c.p, 'P');
      return [
        chk('Moment at the wall', 'PL/2', (P * L) / 2, c.M(0, 0), 'kNm'),
        chk('Moment at the clamp', 'PL/2', (P * L) / 2, c.M(0, 1), 'kNm'),
        chk('Clamp deflection', 'PL³ / 12EI', (P * L ** 3) / (12 * c.EI), c.v(0, 1), 'mm'),
      ];
    },
  },
];
