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

export interface LegendHandlers {
  readonly onHover: (id: string | null) => void;
  readonly onPin: (id: string | null) => void;
}

/** One entry per chain: marker, letter, rhyme sound, syllable count, members. Hover or focus isolates the chain. */
export function renderLegend(container: HTMLElement, chains: readonly RhymeChain[], colors: readonly ChainColor[], { onHover, onPin }: LegendHandlers): void {
  container.textContent = '';
  let pinned: string | null = null;
  const buttons: HTMLButtonElement[] = [];

  chains.forEach((chain, i) => {
    const color = colors[i]!;
    const li = el('li');
    const button = el('button', 'legend-item');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--chain-ink', `var(--chain-${color.index}-ink)`);
    button.style.setProperty('--chain-wash', `var(--chain-${color.index}-wash)`);
    button.style.setProperty('--i', String(Math.min(i, 12)));

    const head = el('span', 'legend-head');
    const letter = el('span', 'tag', color.label);
    const sound = el('span', 'sound', chain.sound + (chain.kind === 'slant' ? '~' : ''));
    head.append(markerIcon(color), letter, sound);

    const count = el('span', 'syl');
    count.append(el('b', undefined, String(chain.syllables)), document.createTextNode(` ${chain.syllables === 1 ? 'syllable' : 'syllables'}`));

    const kind = el('span', 'kind', chain.kind + (chain.approximate ? ' ≈' : ''));
    kind.title = describeChain(chain);

    const words = el('span', 'words');
    const sample = el('span', 'sample', chain.members[0]!.text);
    sample.dataset.line = color.lineStyle;
    words.append(sample, document.createTextNode(chain.members.length > 1 ? ` + ${plural(chain.members.length - 1, 'more')}` : ''));
    words.title = chain.members.map((m) => m.text).join(' · ');

    button.append(head, count, kind, words);
    button.setAttribute('aria-label', `Chain ${color.label}: ${describeChain(chain)}, ${plural(chain.members.length, 'member')}. Press to pin.`);

    button.addEventListener('pointerenter', () => onHover(chain.id));
    button.addEventListener('pointerleave', () => onHover(null));
    button.addEventListener('focus', () => onHover(chain.id));
    button.addEventListener('blur', () => onHover(null));
    button.addEventListener('click', () => {
      pinned = pinned === chain.id ? null : chain.id;
      buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(pinned === chains[k]!.id)));
      onPin(pinned);
    });
    buttons.push(button);
    li.append(button);
    container.append(li);
  });
}

/** Summary banner plus one row per chain: ink on stock, body ink on wash, tag text on ink. */
export function renderContrast(container: HTMLElement, report: ContrastReport): void {
  container.textContent = '';
  const okAll = report.passing === report.rows.length;
  const okRange = report.range.passing === report.range.count;

  const summary = el('p', `summary ${okAll && okRange ? 'ok' : 'bad'}`);
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
    const cell = (value: number): HTMLTableCellElement => {
      const td = el('td', value >= AA ? '' : 'low', ratioText(value));
      return td;
    };
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
