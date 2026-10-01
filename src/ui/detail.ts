import { describeDeterminacy } from '../engine/determinacy';
import type { LoadSpec, SupportKind } from '../engine/types';
import { equilibrium, makeContext } from '../examples/context';
import { SHEETS } from '../examples';
import type { Param, RangeParam } from '../examples/types';
import { beamCharts, isBeam } from './charts';
import { h, icon, ICONS } from './dom';
import { fmt, nodeLetter } from './format';
import type { Item } from './item';
import { onSettings, settings } from './settings';
import { ownScales, StructureView } from './view';

const SUPPORT_NAMES: Record<SupportKind, string> = {
  fixed: 'Fixed',
  pin: 'Pin',
  roller: 'Roller',
  wallRoller: 'Roller',
  slide: 'Sliding clamp',
  spring: 'Spring',
};

export interface DetailHost {
  /** Diagram, reactions and inflection controls, kept in sync with the toolbar. */
  controls(): HTMLElement;
  onClose(): void;
  onNavigate(item: Item): void;
}

export class Detail {
  private host: DetailHost;
  private root: HTMLElement | null = null;
  private view: StructureView | null = null;
  private item: Item | null = null;
  private list: Item[] = [];
  private results: HTMLElement | null = null;
  private loadsBox: HTMLElement | null = null;
  private unsub: (() => void) | null = null;
  private pending = 0;
  private lastFocus: Element | null = null;

  constructor(host: DetailHost) {
    this.host = host;
    onSettings(() => this.schedule());
    document.addEventListener('keydown', this.onKey);
  }

  get openItem(): Item | null {
    return this.item;
  }

  open(item: Item, list: Item[]): void {
    if (!this.root) this.lastFocus = document.activeElement;
    this.teardown();
    this.item = item;
    this.list = list;
    const ex = item.ex;
    const sheet = SHEETS.find((s) => s.id === ex.sheet)!;
    const idx = list.indexOf(item);
    const canvas = h('canvas', { 'aria-label': `${ex.title}: interactive model`, role: 'img' });
    this.results = h('div', { class: 'detail-results', style: { display: 'grid', gap: '18px' } });
    this.loadsBox = h('div', { class: 'loadlist' });

    const head = h(
      'header',
      { class: 'detail-head' },
      h('div', { style: { minWidth: '0' } }, h('span', { class: 'eyebrow' }, `${sheet.title} · ${idx + 1} of ${list.length}`), h('h2', { id: 'detail-title' }, ex.title)),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Previous structure', 'aria-label': 'Previous structure', onclick: () => this.step(-1) }, icon(ICONS.prev)),
      h('button', { class: 'icon-btn', type: 'button', title: 'Next structure', 'aria-label': 'Next structure', onclick: () => this.step(1) }, icon(ICONS.next)),
      h('button', { class: 'icon-btn', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => this.close() }, icon(ICONS.close)),
    );

    const stage = h(
      'div',
      { class: 'detail-stage' },
      h('div', { class: 'stage' }, canvas),
      h(
        'div',
        { class: 'detail-tools' },
        this.host.controls(),
        h('button', { class: 'btn', type: 'button', onclick: () => item.reset() }, 'Reset this structure'),
      ),
    );

    const info = h(
      'div',
      { class: 'detail-info' },
      h('p', null, ex.blurb),
      h('section', null, h('h3', null, 'Look for'), h('ul', null, ...ex.notes.map((n) => h('li', null, n)))),
      ex.params?.length ? h('section', null, h('h3', null, 'Adjust'), this.paramControls(item, ex.params)) : null,
      h('section', null, h('h3', null, 'Loads'), this.loadsBox, h('p', { class: 'small', style: { marginTop: '6px' } }, 'Tap a load to apply or remove it. On the drawing you can also drag point loads and couples along the members.')),
      this.results,
    );

    const panel = h('section', { class: 'sheetpanel paper', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'detail-title', tabindex: '-1' }, head, stage, info);
    if (!this.root) {
      this.root = h('div', { class: 'detail' });
      this.root.addEventListener('pointerdown', (ev) => {
        if (ev.target === this.root) this.close();
      });
      document.body.append(this.root);
      document.body.style.overflow = 'hidden';
    }
    this.root.replaceChildren(panel);
    this.view = new StructureView(canvas, item, { big: true, scales: () => ownScales(item.sim, item.ex.exaggerate) });
    this.view.onInteract = () => this.schedule();
    this.unsub = item.onChange(() => this.schedule());
    this.renderDynamic();
    panel.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.root) return;
    this.teardown();
    this.root.remove();
    this.root = null;
    document.body.style.overflow = '';
    this.host.onClose();
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus({ preventScroll: true });
  }

  private teardown(): void {
    this.view?.destroy();
    this.view = null;
    this.unsub?.();
    this.unsub = null;
    this.item = null;
  }

  private step(d: number): void {
    if (!this.item) return;
    const i = this.list.indexOf(this.item);
    const next = this.list[(i + d + this.list.length) % this.list.length];
    this.open(next, this.list);
    this.host.onNavigate(next);
  }

  private onKey = (ev: KeyboardEvent): void => {
    if (!this.root) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
      return;
    }
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (ev.key === 'ArrowRight') this.step(1);
    else if (ev.key === 'ArrowLeft') this.step(-1);
  };

  private schedule(): void {
    if (this.pending || !this.item) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.renderDynamic();
    });
  }

  private paramControls(item: Item, params: Param[]): HTMLElement {
    const box = h('div', { class: 'params' });
    for (const p of params) {
      const id = `param-${item.ex.id}-${p.key}`;
      if ('options' in p) {
        const seg = h('div', { class: 'seg', role: 'group', 'aria-label': p.label });
        for (const o of p.options) {
          seg.append(
            h('button', { type: 'button', 'aria-pressed': String(item.params[p.key] === o.value), onclick: () => {
              item.setParam(p.key, o.value);
              seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === o.label)));
            } }, o.label),
          );
        }
        box.append(h('div', { class: 'param' }, h('label', null, p.label), seg));
        continue;
      }
      const rp = p as RangeParam;
      const toSlider = (v: number) => (rp.log ? Math.log10(v) : v);
      const fromSlider = (s: number) => (rp.log ? niceLog(10 ** s) : s);
      const out = h('output', { for: id }, display(rp, Number(item.params[rp.key])));
      const input = h('input', {
        id,
        type: 'range',
        min: toSlider(rp.min),
        max: toSlider(rp.max),
        step: rp.log ? 0.01 : rp.step,
        value: toSlider(Number(item.params[rp.key])),
      });
      input.addEventListener('input', () => {
        const v = fromSlider(Number(input.value));
        out.textContent = display(rp, v);
        item.setParam(rp.key, v);
      });
      box.append(h('div', { class: 'param' }, h('label', { for: id }, rp.label), out, input));
    }
    return box;
  }

  private renderDynamic(): void {
    const item = this.item;
    if (!item || !this.results || !this.loadsBox) return;
    const sim = item.sim;
    this.loadsBox.replaceChildren(
      ...sim.spec.loads.map((ld, l) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(sim.target[l] > 0.5), onclick: () => item.toggleLoad(l) }, describeLoad(ld)),
      ),
    );
    if (!sim.ok) {
      this.results.replaceChildren(h('p', { class: 'small' }, sim.error ?? ''));
      return;
    }
    if (settings.quiz && !item.revealed) {
      this.results.replaceChildren(
        h(
          'section',
          null,
          h('h3', null, 'Sketch first'),
          h('p', null, 'Sketch the deflected shape and the bending moment diagram, and estimate the reactions. Then reveal the answer.'),
          h('button', { class: 'btn primary', type: 'button', style: { marginTop: '10px' }, onclick: () => item.reveal() }, 'Reveal'),
        ),
      );
      return;
    }
    const m = sim.model;
    const a = item.analysis();
    const spec = sim.spec;
    const ctx = makeContext(item.params, spec, item.original, m, a, sim.target);
    const blocks: HTMLElement[] = [];

    // Reactions.
    const rows = a.reactions.map((r) => {
      const sup = spec.supports.find((s) => s.node === r.node)!;
      const cell = (k: number) => h('td', { class: 'num' }, r.has[k] ? fmt(r.R[k]) : '–');
      return h('tr', null, h('td', null, `${nodeLetter(r.node)} · ${SUPPORT_NAMES[sup.kind]}`), cell(0), cell(1), cell(2));
    });
    blocks.push(
      h(
        'section',
        null,
        h('h3', null, 'Reactions'),
        h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Support'), h('th', null, 'H kN'), h('th', null, 'V kN'), h('th', null, 'M kNm'))), h('tbody', null, ...rows))),
        h('p', { class: 'small', style: { marginTop: '6px' } }, 'Forces on the structure: H positive to the right, V positive upwards, M positive anticlockwise.'),
      ),
    );

    // Peaks.
    const where = (mi: number, x: number) => {
      const mem = spec.members[mi];
      return `${nodeLetter(mem.a)}${nodeLetter(mem.b)}, ${fmt(x)} m from ${nodeLetter(mem.a)}`;
    };
    const ex = a.extremes;
    const facts: Array<[string, string, string]> = [];
    const mTiny = 1e-6 * Math.max(sim.refLoad * m.size, 1);
    if (isBeam(spec)) {
      if (ex.sag.member >= 0 && ex.sag.value > mTiny) facts.push(['Largest sagging moment', `${fmt(ex.sag.value)} kNm`, where(ex.sag.member, ex.sag.x)]);
      if (ex.hog.member >= 0 && ex.hog.value < -mTiny) facts.push(['Largest hogging moment', `${fmt(ex.hog.value)} kNm`, where(ex.hog.member, ex.hog.x)]);
    } else {
      const big = ex.sag.value >= -ex.hog.value ? ex.sag : ex.hog;
      if (big.member >= 0 && Math.abs(big.value) > mTiny) facts.push(['Largest bending moment', `${fmt(Math.abs(big.value))} kNm`, where(big.member, big.x)]);
    }
    if (ex.shear.member >= 0 && Math.abs(ex.shear.value) > 1e-6 * Math.max(sim.refLoad, 1)) facts.push(['Largest shear', `${fmt(Math.abs(ex.shear.value))} kN`, where(ex.shear.member, ex.shear.x)]);
    const axialFloor = 1e-6 * Math.max(sim.refLoad, Math.abs(ex.shear.value), 1);
    if (ex.tension.member >= 0 && ex.tension.value > axialFloor) facts.push(['Largest tension', `${fmt(ex.tension.value)} kN`, where(ex.tension.member, ex.tension.x)]);
    if (ex.compression.member >= 0 && ex.compression.value < -axialFloor) facts.push(['Largest compression', `${fmt(-ex.compression.value)} kN`, where(ex.compression.member, ex.compression.x)]);
    if (ex.disp.member >= 0) facts.push(['Largest deflection', `${fmt(ex.disp.value * 1000)} mm`, where(ex.disp.member, ex.disp.x)]);
    if (a.contraflexure.length) facts.push(['Points of contraflexure', String(a.contraflexure.length), a.contraflexure.slice(0, 3).map((c) => where(c.member, c.x)).join('; ') + (a.contraflexure.length > 3 ? '…' : '')]);
    blocks.push(
      h(
        'section',
        null,
        h('h3', null, 'Peaks'),
        h('dl', { class: 'facts' }, ...facts.flatMap(([k, v, w]) => [h('dt', null, k), h('dd', null, v, h('span', { class: 'small', style: { fontFamily: 'var(--font-body)' } }, `  ${w}`))])),
      ),
    );

    // Hand checks.
    if (item.ex.checks) {
      const checks = item.ex.checks(ctx);
      const sec = h('section', null, h('h3', null, 'Hand checks'));
      if (!checks.length) {
        sec.append(h('p', { class: 'small' }, 'The textbook formulas assume the original loads in their original places. Switch them back on, or reset the structure, to compare.'));
      } else {
        const body = checks.map((c) => {
          const diff = Math.abs(c.actual - c.expected) / Math.max(Math.abs(c.expected), 1e-9);
          const v = diff < 0.005 ? 'ok' : diff < 0.05 ? 'near' : 'off';
          const mark = v === 'ok' ? '✓' : v === 'near' ? '≈' : '✗';
          return h(
            'tr',
            { title: c.note ?? '' },
            h('td', { class: 'label' }, c.label),
            h('td', { class: 'formula' }, c.formula),
            h('td', { class: 'num' }, `${fmt(c.expected)} ${c.unit}`),
            h('td', { class: 'num' }, `${fmt(c.actual)} ${c.unit}`),
            h('td', { class: 'num' }, h('span', { class: 'verdict', 'data-v': v }, `${mark} ${fmt(diff * 100, diff < 0.0995 ? 2 : 1)}%`)),
          );
        });
        sec.append(
          h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Quantity'), h('th', { style: { textAlign: 'left' } }, 'Formula'), h('th', null, 'Textbook'), h('th', null, 'This model'), h('th', null, 'Diff.'))), h('tbody', null, ...body))),
        );
        const notes = [...new Set(checks.map((c) => c.note).filter(Boolean))] as string[];
        for (const n of notes) sec.append(h('p', { class: 'small', style: { marginTop: '6px' } }, n));
      }
      blocks.push(sec);
    }

    // Beam diagrams.
    if (isBeam(spec)) blocks.push(h('section', { class: 'charts' }, h('h3', null, 'Diagrams along the beam'), beamCharts(m, a)));

    // Equilibrium and model facts.
    const eq = equilibrium(m, a, sim.target);
    const det = item.determinacy;
    const sc = ownScales(sim);
    blocks.push(
      h(
        'section',
        null,
        h('h3', null, 'Model'),
        h(
          'dl',
          { class: 'facts' },
          h('dt', null, 'Determinacy'),
          h('dd', null, `${describeDeterminacy(det)}: 3m + r − 3j − c = 3·${det.m} + ${det.r} − 3·${det.j} − ${det.c} = ${det.degree}`),
          h('dt', null, 'Equilibrium'),
          h('dd', null, `ΣH ${fmt(eq.fx, 4)} kN · ΣV ${fmt(eq.fy, 4)} kN · ΣM ${fmt(eq.m, 3)} kNm`),
          h('dt', null, 'Finite elements'),
          h('dd', null, `${m.elems.length} Euler–Bernoulli elements, ${m.nDof - countMask(m.mask)} free DOFs`),
          h('dt', null, 'Natural period'),
          h('dd', null, `T₁ = ${fmt(sim.T1, 3)} s (springback runs in slow motion)`),
          h('dt', null, 'Drawing scale'),
          h('dd', null, `Deflections × ${fmt(sc.mag, 0)}`),
          h('dt', null, 'Section'),
          h('dd', null, `E = 200 GPa; EI ${fmt(Math.min(...spec.members.map((mm) => mm.EI ?? 40000)), 0)}–${fmt(Math.max(...spec.members.map((mm) => mm.EI ?? 40000)), 0)} kN·m²`),
        ),
      ),
    );
    this.results.replaceChildren(...blocks);
  }
}

function countMask(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

function niceLog(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.round(v / p * 10) / 10 * p;
}

function display(p: RangeParam, v: number): string {
  const text = p.log ? (v >= 1000 ? Math.round(v).toLocaleString('en-GB') : fmt(v)) : fmt(v, p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : 2);
  return p.unit ? `${text} ${p.unit}` : text;
}

function describeLoad(ld: LoadSpec): string {
  const name = ld.label;
  if (ld.kind === 'point') {
    const F = Math.hypot(ld.F[0], ld.F[1]);
    const dir = Math.abs(ld.F[0]) > Math.abs(ld.F[1]) ? 'sideways' : ld.F[1] < 0 ? 'down' : 'up';
    return `${name ?? 'Point load'} · ${fmt(F)} kN ${dir}`;
  }
  if (ld.kind === 'moment') return `${name ?? 'Couple'} · ${fmt(Math.abs(ld.M))} kNm ${ld.M > 0 ? 'anticlockwise' : 'clockwise'}`;
  if (ld.kind === 'line') {
    const w = typeof ld.w === 'number' ? Math.abs(ld.w) : Math.hypot(ld.w[0], ld.w[1]);
    const r = ld.ramp ? Math.max(...ld.ramp.map(Math.abs)) : 1;
    const shape = ld.ramp && ld.ramp[0] !== ld.ramp[1] ? 'peak' : 'uniform';
    return `${name ?? 'Distributed load'} · ${fmt(w * r)} kN/m ${shape}`;
  }
  return `${name ?? 'Settlement'} · ${fmt(Math.hypot(ld.d[0], ld.d[1]) * 1000)} mm`;
}

