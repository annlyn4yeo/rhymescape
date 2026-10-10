import '../style-tile/fonts.css';
import '../style-tile/tokens.css';
import './styles/app.css';

import { detectRhymes, loadEngine, type AnalyzedVerse, type Engine, type RhymeChain } from './engine';
import { generateChainColors, publishChainVars, readPalette, type ChainColor } from './ui/colors';
import { createArcLayer } from './ui/arcs';
import { checkContrast } from './ui/contrast';
import { renderContrast, renderLegend } from './ui/panels';
import { renderReadView, soloChain } from './ui/readView';
import { SAMPLE_VERSE } from './ui/sample';

const $ = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const root = document.documentElement;
const input = $<HTMLTextAreaElement>('#verse-input');
const analyzeBtn = $<HTMLButtonElement>('#analyze-btn');
const analyzeLabel = $('#analyze-label');
const readView = $('#read-view');
const readStage = $('#read-stage');
const arcs = createArcLayer(readStage, document.querySelector<SVGSVGElement>('#arcs')!);
const legendView = $('#legend-view');
const contrastView = $('#contrast-view');
const statusChip = $('#status');
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Result {
  readonly verse: AnalyzedVerse;
  readonly chains: RhymeChain[];
}

let engine: Engine | null = null;
let result: Result | null = null;
let pinned: string | null = null;
let hovered: string | null = null;
let runId = 0;

/** Hover wins over a pinned chain; with neither, everything is back to full strength. */
function applyFocus(): void {
  soloChain(readStage, hovered ?? pinned);
}

/** Arcs measure real glyph positions, so they wait for the fonts the read view uses. */
const fontsReady = (): Promise<unknown> => Promise.all([document.fonts.load('450 17px "Martian Mono"'), document.fonts.load('650 17px "Martian Mono"'), document.fonts.ready]);

/* ── Rendering ───────────────────────────────────────────── */

/** Chain colours are solved against the live stock tokens, so they are regenerated for every analysis. */
async function paint(): Promise<void> {
  if (!result) return;
  const id = ++runId;
  pinned = null;
  hovered = null;
  const { verse, chains } = result;
  const palette = readPalette(root);
  const colors: ChainColor[] = generateChainColors(chains.length, palette);
  publishChainVars(root, colors);

  renderReadView(readView, verse, chains, colors);
  renderLegend(legendView, chains, colors, {
    onHover: (id) => {
      hovered = id;
      applyFocus();
    },
    onPin: (id) => {
      pinned = id;
      applyFocus();
    },
  });

  const words = verse.lines.reduce((n, l) => n + l.words.length, 0);
  $('#read-meta').textContent = `${plural(verse.lines.length, 'line')} · ${plural(words, 'word')}`;
  $('#legend-meta').textContent = chains.length
    ? `${plural(chains.length, 'chain')}${verse.approximateWords.length ? ` · ${plural(verse.approximateWords.length, 'approximate word')}` : ''}`
    : '';

  if (chains.length === 0) {
    arcs.clear();
    legendView.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty-note', textContent: 'No rhymes found in this verse.' }));
    contrastView.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty-note', textContent: 'No chain colours to check.' }));
    return;
  }
  renderContrast(contrastView, checkContrast(root, colors, palette));

  await fontsReady();
  if (id === runId) arcs.show(chains, colors, true);
}

function analyze(): void {
  if (!engine) return;
  const text = input.value;
  if (!text.trim()) {
    input.focus();
    return;
  }
  const verse = engine.analyze(text);
  result = { verse, chains: detectRhymes(verse) };
  void paint();
}

/* ── Hover a word, tag or arc to isolate its chain (fine pointers only) ── */

const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
readStage.addEventListener('pointerover', (e) => {
  if (!finePointer.matches) return;
  const id = (e.target as Element).closest<HTMLElement>('[data-chain]')?.dataset.chain ?? null;
  if (id === hovered) return;
  hovered = id;
  applyFocus();
});
readStage.addEventListener('pointerleave', () => {
  if (hovered === null) return;
  hovered = null;
  applyFocus();
});

/* ── Input ───────────────────────────────────────────────── */

function updateInputMeta(): void {
  const lines = input.value.split(/\r\n|\r|\n/).filter((l) => l.trim()).length;
  $('#input-meta').textContent = plural(lines, 'line');
}

input.addEventListener('input', updateInputMeta);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    analyze();
  }
});
analyzeBtn.addEventListener('click', analyze);
$('#sample-btn').addEventListener('click', () => {
  input.value = SAMPLE_VERSE;
  updateInputMeta();
  analyze();
});

/* ── Reveal on scroll ────────────────────────────────────── */

const revealables = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
revealables.forEach((node, i) => node.style.setProperty('--d', String(i % 3)));
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
  );
  revealables.forEach((node) => io.observe(node));
} else {
  revealables.forEach((node) => node.classList.add('is-in'));
}

/* ── Boot ────────────────────────────────────────────────── */

updateInputMeta();
loadEngine().then(
  (loaded) => {
    engine = loaded;
    analyzeBtn.disabled = false;
    analyzeLabel.textContent = 'Analyze';
    statusChip.classList.add('is-ready');
    statusChip.querySelector('span')!.textContent = 'Dictionary ready';
    if (input.value.trim()) analyze();
  },
  (error: unknown) => {
    console.error(error);
    analyzeLabel.textContent = 'Dictionary failed to load';
    statusChip.querySelector('span')!.textContent = 'Offline';
  },
);
