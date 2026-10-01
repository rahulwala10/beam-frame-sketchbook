import { BandMatrix, LDLT, MechanismError, rcm } from './band';
import {
  addEquivalentLoads,
  condense,
  condenseLoad,
  frameMass,
  frameStiffness,
  internalAt,
  recoverReleased,
  toGlobal,
  vecToGlobal,
  vecToLocal,
  type ScaledLoad,
} from './element';
import {
  DEFAULT_EA,
  DEFAULT_EI,
  DEFAULT_MASS,
  type Elem,
  type ElemLoad,
  type LoadSpec,
  type Spec,
  type SupportKind,
  type Vec2,
} from './types';

export const RESTRAINTS: Record<SupportKind, [number, number, number]> = {
  fixed: [1, 1, 1],
  pin: [1, 1, 0],
  roller: [0, 1, 0],
  wallRoller: [1, 0, 0],
  slide: [1, 0, 1],
  spring: [0, 0, 0],
};

interface LoadEntry {
  e: number;
  el: ElemLoad;
  /** Raw local equivalent nodal loads (before condensation). */
  P: Float64Array;
}

interface LoadData {
  entries: LoadEntry[];
  /** Global equivalent nodal load vector. */
  F: Float64Array;
  /** Prescribed displacements (settlement) on restrained DOFs. */
  presc: Array<{ dof: number; value: number }>;
}

export class StructureError extends Error {}

/** Finite element model built from a Spec: members split into Hermite elements, banded K and M. */
export class Model {
  readonly spec: Spec;
  readonly nodes: Vec2[] = [];
  readonly elems: Elem[] = [];
  readonly memberElems: number[][] = [];
  readonly memberNodes: number[][] = [];
  readonly memberLength: number[] = [];
  readonly nNode: number;
  readonly nDof: number;
  readonly pos: Int32Array;
  readonly K: BandMatrix;
  readonly M: BandMatrix;
  /** Support restraints. */
  readonly fixed: Uint8Array;
  /** Rotations restrained automatically because nothing attached resists them (pin-jointed nodes). */
  readonly auto: Uint8Array;
  /** fixed | auto */
  readonly mask: Uint8Array;
  readonly spring: Float64Array;
  readonly size: number;
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  loads: LoadData[] = [];
  /** Per element: loads acting on it, with the load index. */
  elemLoads: Array<Array<{ l: number; entry: LoadEntry }>> = [];

  private factorCache = new Map<string, LDLT>();

  constructor(spec: Spec) {
    this.spec = spec;
    const sn = spec.nodes;
    if (!sn.length || !spec.members.length) throw new StructureError('The structure needs at least one member.');
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of sn) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    this.bounds = { minX, minY, maxX, maxY };
    this.size = Math.max(maxX - minX, maxY - minY, 1e-6);

    for (const p of sn) this.nodes.push([p[0], p[1]]);
    const h = this.size / 22;
    spec.members.forEach((mem, mi) => {
      const A = sn[mem.a];
      const B = sn[mem.b];
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const L = Math.hypot(dx, dy);
      if (!(L > 1e-9)) throw new StructureError(`Member ${mi + 1} has zero length.`);
      this.memberLength.push(L);
      const c = dx / L;
      const s = dy / L;
      // Pin-jointed bars are split too: they stay stable (only their ends are released) and can bend between joints.
      let n = Math.min(14, Math.max(2, Math.ceil(L / h)));
      if (n > 1 && n % 2) n++;
      const chain = [mem.a];
      for (let k = 1; k < n; k++) {
        this.nodes.push([A[0] + (dx * k) / n, A[1] + (dy * k) / n]);
        chain.push(this.nodes.length - 1);
      }
      chain.push(mem.b);
      this.memberNodes.push(chain);
      const ids: number[] = [];
      const Le = L / n;
      for (let k = 0; k < n; k++) {
        const relI = k === 0 && !!(mem.hingeA || mem.truss);
        const relJ = k === n - 1 && !!(mem.hingeB || mem.truss);
        const EA = mem.EA ?? DEFAULT_EA;
        const EI = mem.EI ?? DEFAULT_EI;
        const kFull = frameStiffness(Le, EA, EI);
        const rel: number[] = [];
        if (relI) rel.push(2);
        if (relJ) rel.push(5);
        const { kc, kccInv } = condense(kFull, rel);
        ids.push(this.elems.length);
        this.elems.push({
          i: chain[k],
          j: chain[k + 1],
          member: mi,
          x0: k * Le,
          L: Le,
          c,
          s,
          EA,
          EI,
          m: mem.mass ?? DEFAULT_MASS,
          relI,
          relJ,
          truss: !!mem.truss,
          dofs: new Int32Array(6),
          kFull,
          kc,
          rel,
          kccInv,
        });
      }
      this.memberElems.push(ids);
    });

    this.nNode = this.nodes.length;
    this.nDof = this.nNode * 3;
    this.pos = rcm(
      this.nNode,
      this.elems.map((e) => [e.i, e.j] as [number, number]),
    );
    let band = 0;
    for (const e of this.elems) {
      for (let k = 0; k < 3; k++) {
        e.dofs[k] = this.dof(e.i, k);
        e.dofs[k + 3] = this.dof(e.j, k);
      }
      band = Math.max(band, Math.max(...e.dofs) - Math.min(...e.dofs));
    }
    this.K = new BandMatrix(this.nDof, band);
    this.M = new BandMatrix(this.nDof, band);
    for (const e of this.elems) {
      const kg = toGlobal(e.kc, e.c, e.s);
      const mg = toGlobal(frameMass(e.L, e.m, e.relI && e.relJ), e.c, e.s);
      // Each unordered (p, q) pair once; BandMatrix.add folds it into the lower band.
      for (let p = 0; p < 6; p++) {
        for (let q = 0; q <= p; q++) {
          this.K.add(e.dofs[p], e.dofs[q], kg[p * 6 + q]);
          this.M.add(e.dofs[p], e.dofs[q], mg[p * 6 + q]);
        }
      }
    }

    this.fixed = new Uint8Array(this.nDof);
    this.spring = new Float64Array(this.nDof);
    for (const sup of spec.supports) {
      const r = RESTRAINTS[sup.kind];
      for (let k = 0; k < 3; k++) if (r[k]) this.fixed[this.dof(sup.node, k)] = 1;
      const ks = [sup.kx ?? 0, sup.ky ?? 0, sup.kr ?? 0];
      for (let k = 0; k < 3; k++) {
        const d = this.dof(sup.node, k);
        if (ks[k] > 0 && !this.fixed[d]) {
          this.spring[d] += ks[k];
          this.K.add(d, d, ks[k]);
        }
      }
    }
    this.auto = new Uint8Array(this.nDof);
    const resists = new Uint8Array(this.nNode);
    for (const e of this.elems) {
      if (!e.relI) resists[e.i] = 1;
      if (!e.relJ) resists[e.j] = 1;
    }
    for (let v = 0; v < this.nNode; v++) {
      const d = this.dof(v, 2);
      if (!resists[v] && !this.fixed[d] && !this.spring[d]) this.auto[d] = 1;
    }
    this.mask = new Uint8Array(this.nDof);
    for (let d = 0; d < this.nDof; d++) this.mask[d] = this.fixed[d] | this.auto[d];

    this.loads = spec.loads.map((_, l) => this.buildLoad(l));
    this.indexElemLoads();
  }

  dof(node: number, k: number): number {
    return this.pos[node] * 3 + k;
  }

  /** Element and local position for fraction t along a member. */
  locate(member: number, t: number): { e: number; a: number } {
    const ids = this.memberElems[member];
    const L = this.memberLength[member];
    const x = Math.min(1, Math.max(0, t)) * L;
    const Le = L / ids.length;
    const k = Math.min(ids.length - 1, Math.floor(x / Le));
    return { e: ids[k], a: Math.min(Le, Math.max(0, x - k * Le)) };
  }

  /** (Re)build the element loads and nodal vector for load l after it changed. */
  rebuildLoad(l: number): void {
    this.loads[l] = this.buildLoad(l);
    this.indexElemLoads();
  }

  private indexElemLoads(): void {
    this.elemLoads = this.elems.map(() => []);
    this.loads.forEach((ld, l) => {
      for (const entry of ld.entries) this.elemLoads[entry.e].push({ l, entry });
    });
  }

  private buildLoad(l: number): LoadData {
    const ld: LoadSpec = this.spec.loads[l];
    const entries: LoadEntry[] = [];
    const presc: LoadData['presc'] = [];
    const push = (e: number, el: ElemLoad) => {
      const P = new Float64Array(6);
      addEquivalentLoads(this.elems[e].L, el, P);
      entries.push({ e, el, P });
    };
    if (ld.kind === 'point') {
      const { e, a } = this.locate(ld.member, ld.t);
      const E = this.elems[e];
      push(e, {
        type: 'point',
        a,
        px: E.c * ld.F[0] + E.s * ld.F[1],
        py: -E.s * ld.F[0] + E.c * ld.F[1],
      });
    } else if (ld.kind === 'moment') {
      const { e, a } = this.locate(ld.member, ld.t);
      push(e, { type: 'moment', a, m: ld.M });
    } else if (ld.kind === 'line') {
      const [t1, t2] = ld.span ?? [0, 1];
      const [r1, r2] = ld.ramp ?? [1, 1];
      for (const mi of ld.members) {
        const ids = this.memberElems[mi];
        const L = this.memberLength[mi];
        const E0 = this.elems[ids[0]];
        let qx = 0;
        let qy = 0;
        if (typeof ld.w === 'number') {
          qy = ld.w;
        } else {
          let [wx, wy] = ld.w;
          if (ld.projected) {
            wx *= Math.abs(E0.s);
            wy *= Math.abs(E0.c);
          }
          qx = E0.c * wx + E0.s * wy;
          qy = -E0.s * wx + E0.c * wy;
        }
        const xa = t1 * L;
        const xb = t2 * L;
        const factor = (x: number) => (xb > xa ? r1 + ((r2 - r1) * (x - xa)) / (xb - xa) : r1);
        for (const e of ids) {
          const E = this.elems[e];
          const lo = Math.max(E.x0, xa);
          const hi = Math.min(E.x0 + E.L, xb);
          if (hi - lo <= 1e-12) continue;
          const f1 = factor(lo);
          const f2 = factor(hi);
          push(e, {
            type: 'dist',
            x1: lo - E.x0,
            x2: hi - E.x0,
            qx1: qx * f1,
            qx2: qx * f2,
            qy1: qy * f1,
            qy2: qy * f2,
          });
        }
      }
    } else {
      for (let k = 0; k < 2; k++) {
        const d = this.dof(ld.node, k);
        if (ld.d[k] !== 0 && this.fixed[d]) presc.push({ dof: d, value: ld.d[k] });
      }
    }
    const F = new Float64Array(this.nDof);
    const g = new Float64Array(6);
    for (const en of entries) {
      const E = this.elems[en.e];
      const Pc = condenseLoad(E.kFull, E.rel, E.kccInv, en.P);
      vecToGlobal(Pc, E.c, E.s, g);
      for (let p = 0; p < 6; p++) F[E.dofs[p]] += g[p];
    }
    return { entries, F, presc };
  }

  /** Factorisation of K with the given DOFs constrained (cached). */
  factor(extra: number[] = []): LDLT {
    const key = extra.join(',');
    let f = this.factorCache.get(key);
    if (!f) {
      const mask = this.mask.slice();
      for (const d of extra) mask[d] = 1;
      f = new LDLT(this.K.constrained(mask));
      if (this.factorCache.size > 6) this.factorCache.clear();
      this.factorCache.set(key, f);
    }
    return f;
  }

  /** Assemble F = Σ λ_l F_l. */
  loadVector(lambda: ArrayLike<number>, out: Float64Array = new Float64Array(this.nDof)): Float64Array {
    out.fill(0);
    this.loads.forEach((ld, l) => {
      const s = lambda[l];
      if (!s) return;
      for (let d = 0; d < this.nDof; d++) out[d] += s * ld.F[d];
    });
    return out;
  }

  /** Prescribed displacements on constrained DOFs (settlements), plus extra prescribed values. */
  prescribed(lambda: ArrayLike<number>, extra: Array<{ dof: number; value: number }> = []): Float64Array {
    const up = new Float64Array(this.nDof);
    this.loads.forEach((ld, l) => {
      for (const p of ld.presc) up[p.dof] += lambda[l] * p.value;
    });
    for (const p of extra) up[p.dof] = p.value;
    return up;
  }

  /**
   * Static solution for load factors λ. `extra` prescribes displacements on additional DOFs
   * (used for grabbing the structure with the pointer).
   */
  solve(lambda: ArrayLike<number>, extra: Array<{ dof: number; value: number }> = []): Float64Array {
    const fac = this.factor(extra.map((p) => p.dof));
    const F = this.loadVector(lambda);
    const up = this.prescribed(lambda, extra);
    const Ku = this.K.mul(up);
    const rhs = new Float64Array(this.nDof);
    const isExtra = new Set(extra.map((p) => p.dof));
    for (let d = 0; d < this.nDof; d++) {
      rhs[d] = this.mask[d] || isExtra.has(d) ? up[d] : F[d] - Ku[d];
    }
    return fac.solve(rhs);
  }

  /** R = K·u − F: support reactions on constrained DOFs, spring forces on spring DOFs. */
  reactions(u: Float64Array, lambda: ArrayLike<number>): Float64Array {
    const R = this.K.mul(u);
    const F = this.loadVector(lambda);
    for (let d = 0; d < this.nDof; d++) {
      if (this.fixed[d]) R[d] -= F[d];
      else if (this.spring[d]) R[d] = -this.spring[d] * u[d];
      else R[d] = 0;
    }
    return R;
  }

  /** Scaled loads acting on element e for load factors λ. */
  scaledLoads(e: number, lambda: ArrayLike<number>): ScaledLoad[] {
    const out: ScaledLoad[] = [];
    for (const { l, entry } of this.elemLoads[e]) if (lambda[l]) out.push({ el: entry.el, s: lambda[l] });
    return out;
  }

  /**
   * Local end displacements (with released rotations recovered) and local end forces
   * (forces on the element) for element e.
   */
  elemState(e: number, u: Float64Array, lambda: ArrayLike<number>, d = new Float64Array(6), f = new Float64Array(6)): { d: Float64Array; f: Float64Array } {
    const E = this.elems[e];
    const g = [0, 0, 0, 0, 0, 0];
    for (let p = 0; p < 6; p++) g[p] = u[E.dofs[p]];
    vecToLocal(g, E.c, E.s, d);
    const P = [0, 0, 0, 0, 0, 0];
    for (const { l, entry } of this.elemLoads[e]) {
      const s = lambda[l];
      if (s) for (let p = 0; p < 6; p++) P[p] += s * entry.P[p];
    }
    recoverReleased(E.kFull, E.rel, E.kccInv, d, P);
    const k = E.kFull;
    for (let p = 0; p < 6; p++) {
      let v = -P[p];
      for (let q = 0; q < 6; q++) v += k[p * 6 + q] * d[q];
      f[p] = v;
    }
    for (const r of E.rel) f[r] = 0;
    return { d, f };
  }

  /** Internal forces [N, V, M] at local x of element e. */
  internal(e: number, f: Float64Array, loads: ScaledLoad[], x: number, right: boolean, out = new Float64Array(3)): Float64Array {
    return internalAt(f, loads, x, right, out);
  }
}

export { MechanismError };
