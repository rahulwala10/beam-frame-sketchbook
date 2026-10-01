import type { Model } from '../engine/model';
import { displacementAt, forcesAt, peakMoment, type Analysis } from '../engine/results';
import { DEFAULT_EI, type Spec } from '../engine/types';
import type { CheckContext, Params } from './types';

/** Everything a hand check needs, read from a solved model. */
export function makeContext(p: Params, spec: Spec, original: Spec, model: Model, a: Analysis, lambda: ArrayLike<number>): CheckContext {
  const u = a.u;
  return {
    p,
    spec,
    a,
    EI: DEFAULT_EI,
    on: (l) => lambda[l] > 0.5,
    t: (l) => {
      const ld = spec.loads[l];
      return ld.kind === 'point' || ld.kind === 'moment' ? ld.t : 0;
    },
    inPlace: (l) => {
      const now = spec.loads[l];
      const then = original.loads[l];
      if (!then || now.kind !== then.kind) return false;
      if ((now.kind === 'point' || now.kind === 'moment') && (then.kind === 'point' || then.kind === 'moment')) {
        return now.member === then.member && Math.abs(now.t - then.t) < 1e-9;
      }
      return true;
    },
    R: (node) => a.reactions.find((r) => r.node === node)?.R ?? [0, 0, 0],
    M: (m, t) => forcesAt(a, m, t)[2],
    V: (m, t) => forcesAt(a, m, t)[1],
    N: (m, t) => forcesAt(a, m, t)[0],
    peakM: (m, sign = 0) => peakMoment(a, m, sign),
    v: (m, t) => displacementAt(a, m, t)[2],
    peakV: (m) => Math.max(...a.members[m].defl.map((d) => Math.abs(d.v))),
    disp: (node) => [u[model.dof(node, 0)], u[model.dof(node, 1)]],
    rot: (node) => u[model.dof(node, 2)],
  };
}

/** Out-of-balance force and moment between the applied loads and the reactions (should be ~0). */
export function equilibrium(model: Model, a: Analysis, lambda: ArrayLike<number>): { fx: number; fy: number; m: number; scale: number } {
  const F = model.loadVector(lambda);
  let fx = 0;
  let fy = 0;
  let m = 0;
  let scale = 0;
  for (let v = 0; v < model.nNode; v++) {
    const [x, y] = model.nodes[v];
    const px = F[model.dof(v, 0)];
    const py = F[model.dof(v, 1)];
    const pm = F[model.dof(v, 2)];
    fx += px;
    fy += py;
    m += x * py - y * px + pm;
    scale = Math.max(scale, Math.abs(px), Math.abs(py));
  }
  for (const r of a.reactions) {
    const [x, y] = model.nodes[r.node];
    fx += r.R[0];
    fy += r.R[1];
    m += x * r.R[1] - y * r.R[0] + r.R[2];
    scale = Math.max(scale, Math.abs(r.R[0]), Math.abs(r.R[1]));
  }
  return { fx, fy, m, scale };
}
