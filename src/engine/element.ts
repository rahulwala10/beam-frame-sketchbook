import type { ElemLoad } from './types';

/**
 * Euler–Bernoulli plane frame element.
 * Local DOFs: [u1, v1, θ1, u2, v2, θ2]; x runs from node i to node j, y is x rotated 90° anticlockwise.
 */

function sym(k: Float64Array, i: number, j: number, v: number): void {
  k[i * 6 + j] = v;
  k[j * 6 + i] = v;
}

export function frameStiffness(L: number, EA: number, EI: number): Float64Array {
  const k = new Float64Array(36);
  const a = EA / L;
  const b = (12 * EI) / L ** 3;
  const c = (6 * EI) / L ** 2;
  const d = (4 * EI) / L;
  const e = (2 * EI) / L;
  sym(k, 0, 0, a);
  sym(k, 0, 3, -a);
  sym(k, 3, 3, a);
  sym(k, 1, 1, b);
  sym(k, 1, 2, c);
  sym(k, 1, 4, -b);
  sym(k, 1, 5, c);
  sym(k, 2, 2, d);
  sym(k, 2, 4, -c);
  sym(k, 2, 5, e);
  sym(k, 4, 4, b);
  sym(k, 4, 5, -c);
  sym(k, 5, 5, d);
  return k;
}

/** Consistent mass matrix. Pin-jointed bars get a rod mass in both directions. */
export function frameMass(L: number, m: number, truss: boolean): Float64Array {
  const M = new Float64Array(36);
  const r = (m * L) / 6;
  sym(M, 0, 0, 2 * r);
  sym(M, 0, 3, r);
  sym(M, 3, 3, 2 * r);
  if (truss) {
    sym(M, 1, 1, 2 * r);
    sym(M, 1, 4, r);
    sym(M, 4, 4, 2 * r);
    return M;
  }
  const q = (m * L) / 420;
  sym(M, 1, 1, 156 * q);
  sym(M, 1, 2, 22 * L * q);
  sym(M, 1, 4, 54 * q);
  sym(M, 1, 5, -13 * L * q);
  sym(M, 2, 2, 4 * L * L * q);
  sym(M, 2, 4, 13 * L * q);
  sym(M, 2, 5, -3 * L * L * q);
  sym(M, 4, 4, 156 * q);
  sym(M, 4, 5, -22 * L * q);
  sym(M, 5, 5, 4 * L * L * q);
  return M;
}

/** Tᵀ·k·T for the rotation c = cos, s = sin of the element axis. */
export function toGlobal(k: Float64Array, c: number, s: number): Float64Array {
  const T = new Float64Array(36);
  for (const o of [0, 3]) {
    T[o * 6 + o] = c;
    T[o * 6 + o + 1] = s;
    T[(o + 1) * 6 + o] = -s;
    T[(o + 1) * 6 + o + 1] = c;
    T[(o + 2) * 6 + o + 2] = 1;
  }
  const kT = new Float64Array(36);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let v = 0;
      for (let m = 0; m < 6; m++) v += k[i * 6 + m] * T[m * 6 + j];
      kT[i * 6 + j] = v;
    }
  }
  const g = new Float64Array(36);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let v = 0;
      for (let m = 0; m < 6; m++) v += T[m * 6 + i] * kT[m * 6 + j];
      g[i * 6 + j] = v;
    }
  }
  return g;
}

/** Global 6-vector → local. */
export function vecToLocal(g: ArrayLike<number>, c: number, s: number, out: Float64Array): Float64Array {
  for (const o of [0, 3]) {
    out[o] = c * g[o] + s * g[o + 1];
    out[o + 1] = -s * g[o] + c * g[o + 1];
    out[o + 2] = g[o + 2];
  }
  return out;
}

/** Local 6-vector → global. */
export function vecToGlobal(l: ArrayLike<number>, c: number, s: number, out: Float64Array): Float64Array {
  for (const o of [0, 3]) {
    out[o] = c * l[o] - s * l[o + 1];
    out[o + 1] = s * l[o] + c * l[o + 1];
    out[o + 2] = l[o + 2];
  }
  return out;
}

/** Static condensation of released DOFs (subset of local 2 and 5). */
export function condense(k: Float64Array, rel: number[]): { kc: Float64Array; kccInv: Float64Array | null } {
  if (!rel.length) return { kc: k.slice(), kccInv: null };
  const r = rel.length;
  let inv: Float64Array;
  if (r === 1) {
    inv = new Float64Array([1 / k[rel[0] * 7]]);
  } else {
    const a = k[rel[0] * 6 + rel[0]];
    const b = k[rel[0] * 6 + rel[1]];
    const d = k[rel[1] * 6 + rel[1]];
    const det = a * d - b * b;
    inv = new Float64Array([d / det, -b / det, -b / det, a / det]);
  }
  const kc = new Float64Array(36);
  for (let i = 0; i < 6; i++) {
    if (rel.includes(i)) continue;
    for (let j = 0; j < 6; j++) {
      if (rel.includes(j)) continue;
      let v = k[i * 6 + j];
      for (let p = 0; p < r; p++) {
        for (let q = 0; q < r; q++) v -= k[i * 6 + rel[p]] * inv[p * r + q] * k[rel[q] * 6 + j];
      }
      kc[i * 6 + j] = v;
    }
  }
  return { kc, kccInv: inv };
}

/** Equivalent nodal loads after condensation: P* = Pr − k_rc·kcc⁻¹·Pc. */
export function condenseLoad(k: Float64Array, rel: number[], inv: Float64Array | null, P: Float64Array): Float64Array {
  const out = P.slice();
  if (!rel.length || !inv) return out;
  const r = rel.length;
  for (let i = 0; i < 6; i++) {
    if (rel.includes(i)) continue;
    for (let p = 0; p < r; p++) {
      for (let q = 0; q < r; q++) out[i] -= k[i * 6 + rel[p]] * inv[p * r + q] * P[rel[q]];
    }
  }
  for (const c of rel) out[c] = 0;
  return out;
}

/** Fill in the rotations of released ends: d_c = kcc⁻¹ (P_c − k_cr d_r). */
export function recoverReleased(k: Float64Array, rel: number[], inv: Float64Array | null, d: Float64Array, P: ArrayLike<number>): void {
  if (!rel.length || !inv) return;
  const r = rel.length;
  const rhs = [0, 0];
  for (let p = 0; p < r; p++) {
    let v = P[rel[p]];
    for (let j = 0; j < 6; j++) if (!rel.includes(j)) v -= k[rel[p] * 6 + j] * d[j];
    rhs[p] = v;
  }
  for (let p = 0; p < r; p++) {
    let v = 0;
    for (let q = 0; q < r; q++) v += inv[p * r + q] * rhs[q];
    d[rel[p]] = v;
  }
}

/** Cubic Hermite shape functions and their x-derivatives. */
export function hermite(x: number, L: number, out: Float64Array): Float64Array {
  const t = x / L;
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = 1 - 3 * t2 + 2 * t3;
  out[1] = L * (t - 2 * t2 + t3);
  out[2] = 3 * t2 - 2 * t3;
  out[3] = L * (-t2 + t3);
  out[4] = (-6 * t + 6 * t2) / L;
  out[5] = 1 - 4 * t + 3 * t2;
  out[6] = (6 * t - 6 * t2) / L;
  out[7] = -2 * t + 3 * t2;
  return out;
}

const GX = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)];
const GW = [5 / 9, 8 / 9, 5 / 9];
const H = new Float64Array(8);

/**
 * Work-equivalent nodal loads (local). For a prismatic element these are exactly the
 * negated fixed-end reactions, because the Hermite cubics are the exact homogeneous solutions.
 */
export function addEquivalentLoads(L: number, load: ElemLoad, P: Float64Array, scale = 1): void {
  if (load.type === 'dist') {
    const { x1, x2 } = load;
    const len = x2 - x1;
    if (len <= 0) return;
    const half = len / 2;
    const mid = (x1 + x2) / 2;
    for (let g = 0; g < 3; g++) {
      const x = mid + half * GX[g];
      const f = (x - x1) / len;
      const qx = load.qx1 + (load.qx2 - load.qx1) * f;
      const qy = load.qy1 + (load.qy2 - load.qy1) * f;
      const w = GW[g] * half * scale;
      hermite(x, L, H);
      P[0] += w * (1 - x / L) * qx;
      P[3] += w * (x / L) * qx;
      P[1] += w * H[0] * qy;
      P[2] += w * H[1] * qy;
      P[4] += w * H[2] * qy;
      P[5] += w * H[3] * qy;
    }
  } else if (load.type === 'point') {
    const { a, px, py } = load;
    hermite(a, L, H);
    P[0] += scale * (1 - a / L) * px;
    P[3] += scale * (a / L) * px;
    P[1] += scale * H[0] * py;
    P[2] += scale * H[1] * py;
    P[4] += scale * H[2] * py;
    P[5] += scale * H[3] * py;
  } else {
    const { a, m } = load;
    hermite(a, L, H);
    P[1] += scale * H[4] * m;
    P[2] += scale * H[5] * m;
    P[4] += scale * H[6] * m;
    P[5] += scale * H[7] * m;
  }
}

export interface ScaledLoad {
  el: ElemLoad;
  s: number;
}

/**
 * Axial force (tension +), shear and bending moment (sagging +, i.e. tension on the local −y face)
 * at local x, from the element end forces f (forces on the element, local axes) and its loads.
 * `right` selects the value just right of a concentrated load sitting exactly at x.
 */
export function internalAt(f: ArrayLike<number>, loads: ScaledLoad[], x: number, right: boolean, out: Float64Array): Float64Array {
  let N = -f[0];
  let V = f[1];
  let M = -f[2] + x * f[1];
  for (const { el, s } of loads) {
    if (el.type === 'dist') {
      if (x <= el.x1) continue;
      const len = el.x2 - el.x1;
      const t = Math.min(x, el.x2) - el.x1;
      const kx = len > 0 ? (el.qx2 - el.qx1) / len : 0;
      const ky = len > 0 ? (el.qy2 - el.qy1) / len : 0;
      const X = x - el.x1;
      N -= s * (el.qx1 * t + (kx * t * t) / 2);
      V += s * (el.qy1 * t + (ky * t * t) / 2);
      M += s * (X * el.qy1 * t + (X * ky * t * t) / 2 - (el.qy1 * t * t) / 2 - (ky * t * t * t) / 3);
    } else if (el.a < x || (right && el.a <= x)) {
      if (el.type === 'point') {
        N -= s * el.px;
        V += s * el.py;
        M += s * el.py * (x - el.a);
      } else {
        M -= s * el.m;
      }
    }
  }
  out[0] = N;
  out[1] = V;
  out[2] = M;
  return out;
}
