import { determinacy, type Determinacy } from '../engine/determinacy';
import { analyze, type Analysis } from '../engine/results';
import { Sim } from '../engine/sim';
import type { Spec } from '../engine/types';
import { defaults, type Example, type Params } from '../examples/types';
import { animate, invalidate } from './ticker';
import { reducedMotion } from './settings';

export interface ItemView {
  draw(): void;
}

/** One example on a sheet: its parameters, its live simulation and the views showing it. */
export class Item {
  readonly ex: Example;
  params: Params;
  revealed = false;
  modified = false;
  private _sim: Sim | null = null;
  private _original: Spec | null = null;
  private _det: Determinacy | null = null;
  private views = new Set<ItemView>();
  private analysisCache: { key: string; a: Analysis } | null = null;
  private listeners = new Set<() => void>();

  constructor(ex: Example) {
    this.ex = ex;
    this.params = defaults(ex);
  }

  get sim(): Sim {
    if (!this._sim) this.build();
    return this._sim!;
  }

  get built(): boolean {
    return this._sim !== null;
  }

  /** The spec as the example first builds it, to tell whether loads have been moved. */
  get original(): Spec {
    if (!this._original) this._original = this.ex.build(this.params);
    return this._original;
  }

  get determinacy(): Determinacy {
    if (!this._det) this._det = determinacy(this.original);
    return this._det;
  }

  private build(keepLoads?: boolean[]): void {
    const spec = this.ex.build(this.params);
    if (keepLoads) spec.loads.forEach((ld, l) => (ld.on = keepLoads[l] ?? ld.on));
    this._original = this.ex.build(this.params);
    this._det = determinacy(this._original);
    this._sim = new Sim(spec);
    this.analysisCache = null;
  }

  setParam(key: string, value: number | string): void {
    this.params = { ...this.params, [key]: value };
    const on = this._sim ? Array.from(this._sim.target, (v) => v > 0.5) : undefined;
    this.build(on);
    this.modified = true;
    this.changed(true);
  }

  reset(): void {
    this.params = defaults(this.ex);
    this.modified = false;
    this.revealed = false;
    this.build();
    this.changed(true);
  }

  /** Static analysis for the loads currently switched on (cached). */
  analysis(): Analysis {
    const sim = this.sim;
    const key = `${sim.staticRev}`;
    if (!this.analysisCache || this.analysisCache.key !== key) {
      this.analysisCache = { key, a: analyze(sim.model, sim.staticU(), sim.target) };
    }
    return this.analysisCache.a;
  }

  toggleLoad(l: number): void {
    const sim = this.sim;
    sim.setLoad(l, sim.target[l] < 0.5, !reducedMotion());
    this.modified = true;
    this.kick();
    this.staticChanged();
  }

  setAll(on: boolean): void {
    const sim = this.sim;
    if (!sim.ok) return;
    sim.setAll(on, !reducedMotion());
    this.kick();
    this.staticChanged();
  }

  /** Reveal in quiz mode: drop the loads on from zero so you can watch it happen. */
  reveal(): void {
    this.revealed = true;
    const sim = this.sim;
    if (sim.ok) {
      const on = Array.from(sim.target, (v) => v > 0.5);
      sim.setAll(false, false);
      on.forEach((v, l) => v && sim.setLoad(l, true, !reducedMotion()));
    }
    this.kick();
    this.staticChanged();
  }

  /** Start animating if the simulation is moving, and redraw. */
  kick(): void {
    if (reducedMotion() && this._sim && !this._sim.grab) this._sim.snapToStatic();
    if (this._sim && !this._sim.resting) animate(this);
    this.changed(false);
  }

  attach(view: ItemView): void {
    this.views.add(view);
  }

  detach(view: ItemView): void {
    this.views.delete(view);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Redraw views; `structural` means geometry or parameters changed. */
  changed(structural = false): void {
    for (const v of this.views) invalidate(v);
    if (structural) for (const fn of this.listeners) fn();
  }

  /** Called by the ticker after each animation frame. */
  frame(): void {
    for (const v of this.views) invalidate(v);
  }

  /** Called when the static answer may have changed (detail panels listen). */
  staticChanged(): void {
    for (const fn of this.listeners) fn();
  }
}
