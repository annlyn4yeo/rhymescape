import type { RhymeChain } from '../engine';
import type { ChainColor } from './colors';
import { describeChain } from './readView';

const NS = 'http://www.w3.org/2000/svg';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

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
    if (!active) return;
    // Scroll the rail itself, clear of its faded edges. scrollIntoView would also move the page.
    const edge = 24;
    const r = rail.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    const by = c.left < r.left + edge ? c.left - r.left - edge : c.right > r.right - edge ? c.right - r.right + edge : 0;
    if (by) rail.scrollBy({ left: by, behavior: smooth ? 'smooth' : 'auto' });
  });
}
