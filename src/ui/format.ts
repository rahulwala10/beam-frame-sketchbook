const MINUS = '−';

/** Engineering-friendly number: three significant figures, typographic minus. */
export function fmt(v: number, digits?: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a < 5e-10) return '0';
  const d = digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3);
  const s = a.toFixed(d);
  if (Number(s) === 0) return '0';
  return (v < 0 ? MINUS : '') + s;
}

export const kN = (v: number) => `${fmt(v)} kN`;
export const kNm = (v: number) => `${fmt(v)} kNm`;
export const mm = (metres: number) => `${fmt(metres * 1000)} mm`;

export function unitValue(v: number, unit: string): string {
  return `${fmt(v)} ${unit}`;
}

/** Letters for structure nodes: A, B, … Z, AA, AB … */
export function nodeLetter(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
