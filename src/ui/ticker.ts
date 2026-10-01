import type { Item, ItemView } from './item';

/** One requestAnimationFrame loop for every moving structure and every view that needs a redraw. */
const moving = new Set<Item>();
const dirty = new Set<ItemView>();
let handle = 0;
let last = 0;

function schedule(): void {
  if (!handle) handle = requestAnimationFrame(frame);
}

function frame(ts: number): void {
  handle = 0;
  const frames = last ? Math.min(3, Math.max(1, Math.round((ts - last) / (1000 / 60)))) : 1;
  last = ts;
  for (const item of moving) {
    const still = item.sim.advance(frames);
    item.frame();
    if (!still) {
      moving.delete(item);
      item.staticChanged();
    }
  }
  for (const v of dirty) v.draw();
  dirty.clear();
  if (moving.size) schedule();
  else last = 0;
}

export function animate(item: Item): void {
  moving.add(item);
  schedule();
}

export function invalidate(view: ItemView): void {
  dirty.add(view);
  schedule();
}

export function isMoving(item: Item): boolean {
  return moving.has(item);
}
