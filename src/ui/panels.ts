import type { RhymeChain } from '../engine';
import type { ChainColor } from './colors';
import { AA, type ContrastReport } from './contrast';
import { describeChain } from './readView';

const NS = 'http://www.w3.org/2000/svg';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const ratioText = (r: number): string => `${r.toFixed(1)}:1`;

function markerIcon(color: ChainColor): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-7 -7 14 14');
  svg.setAttribute('class', 'marker');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', color.marker.d);
  svg.append(path);
  return svg;
}

export interface RailHandlers {
  readonly onHover: (id: string | null) => void;
  readonly onPin: (id: string | null) => void;
}

/**
 * The chain rail: one chip per chain with its marker, letter, rhyme sound and syllable count.
 * It sits above the verse, so chains are always on screen. Hover or focus isolates a chain; click pins it.
 */
export function renderRail(rail: HTMLElement, chains: readonly RhymeChain[], colors: readonly ChainColor[], { onHover, onPin }: RailHandlers): void {
  rail.textContent = '';
  let pinned: string | null = null;
  const chips: HTMLButtonElement[] = [];

  chains.forEach((chain, i) => {
    const color = colors[i]!;
    const li = el('li');
    const chip = el('button', 'rail-chip');
    chip.type = 'button';
    chip.dataset.chain = chain.id;
    chip.setAttribute('aria-pressed', 'false');
    chip.style.setProperty('--chain-ink', `var(--chain-${color.index}-ink)`);
    chip.style.setProperty('--i', String(Math.min(i, 10)));

    const top = el('span', 'chip-top');
    top.append(markerIcon(color), el('span', 'tag', color.label), el('span', 'sound', chain.sound + (chain.kind === 'slant' ? '~' : '')));

    const bottom = el('span', 'chip-bottom');
    bottom.append(el('b', undefined, String(chain.syllables)), el('span', 'unit', chain.syllables === 1 ? 'syl' : 'syls'), el('span', 'kind', chain.kind + (chain.approximate ? ' ≈' : '')));

    chip.append(top, bottom);
    chip.title = chain.members.map((m) => m.text).join(' · ');
    chip.setAttribute('aria-label', `Chain ${color.label}: ${describeChain(chain)}, ${plural(chain.members.length, 'member')}: ${chain.members.map((m) => m.text).join(', ')}. Press to pin.`);

    chip.addEventListener('pointerenter', () => onHover(chain.id));
    chip.addEventListener('pointerleave', () => onHover(null));
    chip.addEventListener('focus', () => onHover(chain.id));
    chip.addEventListener('blur', () => onHover(null));
    chip.addEventListener('click', () => {
      pinned = pinned === chain.id ? null : chain.id;
      chips.forEach((c, k) => c.setAttribute('aria-pressed', String(pinned === chains[k]!.id)));
      onPin(pinned);
    });
    chips.push(chip);
    li.append(chip);
    rail.append(li);
  });
}

/** Marks the chip of the chain currently in focus (hovered or pinned) and keeps it in view inside the rail. */
export function markActiveChip(rail: HTMLElement, id: string | null, smooth: boolean): void {
  rail.querySelectorAll<HTMLElement>('.rail-chip').forEach((chip) => {
    const active = id !== null && chip.dataset.chain === id;
    chip.toggleAttribute('data-active', active);
    if (active) chip.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  });
}

/** The pill in the footer: a one-glance verdict. Details live in the sheet it opens. */
export function renderVerdict(button: HTMLElement, label: HTMLElement, report: ContrastReport): void {
  const ok = report.passing === report.rows.length && report.range.passing === report.range.count;
  button.classList.toggle('bad', !ok);
  label.textContent = ok
    ? `AA ${report.passing}/${report.rows.length} · lowest ${ratioText(report.minimum)}`
    : `${report.rows.length - report.passing} below AA · lowest ${ratioText(report.minimum)}`;
}

/** Summary banner plus one row per chain: ink on stock, body ink on wash, tag text on ink. */
export function renderContrast(container: HTMLElement, report: ContrastReport): void {
  container.textContent = '';
  const okAll = report.passing === report.rows.length;
  const okRange = report.range.passing === report.range.count;

  const summary = el('p', `summary ${okAll && okRange ? '' : 'bad'}`);
  summary.append(
    el('b', undefined, okAll ? 'All pass' : `${report.rows.length - report.passing} fail`),
    document.createTextNode(` · ${report.passing}/${report.rows.length} chains clear WCAG AA (${AA}:1) on every stock · lowest ${ratioText(report.minimum)}`),
  );
  container.append(summary);

  const table = el('table', 'contrast');
  const head = el('thead');
  head.innerHTML = '<tr><th scope="col">Chain</th><th scope="col">Ink on stock</th><th scope="col">Text on wash</th><th scope="col">Tag on ink</th><th scope="col">Result</th></tr>';
  const body = el('tbody');
  report.rows.forEach((row, i) => {
    const tr = el('tr');
    const cell = (value: number): HTMLTableCellElement => el('td', value >= AA ? '' : 'low', ratioText(value));
    const th = el('th');
    th.scope = 'row';
    const tag = el('span', 'tag mini', row.label);
    tag.style.setProperty('--chain-ink', `var(--chain-${i}-ink)`);
    th.append(tag);
    const result = el('td');
    result.append(el('span', `badge${row.pass ? '' : ' fail'}`, row.pass ? 'AA' : 'FAIL'));
    tr.append(th, cell(row.ink), cell(row.wash), cell(row.tag), result);
    body.append(tr);
  });
  table.append(head, body);
  container.append(table);

  const note = el('p', `range ${okRange ? '' : 'bad'}`);
  note.textContent = `Generator check: ${report.range.passing}/${report.range.count} of 60 generated chains pass, lowest ${ratioText(report.range.minimum)}. Measured from the colours as the browser renders them.`;
  container.append(note);
}
