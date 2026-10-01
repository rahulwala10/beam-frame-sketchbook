import { RESTRAINTS } from './model';
import type { Spec } from './types';

export interface Determinacy {
  /** Degree of static indeterminacy: 3m + r − 3j − c. Negative means a mechanism. */
  degree: number;
  m: number;
  r: number;
  j: number;
  c: number;
}

/**
 * Counts for a rigid-jointed plane frame with releases.
 * At a joint where every member is pinned and nothing restrains rotation, k pinned ends give k − 1 releases.
 */
export function determinacy(spec: Spec): Determinacy {
  const m = spec.members.length;
  const j = spec.nodes.length;
  let r = 0;
  const rotHeld = new Uint8Array(j);
  for (const s of spec.supports) {
    const rs = RESTRAINTS[s.kind];
    const ks = [s.kx ?? 0, s.ky ?? 0, s.kr ?? 0];
    for (let k = 0; k < 3; k++) if (rs[k] || ks[k] > 0) r++;
    if (rs[2] || ks[2] > 0) rotHeld[s.node] = 1;
  }
  const count = new Array<number>(j).fill(0);
  const released = new Array<number>(j).fill(0);
  for (const mem of spec.members) {
    count[mem.a]++;
    count[mem.b]++;
    if (mem.truss || mem.hingeA) released[mem.a]++;
    if (mem.truss || mem.hingeB) released[mem.b]++;
  }
  let c = 0;
  for (let n = 0; n < j; n++) {
    if (!count[n]) continue;
    if (!rotHeld[n] && released[n] === count[n]) c += count[n] - 1;
    else c += released[n];
  }
  return { degree: 3 * m + r - 3 * j - c, m, r, j, c };
}

export function describeDeterminacy(d: Determinacy): string {
  if (d.degree < 0) return 'Mechanism';
  if (d.degree === 0) return 'Statically determinate';
  return `Indeterminate to degree ${d.degree}`;
}
