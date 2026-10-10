import { generateChainColors, ratioOfLuminance, type ChainColor, type Palette } from './colors';

/*
 * Contrast check. Colours are measured as the browser actually renders them (drawn to a canvas and
 * read back), not from our own maths, so gamut mapping or rounding cannot hide a failure.
 * Three pairs occur in the UI for every chain:
 *   ink  on every stock          underline, marker, legend swatch
 *   body ink on the wash         highlighted syllables
 *   tag text on the ink          the letter tags
 */

export const AA = 4.5;

export interface ContrastRow {
  readonly label: string;
  /** Chain ink against the hardest stock. */
  readonly ink: number;
  /** Body ink against the chain's wash. */
  readonly wash: number;
  /** Tag text against the chain ink. */
  readonly tag: number;
  readonly pass: boolean;
}

export interface ContrastReport {
  readonly rows: readonly ContrastRow[];
  /** Lowest ratio of any pair of any chain in the verse. */
  readonly minimum: number;
  readonly passing: number;
  /** Same check run on 60 generated chains, to show the generator holds up at scale. */
  readonly range: { readonly count: number; readonly minimum: number; readonly passing: number };
}

type Rgb = readonly [number, number, number];

let probe: CanvasRenderingContext2D | null | undefined;

/** The colour as rendered, 8-bit sRGB. Works for any CSS colour the browser understands. */
function rendered(css: string): Rgb {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) throw new Error('Canvas is unavailable, cannot measure colours');
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = 'rgb(1 2 3)';
  const sentinel = probe.fillStyle;
  probe.fillStyle = css;
  if (probe.fillStyle === sentinel && css !== 'rgb(1 2 3)') throw new Error(`The browser cannot parse the colour "${css}"`);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

const toLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminanceOf = ([r, g, b]: Rgb): number => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const ratio = (a: Rgb, b: Rgb): number => ratioOfLuminance(luminanceOf(a), luminanceOf(b));

/** Resolves a CSS variable to a colour string through a throwaway element. */
function resolveVar(root: HTMLElement, name: string): string {
  const el = document.createElement('span');
  el.style.color = `var(${name})`;
  el.style.display = 'none';
  root.append(el);
  const value = getComputedStyle(el).color;
  el.remove();
  return value;
}

function measure(color: ChainColor, stocks: readonly Rgb[], bodyInk: Rgb, tagText: Rgb): ContrastRow {
  const ink = rendered(color.inkCss);
  const row = {
    label: color.label,
    ink: Math.min(...stocks.map((s) => ratio(ink, s))),
    wash: ratio(bodyInk, rendered(color.washCss)),
    tag: ratio(tagText, ink),
  };
  return { ...row, pass: Math.min(row.ink, row.wash, row.tag) >= AA };
}

export function checkContrast(root: HTMLElement, colors: readonly ChainColor[], palette: Palette): ContrastReport {
  const stocks = ['--paper', '--paper-raised', '--paper-sunk'].map((n) => rendered(resolveVar(root, n)));
  const bodyInk = rendered(resolveVar(root, '--ink'));
  const tagText = rendered(resolveVar(root, '--paper-raised'));

  const rows = colors.map((c) => measure(c, stocks, bodyInk, tagText));
  const wide = generateChainColors(60, palette).map((c) => measure(c, stocks, bodyInk, tagText));
  const lowest = (list: readonly ContrastRow[]): number => Math.min(...list.map((r) => Math.min(r.ink, r.wash, r.tag)));

  return {
    rows,
    minimum: rows.length ? lowest(rows) : Infinity,
    passing: rows.filter((r) => r.pass).length,
    range: { count: wide.length, minimum: lowest(wide), passing: wide.filter((r) => r.pass).length },
  };
}
