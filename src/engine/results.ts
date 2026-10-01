import { hermite } from './element';
import type { Model } from './model';
import { RESTRAINTS } from './model';

export interface MemberResult {
  member: number;
  L: number;
  /** Sample positions from the member start; repeated where a concentrated load causes a jump. */
  x: number[];
  N: number[];
  V: number[];
  M: number[];
  /** Displacements along the member: global ux, uy and the local transverse deflection v. */
  defl: Array<{ x: number; ux: number; uy: number; v: number }>;
}

export interface Extreme {
  value: number;
  member: number;
  x: number;
}

export interface NodeReaction {
  node: number;
  /** Reaction components on the structure: Rx, Ry (kN), Mz (kN·m, anticlockwise +). */
  R: [number, number, number];
  has: [boolean, boolean, boolean];
}

export interface Analysis {
  u: Float64Array;
  reactions: NodeReaction[];
  members: MemberResult[];
  extremes: {
    sag: Extreme;
    hog: Extreme;
    shear: Extreme;
    tension: Extreme;
    compression: Extreme;
    disp: Extreme;
  };
  contraflexure: Array<{ member: number; x: number }>;
}

const H = new Float64Array(8);

export function analyze(model: Model, u: Float64Array, lambda: ArrayLike<number>): Analysis {
  const members: MemberResult[] = [];
  const r = new Float64Array(3);
  const none = (): Extreme => ({ value: 0, member: -1, x: 0 });
  const ex = { sag: none(), hog: none(), shear: none(), tension: none(), compression: none(), disp: none() };

  model.memberElems.forEach((ids, mi) => {
    const res: MemberResult = { member: mi, L: model.memberLength[mi], x: [], N: [], V: [], M: [], defl: [] };
    for (const e of ids) {
      const E = model.elems[e];
      const { d, f } = model.elemState(e, u, lambda);
      const loads = model.scaledLoads(e, lambda);
      const pts: Array<[number, boolean]> = [
        [0, true],
        [E.L, false],
      ];
      const hasDist = loads.some((s) => s.el.type === 'dist');
      const nIn = hasDist ? 6 : 1;
      for (let k = 1; k < nIn; k++) pts.push([(E.L * k) / nIn, true]);
      for (const s of loads) {
        if (s.el.type === 'dist') {
          pts.push([s.el.x1, true], [s.el.x2, true]);
        } else if (s.el.a > 1e-12 && s.el.a < E.L - 1e-12) {
          pts.push([s.el.a, false], [s.el.a, true]);
        }
      }
      pts.sort((p, q) => p[0] - q[0] || Number(p[1]) - Number(q[1]));
      let lastX = -1;
      let lastRight: boolean | null = null;
      for (const [x, right] of pts) {
        if (Math.abs(x - lastX) < 1e-12 && right === lastRight) continue;
        lastX = x;
        lastRight = right;
        model.internal(f, loads, x, right, r);
        const X = E.x0 + x;
        res.x.push(X);
        res.N.push(r[0]);
        res.V.push(r[1]);
        res.M.push(r[2]);
        track(ex, mi, X, r[0], r[1], r[2]);
      }
      const nd = 6;
      for (let k = 0; k <= nd; k++) {
        if (k === 0 && e !== ids[0]) continue;
        const x = (E.L * k) / nd;
        hermite(x, E.L, H);
        const v = H[0] * d[1] + H[1] * d[2] + H[2] * d[4] + H[3] * d[5];
        const ua = (1 - x / E.L) * d[0] + (x / E.L) * d[3];
        const ux = E.c * ua - E.s * v;
        const uy = E.s * ua + E.c * v;
        res.defl.push({ x: E.x0 + x, ux, uy, v });
        const mag = Math.hypot(ux, uy);
        if (mag > ex.disp.value) ex.disp = { value: mag, member: mi, x: E.x0 + x };
      }
    }
    members.push(res);
  });

  const R = model.reactions(u, lambda);
  const reactions: NodeReaction[] = model.spec.supports.map((sup) => {
    const rs = RESTRAINTS[sup.kind];
    const ks = [sup.kx ?? 0, sup.ky ?? 0, sup.kr ?? 0];
    const has = [0, 1, 2].map((k) => !!rs[k] || ks[k] > 0) as [boolean, boolean, boolean];
    const val = [0, 1, 2].map((k) => (has[k] ? R[model.dof(sup.node, k)] : 0)) as [number, number, number];
    return { node: sup.node, R: val, has };
  });

  let mMax = 0;
  for (const m of members) for (const v of m.M) mMax = Math.max(mMax, Math.abs(v));
  const contraflexure: Analysis['contraflexure'] = [];
  const tol = 1e-3 * mMax;
  for (const m of members) {
    for (let k = 1; k < m.x.length; k++) {
      const x0 = m.x[k - 1];
      const x1 = m.x[k];
      const m0 = m.M[k - 1];
      const m1 = m.M[k];
      if (x1 - x0 < 1e-9) continue;
      if (Math.abs(m0) < tol && Math.abs(m1) < tol) continue;
      if ((m0 > tol && m1 < -tol) || (m0 < -tol && m1 > tol) || (m0 > tol && m1 < 0) || (m0 < -tol && m1 > 0)) {
        if (m1 === 0) continue;
        const x = x0 + ((x1 - x0) * m0) / (m0 - m1);
        if (x > 1e-6 * m.L && x < m.L * (1 - 1e-6)) contraflexure.push({ member: m.member, x });
      }
    }
  }
  return { u, reactions, members, extremes: ex, contraflexure };
}

function track(ex: Analysis['extremes'], member: number, x: number, N: number, V: number, M: number): void {
  if (M > ex.sag.value) ex.sag = { value: M, member, x };
  if (M < ex.hog.value) ex.hog = { value: M, member, x };
  if (Math.abs(V) > Math.abs(ex.shear.value)) ex.shear = { value: V, member, x };
  if (N > ex.tension.value) ex.tension = { value: N, member, x };
  if (N < ex.compression.value) ex.compression = { value: N, member, x };
}

/** Interpolated [N, V, M] at fraction t of a member (value just right of a jump). */
export function forcesAt(a: Analysis, member: number, t: number): [number, number, number] {
  const m = a.members[member];
  const x = t * m.L;
  let k = 0;
  while (k < m.x.length - 1 && m.x[k + 1] <= x + 1e-9) k++;
  if (k >= m.x.length - 1) return [m.N[k], m.V[k], m.M[k]];
  const x0 = m.x[k];
  const x1 = m.x[k + 1];
  const f = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
  const lerp = (arr: number[]) => arr[k] + (arr[k + 1] - arr[k]) * f;
  return [lerp(m.N), lerp(m.V), lerp(m.M)];
}

/** Interpolated displacement at fraction t of a member: [ux, uy, v]. */
export function displacementAt(a: Analysis, member: number, t: number): [number, number, number] {
  const pts = a.members[member].defl;
  const x = t * a.members[member].L;
  let k = 0;
  while (k < pts.length - 1 && pts[k + 1].x <= x + 1e-12) k++;
  if (k >= pts.length - 1) return [pts[k].ux, pts[k].uy, pts[k].v];
  const p = pts[k];
  const q = pts[k + 1];
  const f = q.x > p.x ? (x - p.x) / (q.x - p.x) : 0;
  return [p.ux + (q.ux - p.ux) * f, p.uy + (q.uy - p.uy) * f, p.v + (q.v - p.v) * f];
}

/** Largest |M| along a member, with its sign. */
export function peakMoment(a: Analysis, member: number, sign: 1 | -1 | 0 = 0): number {
  let best = 0;
  for (const M of a.members[member].M) {
    if (sign === 1 && M > best) best = M;
    else if (sign === -1 && M < best) best = M;
    else if (sign === 0 && Math.abs(M) > Math.abs(best)) best = M;
  }
  return best;
}

/** Largest transverse deflection |v| along a member, signed. */
export function peakDeflection(a: Analysis, member: number): { v: number; x: number } {
  let best = { v: 0, x: 0 };
  for (const p of a.members[member].defl) if (Math.abs(p.v) > Math.abs(best.v)) best = { v: p.v, x: p.x };
  return best;
}
