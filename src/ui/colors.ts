/*
 * Chain colours, generated per DESIGN.md: golden-angle hue, lightness solved until the ink
 * clears the contrast target on the hardest stock, a highlighter wash that body ink clears too.
 * Colour is never the only signal, so each chain also gets a marker shape, a line style and a letter.
 */

export interface Oklch {
  readonly L: number;
  readonly C: number;
  readonly h: number;
}

export interface Marker {
  readonly name: string;
  readonly d: string;
}

export interface ChainColor {
  readonly index: number;
  readonly label: string;
  readonly hue: number;
  readonly ink: Oklch;
  readonly wash: Oklch;
  readonly inkCss: string;
  readonly washCss: string;
  readonly marker: Marker;
  /** A text-decoration-style name: also drives the underline in the read view. */
  readonly lineStyle: LineStyle;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'wavy' | 'double';

const GOLDEN_ANGLE = 137.50776405;
const START_HUE = 354;
/** WCAG AA is 4.5; the margin absorbs 8-bit rounding in the rendered colour. */
const TARGET_CONTRAST = 4.7;

const MARKERS: readonly Marker[] = [
  { name: 'circle', d: 'M-4.4 0a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0Z' },
  { name: 'square', d: 'M-3.8 -3.8H3.8V3.8H-3.8Z' },
  { name: 'triangle', d: 'M0 -5.2L5 3.8H-5Z' },
  { name: 'diamond', d: 'M0 -5.6L5.6 0L0 5.6L-5.6 0Z' },
  { name: 'plus', d: 'M-1.7 -5.2H1.7V-1.7H5.2V1.7H1.7V5.2H-1.7V1.7H-5.2V-1.7H-1.7Z' },
  { name: 'cross', d: 'M-3.6 -5.6L0 -2L3.6 -5.6L5.6 -3.6L2 0L5.6 3.6L3.6 5.6L0 2L-3.6 5.6L-5.6 3.6L-2 0L-5.6 -3.6Z' },
  { name: 'hexagon', d: 'M-2.7 -4.7H2.7L5.4 0L2.7 4.7H-2.7L-5.4 0Z' },
  { name: 'spark', d: 'M0 -6L1.6 -1.6L6 0L1.6 1.6L0 6L-1.6 1.6L-6 0L-1.6 -1.6Z' },
];

const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted', 'wavy', 'double'];

/* ── OKLCH maths ─────────────────────────────────────────── */

type Rgb = readonly [number, number, number];

function oklchToLinear({ L, C, h }: Oklch): Rgb {
  const r = (h * Math.PI) / 180;
  const a = C * Math.cos(r);
  const b = C * Math.sin(r);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: Rgb): boolean => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

const luminanceOfLinear = ([r, g, b]: Rgb): number => {
  const c = (v: number): number => Math.min(1, Math.max(0, v));
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};

const luminance = (c: Oklch): number => luminanceOfLinear(oklchToLinear(c));

const ratioOfLuminance = (y1: number, y2: number): number => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);

const contrast = (a: Oklch, b: Oklch): number => ratioOfLuminance(luminance(a), luminance(b));

/** A chain colour can land on any stock, so it has to pass on the hardest one. */
const worstContrast = (c: Oklch, surfaces: readonly Oklch[]): number => Math.min(...surfaces.map((s) => contrast(c, s)));

/** Largest chroma that still fits sRGB at this lightness and hue. */
function maxChroma(L: number, h: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ L, C: mid, h }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

const formatOklch = (c: Oklch): string => `oklch(${c.L.toFixed(3)} ${c.C.toFixed(3)} ${c.h.toFixed(1)})`;

function parseOklch(css: string): Oklch | null {
  const m = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(css);
  if (!m) return null;
  const L = m[1]!.endsWith('%') ? parseFloat(m[1]!) / 100 : parseFloat(m[1]!);
  return { L, C: parseFloat(m[2]!), h: parseFloat(m[3]!) };
}

/* ── Solvers ─────────────────────────────────────────────── */

/** Lightest ink at this hue that still clears the target on every stock. */
function solveInk(h: number, chroma: number, surfaces: readonly Oklch[], nudge: number): Oklch {
  const fit = (L: number): Oklch => ({ L, C: Math.min(chroma, maxChroma(L, h) * 0.97), h });
  let ink: Oklch = { L: 0.2, C: 0.02, h };
  for (let i = 0, L = 0.8; i < 120; i++, L -= 0.005) {
    const c = fit(L);
    if (worstContrast(c, surfaces) >= TARGET_CONTRAST) {
      ink = c;
      break;
    }
  }
  if (nudge) {
    // Alternate chains sit a touch deeper so neighbours differ in value as well as hue.
    ink = fit(ink.L - nudge);
    while (worstContrast(ink, surfaces) < TARGET_CONTRAST && ink.L > 0.1) ink = fit(ink.L - 0.005);
  }
  return ink;
}

/** Highlighter fill that the page's body ink can sit on at the target contrast. */
function solveWash(h: number, text: Oklch): Oklch {
  let L = 0.87;
  let c: Oklch = { L, C: 0, h };
  for (let i = 0; i < 60; i++) {
    c = { L, C: Math.min(0.17, maxChroma(L, h) * 0.95), h };
    if (contrast(c, text) >= TARGET_CONTRAST) break;
    L += 0.005;
  }
  return c;
}

function chainLabel(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export interface Palette {
  /** Every stock a chain colour can land on. */
  readonly surfaces: readonly Oklch[];
  /** Body ink, used on top of washes. */
  readonly text: Oklch;
}

/** The colours for chain number i. */
function solveChain(i: number, { surfaces, text }: Palette): ChainColor {
  const hue = (START_HUE + i * GOLDEN_ANGLE) % 360;
  const ink = solveInk(hue, i % 2 === 0 ? 0.2 : 0.17, surfaces, i % 2 === 0 ? 0 : 0.035);
  const wash = solveWash(hue, text);
  return {
    index: i,
    label: chainLabel(i),
    hue,
    ink,
    wash,
    inkCss: formatOklch(ink),
    washCss: formatOklch(wash),
    marker: MARKERS[i % MARKERS.length]!,
    lineStyle: LINE_STYLES[i % LINE_STYLES.length]!,
  };
}

/** Chain i never depends on how many chains there are, so solved colours are kept per palette and only extended. */
let memo: { key: string; colors: ChainColor[] } = { key: '', colors: [] };

/** `count` chain colours. There is no upper limit; markers and line styles cycle, letters never repeat. */
export function generateChainColors(count: number, palette: Palette): ChainColor[] {
  const key = JSON.stringify([palette.surfaces, palette.text]);
  if (memo.key !== key) memo = { key, colors: [] };
  for (let i = memo.colors.length; i < count; i++) memo.colors.push(solveChain(i, palette));
  return memo.colors.slice(0, count);
}

/** Publishes --chain-{i}-ink / --chain-{i}-wash so CSS never holds a chain colour. */
export function publishChainVars(el: HTMLElement, colors: readonly ChainColor[]): void {
  for (const c of colors) {
    el.style.setProperty(`--chain-${c.index}-ink`, c.inkCss);
    el.style.setProperty(`--chain-${c.index}-wash`, c.washCss);
  }
}

/** Reads the stocks and body ink from the live CSS tokens so the palette always matches them. */
export function readPalette(root: HTMLElement): Palette {
  const css = getComputedStyle(root);
  const read = (name: string): Oklch => {
    const c = parseOklch(css.getPropertyValue(name));
    if (!c) throw new Error(`Token ${name} is not an oklch() colour`);
    return c;
  };
  return {
    surfaces: ['--paper', '--paper-raised', '--paper-sunk'].map(read),
    text: read('--ink'),
  };
}
