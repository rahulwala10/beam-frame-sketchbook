/**
 * Symmetric banded matrices and an LDLᵀ factorisation.
 * Only the lower band is stored: entry (i, j) with j <= i lives at a[i * w + (i - j)].
 */
export class BandMatrix {
  readonly n: number;
  readonly b: number;
  readonly w: number;
  readonly a: Float64Array;

  constructor(n: number, b: number, data?: Float64Array) {
    this.n = n;
    this.b = Math.max(0, Math.min(b, n - 1));
    this.w = this.b + 1;
    this.a = data ?? new Float64Array(n * this.w);
  }

  add(i: number, j: number, v: number): void {
    if (i < j) [i, j] = [j, i];
    this.a[i * this.w + (i - j)] += v;
  }

  get(i: number, j: number): number {
    if (i < j) [i, j] = [j, i];
    return i - j > this.b ? 0 : this.a[i * this.w + (i - j)];
  }

  /** out = A·x */
  mul(x: Float64Array, out: Float64Array = new Float64Array(this.n)): Float64Array {
    const { n, b, w, a } = this;
    out.fill(0);
    for (let i = 0; i < n; i++) {
      const row = i * w;
      let s = a[row] * x[i];
      const j0 = Math.max(0, i - b);
      const xi = x[i];
      for (let j = j0; j < i; j++) {
        const v = a[row + (i - j)];
        s += v * x[j];
        out[j] += v * xi;
      }
      out[i] += s;
    }
    return out;
  }

  clone(): BandMatrix {
    return new BandMatrix(this.n, this.b, this.a.slice());
  }

  /** this + f·other (same shape). */
  combine(f: number, other: BandMatrix, g = 1): BandMatrix {
    const out = new Float64Array(this.a.length);
    for (let k = 0; k < out.length; k++) out[k] = g * this.a[k] + f * other.a[k];
    return new BandMatrix(this.n, this.b, out);
  }

  /** Copy with every masked row and column replaced by the identity. */
  constrained(mask: Uint8Array): BandMatrix {
    const m = this.clone();
    const { n, b, w, a } = m;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const j0 = Math.max(0, i - b);
      for (let j = j0; j < i; j++) a[i * w + (i - j)] = 0;
      const k1 = Math.min(n - 1, i + b);
      for (let k = i + 1; k <= k1; k++) a[k * w + (k - i)] = 0;
      a[i * w] = 1;
    }
    return m;
  }
}

export class MechanismError extends Error {
  readonly dof: number;
  constructor(dof: number) {
    super(`Singular stiffness at DOF ${dof}: the structure is a mechanism.`);
    this.dof = dof;
  }
}

/** A = L·D·Lᵀ for a symmetric positive definite band matrix. Throws MechanismError otherwise. */
export class LDLT {
  readonly n: number;
  readonly b: number;
  private readonly w: number;
  private readonly L: Float64Array;
  private readonly D: Float64Array;

  constructor(A: BandMatrix, relTol = 1e-11) {
    const { n, b, w } = A;
    this.n = n;
    this.b = b;
    this.w = w;
    const L = A.a.slice();
    const D = new Float64Array(n);
    const tmp = new Float64Array(w);
    for (let i = 0; i < n; i++) {
      const j0 = Math.max(0, i - b);
      const rowI = i * w;
      for (let j = j0; j < i; j++) {
        let s = L[rowI + (i - j)];
        const k0 = Math.max(j0, j - b);
        const rowJ = j * w;
        for (let k = k0; k < j; k++) s -= tmp[k - j0] * L[rowJ + (j - k)];
        tmp[j - j0] = s;
        L[rowI + (i - j)] = s / D[j];
      }
      const aii = L[rowI];
      let d = aii;
      for (let k = j0; k < i; k++) d -= tmp[k - j0] * L[rowI + (i - k)];
      if (!(aii > 0) || !(d > relTol * aii)) throw new MechanismError(i);
      D[i] = d;
      L[rowI] = d;
    }
    this.L = L;
    this.D = D;
  }

  solve(rhs: Float64Array, out: Float64Array = new Float64Array(this.n)): Float64Array {
    const { n, b, w, L, D } = this;
    if (out !== rhs) out.set(rhs);
    const x = out;
    for (let i = 0; i < n; i++) {
      let s = x[i];
      const row = i * w;
      for (let j = Math.max(0, i - b); j < i; j++) s -= L[row + (i - j)] * x[j];
      x[i] = s;
    }
    for (let i = 0; i < n; i++) x[i] /= D[i];
    for (let i = n - 1; i >= 0; i--) {
      let s = x[i];
      const k1 = Math.min(n - 1, i + b);
      for (let k = i + 1; k <= k1; k++) s -= L[k * w + (k - i)] * x[k];
      x[i] = s;
    }
    return x;
  }
}

/**
 * Reverse Cuthill–McKee ordering of a graph. Returns pos[node] = new index,
 * which keeps the stiffness band narrow.
 */
export function rcm(nNodes: number, edges: Array<[number, number]>): Int32Array {
  const adj: number[][] = Array.from({ length: nNodes }, () => []);
  for (const [i, j] of edges) {
    if (i === j) continue;
    if (!adj[i].includes(j)) adj[i].push(j);
    if (!adj[j].includes(i)) adj[j].push(i);
  }
  const deg = adj.map((a) => a.length);
  const visited = new Uint8Array(nNodes);
  const order: number[] = [];

  const bfsLevels = (start: number): number[][] => {
    const seen = new Uint8Array(nNodes);
    const levels: number[][] = [[start]];
    seen[start] = 1;
    for (;;) {
      const next: number[] = [];
      for (const v of levels[levels.length - 1]) {
        for (const u of adj[v]) {
          if (!seen[u]) {
            seen[u] = 1;
            next.push(u);
          }
        }
      }
      if (!next.length) return levels;
      levels.push(next);
    }
  };

  for (;;) {
    let start = -1;
    for (let v = 0; v < nNodes; v++) {
      if (!visited[v] && (start < 0 || deg[v] < deg[start])) start = v;
    }
    if (start < 0) break;
    // Walk towards a pseudo-peripheral node.
    for (let pass = 0; pass < 3; pass++) {
      const levels = bfsLevels(start);
      const last = levels[levels.length - 1];
      let best = last[0];
      for (const v of last) if (deg[v] < deg[best]) best = v;
      if (best === start) break;
      start = best;
    }
    visited[start] = 1;
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      order.push(v);
      const nbrs = adj[v].filter((u) => !visited[u]).sort((x, y) => deg[x] - deg[y]);
      for (const u of nbrs) {
        visited[u] = 1;
        queue.push(u);
      }
    }
  }

  order.reverse();
  const pos = new Int32Array(nNodes);
  order.forEach((node, k) => (pos[node] = k));
  return pos;
}
