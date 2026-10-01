import { BandMatrix, LDLT, MechanismError } from './band';
import { Model, StructureError } from './model';
import type { Spec, Vec2 } from './types';

/** Animation frames per fundamental period. 54 frames ≈ 0.9 s at 60 fps. */
const STEPS_PER_PERIOD = 54;
const DAMPING = 0.1;
/** Consecutive calm steps before snapping to rest. */
const CALM_STEPS = 24;
/** Loads ramp on over this fraction of the fundamental period. */
const RAMP = 0.6;

export interface Grab {
  node: number;
  dofs: number[];
  /** Stiffness of the "rubber band" between the pointer and the node (kN/m). */
  k: number;
  /** Where the pointer holds the far end of the band, as a displacement of the node (m). */
  disp: Vec2;
  /** Force the band applies to the structure (kN). */
  force: Vec2;
}

/**
 * A structure you can push and pull: static solves for loads and grabs, and Newmark time stepping
 * (average acceleration, Rayleigh damping) so it springs back when released or when a load changes.
 */
export class Sim {
  readonly spec: Spec;
  model!: Model;
  error: string | null = null;
  nLoads: number;
  lambda: Float64Array;
  target: Float64Array;
  private rampFrom: Float64Array;
  private rampStart: Float64Array;

  u!: Float64Array;
  private v!: Float64Array;
  private a!: Float64Array;
  private t = 0;
  private calm = 0;
  resting = true;
  grab: Grab | null = null;

  T1 = 1;
  dt = 1;
  private alpha = 0;
  private beta = 0;
  private keff!: LDLT;
  private keffBand!: BandMatrix;
  private mFac!: LDLT;
  private staticCache: Float64Array | null = null;

  /** Largest translation under all loads at full value, for scaling the drawing. */
  refDisp = 0;
  /** Largest |M|, |V|, |N| under all loads at full value. */
  refForce = { M: 0, V: 0, N: 0 };
  /** Sum of the magnitudes of all loads at full value (kN), a yardstick for the diagrams. */
  refLoad = 0;
  /** Bumped whenever the state changes, so views know to redraw. */
  version = 0;
  /** Bumped whenever the static answer changes (loads toggled or moved). */
  staticRev = 0;

  constructor(spec: Spec) {
    this.spec = spec;
    this.nLoads = spec.loads.length;
    this.lambda = new Float64Array(this.nLoads);
    this.target = new Float64Array(this.nLoads);
    this.rampFrom = new Float64Array(this.nLoads);
    this.rampStart = new Float64Array(this.nLoads).fill(-Infinity);
    spec.loads.forEach((ld, l) => {
      const on = ld.on !== false ? 1 : 0;
      this.lambda[l] = on;
      this.target[l] = on;
    });
    try {
      this.model = new Model(spec);
      this.init();
    } catch (err) {
      if (err instanceof MechanismError) {
        this.error = 'This is a mechanism: it can move without resistance. Add a support or remove a hinge.';
      } else if (err instanceof StructureError) {
        this.error = err.message;
      } else {
        throw err;
      }
      const n = this.model ? this.model.nDof : 0;
      this.u = new Float64Array(n);
      this.v = new Float64Array(n);
      this.a = new Float64Array(n);
    }
  }

  get ok(): boolean {
    return this.error === null;
  }

  private init(): void {
    const m = this.model;
    const n = m.nDof;
    const all = new Float64Array(this.nLoads).fill(1);
    const uRef = m.solve(all);
    this.refDisp = maxTranslation(m, uRef);
    this.refForce = this.forceExtremes(uRef, all);
    this.refLoad = totalLoad(this.spec, m);

    // Fundamental period by inverse iteration on K⁻¹M.
    const fac = m.factor();
    let x: Float64Array = new Float64Array(n);
    if (this.refDisp > 0) x.set(uRef);
    else for (let d = 0; d < n; d++) x[d] = m.mask[d] ? 0 : 1;
    let omega2 = 1;
    const y = new Float64Array(n);
    for (let it = 0; it < 30; it++) {
      m.M.mul(x, y);
      for (let d = 0; d < n; d++) if (m.mask[d]) y[d] = 0;
      const z = fac.solve(y);
      for (let d = 0; d < n; d++) if (m.mask[d]) z[d] = 0;
      let norm = 0;
      for (let d = 0; d < n; d++) norm = Math.max(norm, Math.abs(z[d]));
      if (!(norm > 0)) break;
      for (let d = 0; d < n; d++) z[d] /= norm;
      x = z;
    }
    const Kx = m.K.mul(x);
    const Mx = m.M.mul(x);
    let num = 0;
    let den = 0;
    for (let d = 0; d < n; d++) {
      if (m.mask[d]) continue;
      num += x[d] * Kx[d];
      den += x[d] * Mx[d];
    }
    if (num > 0 && den > 0) omega2 = num / den;
    const w1 = Math.sqrt(omega2);
    this.T1 = (2 * Math.PI) / w1;
    this.dt = this.T1 / STEPS_PER_PERIOD;
    const w2 = 5 * w1;
    this.alpha = (2 * DAMPING * w1 * w2) / (w1 + w2);
    this.beta = (2 * DAMPING) / (w1 + w2);

    const a0 = 4 / this.dt ** 2;
    const a1 = 2 / this.dt;
    // Keff = K + a0·M + a1·C,  C = αM + βK
    this.keffBand = m.K.combine(a0 + a1 * this.alpha, m.M, 1 + a1 * this.beta);
    this.keff = new LDLT(this.keffBand.constrained(m.mask));
    this.mFac = new LDLT(m.M.constrained(m.mask));

    this.u = m.solve(this.lambda);
    this.v = new Float64Array(n);
    this.a = new Float64Array(n);
    this.staticCache = this.u.slice();
  }

  /** Static displacements for the target load factors. */
  staticU(): Float64Array {
    if (!this.ok) return this.u;
    if (!this.staticCache) this.staticCache = this.model.solve(this.target);
    return this.staticCache;
  }

  forceExtremes(u: Float64Array, lambda: ArrayLike<number>): { M: number; V: number; N: number } {
    const m = this.model;
    const out = { M: 0, V: 0, N: 0 };
    const r = new Float64Array(3);
    for (let e = 0; e < m.elems.length; e++) {
      const { f } = m.elemState(e, u, lambda);
      const loads = m.scaledLoads(e, lambda);
      const xs = [0, m.elems[e].L / 2, m.elems[e].L];
      for (const el of loads) {
        if (el.el.type !== 'dist') xs.push(el.el.a);
      }
      for (const x of xs) {
        for (const right of [false, true]) {
          m.internal(f, loads, x, right, r);
          out.N = Math.max(out.N, Math.abs(r[0]));
          out.V = Math.max(out.V, Math.abs(r[1]));
          out.M = Math.max(out.M, Math.abs(r[2]));
        }
      }
    }
    return out;
  }

  private touch(): void {
    this.version++;
  }

  /** Switch a load on or off, letting the structure respond dynamically. */
  setLoad(l: number, on: boolean, animate = true): void {
    if (!this.ok) {
      this.target[l] = this.lambda[l] = on ? 1 : 0;
      this.touch();
      return;
    }
    const goal = on ? 1 : 0;
    if (this.target[l] === goal && this.lambda[l] === goal) return;
    this.target[l] = goal;
    this.staticCache = null;
    this.staticRev++;
    if (!animate) {
      this.lambda[l] = goal;
      this.rampStart[l] = -Infinity;
      this.snapToStatic();
      return;
    }
    this.rampFrom[l] = this.lambda[l];
    this.rampStart[l] = this.t;
    this.wake();
  }

  setAll(on: boolean, animate = true): void {
    for (let l = 0; l < this.nLoads; l++) this.setLoad(l, on, animate);
  }

  /** Move a point load or couple to fraction t of a member. */
  moveLoad(l: number, member: number, t: number): void {
    const ld = this.spec.loads[l];
    if (ld.kind !== 'point' && ld.kind !== 'moment') return;
    ld.member = member;
    ld.t = t;
    if (!this.ok) return;
    this.model.rebuildLoad(l);
    this.staticCache = null;
    this.staticRev++;
    this.refreshScaleIfLarger();
    if (this.resting && !this.grab) this.snapToStatic();
    else this.touch();
  }

  private refreshScaleIfLarger(): void {
    const all = new Float64Array(this.nLoads).fill(1);
    const uRef = this.model.solve(all);
    this.refDisp = Math.max(this.refDisp, maxTranslation(this.model, uRef));
  }

  /** Jump straight to static equilibrium for the target loads. */
  snapToStatic(): void {
    if (!this.ok) return;
    for (let l = 0; l < this.nLoads; l++) {
      this.lambda[l] = this.target[l];
      this.rampStart[l] = -Infinity;
    }
    this.u = this.staticU().slice();
    this.v.fill(0);
    this.a.fill(0);
    this.resting = true;
    this.calm = 0;
    this.touch();
  }

  /** Start motion from the current state (initial acceleration from equilibrium). */
  private wake(): void {
    if (!this.resting) return;
    this.resting = false;
    this.computeAcceleration();
  }

  private computeAcceleration(): void {
    const m = this.model;
    const F = m.loadVector(this.lambda);
    const Ku = m.K.mul(this.u);
    const r = new Float64Array(m.nDof);
    for (let d = 0; d < m.nDof; d++) r[d] = m.mask[d] ? 0 : F[d] - Ku[d];
    this.a = this.mFac.solve(r);
    for (let d = 0; d < m.nDof; d++) if (m.mask[d]) this.a[d] = 0;
  }

  /** Grabbable translational DOFs of a node. */
  grabDofs(node: number): number[] {
    if (!this.ok) return [];
    const m = this.model;
    return [0, 1].map((k) => m.dof(node, k)).filter((d) => !m.mask[d]);
  }

  /**
   * Take hold of a node with a spring nine times stiffer than the node's softest direction:
   * dragged that way it follows the pointer closely, dragged along a stiff direction it hardly moves.
   */
  startGrab(node: number): boolean {
    const dofs = this.grabDofs(node);
    if (!dofs.length) return false;
    for (let l = 0; l < this.nLoads; l++) {
      this.lambda[l] = this.target[l];
      this.rampStart[l] = -Infinity;
    }
    const m = this.model;
    const fac = m.factor();
    const flex = dofs.map((d) => {
      const e = new Float64Array(m.nDof);
      e[d] = 1;
      const u = fac.solve(e);
      return dofs.map((dd) => u[dd]);
    });
    let lmax: number;
    if (dofs.length === 1) {
      lmax = flex[0][0];
    } else {
      const a = flex[0][0];
      const b = (flex[0][1] + flex[1][0]) / 2;
      const d = flex[1][1];
      lmax = (a + d) / 2 + Math.sqrt(((a - d) / 2) ** 2 + b * b);
    }
    const k = 9 / Math.max(lmax, 1e-300);
    const disp: Vec2 = [this.u[m.dof(node, 0)], this.u[m.dof(node, 1)]];
    this.grab = { node, dofs, k, disp, force: [0, 0] };
    this.dragTo(disp);
    return true;
  }

  /** Move the pointer end of the band to displacement `disp` (m) and solve statically. */
  dragTo(disp: Vec2): void {
    const g = this.grab;
    if (!g) return;
    const m = this.model;
    g.disp = [disp[0], disp[1]];
    const fx = m.dof(g.node, 0);
    const targets = g.dofs.map((dof) => (dof === fx ? disp[0] : disp[1]));
    try {
      this.u = m.solveWithSprings(this.lambda, g.dofs, g.dofs.map(() => g.k), targets);
    } catch (err) {
      if (!(err instanceof MechanismError)) throw err;
      return;
    }
    const force: Vec2 = [0, 0];
    g.dofs.forEach((dof, i) => (force[dof === fx ? 0 : 1] = g.k * (targets[i] - this.u[dof])));
    g.force = force;
    this.v.fill(0);
    this.a.fill(0);
    this.resting = false;
    this.touch();
  }

  endGrab(): void {
    if (!this.grab) return;
    this.grab = null;
    this.v.fill(0);
    this.resting = false;
    this.computeAcceleration();
    this.touch();
  }

  /** Advance the animation by `frames` display frames. Returns true while still moving. */
  advance(frames = 1): boolean {
    if (!this.ok || this.resting || this.grab) return false;
    const m = this.model;
    const n = m.nDof;
    const dt = this.dt;
    const a0 = 4 / dt ** 2;
    const a1 = 2 / dt;
    const a2 = 4 / dt;
    const rampDur = RAMP * this.T1;
    const p = new Float64Array(n);
    const q = new Float64Array(n);
    for (let step = 0; step < frames; step++) {
      this.t += dt;
      let ramping = false;
      for (let l = 0; l < this.nLoads; l++) {
        const s = (this.t - this.rampStart[l]) / rampDur;
        if (s < 1) {
          const k = s <= 0 ? 0 : s * s * (3 - 2 * s);
          this.lambda[l] = this.rampFrom[l] + (this.target[l] - this.rampFrom[l]) * k;
          ramping = true;
        } else {
          this.lambda[l] = this.target[l];
        }
      }
      const F = m.loadVector(this.lambda);
      const up = m.prescribed(this.lambda);
      const { u, v, a } = this;
      // rhs = F + M(a0 u + a2 v + a + α(a1 u + v)) + β K (a1 u + v)
      for (let d = 0; d < n; d++) {
        const pd = a1 * u[d] + v[d];
        p[d] = a0 * u[d] + a2 * v[d] + a[d] + this.alpha * pd;
        q[d] = this.beta * pd;
      }
      const Mp = m.M.mul(p);
      const Kq = m.K.mul(q);
      const Kup = this.keffBand.mul(up);
      const rhs = new Float64Array(n);
      for (let d = 0; d < n; d++) {
        rhs[d] = m.mask[d] ? up[d] : F[d] + Mp[d] + Kq[d] - Kup[d];
      }
      const un = this.keff.solve(rhs);
      for (let d = 0; d < n; d++) {
        const an = a0 * (un[d] - u[d]) - a2 * v[d] - a[d];
        v[d] += (dt / 2) * (a[d] + an);
        a[d] = an;
        u[d] = un[d];
      }
      if (!ramping && this.isNearStatic()) {
        if (++this.calm >= CALM_STEPS) {
          this.snapToStatic();
          return false;
        }
      } else {
        this.calm = 0;
      }
    }
    this.touch();
    return true;
  }

  /**
   * True when every displacement is within a fraction of a pixel of equilibrium. Velocity is not
   * tested: the average-acceleration scheme keeps a harmless high-frequency velocity ripple in the
   * rotations long after the visible motion has died away.
   */
  private isNearStatic(): boolean {
    const us = this.staticU();
    const tol = 8e-3 * Math.max(this.refDisp, this.model.size * 1e-4);
    for (let d = 0; d < this.u.length; d++) if (Math.abs(this.u[d] - us[d]) > tol) return false;
    return true;
  }

  /** Put everything back as built. */
  reset(): void {
    this.grab = null;
    this.spec.loads.forEach((ld, l) => {
      const on = ld.on !== false ? 1 : 0;
      this.target[l] = on;
      this.lambda[l] = on;
    });
    this.staticCache = null;
    this.staticRev++;
    if (this.ok) this.snapToStatic();
  }
}

/** Σ|load|: point loads, distributed loads × loaded length, couples ÷ size. Settlements count as nothing. */
export function totalLoad(spec: Spec, m: Model): number {
  let W = 0;
  for (const ld of spec.loads) {
    if (ld.kind === 'point') W += Math.hypot(ld.F[0], ld.F[1]);
    else if (ld.kind === 'moment') W += Math.abs(ld.M) / m.size;
    else if (ld.kind === 'line') {
      const w = typeof ld.w === 'number' ? Math.abs(ld.w) : Math.hypot(ld.w[0], ld.w[1]);
      const [t1, t2] = ld.span ?? [0, 1];
      const [r1, r2] = ld.ramp ?? [1, 1];
      for (const mi of ld.members) W += w * (t2 - t1) * m.memberLength[mi] * (Math.abs(r1) + Math.abs(r2)) / 2;
    }
  }
  return W;
}

export function maxTranslation(m: Model, u: Float64Array): number {
  let mx = 0;
  for (let v = 0; v < m.nNode; v++) {
    mx = Math.max(mx, Math.hypot(u[m.dof(v, 0)], u[m.dof(v, 1)]));
  }
  return mx;
}
