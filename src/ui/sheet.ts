import { examplesOn, type Sheet } from '../examples';
import { h } from './dom';
import type { Item } from './item';
import { settings } from './settings';
import { ownScales, StructureView, type Scales } from './view';

/** Preferred canvas height from the structure's proportions (rows stretch to the tallest card). */
function preferredHeight(item: Item): number {
  const spec = item.original;
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
  const aspect = (maxY - minY) / Math.max(maxX - minX, 1e-6);
  return Math.round(Math.min(380, Math.max(200, 300 * aspect + 110)));
}

export class Card {
  readonly el: HTMLElement;
  readonly item: Item;
  private canvas: HTMLCanvasElement;
  private scalesFn: () => Scales;
  private view: StructureView | null = null;
  private reveal: HTMLButtonElement;
  private error: HTMLParagraphElement;

  constructor(item: Item, scales: () => Scales, open: (item: Item) => void) {
    this.item = item;
    this.canvas = h('canvas', { 'aria-label': `${item.ex.title}. Drag the structure to pull it; tap a load arrow to apply or remove it.`, role: 'img' });
    this.reveal = h('button', { class: 'btn primary hint', type: 'button', onclick: () => item.reveal() }, 'Reveal');
    this.error = h('p', { class: 'error', role: 'status' });
    const det = item.determinacy;
    const si = h(
      'span',
      { class: 'si', title: det.degree === 0 ? 'Statically determinate' : `Statically indeterminate to degree ${det.degree}`, 'data-zero': String(det.degree === 0) },
      `SI ${det.degree}`,
    );
    const stage = h('div', { class: 'stage', style: { minHeight: `${preferredHeight(item)}px` } }, this.canvas, this.reveal, this.error);
    this.el = h(
      'article',
      { class: 'card', id: `card-${item.ex.id}` },
      stage,
      h('div', { class: 'caption' }, h('button', { type: 'button', onclick: () => open(item), title: 'Open the details, sliders and hand checks' }, item.ex.title), si),
    );
    this.el.addEventListener('dblclick', (ev) => {
      if ((ev.target as HTMLElement).tagName !== 'CANVAS') open(item);
    });
    this.scalesFn = scales;
    this.refresh();
  }

  activate(): void {
    if (this.view) return;
    this.view = new StructureView(this.canvas, this.item, { scales: this.scalesFn });
    this.view.draw();
    this.refresh();
  }

  get active(): boolean {
    return this.view !== null;
  }

  refresh(): void {
    const hidden = settings.quiz && !this.item.revealed;
    this.reveal.hidden = !hidden || !this.view;
    const err = this.view && !this.item.sim.ok ? this.item.sim.error : null;
    this.error.textContent = err ?? '';
    this.error.hidden = !err;
    this.view?.draw();
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
  }
}

export class SheetView {
  readonly el: HTMLElement;
  readonly cards: Card[];
  private io: IntersectionObserver;
  private shared: Scales | null = null;
  private unsub: Array<() => void> = [];

  constructor(sheet: Sheet, items: Map<string, Item>, open: (item: Item) => void) {
    const list = examplesOn(sheet.id).map((ex) => items.get(ex.id)!);
    this.cards = list.map((item) => new Card(item, () => this.scalesFor(item), open));
    this.el = h('div', { class: 'cards' }, ...this.cards.map((c) => c.el));
    this.io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const card = this.cards.find((c) => c.el === en.target);
          card?.activate();
        }
      },
      { rootMargin: '400px 0px' },
    );
    for (const c of this.cards) {
      this.io.observe(c.el);
      this.unsub.push(c.item.onChange(() => {
        this.shared = null;
        c.refresh();
      }));
    }
    // Visible cards come first through the observer; then fill in the rest, one per frame.
    const pump = () => {
      if (this.destroyed) return;
      const next = this.cards.find((c) => !c.active);
      if (!next) return;
      next.activate();
      this.timer = window.setTimeout(pump, 24);
    };
    this.timer = window.setTimeout(pump, 120);
  }

  private timer = 0;
  private destroyed = false;

  /** With "same scale" on, every card uses the smallest magnification on the sheet so sizes compare directly. */
  private scalesFor(item: Item): Scales {
    if (!settings.sameScale) return ownScales(item.sim, item.ex.exaggerate);
    if (!this.shared) {
      const all = this.cards.filter((c) => c.item.sim.ok).map((c) => ownScales(c.item.sim, c.item.ex.exaggerate));
      this.shared = {
        mag: Math.min(...all.map((s) => s.mag)),
        diag: {
          M: Math.min(...all.map((s) => s.diag.M)),
          V: Math.min(...all.map((s) => s.diag.V)),
          N: Math.min(...all.map((s) => s.diag.N)),
        },
      };
    }
    return this.shared;
  }

  refreshAll(): void {
    this.shared = null;
    for (const c of this.cards) c.refresh();
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.io.disconnect();
    for (const u of this.unsub) u();
    for (const c of this.cards) c.destroy();
  }
}
