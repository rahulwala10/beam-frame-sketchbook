import { describe, expect, it } from 'vitest';
import { determinacy } from '../src/engine/determinacy';
import { Model } from '../src/engine/model';
import { analyze, displacementAt, forcesAt } from '../src/engine/results';
import { Sim } from '../src/engine/sim';
import type { LoadSpec, MemberSpec, Spec, SupportSpec, Vec2 } from '../src/engine/types';

const EI = 40_000;
const RIGID_AXIAL = 1e12;

function run(spec: Spec) {
  const model = new Model(spec);
  const lambda = spec.loads.map(() => 1);
  const u = model.solve(lambda);
  return { model, u, a: analyze(model, u, lambda) };
}

function reaction(r: ReturnType<typeof run>, node: number) {
  const found = r.a.reactions.find((x) => x.node === node);
  if (!found) throw new Error(`no support at node ${node}`);
  return found.R;
}

function beam(xs: number[], supports: SupportSpec[], loads: LoadSpec[], extra: Partial<MemberSpec> = {}): Spec {
  const nodes: Vec2[] = xs.map((x) => [x, 0]);
  const members: MemberSpec[] = xs.slice(1).map((_, i) => ({ a: i, b: i + 1, EI, ...extra }));
  return { nodes, members, supports, loads };
}

const close = (actual: number, expected: number, rel = 1e-6) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));

describe('single-span beams', () => {
  it('simply supported, uniform load', () => {
    const r = run(beam([0, 6], [{ node: 0, kind: 'pin' }, { node: 1, kind: 'roller' }], [{ kind: 'line', members: [0], w: [0, -10] }]));
    close(reaction(r, 0)[1], 30);
    close(reaction(r, 1)[1], 30);
    close(forcesAt(r.a, 0, 0.5)[2], 45);
    close(displacementAt(r.a, 0, 0.5)[1], -(5 * 10 * 6 ** 4) / (384 * EI), 1e-5);
  });

  it('cantilever, tip load', () => {
    const r = run(beam([0, 5], [{ node: 0, kind: 'fixed' }], [{ kind: 'point', member: 0, t: 1, F: [0, -20] }]));
    close(reaction(r, 0)[1], 20);
    close(reaction(r, 0)[2], 100);
    close(forcesAt(r.a, 0, 0)[2], -100);
    close(r.u[r.model.dof(1, 1)], -(20 * 125) / (3 * EI));
    close(r.u[r.model.dof(1, 2)], -(20 * 25) / (2 * EI));
  });

  it('propped cantilever, uniform load', () => {
    const r = run(beam([0, 6], [{ node: 0, kind: 'fixed' }, { node: 1, kind: 'roller' }], [{ kind: 'line', members: [0], w: [0, -10] }]));
    close(reaction(r, 1)[1], (3 * 10 * 6) / 8);
    close(forcesAt(r.a, 0, 0)[2], -(10 * 36) / 8);
    close(Math.max(...r.a.members[0].M), (9 * 10 * 36) / 128, 1e-3);
  });

  it('fixed–fixed, uniform load', () => {
    const r = run(beam([0, 6], [{ node: 0, kind: 'fixed' }, { node: 1, kind: 'fixed' }], [{ kind: 'line', members: [0], w: [0, -10] }]));
    close(forcesAt(r.a, 0, 0)[2], -30);
    close(forcesAt(r.a, 0, 0.5)[2], 15);
    close(displacementAt(r.a, 0, 0.5)[1], -(10 * 6 ** 4) / (384 * EI), 1e-5);
  });

  it('fixed–fixed, off-centre point load', () => {
    const r = run(beam([0, 6], [{ node: 0, kind: 'fixed' }, { node: 1, kind: 'fixed' }], [{ kind: 'point', member: 0, t: 2 / 6, F: [0, -30] }]));
    close(forcesAt(r.a, 0, 0)[2], -(30 * 2 * 16) / 36);
    close(forcesAt(r.a, 0, 1)[2], -(30 * 4 * 4) / 36);
  });

  it('simply supported, triangular load', () => {
    const r = run(
      beam([0, 6], [{ node: 0, kind: 'pin' }, { node: 1, kind: 'roller' }], [{ kind: 'line', members: [0], w: [0, -15], ramp: [0, 1] }]),
    );
    close(reaction(r, 0)[1], 15);
    close(reaction(r, 1)[1], 30);
    close(Math.max(...r.a.members[0].M), (15 * 36) / (9 * Math.sqrt(3)), 2e-3);
  });

  it('simply supported, couple at one end', () => {
    const r = run(beam([0, 6], [{ node: 0, kind: 'pin' }, { node: 1, kind: 'roller' }], [{ kind: 'moment', member: 0, t: 1, M: 30 }]));
    close(reaction(r, 0)[1], 5);
    close(reaction(r, 1)[1], -5);
    close(forcesAt(r.a, 0, 1)[2], 30);
    const vmax = Math.max(...r.a.members[0].defl.map((p) => Math.abs(p.v)));
    close(vmax, (30 * 36) / (9 * Math.sqrt(3) * EI), 2e-3);
  });

  it('fixed–fixed with a settling support', () => {
    const r = run(beam([0, 6], [{ node: 0, kind: 'fixed' }, { node: 1, kind: 'fixed' }], [{ kind: 'settle', node: 1, d: [0, -0.01] }]));
    close(Math.abs(forcesAt(r.a, 0, 0)[2]), (6 * EI * 0.01) / 36);
    close(Math.abs(forcesAt(r.a, 0, 0.5)[1]), (12 * EI * 0.01) / 216);
    close(r.u[r.model.dof(1, 1)], -0.01);
  });

  it('inclined beam with load per horizontal projection', () => {
    const spec: Spec = {
      nodes: [
        [0, 0],
        [4, 3],
      ],
      members: [{ a: 0, b: 1, EI }],
      supports: [
        { node: 0, kind: 'pin' },
        { node: 1, kind: 'roller' },
      ],
      loads: [{ kind: 'line', members: [0], w: [0, -10], projected: true }],
    };
    const r = run(spec);
    close(reaction(r, 1)[1], 20);
    close(Math.max(...r.a.members[0].M), (10 * 16) / 8, 1e-6);
  });
});

describe('continuous beams, hinges and springs', () => {
  it('two equal spans, uniform load', () => {
    const r = run(
      beam([0, 5, 10], [{ node: 0, kind: 'pin' }, { node: 1, kind: 'roller' }, { node: 2, kind: 'roller' }], [{ kind: 'line', members: [0, 1], w: [0, -10] }]),
    );
    close(reaction(r, 1)[1], 1.25 * 10 * 5);
    close(forcesAt(r.a, 0, 1)[2], -(10 * 25) / 8);
    expect(determinacy(r.model.spec).degree).toBe(1);
  });

  it('three equal spans, uniform load', () => {
    const r = run(
      beam(
        [0, 5, 10, 15],
        [{ node: 0, kind: 'pin' }, { node: 1, kind: 'roller' }, { node: 2, kind: 'roller' }, { node: 3, kind: 'roller' }],
        [{ kind: 'line', members: [0, 1, 2], w: [0, -10] }],
      ),
    );
    close(forcesAt(r.a, 0, 1)[2], -0.1 * 10 * 25);
    close(reaction(r, 0)[1], 0.4 * 10 * 5);
  });

  it('Gerber beam: fixed end, hinge, roller', () => {
    const spec = beam([0, 2, 6], [{ node: 0, kind: 'fixed' }, { node: 2, kind: 'roller' }], [{ kind: 'line', members: [0, 1], w: [0, -10] }]);
    spec.members[0].hingeB = true;
    const r = run(spec);
    expect(determinacy(spec).degree).toBe(0);
    close(reaction(r, 2)[1], 20);
    close(forcesAt(r.a, 0, 0)[2], -60);
    close(forcesAt(r.a, 0, 1)[2], 0);
  });

  it('point load on a hinge between two cantilevers', () => {
    const spec = beam([0, 3, 6], [{ node: 0, kind: 'fixed' }, { node: 2, kind: 'fixed' }], [{ kind: 'point', member: 0, t: 1, F: [0, -20] }]);
    spec.members[1].hingeA = true;
    const r = run(spec);
    close(forcesAt(r.a, 0, 0)[2], -30);
    close(forcesAt(r.a, 1, 1)[2], -30);
  });

  it('spring support under a long beam', () => {
    const k = 5000;
    const spec = beam([0, 4, 8], [{ node: 0, kind: 'pin' }, { node: 1, kind: 'spring', ky: k }, { node: 2, kind: 'roller' }], [
      { kind: 'line', members: [0, 1], w: [0, -10] },
    ]);
    const r = run(spec);
    const d0 = (5 * 10 * 8 ** 4) / (384 * EI);
    const flex = 8 ** 3 / (48 * EI);
    close(reaction(r, 1)[1], d0 / (flex + 1 / k), 1e-6);
  });
});

describe('frames and trusses', () => {
  const portal = (base: 'pin' | 'fixed', loads: LoadSpec[], crownHinge = false): Spec => {
    const nodes: Vec2[] = crownHinge
      ? [
          [0, 0],
          [0, 4],
          [3, 4],
          [6, 4],
          [6, 0],
        ]
      : [
          [0, 0],
          [0, 4],
          [6, 4],
          [6, 0],
        ];
    const members: MemberSpec[] = [];
    for (let i = 0; i < nodes.length - 1; i++) members.push({ a: i, b: i + 1, EI, EA: RIGID_AXIAL });
    if (crownHinge) members[1].hingeB = true;
    return {
      nodes,
      members,
      supports: [
        { node: 0, kind: base },
        { node: nodes.length - 1, kind: base },
      ],
      loads,
    };
  };
  const k = (1 * 4) / 6; // (Ib/Ic)(h/L)

  it('pinned portal, uniform load on the beam', () => {
    const r = run(portal('pin', [{ kind: 'line', members: [1], w: [0, -10] }]));
    const Mk = (10 * 36) / (4 * (2 * k + 3));
    close(Math.abs(forcesAt(r.a, 1, 0)[2]), Mk, 1e-6);
    close(Math.abs(reaction(r, 0)[0]), Mk / 4, 1e-6);
  });

  it('fixed portal, uniform load on the beam', () => {
    const r = run(portal('fixed', [{ kind: 'line', members: [1], w: [0, -10] }]));
    close(Math.abs(forcesAt(r.a, 1, 0)[2]), (10 * 36) / (6 * (k + 2)), 1e-6);
    close(Math.abs(reaction(r, 0)[2]), (10 * 36) / (12 * (k + 2)), 1e-6);
    close(Math.abs(reaction(r, 0)[0]), (10 * 36) / (4 * 4 * (k + 2)), 1e-6);
  });

  it('fixed portal, sway load', () => {
    const r = run(portal('fixed', [{ kind: 'point', member: 0, t: 1, F: [10, 0] }]));
    const half = (10 * 4) / 2;
    close(Math.abs(reaction(r, 0)[2]), (half * (1 + 3 * k)) / (1 + 6 * k), 1e-6);
    close(Math.abs(forcesAt(r.a, 0, 1)[2]), (half * 3 * k) / (1 + 6 * k), 1e-6);
    close(reaction(r, 0)[0] + reaction(r, 3)[0], -10);
  });

  it('three-pinned portal, uniform load', () => {
    const spec = portal('pin', [{ kind: 'line', members: [1, 2], w: [0, -10] }], true);
    spec.members.forEach((m) => (m.EA = undefined));
    const r = run(spec);
    expect(determinacy(spec).degree).toBe(0);
    close(Math.abs(reaction(r, 0)[0]), (10 * 36) / (8 * 4));
    close(forcesAt(r.a, 1, 1)[2], 0);
  });

  it('pin-jointed triangle', () => {
    const spec: Spec = {
      nodes: [
        [0, 0],
        [4, 0],
        [2, 2],
      ],
      members: [
        { a: 0, b: 1, truss: true },
        { a: 1, b: 2, truss: true },
        { a: 2, b: 0, truss: true },
      ],
      supports: [
        { node: 0, kind: 'pin' },
        { node: 1, kind: 'roller' },
      ],
      loads: [{ kind: 'point', member: 1, t: 1, F: [0, -10] }],
    };
    const r = run(spec);
    expect(determinacy(spec).degree).toBe(0);
    close(forcesAt(r.a, 0, 0.5)[0], 5);
    close(forcesAt(r.a, 1, 0.5)[0], -5 * Math.SQRT2);
    close(forcesAt(r.a, 2, 0.5)[0], -5 * Math.SQRT2);
  });
});

describe('interaction and dynamics', () => {
  const cantilever = (): Spec => beam([0, 5], [{ node: 0, kind: 'fixed' }], [{ kind: 'point', member: 0, t: 1, F: [0, -20] }]);

  it('grabbing the tip needs 3EIδ/L³', () => {
    const sim = new Sim(cantilever());
    sim.setLoad(0, false, false);
    expect(sim.startGrab(1)).toBe(true);
    sim.dragTo([0, 0.01]);
    close(sim.grab!.force[1], (3 * EI * 0.01) / 125, 1e-6);
  });

  it('springs back to equilibrium after release', () => {
    const sim = new Sim(cantilever());
    const still = sim.staticU().slice();
    sim.startGrab(1);
    sim.dragTo([0, 0.05]);
    sim.endGrab();
    let frames = 0;
    while (sim.advance() && frames < 5000) frames++;
    expect(sim.resting).toBe(true);
    expect(frames).toBeGreaterThan(20);
    for (let d = 0; d < still.length; d++) close(sim.u[d], still[d], 1e-9);
  });

  it('animates a load on and settles at the static answer', () => {
    const sim = new Sim(cantilever());
    sim.setLoad(0, false, false);
    sim.setLoad(0, true);
    let frames = 0;
    let peak = 0;
    const tip = sim.model.dof(1, 1);
    while (sim.advance() && frames < 5000) {
      frames++;
      peak = Math.min(peak, sim.u[tip]);
    }
    const target = -(20 * 125) / (3 * EI);
    close(sim.u[tip], target, 1e-9);
    expect(peak).toBeLessThan(target);
    expect(peak).toBeGreaterThan(1.6 * target);
  });

  it('reports a mechanism instead of throwing', () => {
    const spec = beam([0, 5], [{ node: 0, kind: 'roller' }, { node: 1, kind: 'roller' }], [{ kind: 'point', member: 0, t: 0.5, F: [0, -10] }]);
    const sim = new Sim(spec);
    expect(sim.ok).toBe(false);
    expect(sim.error).toMatch(/mechanism/i);
  });
});
