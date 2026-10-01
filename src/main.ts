import './styles.css';
import { EXAMPLES, SHEETS, examplesOn, findExample, type SheetId } from './examples';
import { Detail } from './ui/detail';
import { h, icon, ICONS } from './ui/dom';
import { Item } from './ui/item';
import { onSettings, settings, update, type DiagramKind, type ThemeChoice } from './ui/settings';
import { SheetView } from './ui/sheet';
import { applyTheme, onPaletteChange } from './ui/theme';

const items = new Map<string, Item>(EXAMPLES.map((ex) => [ex.id, new Item(ex)]));
let sheetView: SheetView | null = null;

// ── Shared controls ───────────────────────────────────────────

const DIAGRAMS: Array<[DiagramKind, string]> = [
  ['M', 'Moment'],
  ['V', 'Shear'],
  ['N', 'Axial'],
  ['none', 'None'],
];

function diagramControl(): HTMLElement {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Internal force diagram' });
  const sync = () => seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === settings.diagram)));
  for (const [kind, label] of DIAGRAMS) {
    seg.append(h('button', { type: 'button', dataset: { kind }, onclick: () => update({ diagram: kind }) }, label));
  }
  sync();
  onSettings(sync);
  return seg;
}

type Flag = 'reactions' | 'values' | 'inflection' | 'sameScale' | 'quiz';

function chip(flag: Flag, label: string, title: string): HTMLButtonElement {
  const b = h('button', { class: 'chip', type: 'button', title, onclick: () => update({ [flag]: !settings[flag] }) }, label);
  const sync = () => b.setAttribute('aria-pressed', String(settings[flag]));
  sync();
  onSettings(sync);
  return b;
}

// ── Layout ────────────────────────────────────────────────────

const app = document.getElementById('app')!;
app.className = 'app';

const sheetNo = h('span', { class: 'tb-value' });
const subject = h('span', { class: 'tb-value' });
const themeBtn = h('button', { class: 'icon-btn', type: 'button' });

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemeChoice, string> = { system: 'Theme: follows your system', light: 'Theme: light (computation pad)', dark: 'Theme: dark (blueprint)' };
function syncTheme(): void {
  themeBtn.replaceChildren(icon(settings.theme === 'light' ? ICONS.sun : settings.theme === 'dark' ? ICONS.moon : ICONS.auto));
  themeBtn.title = THEME_LABEL[settings.theme];
  themeBtn.setAttribute('aria-label', THEME_LABEL[settings.theme]);
}
themeBtn.addEventListener('click', () => update({ theme: THEME_NEXT[settings.theme] }));

const titleblock = h(
  'header',
  { class: 'titleblock' },
  h(
    'div',
    { class: 'tb-cell tb-name' },
    h('span', { class: 'tb-label' }, 'Project'),
    h('h1', { class: 'tb-value', style: { margin: '0' } }, 'Beam & Frame Sketchbook'),
    h('p', null, `${EXAMPLES.length} structures solved live by a finite element model. Push them, pull them, load them.`),
  ),
  h('div', { class: 'tb-cell' }, h('span', { class: 'tb-label' }, 'Sheet'), sheetNo),
  h('div', { class: 'tb-cell' }, h('span', { class: 'tb-label' }, 'Subject'), subject),
  h('div', { class: 'tb-cell tb-units' }, h('span', { class: 'tb-label' }, 'Units'), h('span', { class: 'tb-value' }, 'kN · m · mm')),
  h('div', { class: 'tb-cell tb-theme' }, themeBtn),
);

const tabs = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sheets' });
for (const s of SHEETS) {
  tabs.append(
    h(
      'button',
      { class: 'tab', type: 'button', role: 'tab', id: `tab-${s.id}`, dataset: { sheet: s.id }, onclick: () => showSheet(s.id, true) },
      s.title,
      h('span', null, String(examplesOn(s.id).length)),
    ),
  );
}

const toolbar = h(
  'div',
  { class: 'toolbar', role: 'toolbar', 'aria-label': 'Display' },
  h('div', { class: 'group' }, h('span', { class: 'group-label' }, 'Diagram'), diagramControl()),
  h(
    'div',
    { class: 'group' },
    h('span', { class: 'group-label' }, 'Show'),
    chip('reactions', 'Reactions', 'Support reactions with their values'),
    chip('values', 'Values', 'Peak values on the diagrams, load sizes and the largest deflection'),
    chip('inflection', 'Contraflexure', 'Mark the points where the bending moment changes sign'),
  ),
  h(
    'div',
    { class: 'group' },
    h('span', { class: 'group-label' }, 'Compare'),
    chip('sameScale', 'Same scale', 'Draw every structure on this sheet at one deflection and force scale, so you can compare them'),
    chip('quiz', 'Sketch first', 'Hide the answers: sketch the deflected shape and bending moment yourself, then reveal'),
  ),
  h(
    'div',
    { class: 'group' },
    h('button', { class: 'btn', type: 'button', onclick: () => sheetItems().forEach((it) => it.setAll(true)) }, 'Apply all loads'),
    h('button', { class: 'btn', type: 'button', onclick: () => sheetItems().forEach((it) => it.setAll(false)) }, 'Remove all'),
    h('button', { class: 'btn', type: 'button', onclick: () => sheetItems().forEach((it) => it.reset()) }, 'Reset sheet'),
  ),
);

const intro = h('p', { class: 'sheet-intro' });
const host = h('main', { id: 'sheet' });
const footnote = h(
  'footer',
  { class: 'footnote' },
  h('span', null, h('strong', null, 'Drag any structure'), ' to pull it, then let go and watch it spring back.'),
  h('span', null, h('strong', null, 'Tap a load'), ' to apply or remove it; drag it to move it.'),
  h('span', null, h('strong', null, 'Open a title'), ' for sliders, reactions and hand checks.'),
  h('span', null, 'Bending moment drawn on the tension side. Deflections exaggerated.'),
  h(
    'span',
    { class: 'legend' },
    ...([
      ['--moment', 'Moment'],
      ['--shear', 'Shear'],
      ['--tension', 'Tension'],
      ['--compression', 'Compression'],
      ['--load', 'Loads'],
      ['--reaction', 'Reactions'],
      ['--pull', 'Your pull'],
    ] as const).map(([v, label]) => h('span', null, h('i', { style: { background: `var(${v})` } }), label)),
  ),
);

app.append(titleblock, tabs, toolbar, intro, host, footnote);

function sheetItems(): Item[] {
  return examplesOn(settings.sheet).map((ex) => items.get(ex.id)!);
}

function showSheet(id: SheetId, pushHash = false): void {
  if (sheetView && settings.sheet === id) return;
  if (settings.sheet !== id) update({ sheet: id });
  const idx = SHEETS.findIndex((s) => s.id === id);
  const sheet = SHEETS[idx];
  sheetNo.textContent = `${idx + 1} of ${SHEETS.length}`;
  subject.textContent = sheet.title;
  tabs.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.sheet === id)));
  intro.replaceChildren(h('strong', null, `${examplesOn(id).length} structures. `), sheet.intro);
  sheetView?.destroy();
  sheetView = new SheetView(sheet, items, (item) => openDetail(item, true));
  host.replaceChildren(sheetView.el);
  if (pushHash) setHash(id);
}

// ── Detail view and links ─────────────────────────────────────

const detail = new Detail({
  controls: () =>
    h(
      'div',
      { class: 'group' },
      diagramControl(),
      chip('reactions', 'Reactions', 'Support reactions with their values'),
      chip('inflection', 'Contraflexure', 'Mark the points where the bending moment changes sign'),
    ),
  onClose: () => setHash(settings.sheet),
  onNavigate: (item) => setHash(item.ex.id),
});

function openDetail(item: Item, pushHash: boolean): void {
  detail.open(item, examplesOn(item.ex.sheet).map((ex) => items.get(ex.id)!));
  if (pushHash) setHash(item.ex.id);
}

function setHash(id: string): void {
  try {
    history.replaceState(null, '', `#${id}`);
  } catch {
    // Some embedded viewers refuse history changes; links simply won't update.
  }
}

function route(): void {
  const id = decodeURIComponent(location.hash.slice(1));
  const ex = id ? findExample(id) : undefined;
  if (ex) {
    showSheet(ex.sheet);
    openDetail(items.get(ex.id)!, false);
    return;
  }
  const sheet = SHEETS.find((s) => s.id === id);
  showSheet(sheet ? sheet.id : settings.sheet);
}

window.addEventListener('hashchange', route);

onSettings((changed) => {
  if ('theme' in changed) {
    applyTheme(settings.theme);
    syncTheme();
  }
  if ('quiz' in changed) for (const it of items.values()) it.revealed = false;
  sheetView?.refreshAll();
});

onPaletteChange(() => sheetView?.refreshAll());

applyTheme(settings.theme);
syncTheme();
route();
document.fonts?.ready.then(() => sheetView?.refreshAll());
