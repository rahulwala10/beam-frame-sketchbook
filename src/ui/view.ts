import { hermite, internalAt, type ScaledLoad } from '../engine/element';
import type { Model } from '../engine/model';
import type { Sim } from '../engine/sim';
import type { LoadSpec, SupportSpec, Vec2 } from '../engine/types';
import { fmt, nodeLetter } from './format';
import type { Item, ItemView } from './item';
import { settings, type DiagramKind } from './settings';
import { getPalette, type Palette } from './theme';

export interface Scales {
  /** Deflection magnification. */
  mag: number;
  /** World units of diagram ordinate per kN or kNm. */
  diag: { M: number; V: number; N: number };
}

/**
 * Each structure's own scales: deflections to ~9% and diagrams to ~13% of its size.
 * Diagrams are measured against the applied load as well as their own peak, so a funicular arch
 * with almost no bending really does show almost no bending.
 */
export function ownScales(sim: Sim, exaggerate = 1): Scales {
  if (!sim.ok) return { mag: 1, diag: { M: 1, V: 1, N: 1 } };
  const size = sim.model.size;
  const ref = sim.refDisp > 0 ? sim.refDisp : size * 1e-3;
  const f = sim.refForce;
  const W = sim.refLoad;
  const floor = 1e-3 * Math.max(f.V, f.N, f.M / size, 1e-9);
  return {
    mag: (0.09 * size * exaggerate) / ref,
    diag: {
      M: (0.13 * size) / Math.max(f.M, 0.1 * W * size, floor * size),
      V: (0.13 * size) / Math.max(f.V, 0.3 * W, floor),
      N: (0.13 * size) / Math.max(f.N, 0.3 * W, floor),
    },
  };
}

/** True when every node sits on one level: a beam rather than a frame. */
export function isBeamSpec(spec: { nodes: Vec2[] }): boolean {
  const y0 = spec.nodes[0][1];
  return spec.nodes.every(([, y]) => Math.abs(y - y0) < 1e-9);
}

interface DiagramLabel {
  x: number;
  y: number;
  v: number;
  color: string;
  signed: boolean;
}

type Hit = { l: number; kind: 'seg'; x1: number; y1: number; x2: number; y2: number } | { l: number; kind: 'disc'; x: number; y: number; r: number };

interface Press {
  kind: 'load' | 'grab';
  id: number;
  l?: number;
  start: Vec2;
  moved: boolean;
  offset?: Vec2;
}

const H = new Float64Array(8);
const R3 = new Float64Array(3);
const FONT_DATA = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";

/** A canvas showing one structure, with grab-and-pull and load interactions. */
export class StructureView implements ItemView {
  readonly canvas: HTMLCanvasElement;
  readonly item: Item;
  readonly big: boolean;
  scales: () => Scales;
  onInteract: (() => void) | null = null;

  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private s = 1;
  private ox = 0;
  private oy = 0;
  private fitKey = '';
  private D: Float64Array[] = [];
  private F: Float64Array[] = [];
  private nodeXY: Float64Array = new Float64Array(0);
  private hits: Hit[] = [];
  private hover = -1;
  private press: Press | null = null;
  private ro: ResizeObserver;
  private labels: Array<[number, number, number, number]> = [];

  constructor(canvas: HTMLCanvasElement, item: Item, opts: { big?: boolean; scales?: () => Scales } = {}) {
    this.canvas = canvas;
    this.item = item;
    this.big = !!opts.big;
    this.scales = opts.scales ?? (() => ownScales(this.item.sim, this.item.ex.exaggerate));
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    item.attach(this);
  }

  destroy(): void {
    this.ro.disconnect();
    this.item.detach(this);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
  }

  // ── Geometry ────────────────────────────────────────────────

  private X(x: number): number {
    return this.ox + this.s * x;
  }

  private Y(y: number): number {
    return this.oy - this.s * y;
  }

  private fit(): void {
    const spec = this.item.sim.spec;
    const key = `${this.w}x${this.h}:${spec.nodes.map((p) => p.join(',')).join(';')}`;
    if (key === this.fitKey) return;
    this.fitKey = key;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of spec.nodes) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const size = Math.max(maxX - minX, maxY - minY, 1e-6);
    let ax = 0;
    let ay = 0;
    for (const mem of spec.members) {
      const [x1, y1] = spec.nodes[mem.a];
      const [x2, y2] = spec.nodes[mem.b];
      const L = Math.hypot(x2 - x1, y2 - y1) || 1;
      ax = Math.max(ax, Math.abs(y2 - y1) / L);
      ay = Math.max(ay, Math.abs(x2 - x1) / L);
    }
    // Room for diagrams outside the outline: generous for flat beams, less for deep frames and trusses.
    const flat = Math.min(maxX - minX, maxY - minY) < 0.05 * size;
    const allow = (flat ? 0.16 : 0.1) * size;
    const x0 = minX - ax * allow;
    const x1 = maxX + ax * allow;
    const y0 = minY - ay * allow;
    const y1 = maxY + ay * allow;
    const big = this.big;
    const pl = big ? 64 : 34;
    const pr = big ? 64 : 34;
    const pt = big ? 70 : 52;
    const pb = big ? 64 : 40;
    const aw = Math.max(10, this.w - pl - pr);
    const ah = Math.max(10, this.h - pt - pb);
    const bw = Math.max(x1 - x0, 1e-6);
    const bh = Math.max(y1 - y0, 1e-6);
    this.s = Math.min(aw / bw, ah / bh);
    this.ox = pl + (aw - this.s * bw) / 2 - this.s * x0;
    this.oy = pt + (ah - this.s * bh) / 2 + this.s * y1;
  }

  /** Screen position of local x along element e, displaced by mag × deflection. */
  private pos(m: Model, e: number, x: number, mag: number): Vec2 {
    const E = m.elems[e];
    const d = this.D[e];
    hermite(x, E.L, H);
    const v = H[0] * d[1] + H[1] * d[2] + H[2] * d[4] + H[3] * d[5];
    const ua = (1 - x / E.L) * d[0] + (x / E.L) * d[3];
    const [xi, yi] = m.nodes[E.i];
    const wx = xi + E.c * x + mag * (E.c * ua - E.s * v);
    const wy = yi + E.s * x + mag * (E.s * ua + E.c * v);
    return [this.X(wx), this.Y(wy)];
  }

  private pointOnMember(m: Model, member: number, t: number, mag: number): Vec2 {
    const { e, a } = m.locate(member, t);
    return this.pos(m, e, a, mag);
  }

  // ── Drawing ─────────────────────────────────────────────────

  draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 2 || h < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.labels = [];
    this.hits = [];
    const sim = this.item.sim;
    const pal = getPalette();
    this.fit();
    if (!sim.ok) {
      this.drawPlain(pal);
      return;
    }
    const m = sim.model;
    const hidden = settings.quiz && !this.item.revealed;
    const sc = this.scales();
    const mag = hidden ? 0 : sc.mag;
    if (this.D.length !== m.elems.length) {
      this.D = m.elems.map(() => new Float64Array(6));
      this.F = m.elems.map(() => new Float64Array(6));
    }
    for (let e = 0; e < m.elems.length; e++) m.elemState(e, sim.u, sim.lambda, this.D[e], this.F[e]);
    this.cacheNodes(m, mag);

    if (this.big) this.reserveNodeLetters(m);
    let pending: DiagramLabel[] = [];
    if (!hidden && settings.diagram !== 'none') pending = this.drawDiagram(m, sim, settings.diagram, sc, pal);
    if (!hidden) this.drawGhost(m, pal);
    this.drawSupports(m, sim, mag, pal);
    this.drawMembers(m, mag, pal, hidden);
    this.drawLoads(m, sim, mag, pal);
    if (!hidden && settings.reactions) this.drawReactions(m, sim, mag, pal);
    if (!hidden && settings.inflection) this.drawInflection(m, sim, mag, pal);
    if (this.big) this.drawNodeLetters(m, pal, hidden ? null : sc);
    if (!hidden && (settings.values || this.big)) this.drawDeflectionLabel(m, sim, mag, pal);
    this.placeDiagramLabels(pending, pal);
    if (sim.grab) this.drawGrab(sim, pal);
    else if (this.hover >= 0 && !hidden) this.drawHover(pal);
  }

  private cacheNodes(m: Model, mag: number): void {
    if (this.nodeXY.length !== m.nNode * 2) this.nodeXY = new Float64Array(m.nNode * 2);
    const u = this.item.sim.u;
    for (let v = 0; v < m.nNode; v++) {
      this.nodeXY[2 * v] = this.X(m.nodes[v][0] + mag * u[m.dof(v, 0)]);
      this.nodeXY[2 * v + 1] = this.Y(m.nodes[v][1] + mag * u[m.dof(v, 1)]);
    }
  }

  private drawPlain(pal: Palette): void {
    const ctx = this.ctx;
    const spec = this.item.sim.spec;
    ctx.strokeStyle = pal.faint;
    ctx.lineWidth = 2;
    for (const mem of spec.members) {
      const [x1, y1] = spec.nodes[mem.a];
      const [x2, y2] = spec.nodes[mem.b];
      ctx.beginPath();
      ctx.moveTo(this.X(x1), this.Y(y1));
      ctx.lineTo(this.X(x2), this.Y(y2));
      ctx.stroke();
    }
  }

  private drawGhost(m: Model, pal: Palette): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = pal.faint;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    for (const mem of m.spec.members) {
      const [x1, y1] = m.spec.nodes[mem.a];
      const [x2, y2] = m.spec.nodes[mem.b];
      ctx.beginPath();
      ctx.moveTo(this.X(x1), this.Y(y1));
      ctx.lineTo(this.X(x2), this.Y(y2));
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMembers(m: Model, mag: number, pal: Palette, hidden: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.ink;
    m.memberElems.forEach((ids, mi) => {
      const mem = m.spec.members[mi];
      const slim = mem.truss || mem.role === 'tie' || mem.role === 'brace';
      ctx.lineWidth = (this.big ? 1.25 : 1) * (slim ? 1.8 : hidden ? 2.2 : 2.7);
      ctx.beginPath();
      ids.forEach((e, k) => {
        const E = m.elems[e];
        for (let q = k === 0 ? 0 : 1; q <= 4; q++) {
          const [x, y] = this.pos(m, e, (E.L * q) / 4, mag);
          if (k === 0 && q === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });
    // Hinges: one circle at a fully pinned joint, otherwise a circle just inside each released member end.
    const r = this.big ? 4.2 : 3.4;
    const count = new Array<number>(m.spec.nodes.length).fill(0);
    const released = new Array<number>(m.spec.nodes.length).fill(0);
    for (const mem of m.spec.members) {
      count[mem.a]++;
      count[mem.b]++;
      if (mem.hingeA || mem.truss) released[mem.a]++;
      if (mem.hingeB || mem.truss) released[mem.b]++;
    }
    const circle = (cx: number, cy: number) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = pal.paper;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.stroke();
    };
    m.spec.nodes.forEach((_, v) => {
      if (released[v] && released[v] === count[v]) circle(this.nodeXY[2 * v], this.nodeXY[2 * v + 1]);
    });
    m.spec.members.forEach((mem, mi) => {
      const ids = m.memberElems[mi];
      const ends: Array<[boolean, number, boolean, number]> = [
        [!!(mem.hingeA || mem.truss), ids[0], true, mem.a],
        [!!(mem.hingeB || mem.truss), ids[ids.length - 1], false, mem.b],
      ];
      for (const [rel, e, atStart, node] of ends) {
        if (!rel || released[node] === count[node]) continue;
        const E = m.elems[e];
        const inset = Math.min(E.L * 0.5, (r * 1.1) / this.s);
        const [cx, cy] = this.pos(m, e, atStart ? inset : E.L - inset, mag);
        circle(cx, cy);
      }
    });
    ctx.restore();
  }

  private diagramValue(kind: DiagramKind, r: Float64Array): number {
    return kind === 'M' ? r[2] : kind === 'V' ? r[1] : r[0];
  }

  /** Sample positions along an element: ends, interior points under distributed load, both sides of point loads. */
  private samples(E: { L: number }, loads: ScaledLoad[]): Array<[number, boolean]> {
    const pts: Array<[number, boolean]> = [
      [0, true],
      [E.L, false],
    ];
    if (loads.some((l) => l.el.type === 'dist')) for (let k = 1; k < 4; k++) pts.push([(E.L * k) / 4, true]);
    for (const l of loads) {
      if (l.el.type !== 'dist' && l.el.a > 1e-9 && l.el.a < E.L - 1e-9) pts.push([l.el.a, false], [l.el.a, true]);
    }
    pts.sort((a, b) => a[0] - b[0] || Number(a[1]) - Number(b[1]));
    return pts;
  }

  private drawDiagram(m: Model, sim: Sim, kind: DiagramKind, sc: Scales, pal: Palette): DiagramLabel[] {
    const ctx = this.ctx;
    const k = kind as 'M' | 'V' | 'N';
    const scale = sc.diag[k];
    const cap = 0.45 * m.size;
    const beam = isBeamSpec(m.spec);
    let globalMax = 0;
    const perMember: Array<Array<[number, number]>> = [];
    m.memberElems.forEach((ids) => {
      const pts: Array<[number, number]> = [];
      for (const e of ids) {
        const E = m.elems[e];
        const loads = m.scaledLoads(e, sim.lambda);
        for (const [x, right] of this.samples(E, loads)) {
          internalAt(this.F[e], loads, x, right, R3);
          const v = this.diagramValue(kind, R3);
          pts.push([E.x0 + x, v]);
          globalMax = Math.max(globalMax, Math.abs(v));
        }
      }
      perMember.push(pts);
    });
    // Ignore round-off: nothing to draw unless the forces are a visible fraction of the yardstick.
    if (globalMax * scale * this.s < 0.75) return [];
    const labels: DiagramLabel[] = [];

    m.memberElems.forEach((ids, mi) => {
      const E0 = m.elems[ids[0]];
      const [ax, ay] = m.nodes[E0.i];
      const c = E0.c;
      const s = E0.s;
      const pts = perMember[mi];
      let own = 0;
      for (const p of pts) own = Math.max(own, Math.abs(p[1]));
      if (own * scale * this.s < 0.6) return;
      const at = (x: number, o: number): Vec2 => [this.X(ax + c * x - s * o), this.Y(ay + s * x + c * o)];
      const clamp = (o: number) => Math.max(-cap, Math.min(cap, o));

      if (kind === 'N') {
        // Axial force as a band centred on the member: blue tension, red compression, width ∝ |N|.
        const half = (v: number) => clamp(Math.abs(v) * scale * 0.3);
        for (let i = 1; i < pts.length; i++) {
          const [x0, v0] = pts[i - 1];
          const [x1, v1] = pts[i];
          if (x1 - x0 < 1e-12) continue;
          const mean = (v0 + v1) / 2;
          if (Math.abs(mean) * scale * this.s * 0.3 < 0.4) continue;
          const p1 = at(x0, half(v0));
          const p2 = at(x1, half(v1));
          const p3 = at(x1, -half(v1));
          const p4 = at(x0, -half(v0));
          ctx.beginPath();
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
          ctx.lineTo(p3[0], p3[1]);
          ctx.lineTo(p4[0], p4[1]);
          ctx.closePath();
          ctx.globalAlpha = 0.34;
          ctx.fillStyle = mean >= 0 ? pal.tension : pal.compression;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        let peak = pts[0];
        for (const p of pts) if (Math.abs(p[1]) > Math.abs(peak[1])) peak = p;
        if (Math.abs(peak[1]) >= 0.2 * globalMax) {
          const L = m.memberLength[mi];
          const [lx, ly] = at(L / 2, 0);
          labels.push({ x: lx, y: ly + 4, v: peak[1], color: peak[1] >= 0 ? pal.tension : pal.compression, signed: true });
        }
        return;
      }

      // Moment on the tension side (sagging to the member's local −y face); shear on the +y face.
      const sign = kind === 'M' ? -1 : 1;
      const color = kind === 'M' ? pal.moment : pal.shear;
      const base = (x: number) => at(x, 0);
      const tip = (x: number, v: number) => at(x, clamp(sign * v * scale));
      ctx.beginPath();
      const b0 = base(pts[0][0]);
      ctx.moveTo(b0[0], b0[1]);
      for (const [x, v] of pts) {
        const [tx, ty] = tip(x, v);
        ctx.lineTo(tx, ty);
      }
      const b1 = base(pts[pts.length - 1][0]);
      ctx.lineTo(b1[0], b1[1]);
      ctx.closePath();
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      // Hatching: ordinates every few pixels, as drawn by hand.
      ctx.beginPath();
      const step = (this.big ? 7 : 6) / this.s;
      const x0 = pts[0][0];
      const x1 = pts[pts.length - 1][0];
      let j = 0;
      for (let x = x0 + step / 2; x < x1; x += step) {
        while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
        const p = pts[j];
        const q = pts[j + 1];
        const f = q[0] > p[0] ? (x - p[0]) / (q[0] - p[0]) : 0;
        const v = p[1] + (q[1] - p[1]) * f;
        const [bx, by] = base(x);
        const [tx, ty] = tip(x, v);
        ctx.moveTo(bx, by);
        ctx.lineTo(tx, ty);
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      pts.forEach(([x, v], i) => {
        const [tx, ty] = tip(x, v);
        if (i === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      });
      ctx.lineWidth = this.big ? 1.6 : 1.3;
      ctx.stroke();
      // Label candidates: the largest value each way on this member.
      let hi = pts[0];
      let lo = pts[0];
      for (const p of pts) {
        if (p[1] > hi[1]) hi = p;
        if (p[1] < lo[1]) lo = p;
      }
      for (const p of [hi, lo]) {
        if (Math.abs(p[1]) < 0.2 * globalMax) continue;
        const [tx, ty] = tip(p[0], p[1]);
        // On frames the side of the member already shows the sense, so quote magnitudes.
        labels.push({ x: tx, y: ty, v: p[1], color, signed: beam || kind === 'V' });
      }
    });
    return labels;
  }

  private placeDiagramLabels(cands: DiagramLabel[], pal: Palette): void {
    if (!cands.length || !(settings.values || this.big)) return;
    cands.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const limit = this.big ? 16 : 6;
    let placed = 0;
    const seen = new Set<string>();
    for (const c of cands) {
      if (placed >= limit) break;
      const key = `${Math.round(c.x / 4)},${Math.round(c.y / 4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.label(fmt(c.signed ? c.v : Math.abs(c.v)), c.x, c.y, c.color, pal)) placed++;
    }
  }

  /** Text with a paper halo. Returns false if it would overlap a label already drawn. */
  private label(text: string, x: number, y: number, color: string, pal: Palette, align: CanvasTextAlign = 'center', dy = -7): boolean {
    const ctx = this.ctx;
    ctx.font = `500 ${this.big ? 12 : 10.5}px ${FONT_DATA}`;
    const w = ctx.measureText(text).width;
    const hgt = this.big ? 13 : 11;
    let left = align === 'center' ? x - w / 2 : align === 'left' ? x : x - w;
    left = Math.max(2, Math.min(this.w - w - 2, left));
    const top = Math.max(2, Math.min(this.h - hgt - 2, y + dy - hgt / 2));
    for (const [l, t, r, b] of this.labels) {
      if (left < r + 2 && left + w > l - 2 && top < b + 1 && top + hgt > t - 1) return false;
    }
    this.labels.push([left, top, left + w, top + hgt]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.paper;
    ctx.strokeText(text, left, top + hgt / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, left, top + hgt / 2);
    return true;
  }

  private faceOf(m: Model, sup: SupportSpec): Vec2 {
    if (sup.face) return sup.face;
    if (sup.kind === 'pin' || sup.kind === 'roller' || sup.kind === 'spring') return [0, -1];
    let dx = 0;
    let dy = 0;
    for (const mem of m.spec.members) {
      const other = mem.a === sup.node ? mem.b : mem.b === sup.node ? mem.a : -1;
      if (other < 0) continue;
      const [x0, y0] = m.spec.nodes[sup.node];
      const [x1, y1] = m.spec.nodes[other];
      const L = Math.hypot(x1 - x0, y1 - y0) || 1;
      dx += (x1 - x0) / L;
      dy += (y1 - y0) / L;
    }
    if (Math.hypot(dx, dy) < 1e-6) return [0, -1];
    return Math.abs(dx) > Math.abs(dy) ? [-Math.sign(dx), 0] : [0, -Math.sign(dy)];
  }

  private drawSupports(m: Model, sim: Sim, mag: number, pal: Palette): void {
    const ctx = this.ctx;
    const k = this.big ? 1.25 : 1;
    for (const sup of m.spec.supports) {
      const v = sup.node;
      const px = this.X(m.nodes[v][0] + mag * sim.u[m.dof(v, 0)]);
      const py = this.Y(m.nodes[v][1] + mag * sim.u[m.dof(v, 1)]);
      const [fx, fy] = this.faceOf(m, sup);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(-fx, -fy));
      ctx.scale(k, k);
      ctx.strokeStyle = pal.ink;
      ctx.fillStyle = pal.paper;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      const ground = (y: number, half = 13) => {
        ctx.beginPath();
        ctx.moveTo(-half, y);
        ctx.lineTo(half, y);
        ctx.stroke();
        ctx.beginPath();
        for (let x = -half + 3; x <= half; x += 5) {
          ctx.moveTo(x, y);
          ctx.lineTo(x - 4, y + 5);
        }
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.lineWidth = 1.4;
      };
      if (sup.kind === 'fixed') {
        ctx.beginPath();
        ctx.moveTo(-13, 0);
        ctx.lineTo(13, 0);
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.beginPath();
        for (let x = -11; x <= 13; x += 5) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x - 5, 7);
        }
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (sup.kind === 'pin') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-8.5, 13);
        ctx.lineTo(8.5, 13);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ground(13);
      } else if (sup.kind === 'roller' || sup.kind === 'wallRoller') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-8, 10);
        ctx.lineTo(8, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        for (const cx of [-4.5, 4.5]) {
          ctx.beginPath();
          ctx.arc(cx, 13, 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ground(16.5);
      } else if (sup.kind === 'slide') {
        ctx.beginPath();
        ctx.moveTo(-9, 0);
        ctx.lineTo(9, 0);
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.lineWidth = 1.4;
        for (const cx of [-5, 5]) {
          ctx.beginPath();
          ctx.arc(cx, 4, 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ground(7.5);
      } else {
        // Spring: zigzag from the displaced node down to the ground.
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 3);
        for (let i = 0; i < 6; i++) ctx.lineTo(i % 2 ? -5 : 5, 5 + i * 2.6);
        ctx.lineTo(0, 21);
        ctx.lineTo(0, 24);
        ctx.stroke();
        ground(24, 11);
      }
      ctx.restore();
    }
  }

  private drawLoads(m: Model, sim: Sim, mag: number, pal: Palette): void {
    const ctx = this.ctx;
    const len = this.big ? 48 : 36;
    const showValues = settings.values || this.big;
    m.spec.loads.forEach((ld: LoadSpec, l: number) => {
      const on = sim.target[l] > 0.5;
      const col = on ? pal.load : pal.faint;
      if (ld.kind === 'point') {
        const [tx, ty] = this.pointOnMember(m, ld.member, ld.t, mag);
        const n = Math.hypot(ld.F[0], ld.F[1]) || 1;
        const dx = ld.F[0] / n;
        const dy = -ld.F[1] / n;
        const x2 = tx - dx * 3;
        const y2 = ty - dy * 3;
        const x1 = x2 - dx * len;
        const y1 = y2 - dy * len;
        arrow(ctx, x1, y1, x2, y2, col, on, this.big ? 2 : 1.7, this.big ? 10 : 8.5);
        this.hits.push({ l, kind: 'seg', x1, y1, x2, y2 });
        if (showValues) this.label(`${fmt(n)} kN`, x1 + (Math.abs(dx) > 0.5 ? 0 : 4), y1 + (Math.abs(dx) > 0.5 ? -9 : 2), col, pal, Math.abs(dx) > 0.5 ? 'center' : 'left', 0);
      } else if (ld.kind === 'moment') {
        const [cx, cy] = this.pointOnMember(m, ld.member, ld.t, mag);
        const r = this.big ? 16 : 13;
        momentArrow(ctx, cx, cy, r, ld.M > 0, col, on, this.big ? 1.9 : 1.6);
        this.hits.push({ l, kind: 'disc', x: cx, y: cy, r: r + 6 });
        if (showValues) this.label(`${fmt(Math.abs(ld.M))} kNm`, cx, cy - r - 9, col, pal, 'center', 0);
      } else if (ld.kind === 'line') {
        this.drawLineLoad(m, ld, l, mag, col, on, pal, showValues);
      } else {
        const v = ld.node;
        const px = this.nodeXY[2 * v];
        const py = this.nodeXY[2 * v + 1];
        const n = Math.hypot(ld.d[0], ld.d[1]) || 1;
        const dx = ld.d[0] / n;
        const dy = -ld.d[1] / n;
        const off = this.big ? 40 : 32;
        const x1 = px + dx * off;
        const y1 = py + dy * off;
        const x2 = x1 + dx * 16;
        const y2 = y1 + dy * 16;
        arrow(ctx, x1, y1, x2, y2, col, on, 1.6, 7);
        this.hits.push({ l, kind: 'seg', x1: x1 - dx * 8, y1: y1 - dy * 8, x2, y2 });
        this.label(`Δ ${fmt(n * 1000)} mm`, x2 + 6, y2 - 4, col, pal, 'left', 0);
      }
    });
  }

  private drawLineLoad(m: Model, ld: Extract<LoadSpec, { kind: 'line' }>, l: number, mag: number, col: string, on: boolean, pal: Palette, showValues: boolean): void {
    const ctx = this.ctx;
    const [t1, t2] = ld.span ?? [0, 1];
    const [r1, r2] = ld.ramp ?? [1, 1];
    const rmax = Math.max(Math.abs(r1), Math.abs(r2)) || 1;
    const maxLen = this.big ? 26 : 20;
    const spacing = this.big ? 17 : 14;
    let labelAt: Vec2 | null = null;
    for (const mi of ld.members) {
      const ids = m.memberElems[mi];
      const E0 = m.elems[ids[0]];
      const L = m.memberLength[mi];
      let dirX: number;
      let dirY: number;
      if (typeof ld.w === 'number') {
        const sg = Math.sign(ld.w) || 1;
        dirX = -E0.s * sg;
        dirY = E0.c * sg;
      } else {
        const n = Math.hypot(ld.w[0], ld.w[1]) || 1;
        dirX = ld.w[0] / n;
        dirY = ld.w[1] / n;
      }
      const sx = dirX;
      const sy = -dirY;
      const a = t1 * L;
      const b = t2 * L;
      const count = Math.max(2, Math.round(((b - a) * this.s) / spacing) + 1);
      const tails: Vec2[] = [];
      for (let k = 0; k < count; k++) {
        const x = a + ((b - a) * k) / (count - 1);
        const f = b > a ? r1 + ((r2 - r1) * (x - a)) / (b - a) : r1;
        const [px, py] = this.pointOnMember(m, mi, x / L, mag);
        const length = 5 + (maxLen - 5) * (Math.abs(f) / rmax);
        const x2 = px - sx * 2;
        const y2 = py - sy * 2;
        const x1 = x2 - sx * length;
        const y1 = y2 - sy * length;
        tails.push([x1, y1]);
        if (Math.abs(f) > 1e-9) arrow(ctx, x1, y1, x2, y2, col, on, 1.1, 5.5);
        this.hits.push({ l, kind: 'seg', x1: x1 - sx * 4, y1: y1 - sy * 4, x2, y2 });
      }
      ctx.save();
      ctx.beginPath();
      tails.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.3;
      if (!on) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.restore();
      if (!labelAt) {
        let best = tails[0];
        for (const p of tails) if (p[1] < best[1]) best = p;
        labelAt = best;
      }
    }
    if (showValues && labelAt) {
      const w = typeof ld.w === 'number' ? Math.abs(ld.w) : Math.hypot(ld.w[0], ld.w[1]);
      this.label(`${fmt(w * rmax)} kN/m`, labelAt[0], labelAt[1] - 8, col, pal, 'center', 0);
    }
  }

  private drawReactions(m: Model, sim: Sim, mag: number, pal: Palette): void {
    const ctx = this.ctx;
    const R = m.reactions(sim.u, sim.lambda);
    let scale = sim.refLoad;
    for (const sup of m.spec.supports) {
      for (let k = 0; k < 2; k++) scale = Math.max(scale, Math.abs(R[m.dof(sup.node, k)]));
      scale = Math.max(scale, Math.abs(R[m.dof(sup.node, 2)]) / m.size);
    }
    const k = this.big ? 1.2 : 1;
    for (const sup of m.spec.supports) {
      const v = sup.node;
      const px = this.X(m.nodes[v][0] + mag * sim.u[m.dof(v, 0)]);
      const py = this.Y(m.nodes[v][1] + mag * sim.u[m.dof(v, 1)]);
      const [fx, fy] = this.faceOf(m, sup);
      const below = Math.abs(fx) < 0.5 && fy < 0;
      const rx = R[m.dof(v, 0)];
      const ry = R[m.dof(v, 1)];
      const rz = R[m.dof(v, 2)];
      const tiny = 1e-6 * Math.max(scale, 1e-9);
      if (Math.abs(ry) > tiny) {
        const yNear = py + (below ? 30 : 18) * k;
        const yFar = yNear + 22 * k;
        const x = below ? px : px + (fx > 0 ? -1 : 1) * 0;
        if (ry > 0) arrow(ctx, x, yFar, x, yNear, pal.reaction, true, 1.7, 7);
        else arrow(ctx, x, yNear, x, yFar, pal.reaction, true, 1.7, 7);
        this.label(fmt(ry), x + 5, yFar - 2, pal.reaction, pal, 'left', 0);
      }
      if (Math.abs(rx) > tiny) {
        const y = py + (below ? 13 : 0) * k;
        const side = below ? -1 : fx !== 0 ? Math.sign(fx) : -1;
        const xNear = px + side * 18 * k;
        const xFar = xNear + side * 24 * k;
        if (Math.sign(rx) === -side) arrow(ctx, xFar, y, xNear, y, pal.reaction, true, 1.7, 7);
        else arrow(ctx, xNear, y, xFar, y, pal.reaction, true, 1.7, 7);
        this.label(fmt(rx), xFar, y - 9, pal.reaction, pal, 'center', 0);
      }
      if (Math.abs(rz) > tiny && sup.kind !== 'pin') {
        const r = 21 * k;
        momentArrow(ctx, px, py, r, rz > 0, pal.reaction, true, 1.5);
        this.label(`${fmt(rz)}`, px + r * 0.75, py - r - 4, pal.reaction, pal, 'left', 0);
      }
    }
  }

  private drawInflection(m: Model, sim: Sim, mag: number, pal: Palette): void {
    const ctx = this.ctx;
    let mMax = 0;
    const series: Array<Array<[number, number, number]>> = [];
    m.memberElems.forEach((ids) => {
      const s: Array<[number, number, number]> = [];
      for (const e of ids) {
        const E = m.elems[e];
        const loads = m.scaledLoads(e, sim.lambda);
        for (const [x, right] of this.samples(E, loads)) {
          internalAt(this.F[e], loads, x, right, R3);
          s.push([e, x, R3[2]]);
          mMax = Math.max(mMax, Math.abs(R3[2]));
        }
      }
      series.push(s);
    });
    const tol = 2e-3 * mMax;
    if (mMax < 1e-9) return;
    ctx.save();
    ctx.strokeStyle = pal.moment;
    ctx.fillStyle = pal.paper;
    ctx.lineWidth = 1.8;
    series.forEach((s, mi) => {
      const L = m.memberLength[mi];
      for (let i = 1; i < s.length; i++) {
        const [e0, x0, m0] = s[i - 1];
        const [e1, x1, m1] = s[i];
        if (e0 !== e1) continue;
        if (!((m0 > tol && m1 < -tol) || (m0 < -tol && m1 > tol))) continue;
        if (x1 - x0 < 1e-9) continue;
        const x = x0 + ((x1 - x0) * m0) / (m0 - m1);
        const xm = m.elems[e0].x0 + x;
        if (xm < 1e-3 * L || xm > L * (1 - 1e-3)) continue;
        const [cx, cy] = this.pos(m, e0, x, mag);
        ctx.beginPath();
        ctx.arc(cx, cy, this.big ? 5.5 : 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  private drawDeflectionLabel(m: Model, sim: Sim, mag: number, pal: Palette): void {
    let best = -1;
    let bestD = 0;
    for (let v = 0; v < m.nNode; v++) {
      const d = Math.hypot(sim.u[m.dof(v, 0)], sim.u[m.dof(v, 1)]);
      if (d > bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best < 0 || bestD * mag * this.s < 3) return;
    const x = this.nodeXY[2 * best];
    const y = this.nodeXY[2 * best + 1];
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = pal.ink;
    ctx.fill();
    const below = sim.u[m.dof(best, 1)] < 0;
    this.label(`δ ${fmt(bestD * 1000)} mm`, x + 6, y + (below ? 12 : -12), pal.ink, pal, 'left', 0);
  }

  private letterAt(v: number): Vec2 {
    return [this.nodeXY[2 * v] - 11, this.nodeXY[2 * v + 1] - 11];
  }

  /** Keep diagram labels clear of the node letters drawn later. */
  private reserveNodeLetters(m: Model): void {
    // nodeXY is filled before this is called.
    m.spec.nodes.forEach((_, v) => {
      const [x, y] = this.letterAt(v);
      this.labels.push([x - 6, y - 7, x + 6, y + 7]);
    });
  }

  private drawNodeLetters(m: Model, pal: Palette, sc: Scales | null): void {
    const ctx = this.ctx;
    ctx.font = `600 12px ${FONT_DATA}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    m.spec.nodes.forEach((_, v) => {
      const [x, y] = this.letterAt(v);
      const text = nodeLetter(v);
      ctx.lineWidth = 3;
      ctx.strokeStyle = pal.paper;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = pal.inkSoft;
      ctx.fillText(text, x, y);
    });
    if (sc) {
      ctx.font = `500 11px ${FONT_DATA}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = pal.inkSoft;
      ctx.fillText(`Deflections × ${fmt(sc.mag, 0)}`, 12, 10);
    }
  }

  private drawGrab(sim: Sim, pal: Palette): void {
    const g = sim.grab!;
    const m = sim.model;
    const ctx = this.ctx;
    const mag = this.scales().mag;
    const x = this.nodeXY[2 * g.node];
    const y = this.nodeXY[2 * g.node + 1];
    // Where the pointer holds the other end of the band.
    const px = this.X(m.nodes[g.node][0] + mag * g.disp[0]);
    const py = this.Y(m.nodes[g.node][1] + mag * g.disp[1]);
    ctx.save();
    ctx.strokeStyle = pal.pull;
    ctx.fillStyle = pal.pull;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
    const F = Math.hypot(g.force[0], g.force[1]);
    if (F > 1e-6 * Math.max(sim.refLoad, 1)) {
      const dx = g.force[0] / F;
      const dy = -g.force[1] / F;
      arrow(ctx, x + dx * 10, y + dy * 10, x + dx * 44, y + dy * 44, pal.pull, true, 2, 9);
      this.label(`${fmt(F)} kN`, x + dx * 54, y + dy * 54, pal.pull, pal, 'center', 0);
    }
    ctx.restore();
  }

  private drawHover(pal: Palette): void {
    const ctx = this.ctx;
    const x = this.nodeXY[2 * this.hover];
    const y = this.nodeXY[2 * this.hover + 1];
    if (!Number.isFinite(x)) return;
    ctx.save();
    ctx.strokeStyle = pal.pull;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── Interaction ─────────────────────────────────────────────

  private local(ev: PointerEvent | Touch): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private hitLoad(p: Vec2, tol: number): number {
    let best = -1;
    let bestD = tol;
    for (const h of this.hits) {
      const d = h.kind === 'seg' ? segDist(p, h.x1, h.y1, h.x2, h.y2) : Math.max(0, Math.hypot(p[0] - h.x, p[1] - h.y) - h.r);
      if (d < bestD) {
        bestD = d;
        best = h.l;
      }
    }
    return best;
  }

  private nearestNode(p: Vec2, tol: number): number {
    const sim = this.item.sim;
    if (!sim.ok) return -1;
    let best = -1;
    let bestD = tol;
    for (let v = 0; v < sim.model.nNode; v++) {
      const d = Math.hypot(p[0] - this.nodeXY[2 * v], p[1] - this.nodeXY[2 * v + 1]);
      if (d < bestD && sim.grabDofs(v).length) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private canGrab(): boolean {
    return this.item.sim.ok && !(settings.quiz && !this.item.revealed);
  }

  private onTouchStart = (ev: TouchEvent): void => {
    const t = ev.touches[0];
    if (!t || ev.touches.length > 1) return;
    const p = this.local(t);
    if (this.hitLoad(p, 18) >= 0 || (this.canGrab() && this.nearestNode(p, 30) >= 0)) ev.preventDefault();
  };

  private onDown = (ev: PointerEvent): void => {
    if (ev.button > 0 || this.press) return;
    const touch = ev.pointerType === 'touch';
    const p = this.local(ev);
    const l = this.hitLoad(p, touch ? 18 : 10);
    if (l >= 0) {
      this.press = { kind: 'load', id: ev.pointerId, l, start: p, moved: false };
      this.canvas.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      return;
    }
    if (!this.canGrab()) return;
    const node = this.nearestNode(p, touch ? 30 : 20);
    if (node < 0) return;
    const sim = this.item.sim;
    const nx = this.nodeXY[2 * node];
    const ny = this.nodeXY[2 * node + 1];
    if (!sim.startGrab(node)) return;
    this.press = { kind: 'grab', id: ev.pointerId, start: p, moved: false, offset: [nx - p[0], ny - p[1]] };
    this.canvas.setPointerCapture(ev.pointerId);
    this.canvas.style.cursor = 'grabbing';
    this.hover = -1;
    ev.preventDefault();
    this.item.changed();
    this.onInteract?.();
  };

  private onMove = (ev: PointerEvent): void => {
    const p = this.local(ev);
    const press = this.press;
    if (press && press.id === ev.pointerId) {
      if (press.kind === 'load') {
        if (!press.moved && Math.hypot(p[0] - press.start[0], p[1] - press.start[1]) < 6) return;
        press.moved = true;
        this.dragLoad(press.l!, p);
      } else {
        this.dragNode(p, press.offset!);
      }
      return;
    }
    if (ev.pointerType !== 'mouse') return;
    const l = this.hitLoad(p, 10);
    let hover = -1;
    if (l < 0 && this.canGrab()) hover = this.nearestNode(p, 20);
    this.canvas.style.cursor = l >= 0 ? 'pointer' : hover >= 0 ? 'grab' : 'default';
    if (hover !== this.hover) {
      this.hover = hover;
      this.item.changed();
    }
  };

  private onUp = (ev: PointerEvent): void => {
    const press = this.press;
    if (!press || press.id !== ev.pointerId) return;
    this.press = null;
    this.canvas.style.cursor = 'default';
    if (press.kind === 'load') {
      if (!press.moved && ev.type === 'pointerup') this.item.toggleLoad(press.l!);
      else this.item.staticChanged();
      this.onInteract?.();
    } else {
      this.item.sim.endGrab();
      this.item.kick();
    }
  };

  private onLeave = (): void => {
    if (this.hover >= 0 && !this.press) {
      this.hover = -1;
      this.item.changed();
    }
  };

  private dragLoad(l: number, p: Vec2): void {
    const sim = this.item.sim;
    const ld = sim.spec.loads[l];
    if ((ld.kind !== 'point' && ld.kind !== 'moment') || ld.draggable === false || !sim.ok) return;
    const spec = sim.spec;
    let best = { member: ld.member, t: ld.t, d: Infinity };
    spec.members.forEach((mem, mi) => {
      const ax = this.X(spec.nodes[mem.a][0]);
      const ay = this.Y(spec.nodes[mem.a][1]);
      const bx = this.X(spec.nodes[mem.b][0]);
      const by = this.Y(spec.nodes[mem.b][1]);
      const dx = bx - ax;
      const dy = by - ay;
      const L2 = dx * dx + dy * dy || 1;
      let t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + dx * t - p[0], ay + dy * t - p[1]);
      if (d < best.d) best = { member: mi, t, d };
    });
    const L = sim.model.memberLength[best.member];
    // Snap to 5 cm, and to the member ends when close.
    let t = Math.round((best.t * L) / 0.05) * (0.05 / L);
    if (t * L * this.s < 8) t = 0;
    if ((1 - t) * L * this.s < 8) t = 1;
    t = Math.max(0, Math.min(1, t));
    if (best.member === ld.member && Math.abs(t - ld.t) < 1e-9) return;
    sim.moveLoad(l, best.member, t);
    this.item.modified = true;
    this.item.changed();
  }

  private dragNode(p: Vec2, offset: Vec2): void {
    const sim = this.item.sim;
    const g = sim.grab;
    if (!g) return;
    const m = sim.model;
    const mag = this.scales().mag;
    const tx = (p[0] + offset[0] - this.ox) / this.s;
    const ty = (this.oy - (p[1] + offset[1])) / this.s;
    let dx = tx - m.nodes[g.node][0];
    let dy = ty - m.nodes[g.node][1];
    const lim = 0.3 * m.size;
    const n = Math.hypot(dx, dy);
    if (n > lim) {
      dx *= lim / n;
      dy *= lim / n;
    }
    sim.dragTo([dx / mag, dy / mag]);
    this.item.changed();
  }
}

function segDist(p: Vec2, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / L2));
  return Math.hypot(x1 + dx * t - p[0], y1 + dy * t - p[1]);
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, solid: boolean, width: number, head: number): void {
  const L = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / L;
  const uy = (y2 - y1) / L;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (!solid) ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx + ux * 1, by + uy * 1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(bx - uy * head * 0.45, by + ux * head * 0.45);
  ctx.lineTo(bx + uy * head * 0.45, by - ux * head * 0.45);
  ctx.closePath();
  if (solid) ctx.fill();
  else {
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

/** A three-quarter circle with an arrowhead: anticlockwise when `ccw`. */
function momentArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ccw: boolean, color: string, solid: boolean, width: number): void {
  const a0 = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  // Screen y points down, so a visually anticlockwise arc runs towards decreasing angle.
  const start = ccw ? a0 + sweep : a0;
  const end = ccw ? a0 : a0 + sweep;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  if (!solid) ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end, ccw);
  ctx.stroke();
  ctx.setLineDash([]);
  const ex = cx + r * Math.cos(end);
  const ey = cy + r * Math.sin(end);
  // Tangent direction of travel at the end of the arc.
  const tx = ccw ? Math.sin(end) : -Math.sin(end);
  const ty = ccw ? -Math.cos(end) : Math.cos(end);
  const head = 7;
  ctx.beginPath();
  ctx.moveTo(ex + tx * head * 0.6, ey + ty * head * 0.6);
  ctx.lineTo(ex - tx * head * 0.5 - ty * head * 0.45, ey - ty * head * 0.5 + tx * head * 0.45);
  ctx.lineTo(ex - tx * head * 0.5 + ty * head * 0.45, ey - ty * head * 0.5 - tx * head * 0.45);
  ctx.closePath();
  if (solid) ctx.fill();
  else ctx.stroke();
  ctx.restore();
}
