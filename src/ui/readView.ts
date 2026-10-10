import type { AnalyzedLine, AnalyzedVerse, RhymeChain, RhymeMember, SyllableRef } from '../engine';
import type { ChainColor } from './colors';

/*
 * The highlighted read view. Consumes the verse text and RhymeChain[]; no rhyme logic lives here.
 * Each member (line, start/end syllable) is mapped back to character offsets in the original line,
 * painted with the chain's wash and underline style, and closed with a letter tag.
 */

interface Cell {
  readonly chain: number;
  readonly member: number;
}

/** Character offset (within the line) of the start or end of a syllable. Falls back to the whole word. */
function syllableOffset(line: AnalyzedLine, ref: SyllableRef, edge: 'start' | 'end'): number {
  const word = line.words[ref.word]!;
  const base = word.span.start - line.span.start;
  const spelled = word.pronunciation.syllables;
  const lengths = spelled.map((s) => s.text.length);
  const exact = word.raw.length === lengths.reduce((a, b) => a + b, 0) && ref.syllable < spelled.length;
  if (!exact) return edge === 'start' ? base : base + word.raw.length;
  const upTo = lengths.slice(0, ref.syllable + (edge === 'end' ? 1 : 0)).reduce((a, b) => a + b, 0);
  return base + upTo;
}

function memberRange(line: AnalyzedLine, m: RhymeMember): [number, number] {
  return [syllableOffset(line, m.start, 'start'), syllableOffset(line, m.end, 'end')];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function describeChain(chain: RhymeChain): string {
  return `${chain.kind} rhyme, ${plural(chain.syllables, 'syllable')}${chain.approximate ? ', approximate' : ''}`;
}

/** Longer matches claim shared characters first, so a multi like "bad habit" is never split by a shorter chain. */
function paintOrder(chains: readonly RhymeChain[]): number[] {
  return chains.map((_, i) => i).sort((a, b) => chains[b]!.syllables - chains[a]!.syllables || a - b);
}

/** A member, tied to the chain that owns it. */
interface Placed {
  readonly chain: number;
  readonly member: number;
  readonly range: RhymeMember;
}

function renderLine(line: AnalyzedLine, placed: readonly Placed[], chains: readonly RhymeChain[], colors: readonly ChainColor[], index: number): HTMLElement {
  const text = line.raw;
  const owner: (Cell | null)[] = Array.from({ length: text.length }, () => null);
  const ends = new Map<string, number>(); // member key -> index of its last painted character

  for (const { chain: ci, member: mi, range } of placed) {
    const [from, to] = memberRange(line, range);
    for (let k = from; k < to; k++) if (!owner[k]) owner[k] = { chain: ci, member: mi };
    if (owner[to - 1]?.chain === ci) ends.set(`${ci}:${mi}`, to - 1);
  }

  const p = el('p', 'line');
  p.style.setProperty('--i', String(Math.min(index, 14)));
  p.dataset.lineIndex = String(line.index);
  const body = el('span', 'text');
  p.append(el('span', 'ln', String(line.index + 1).padStart(2, '0')), body);

  let i = 0;
  while (i < text.length) {
    const cell = owner[i];
    let j = i + 1;
    while (j < text.length && owner[j]?.chain === cell?.chain && owner[j]?.member === cell?.member) j++;
    if (!cell) {
      body.append(document.createTextNode(text.slice(i, j)));
    } else {
      const chain = chains[cell.chain]!;
      const color = colors[cell.chain]!;
      const mark = el('mark', 'hl', text.slice(i, j));
      mark.dataset.chain = chain.id;
      mark.dataset.member = `${cell.chain}:${cell.member}`;
      mark.dataset.line = color.lineStyle;
      mark.title = `${color.label}: ${describeChain(chain)}`;
      mark.style.setProperty('--chain-ink', `var(--chain-${color.index}-ink)`);
      mark.style.setProperty('--chain-wash', `var(--chain-${color.index}-wash)`);
      body.append(mark);
      if (ends.get(`${cell.chain}:${cell.member}`) === j - 1) {
        const tag = el('sup', 'tag', color.label + (chain.members[cell.member]!.approximate ? '≈' : ''));
        tag.dataset.chain = chain.id;
        tag.dataset.member = `${cell.chain}:${cell.member}`;
        tag.setAttribute('aria-label', `Chain ${color.label}, ${describeChain(chain)}`);
        tag.style.setProperty('--chain-ink', `var(--chain-${color.index}-ink)`);
        body.append(tag);
      }
    }
    i = j;
  }
  return p;
}

export function renderReadView(container: HTMLElement, verse: AnalyzedVerse, chains: readonly RhymeChain[], colors: readonly ChainColor[]): void {
  // Members by line, in paint order (longer matches first), so each line only looks at its own.
  const byLine = new Map<number, Placed[]>();
  for (const ci of paintOrder(chains)) {
    chains[ci]!.members.forEach((range, member) => {
      const list = byLine.get(range.line);
      if (list) list.push({ chain: ci, member, range });
      else byLine.set(range.line, [{ chain: ci, member, range }]);
    });
  }

  // Built off-screen and swapped in once.
  const next = document.createDocumentFragment();
  let stanza = -1;
  let group: HTMLElement | null = null;
  verse.lines.forEach((line, i) => {
    if (line.stanza !== stanza || !group) {
      stanza = line.stanza;
      group = el('div', 'stanza');
      next.append(group);
    }
    group.append(renderLine(line, byLine.get(line.index) ?? [], chains, colors, i));
  });
  if (verse.lines.length === 0) next.append(el('p', 'empty-note', 'No words found. Type a few lines first.'));
  container.replaceChildren(next);
}

/** Focus one chain: every other highlight, tag, arc and rail chip dims. Pass null to clear. */
export function soloChain(scope: ParentNode, id: string | null): void {
  scope.querySelectorAll<HTMLElement>('[data-chain]').forEach((node) => node.classList.toggle('is-dim', id !== null && node.dataset.chain !== id));
}
