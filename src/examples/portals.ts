import type { Spec } from '../engine/types';
import { AXIAL_NOTE, EI, chk, force, lineLoad, num, portal, range, sup, udl } from './kit';
import type { Example, Params } from './types';

const span = range('L', 'Span', 4, 10, 0.5, 6, 'm');
const height = range('h', 'Height', 2.5, 6, 0.5, 4, 'm');
const ratio = (value = 1) => range('r', 'Beam / column stiffness', 0.1, 10, 0.01, value, 'Ib/Ic', true);
const gravity = range('w', 'Beam load', 2, 25, 1, 10, 'kN/m');
const lateral = range('P', 'Sideways load', 2, 30, 1, 10, 'kN');

const geom = (p: Params) => ({ L: num(p, 'L'), h: num(p, 'h'), r: num(p, 'r') });
/** Kleinlogel's stiffness ratio k = (Ib/Ic)(h/L). */
const kOf = (p: Params) => (num(p, 'r') * num(p, 'h')) / num(p, 'L');

function swayPortal(p: Params, base: 'fixed' | 'pin'): Spec {
  const { L, h, r } = geom(p);
  const f = portal(L, h, { EIb: EI * r });
  return { ...f, supports: [sup(f.baseL, base), sup(f.baseR, base)], loads: [force(f.colL, 1, num(p, 'P'), 0, { label: 'Wind' })] };
}

function fixedSwayChecks(c: Parameters<NonNullable<Example['checks']>>[0]) {
  if (!c.on(0) || !c.inPlace(0)) return [];
  const { h } = geom(c.p);
  const P = num(c.p, 'P');
  const k = kOf(c.p);
  return [
    chk('Base moment', '(Ph/2)(1 + 3k)/(1 + 6k)', ((P * h) / 2) * ((1 + 3 * k) / (1 + 6 * k)), c.R(0)[2], 'kNm', AXIAL_NOTE),
    chk('Moment at the top of the column', '(Ph/2)·3k/(1 + 6k)', ((P * h) / 2) * ((3 * k) / (1 + 6 * k)), c.M(0, 1), 'kNm', AXIAL_NOTE),
    chk('Shear in each column', 'P/2', P / 2, c.R(0)[0], 'kN', AXIAL_NOTE),
  ];
}

export const portals: Example[] = [
  {
    id: 'portal-fixed-gravity',
    sheet: 'portals',
    title: 'Fixed portal, gravity',
    blurb: 'A single-bay frame with fixed feet and a uniform load on the beam.',
    notes: [
      'The rigid knees let the beam hog at its ends, so mid-span sagging is well below wL²/8.',
      'The feet push outwards; the bases push back with a horizontal thrust.',
      'Symmetric frame, symmetric load: no sway. Try making the beam stiffer and see the knees take less moment.',
    ],
    params: [span, height, ratio(), gravity],
    build: (p) => {
      const { L, h, r } = geom(p);
      const f = portal(L, h, { EIb: EI * r });
      return { ...f, supports: [sup(f.baseL, 'fixed'), sup(f.baseR, 'fixed')], loads: [udl(f.beams, num(p, 'w'))] };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const { L, h } = geom(c.p);
      const w = num(c.p, 'w');
      const k = kOf(c.p);
      return [
        chk('Knee moment', 'wL² / 6(k + 2)', (w * L * L) / (6 * (k + 2)), c.M(1, 0), 'kNm', AXIAL_NOTE),
        chk('Base moment', 'wL² / 12(k + 2)', (w * L * L) / (12 * (k + 2)), c.R(0)[2], 'kNm', AXIAL_NOTE),
        chk('Horizontal thrust', 'wL² / 4h(k + 2)', (w * L * L) / (4 * h * (k + 2)), c.R(0)[0], 'kN', AXIAL_NOTE),
      ];
    },
  },
  {
    id: 'portal-pinned-gravity',
    sheet: 'portals',
    title: 'Pinned portal, gravity',
    blurb: 'The same frame on pinned feet. One degree of indeterminacy instead of three.',
    notes: [
      'No moment at the feet, so the columns are triangles of moment from zero at the base to the knee.',
      'Knee moments are smaller than with fixed feet, and the beam sags more.',
    ],
    params: [span, height, ratio(), gravity],
    build: (p) => {
      const { L, h, r } = geom(p);
      const f = portal(L, h, { EIb: EI * r });
      return { ...f, supports: [sup(f.baseL, 'pin'), sup(f.baseR, 'pin')], loads: [udl(f.beams, num(p, 'w'))] };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const { L, h } = geom(c.p);
      const w = num(c.p, 'w');
      const k = kOf(c.p);
      const Mk = (w * L * L) / (4 * (2 * k + 3));
      return [
        chk('Knee moment', 'wL² / 4(2k + 3)', Mk, c.M(1, 0), 'kNm', AXIAL_NOTE),
        chk('Horizontal thrust', 'M_knee / h', Mk / h, c.R(0)[0], 'kN', AXIAL_NOTE),
        chk('Mid-span moment', 'wL²/8 − M_knee', (w * L * L) / 8 - Mk, c.M(1, 0.5), 'kNm', AXIAL_NOTE),
      ];
    },
  },
  {
    id: 'portal-fixed-sway',
    sheet: 'portals',
    title: 'Fixed portal, sway',
    blurb: 'Wind pushes the top of the frame sideways.',
    notes: [
      'Each column takes half the wind as shear, P/2, whatever the stiffnesses.',
      'Columns bend in double curvature, with contraflexure somewhere up the column.',
      'The beam is bent into an S by the rotating knees, and the feet push and pull vertically to resist overturning.',
    ],
    params: [span, height, ratio(), lateral],
    build: (p) => swayPortal(p, 'fixed'),
    checks: fixedSwayChecks,
  },
  {
    id: 'portal-pinned-sway',
    sheet: 'portals',
    title: 'Pinned portal, sway',
    blurb: 'The pinned-foot frame under the same wind.',
    notes: [
      'Knee moments are Ph/2 regardless of stiffness, twice the fixed-foot value when the beam is rigid.',
      'It sways much further than the fixed frame: the columns now bend as cantilevers hanging from the knees.',
      'Vertical reactions Ph/L resist overturning.',
    ],
    params: [span, height, ratio(), lateral],
    build: (p) => swayPortal(p, 'pin'),
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const { L, h } = geom(c.p);
      const P = num(c.p, 'P');
      return [
        chk('Knee moment', 'Ph/2', (P * h) / 2, c.M(0, 1), 'kNm'),
        chk('Vertical reactions', 'Ph/L', (P * h) / L, c.R(0)[1], 'kN'),
        chk('Shear in each column', 'P/2', P / 2, c.R(0)[0], 'kN'),
      ];
    },
  },
  {
    id: 'portal-three-pin-gravity',
    sheet: 'portals',
    title: 'Three-pinned portal, gravity',
    blurb: 'Pinned feet and a hinge at the crown. Statically determinate again.',
    notes: [
      'Zero moment at the feet and at the crown fixes the thrust by statics: H = wL²/8h.',
      'Knee moments equal wL²/8, the whole simple-span moment, carried to the corners instead of mid-span.',
      'Settlement or temperature would cause no stress at all.',
    ],
    params: [span, height, ratio(), gravity],
    build: (p) => {
      const { L, h, r } = geom(p);
      const f = portal(L, h, { EIb: EI * r, crown: 'hinge' });
      return { ...f, supports: [sup(f.baseL, 'pin'), sup(f.baseR, 'pin')], loads: [udl(f.beams, num(p, 'w'))] };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const { L, h } = geom(c.p);
      const w = num(c.p, 'w');
      return [
        chk('Horizontal thrust', 'wL² / 8h', (w * L * L) / (8 * h), c.R(0)[0], 'kN'),
        chk('Knee moment', 'wL²/8', (w * L * L) / 8, c.M(1, 0), 'kNm'),
      ];
    },
  },
  {
    id: 'portal-three-pin-sway',
    sheet: 'portals',
    title: 'Three-pinned portal, sway',
    blurb: 'The three-pinned frame under wind.',
    notes: [
      'The crown hinge forces equal horizontal reactions of P/2 at both feet.',
      'Both knees carry Ph/2, one each way.',
    ],
    params: [span, height, ratio(), lateral],
    build: (p) => {
      const { L, h, r } = geom(p);
      const f = portal(L, h, { EIb: EI * r, crown: 'hinge' });
      return { ...f, supports: [sup(f.baseL, 'pin'), sup(f.baseR, 'pin')], loads: [force(f.colL, 1, num(p, 'P'), 0, { label: 'Wind' })] };
    },
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const { L, h } = geom(c.p);
      const P = num(c.p, 'P');
      return [
        chk('Horizontal reactions', 'P/2', P / 2, c.R(0)[0], 'kN'),
        chk('Vertical reactions', 'Ph/L', (P * h) / L, c.R(0)[1], 'kN'),
        chk('Knee moments', 'Ph/2', (P * h) / 2, c.M(0, 1), 'kNm'),
      ];
    },
  },
  {
    id: 'portal-unequal-legs',
    sheet: 'portals',
    title: 'Portal on unequal legs',
    blurb: 'A short pinned leg on one side, a tall fixed leg on the other.',
    notes: [
      'A purely vertical load makes it sway, because the frame is not symmetric.',
      'The short leg is much stiffer sideways and attracts most of the horizontal reaction.',
    ],
    params: [range('P', 'Load', 5, 60, 5, 30, 'kN')],
    build: (p) => ({
      nodes: [
        [0, 2],
        [0, 4.4],
        [2.4, 4.4],
        [4.4, 4.4],
        [4.4, 0],
      ],
      members: [
        { a: 0, b: 1, EI, role: 'column' },
        { a: 1, b: 2, EI, role: 'beam' },
        { a: 2, b: 3, EI, role: 'beam' },
        { a: 3, b: 4, EI, role: 'column' },
      ],
      supports: [sup(0, 'pin'), sup(4, 'fixed')],
      loads: [force(1, 1, 0, -num(p, 'P'))],
    }),
  },
  {
    id: 'portal-stiff-beam',
    sheet: 'portals',
    title: 'Stiff beam, slender columns',
    blurb: 'A fixed portal whose beam is ten times as stiff as its columns.',
    notes: [
      'The beam barely rotates, so each column bends like a fixed–guided member: contraflexure at mid-height.',
      'Base and top moments both approach Ph/4.',
    ],
    params: [span, height, ratio(10), lateral],
    build: (p) => swayPortal(p, 'fixed'),
    checks: fixedSwayChecks,
  },
  {
    id: 'portal-slender-beam',
    sheet: 'portals',
    title: 'Slender beam, stiff columns',
    blurb: 'The opposite: columns ten times as stiff as the beam.',
    notes: [
      'The beam can barely restrain the column tops, so the columns behave like two separate cantilevers.',
      'Base moments approach Ph/2, double the stiff-beam case, and the sway is much larger.',
    ],
    params: [span, height, ratio(0.1), lateral],
    build: (p) => swayPortal(p, 'fixed'),
    checks: fixedSwayChecks,
  },
  {
    id: 'portal-pin-roller',
    sheet: 'portals',
    title: 'Portal on a pin and a roller',
    blurb: 'One foot is free to slide outwards, so the frame cannot develop any thrust.',
    notes: [
      'With no horizontal reaction the columns carry no moment at all.',
      'The beam is left to span as a plain simple beam: wL²/8 at mid-span.',
      'The roller foot slides outwards as the beam sags and the knees rotate.',
    ],
    params: [span, height, ratio(), gravity],
    build: (p) => {
      const { L, h, r } = geom(p);
      const f = portal(L, h, { EIb: EI * r });
      return { ...f, supports: [sup(f.baseL, 'pin'), sup(f.baseR, 'roller')], loads: [udl(f.beams, num(p, 'w'))] };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const { L } = geom(c.p);
      const w = num(c.p, 'w');
      return [chk('Mid-span moment', 'wL²/8', (w * L * L) / 8, c.M(1, 0.5), 'kNm'), chk('Each vertical reaction', 'wL/2', (w * L) / 2, c.R(0)[1], 'kN')];
    },
  },
  {
    id: 'portal-tied',
    sheet: 'portals',
    title: 'Tied portal',
    blurb: 'The sliding foot again, now tied back to the other foot with a steel rod.',
    notes: [
      'The tie supplies the thrust the roller could not, so the frame works like a pinned portal again.',
      'The tie stretches a little, so its force is slightly below the pinned-portal thrust.',
    ],
    params: [span, height, ratio(), gravity],
    build: (p) => {
      const { L, h, r } = geom(p);
      const f = portal(L, h, { EIb: EI * r });
      // Member 3: a rod tying the feet together.
      f.members.push({ a: f.baseL, b: f.baseR, EA: 4e5, EI: 200, truss: true, role: 'tie' });
      return { ...f, supports: [sup(f.baseL, 'pin'), sup(f.baseR, 'roller')], loads: [udl(f.beams, num(p, 'w'))] };
    },
    checks: (c) => {
      if (!c.on(0)) return [];
      const { L, h } = geom(c.p);
      const w = num(c.p, 'w');
      const k = kOf(c.p);
      return [
        chk('Tie force', '≈ wL² / 4h(2k + 3)', (w * L * L) / (4 * h * (2 * k + 3)), c.N(3, 0.5), 'kN', 'The tie stretches, which lets the frame spread a little and sheds some thrust.'),
      ];
    },
  },
  {
    id: 'gable-gravity',
    sheet: 'portals',
    title: 'Pitched portal, snow',
    blurb: 'A pitched-roof portal frame, the shed of every industrial estate, with snow on the rafters.',
    notes: [
      'The ridge drops and the eaves spread outwards, bending the columns.',
      'The largest moment is at the knees (the haunches), which is why real frames are deepened there.',
      'The rafters carry significant axial compression: they are part beam, part arch.',
    ],
    params: [range('L', 'Span', 8, 20, 1, 12, 'm'), range('h', 'Eaves height', 3, 7, 0.5, 4.5, 'm'), range('f', 'Ridge rise', 0.5, 4, 0.25, 2, 'm'), range('w', 'Snow', 1, 10, 0.5, 5, 'kN/m')],
    build: (p) => gable(p, 'gravity'),
    checks: (c) => {
      if (!c.on(0)) return [];
      const L = num(c.p, 'L');
      const w = num(c.p, 'w');
      return [chk('Each vertical reaction', 'wL/2', (w * L) / 2, c.R(0)[1], 'kN')];
    },
  },
  {
    id: 'gable-wind',
    sheet: 'portals',
    title: 'Pitched portal, wind',
    blurb: 'The same frame with wind: pressure on the windward wall, suction on the leeward wall and uplift on the roof.',
    notes: [
      'Switch the three wind effects on one at a time to see how each one bends the frame.',
      'Roof uplift can reverse the knee moments from the snow case, a classic design check.',
    ],
    params: [range('L', 'Span', 8, 20, 1, 12, 'm'), range('h', 'Eaves height', 3, 7, 0.5, 4.5, 'm'), range('f', 'Ridge rise', 0.5, 4, 0.25, 2, 'm'), range('q', 'Wind pressure', 0.5, 6, 0.25, 2.5, 'kN/m')],
    build: (p) => gable(p, 'wind'),
  },
  {
    id: 'gable-tied',
    sheet: 'portals',
    title: 'Pitched portal with eaves tie',
    blurb: 'Pinned on one side, sliding on the other, with a tie across the eaves.',
    notes: [
      'The tie stops the eaves spreading, so the rafters and tie work like a truss.',
      'The columns are left almost free of moment: they simply carry the roof down.',
    ],
    params: [range('L', 'Span', 8, 20, 1, 12, 'm'), range('h', 'Eaves height', 3, 7, 0.5, 4.5, 'm'), range('f', 'Ridge rise', 0.5, 4, 0.25, 2.5, 'm'), range('w', 'Snow', 1, 10, 0.5, 5, 'kN/m')],
    build: (p) => {
      const s = gable(p, 'gravity');
      s.members.push({ a: 1, b: 3, EA: 4e5, EI: 200, truss: true, role: 'tie' });
      s.supports = [sup(0, 'pin'), sup(4, 'roller')];
      return s;
    },
  },
];

function gable(p: Params, load: 'gravity' | 'wind'): Spec {
  const L = num(p, 'L');
  const h = num(p, 'h');
  const f = num(p, 'f');
  const spec: Spec = {
    nodes: [
      [0, 0],
      [0, h],
      [L / 2, h + f],
      [L, h],
      [L, 0],
    ],
    members: [
      { a: 0, b: 1, EI, role: 'column' },
      { a: 1, b: 2, EI, role: 'beam' },
      { a: 2, b: 3, EI, role: 'beam' },
      { a: 3, b: 4, EI, role: 'column' },
    ],
    supports: [sup(0, 'pin'), sup(4, 'pin')],
    loads: [],
  };
  if (load === 'gravity') {
    spec.loads.push(udl([1, 2], num(p, 'w'), { projected: true, label: 'Snow' }));
  } else {
    const q = num(p, 'q');
    spec.loads.push(
      lineLoad([0], [q, 0], { label: 'Windward wall' }),
      lineLoad([3], [0.6 * q, 0], { label: 'Leeward suction' }),
      lineLoad([1, 2], 0.8 * q, { normal: true, label: 'Roof uplift' }),
    );
  }
  return spec;
}
