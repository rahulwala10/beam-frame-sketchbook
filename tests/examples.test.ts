import { describe, expect, it } from 'vitest';
import { determinacy } from '../src/engine/determinacy';
import { analyze } from '../src/engine/results';
import { Sim } from '../src/engine/sim';
import { equilibrium, makeContext } from '../src/examples/context';
import { EXAMPLES, SHEETS } from '../src/examples/index';
import { AXIAL_NOTE } from '../src/examples/kit';
import { defaults } from '../src/examples/types';

describe('example library', () => {
  it('has unique ids and every sheet is populated', () => {
    const ids = new Set(EXAMPLES.map((e) => e.id));
    expect(ids.size).toBe(EXAMPLES.length);
    for (const s of SHEETS) expect(EXAMPLES.filter((e) => e.sheet === s.id).length).toBeGreaterThanOrEqual(8);
  });

  for (const ex of EXAMPLES) {
    describe(ex.id, () => {
      const p = defaults(ex);
      const spec = ex.build(p);
      const sim = new Sim(spec);

      it('solves without a mechanism', () => {
        expect(sim.error).toBeNull();
        expect(determinacy(spec).degree).toBeGreaterThanOrEqual(0);
        expect(sim.refDisp).toBeGreaterThan(0);
        expect(Number.isFinite(sim.T1)).toBe(true);
      });

      it('is in equilibrium', () => {
        const lambda = sim.target;
        const a = analyze(sim.model, sim.staticU(), lambda);
        const eq = equilibrium(sim.model, a, lambda);
        const tol = 1e-7 * Math.max(1, eq.scale) * Math.max(1, sim.model.size);
        expect(Math.abs(eq.fx)).toBeLessThan(tol);
        expect(Math.abs(eq.fy)).toBeLessThan(tol);
        expect(Math.abs(eq.m)).toBeLessThan(tol * 10);
      });

      if (ex.checks) {
        it('matches its hand checks', () => {
          const lambda = sim.target;
          const a = analyze(sim.model, sim.staticU(), lambda);
          const checks = ex.checks!(makeContext(p, spec, ex.build(p), sim.model, a, lambda));
          expect(checks.length).toBeGreaterThan(0);
          for (const c of checks) {
            const approx = c.formula.startsWith('≈') || (c.note !== undefined && c.note !== AXIAL_NOTE);
            const tol = approx ? 0.08 : c.note === AXIAL_NOTE ? 0.03 : 0.005;
            const err = Math.abs(c.actual - c.expected) / Math.max(Math.abs(c.expected), 1e-9);
            expect(err, `${c.label}: expected ${c.expected}, got ${c.actual}`).toBeLessThan(tol);
          }
        });
      }

      it('springs back after a pull', () => {
        const m = sim.model;
        let grabbed = -1;
        for (let v = m.nNode - 1; v >= 0; v--) {
          if (sim.grabDofs(v).length) {
            grabbed = v;
            break;
          }
        }
        expect(grabbed).toBeGreaterThanOrEqual(0);
        const before = sim.staticU().slice();
        sim.startGrab(grabbed);
        sim.dragTo([m.size * 0.002, m.size * 0.002]);
        sim.endGrab();
        let frames = 0;
        while (sim.advance() && frames < 4000) frames++;
        expect(sim.resting).toBe(true);
        for (let d = 0; d < before.length; d++) expect(sim.u[d]).toBeCloseTo(before[d], 9);
      });
    });
  }
});
