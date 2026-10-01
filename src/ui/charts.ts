import type { Model } from '../engine/model';
import type { Analysis } from '../engine/results';
import type { Spec } from '../engine/types';
import { svg } from './dom';
import { fmt } from './format';

/** All nodes on one level and all members horizontal. */
export function isBeam(spec: Spec): boolean {
  const y0 = spec.nodes[0][1];
  return spec.nodes.every(([, y]) => Math.abs(y - y0) < 1e-9);
}

interface Row {
  title: string;
  color: string;
  /** +1 plots positive values upwards, −1 downwards. */
  dir: 1 | -1;
  pts: Array<[number, number]>;
  unit: string;
}

/** Shear, bending moment and deflection plotted under one another along the beam. */
export function beamCharts(model: Model, a: Analysis): SVGSVGElement {
  const spec = model.spec;
  const xs = spec.nodes.map(([x]) => x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const rows: Row[] = [
    { title: 'Shear force V', color: 'var(--shear)', dir: 1, pts: [], unit: 'kN' },
    { title: 'Bending moment M, on the tension side', color: 'var(--moment)', dir: -1, pts: [], unit: 'kNm' },
    { title: 'Deflection', color: 'var(--ink)', dir: 1, pts: [], unit: 'mm' },
  ];
  const order = spec.members.map((_, i) => i).sort((p, q) => Math.min(xs[spec.members[p].a], xs[spec.members[p].b]) - Math.min(xs[spec.members[q].a], xs[spec.members[q].b]));
  for (const mi of order) {
    const mem = spec.members[mi];
    const xa = xs[mem.a];
    const dirn = Math.sign(xs[mem.b] - xa) || 1;
    const r = a.members[mi];
    const seq = r.x.map((x, k) => [xa + dirn * x, r.V[k] * dirn, r.M[k]] as const);
    if (dirn < 0) seq.reverse();
    for (const [x, V, M] of seq) {
      rows[0].pts.push([x, V]);
      rows[1].pts.push([x, M]);
    }
    const defl = r.defl.map((d) => [xa + dirn * d.x, d.uy * 1000] as [number, number]);
    if (dirn < 0) defl.reverse();
    rows[2].pts.push(...defl);
  }

  const W = 640;
  const padL = 14;
  const padR = 14;
  const rowH = 104;
  const plotTop = 24;
  const plotH = 64;
  const X = (x: number) => padL + ((x - x0) / Math.max(x1 - x0, 1e-9)) * (W - padL - padR);
  const root = svg('svg', { viewBox: `0 0 ${W} ${rowH * rows.length}`, role: 'img', 'aria-label': 'Shear force, bending moment and deflection diagrams along the beam' });
  const supportsX = spec.supports.map((s) => spec.nodes[s.node][0]);

  rows.forEach((row, i) => {
    const top = i * rowH;
    const vals = row.pts.map((p) => p[1] * row.dir);
    let lo = Math.min(0, ...vals);
    let hi = Math.max(0, ...vals);
    if (hi - lo < 1e-9) {
      hi = 1;
      lo = -1;
    }
    const Y = (v: number) => top + plotTop + ((hi - v * row.dir) / (hi - lo)) * plotH;
    const g = svg('g');
    g.append(svg('text', { x: padL, y: top + 12, style: 'font-weight:500' }, `${row.title} (${row.unit})`));
    for (const sx of supportsX) {
      g.append(svg('line', { x1: X(sx), x2: X(sx), y1: top + plotTop - 4, y2: top + plotTop + plotH + 4, style: 'stroke: var(--ink-faint); stroke-dasharray: 2 3' }));
    }
    const zero = Y(0);
    let d = `M ${X(row.pts[0][0])} ${zero}`;
    for (const [x, v] of row.pts) d += ` L ${X(x).toFixed(2)} ${Y(v).toFixed(2)}`;
    d += ` L ${X(row.pts[row.pts.length - 1][0])} ${zero} Z`;
    g.append(svg('path', { d, style: `fill: ${row.color}; fill-opacity: 0.14; stroke: none` }));
    let line = '';
    row.pts.forEach(([x, v], k) => (line += `${k ? 'L' : 'M'} ${X(x).toFixed(2)} ${Y(v).toFixed(2)} `));
    g.append(svg('path', { d: line, style: `fill: none; stroke: ${row.color}; stroke-width: 1.6; stroke-linejoin: round` }));
    g.append(svg('line', { x1: padL, x2: W - padR, y1: zero, y2: zero, style: 'stroke: var(--ink); stroke-width: 1' }));
    // Extremes.
    let iMax = 0;
    let iMin = 0;
    row.pts.forEach(([, v], k) => {
      if (v > row.pts[iMax][1]) iMax = k;
      if (v < row.pts[iMin][1]) iMin = k;
    });
    const placed: number[] = [];
    for (const k of [iMax, iMin]) {
      const [x, v] = row.pts[k];
      if (Math.abs(v) < 1e-6 * Math.max(Math.abs(hi), Math.abs(lo))) continue;
      const px = X(x);
      if (placed.some((p) => Math.abs(p - px) < 40) && placed.length) continue;
      placed.push(px);
      const py = Y(v);
      const above = v * row.dir > 0;
      const anchor = px < 60 ? 'start' : px > W - 60 ? 'end' : 'middle';
      g.append(svg('circle', { cx: px, cy: py, r: 2.4, style: `fill: ${row.color}` }));
      g.append(svg('text', { x: px, y: py + (above ? -6 : 14), 'text-anchor': anchor, style: `fill: ${row.color}; font-weight: 500` }, fmt(v)));
    }
    root.append(g);
  });
  return root;
}
