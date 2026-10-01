import type { MemberSpec, Spec, Vec2 } from '../engine/types';
import { EI, chk, down, force, grid, num, portal, range, sup, udl } from './kit';
import type { Example } from './types';

const BRACE: Partial<MemberSpec> = { EA: 4e5, EI: 500, truss: true, role: 'brace' };

export const frames: Example[] = [
  {
    id: 'bent-cantilever',
    sheet: 'frames',
    title: 'Bent cantilever',
    blurb: 'An L-shaped cantilever out of a wall, pulled back towards the wall at its tip.',
    notes: [
      'The horizontal arm carries a constant moment P·e, because the load’s lever arm to every point on it is the same.',
      'The hanging leg bends as a little cantilever of its own.',
      'The tip moves sideways and up: the arm rotates as it curves.',
    ],
    params: [range('P', 'Pull', 2, 30, 1, 10, 'kN')],
    build: (p) => ({
      nodes: [
        [0, 0],
        [4, 0],
        [4, -2.5],
      ],
      members: [
        { a: 0, b: 1, EI, role: 'beam' },
        { a: 1, b: 2, EI, role: 'column' },
      ],
      supports: [sup(0, 'fixed')],
      loads: [force(1, 1, -num(p, 'P'), 0)],
    }),
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const P = num(c.p, 'P');
      return [
        chk('Moment along the arm', 'P·e', P * 2.5, c.M(0, 0.5), 'kNm'),
        chk('Moment at the wall', 'P·e', P * 2.5, c.R(0)[2], 'kNm'),
      ];
    },
  },
  {
    id: 'gallows-frame',
    sheet: 'frames',
    title: 'Gallows frame',
    blurb: 'A post with an arm, like a sign or a street light, loaded at the end of the arm.',
    notes: [
      'The post carries a constant moment P·a from top to bottom, so it curves into an arc.',
      'That curvature swings the whole arm sideways: the tip moves more than the arm alone would bend.',
      'Drag the load along the arm and watch the post’s moment follow the lever arm.',
    ],
    params: [range('a', 'Arm length', 1, 4, 0.25, 2.5, 'm'), range('P', 'Load', 2, 30, 1, 10, 'kN')],
    build: (p) => ({
      nodes: [
        [0, 0],
        [0, 4],
        [num(p, 'a'), 4],
      ],
      members: [
        { a: 0, b: 1, EI, role: 'column' },
        { a: 1, b: 2, EI, role: 'beam' },
      ],
      supports: [sup(0, 'fixed')],
      loads: [down(1, 1, num(p, 'P'))],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const a = num(c.p, 'a') * c.t(0);
      const P = num(c.p, 'P');
      if (c.spec.loads[0].kind !== 'point' || c.spec.loads[0].member !== 1) return [];
      return [chk('Moment in the post', 'P·a', P * a, c.M(0, 0.5), 'kNm'), chk('Base moment', 'P·a', P * a, c.R(0)[2], 'kNm')];
    },
  },
  {
    id: 'tree-column',
    sheet: 'frames',
    title: 'Tree column, unbalanced',
    blurb: 'A column with an arm each side. Load them unequally and the column has to make up the difference.',
    notes: [
      'Balanced loads cancel at the top of the column: it stays straight.',
      'Switch off one load and the column bends with the full out-of-balance moment.',
    ],
    params: [range('P1', 'Left load', 0, 40, 1, 20, 'kN'), range('P2', 'Right load', 0, 40, 1, 10, 'kN')],
    build: (p) => ({
      nodes: [
        [0, 0],
        [0, 4],
        [-2.5, 4],
        [2.5, 4],
      ],
      members: [
        { a: 0, b: 1, EI, role: 'column' },
        { a: 1, b: 2, EI, role: 'beam' },
        { a: 1, b: 3, EI, role: 'beam' },
      ],
      supports: [sup(0, 'fixed')],
      loads: [down(1, 1, num(p, 'P1'), { label: 'Left' }), down(2, 1, num(p, 'P2'), { label: 'Right' })],
    }),
    checks: (c) => {
      if (!c.inPlace(0) || !c.inPlace(1)) return [];
      const net = (c.on(0) ? num(c.p, 'P1') : 0) - (c.on(1) ? num(c.p, 'P2') : 0);
      return [chk('Base moment', '(P₁ − P₂)·a', net * 2.5, c.R(0)[2], 'kNm')];
    },
  },
  {
    id: 'inclined-beam',
    sheet: 'frames',
    title: 'Inclined beam',
    blurb: 'A rafter or stair stringer on a pin at the bottom and a roller at the top, loaded per metre of plan.',
    notes: [
      'With a vertical roller reaction the bending is exactly that of a level beam of the plan span: wLₕ²/8.',
      'The slope adds axial force instead: compression near the pin, fading towards the roller.',
    ],
    params: [range('Lh', 'Plan span', 3, 8, 0.5, 6, 'm'), range('rise', 'Rise', 1, 5, 0.5, 3, 'm'), range('w', 'Load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => ({
      nodes: [
        [0, 0],
        [num(p, 'Lh'), num(p, 'rise')],
      ],
      members: [{ a: 0, b: 1, EI, role: 'beam' }],
      supports: [sup(0, 'pin'), sup(1, 'roller')],
      loads: [udl([0], num(p, 'w'), { projected: true })],
    }),
    checks: (c) => {
      if (!c.on(0)) return [];
      const Lh = num(c.p, 'Lh');
      const w = num(c.p, 'w');
      return [chk('Mid-span moment', 'wLₕ²/8', (w * Lh * Lh) / 8, c.M(0, 0.5), 'kNm'), chk('Each vertical reaction', 'wLₕ/2', (w * Lh) / 2, c.R(1)[1], 'kN')];
    },
  },
  {
    id: 'two-bay-gravity',
    sheet: 'frames',
    title: 'Two-bay frame, gravity',
    blurb: 'Two bays on three columns: fixed outer feet, a pinned middle foot, one load in the left bay.',
    notes: [
      'The loaded bay hogs at both ends; the unloaded bay is dragged into an S by the rotating middle joint.',
      'The frame is not symmetric about the load, so it sways a little too.',
    ],
    params: [range('P', 'Load', 5, 60, 5, 30, 'kN')],
    build: (p) => {
      const g = grid([5, 5], [4]);
      return { ...g, supports: [sup(g.node(0, 0), 'fixed'), sup(g.node(1, 0), 'pin'), sup(g.node(2, 0), 'fixed')], loads: [down(g.beam(0, 1), 0.5, num(p, 'P'))] };
    },
  },
  {
    id: 'two-bay-sway',
    sheet: 'frames',
    title: 'Two-bay frame, sway',
    blurb: 'The two-bay frame with fixed feet, pushed sideways at roof level.',
    notes: [
      'The middle column has beams on both sides, so it is restrained best and takes the largest share of the shear.',
      'All three columns bend in double curvature.',
    ],
    params: [range('P', 'Sideways load', 2, 40, 1, 15, 'kN')],
    build: (p) => {
      const g = grid([5, 5], [4]);
      return {
        ...g,
        supports: [0, 1, 2].map((i) => sup(g.node(i, 0), 'fixed')),
        loads: [force(g.col(0, 1), 1, num(p, 'P'), 0, { label: 'Wind' })],
      };
    },
  },
  {
    id: 'two-storey-sway',
    sheet: 'frames',
    title: 'Two-storey frame, sway',
    blurb: 'A one-bay, two-storey frame with wind at both floors.',
    notes: [
      'The ground-floor columns carry the wind from both floors, so they bend most.',
      'Storey drift is largest at the bottom, the classic shear-building shape.',
    ],
    params: [range('P', 'Wind at each floor', 2, 30, 1, 10, 'kN')],
    build: (p) => {
      const g = grid([6], [3.5, 3.5]);
      const P = num(p, 'P');
      return {
        ...g,
        supports: [sup(g.node(0, 0), 'fixed'), sup(g.node(1, 0), 'fixed')],
        loads: [force(g.col(0, 1), 1, P, 0, { label: 'Wind, first floor' }), force(g.col(0, 2), 1, P, 0, { label: 'Wind, roof' })],
      };
    },
  },
  {
    id: 'three-storey-wind',
    sheet: 'frames',
    title: 'Three storeys, wind',
    blurb: 'Two bays, three storeys, wind at every floor.',
    notes: [
      'Moments in the columns grow towards the ground as the storey shear accumulates.',
      'Points of contraflexure sit near mid-height of each column: the basis of the portal method of hand analysis.',
      'Grab the roof and pull: the frame racks storey by storey.',
    ],
    params: [range('P', 'Wind at each floor', 2, 20, 1, 8, 'kN')],
    build: (p) => {
      const g = grid([5, 5], [3.5, 3.5, 3.5]);
      const P = num(p, 'P');
      return {
        ...g,
        supports: [0, 1, 2].map((i) => sup(g.node(i, 0), 'fixed')),
        loads: [1, 2, 3].map((j) => force(g.col(0, j), 1, j === 3 ? P * 0.6 : P, 0, { label: `Wind, level ${j}` })),
      };
    },
  },
  {
    id: 'three-storey-gravity',
    sheet: 'frames',
    title: 'Three storeys, floor loads',
    blurb: 'The same frame carrying floor loads on every beam.',
    notes: [
      'Beams behave much like fixed-ended beams; the end moments are shared between the columns above and below.',
      'The outer columns bend more than the inner one, which is balanced by beams on both sides.',
      'Column axial forces build up floor by floor, the inner column carrying about twice the outer ones.',
    ],
    params: [range('w', 'Floor load', 2, 30, 1, 12, 'kN/m')],
    build: (p) => {
      const g = grid([5, 5], [3.5, 3.5, 3.5]);
      return {
        ...g,
        supports: [0, 1, 2].map((i) => sup(g.node(i, 0), 'fixed')),
        loads: [udl([1, 2, 3].flatMap((j) => g.beamsAt(j)), num(p, 'w'), { label: 'Floors' })],
      };
    },
  },
  {
    id: 'braced-portal',
    sheet: 'frames',
    title: 'Braced portal',
    blurb: 'A pinned portal with one diagonal brace. Compare it with the unbraced pinned portal.',
    notes: [
      'The brace carries almost all the wind in pure tension; sway drops to a fraction of a millimetre.',
      'Frame moments almost vanish. Bracing is far more efficient than bending.',
      'Push the other way and the same brace goes into compression, where slender braces buckle. That is why braces come in pairs.',
    ],
    params: [range('P', 'Sideways load', 2, 30, 1, 10, 'kN')],
    build: (p) => {
      const f = portal(6, 4);
      f.members.push({ a: f.baseL, b: f.kneeR, ...BRACE });
      return { ...f, supports: [sup(f.baseL, 'pin'), sup(f.baseR, 'pin')], loads: [force(f.colL, 1, num(p, 'P'), 0, { label: 'Wind' })] };
    },
    checks: (c) => {
      if (!c.on(0) || !c.inPlace(0)) return [];
      const P = num(c.p, 'P');
      return [chk('Brace force', '≈ P / cos θ', (P * Math.hypot(6, 4)) / 6, c.N(3, 0.5), 'kN', 'The frame itself takes a sliver of the load, so the brace carries a little less than P/cos θ.')];
    },
  },
  {
    id: 'x-braced-tower',
    sheet: 'frames',
    title: 'X-braced frame',
    blurb: 'Three storeys with simple pinned beam connections and pinned feet. Only the X-bracing keeps it standing.',
    notes: [
      'Without the braces this frame would fold over like a mechanism.',
      'In each storey one diagonal is in tension and the other in compression; they share the storey shear.',
      'Columns carry the overturning as axial force: tension on the windward side, compression on the leeward side.',
    ],
    params: [range('P', 'Wind at each floor', 2, 20, 1, 8, 'kN')],
    build: (p) => {
      const g = grid([4], [3.5, 3.5, 3.5], { pinnedBeams: true });
      for (let j = 1; j <= 3; j++) {
        g.members.push({ a: g.node(0, j - 1), b: g.node(1, j), ...BRACE });
        g.members.push({ a: g.node(1, j - 1), b: g.node(0, j), ...BRACE });
      }
      const P = num(p, 'P');
      return {
        ...g,
        supports: [sup(g.node(0, 0), 'pin'), sup(g.node(1, 0), 'pin')],
        loads: [1, 2, 3].map((j) => force(g.col(0, j), 1, P, 0, { label: `Wind, level ${j}` })),
      };
    },
  },
  {
    id: 'chevron-braced',
    sheet: 'frames',
    title: 'Chevron-braced frame',
    blurb: 'An inverted-V brace meeting the beam at mid-span.',
    notes: [
      'Under wind one leg of the chevron pulls and the other pushes; the beam barely bends.',
      'Switch on the roof load: the braces now prop the beam at mid-span, turning it into two short spans.',
    ],
    params: [range('P', 'Sideways load', 2, 30, 1, 10, 'kN'), range('w', 'Roof load', 2, 20, 1, 10, 'kN/m')],
    build: (p) => {
      const f = portal(6, 4, { crown: 'node' });
      f.members.push({ a: f.baseL, b: f.crown!, ...BRACE }, { a: f.baseR, b: f.crown!, ...BRACE });
      return {
        ...f,
        supports: [sup(f.baseL, 'pin'), sup(f.baseR, 'pin')],
        loads: [force(f.colL, 1, num(p, 'P'), 0, { label: 'Wind' }), udl(f.beams, num(p, 'w'), { on: false, label: 'Roof' })],
      };
    },
  },
  {
    id: 'vierendeel',
    sheet: 'frames',
    title: 'Vierendeel girder',
    blurb: 'A truss without diagonals: rigid joints only, so every member has to work in bending.',
    notes: [
      'Each panel racks like a little sway frame, with contraflexure near the middle of each chord.',
      'Shear is carried by bending of the chords, so the end panels, where shear is highest, work hardest.',
      'Compare the deflection with the Pratt truss on the trusses sheet: diagonals are worth a lot.',
    ],
    params: [range('w', 'Deck load', 2, 20, 1, 8, 'kN/m')],
    build: (p) => {
      const n = 5;
      const a = 2;
      const h = 1.5;
      const nodes: Vec2[] = [];
      for (let i = 0; i <= n; i++) nodes.push([i * a, 0]);
      for (let i = 0; i <= n; i++) nodes.push([i * a, h]);
      const members: MemberSpec[] = [];
      const top: number[] = [];
      for (let i = 0; i < n; i++) members.push({ a: i, b: i + 1, EI, role: 'chord' });
      for (let i = 0; i < n; i++) {
        top.push(members.length);
        members.push({ a: n + 1 + i, b: n + 2 + i, EI, role: 'chord' });
      }
      for (let i = 0; i <= n; i++) members.push({ a: i, b: n + 1 + i, EI, role: 'column' });
      const spec: Spec = { nodes, members, supports: [sup(0, 'pin'), sup(n, 'roller')], loads: [udl(top, num(p, 'w'), { label: 'Deck' })] };
      return spec;
    },
  },
  {
    id: 'sloping-site',
    sheet: 'frames',
    title: 'Frame on sloping ground',
    blurb: 'A two-bay frame stepping up a hillside, so its columns have three different heights.',
    notes: [
      'Sideways stiffness goes with 1/h³, so the short column is by far the stiffest and attracts most of the shear.',
      'Short, stiff columns are a classic weak point in earthquakes for exactly this reason.',
    ],
    params: [range('P', 'Sideways load', 5, 40, 1, 20, 'kN')],
    build: (p) => ({
      nodes: [
        [0, 0],
        [0, 5],
        [5, 1.5],
        [5, 5],
        [10, 3],
        [10, 5],
      ],
      members: [
        { a: 0, b: 1, EI, role: 'column' },
        { a: 2, b: 3, EI, role: 'column' },
        { a: 4, b: 5, EI, role: 'column' },
        { a: 1, b: 3, EI, role: 'beam' },
        { a: 3, b: 5, EI, role: 'beam' },
      ],
      supports: [sup(0, 'fixed'), sup(2, 'fixed'), sup(4, 'fixed')],
      loads: [force(0, 1, num(p, 'P'), 0, { label: 'Wind' })],
    }),
  },
];
