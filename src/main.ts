import '../style-tile/fonts.css';
import '../style-tile/tokens.css';
import './styles/app.css';

import { detectRhymes, loadEngine, type AnalyzedVerse, type Engine, type RhymeChain } from './engine';
import { createArcLayer } from './ui/arcs';
import { generateChainColors, publishChainVars, readPalette, type ChainColor } from './ui/colors';
import { markActiveChip, renderDetail, renderRail } from './ui/panels';
import { isLoose, renderReadView, soloChain } from './ui/readView';

const $ = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const root = document.documentElement;
const workspace = $('.workspace');
const readPlate = $('.read');
const input = $<HTMLTextAreaElement>('#verse-input');
const analyzeBtn = $<HTMLButtonElement>('#analyze-btn');
const analyzeLabel = $('#analyze-label');
const readView = $('#read-view');
const readStage = $('#read-stage');
const rail = $('#chain-rail');
const railWrap = $('#rail-wrap');
const detail = $('#chain-detail');
const looseToggle = $<HTMLButtonElement>('#loose-toggle');
// A rebuilt overlay (resize, fonts) has fresh elements: reapply whichever chain is isolated.
const arcs = createArcLayer(readStage, document.querySelector<SVGSVGElement>('#arcs')!, () => soloChain(readStage, hovered ?? pinned));
const colorsFor = new Map<string, ChainColor>(); // chain id -> colour, for the detail line

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const stacked = matchMedia('(max-width: 960px), (max-height: 560px)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

interface Result {
  readonly verse: AnalyzedVerse;
  readonly chains: RhymeChain[];
}

let engine: Engine | null = null;
let result: Result | null = null;
let pinned: string | null = null;
let hovered: string | null = null;
let showLoose = true;
let shown: RhymeChain[] = [];
let runId = 0;

/** Hover wins over a pinned chain; with neither, everything is back to full strength. */
function applyFocus(): void {
  const id = hovered ?? pinned;
  soloChain(readStage, id);
  markActiveChip(rail, id, !reducedMotion());
  renderDetail(detail, shown.find((c) => c.id === id) ?? null, id ? (colorsFor.get(id) ?? null) : null);
}

/** Arcs measure real glyph positions, so they wait for the fonts the read view uses. */
const fontsReady = (): Promise<unknown> => Promise.all([document.fonts.load('450 16px "Martian Mono"'), document.fonts.load('650 16px "Martian Mono"'), document.fonts.ready]);

/* ── Rendering ───────────────────────────────────────────── */

/** Chain colours are solved against the live stock tokens, so they are regenerated for every analysis. */
async function paint(): Promise<void> {
  if (!result) return;
  const run = ++runId;
  pinned = null;
  hovered = null;
  const { verse } = result;
  const loose = result.chains.filter(isLoose).length;
  const chains = (shown = showLoose ? result.chains : result.chains.filter((c) => !isLoose(c)));
  const palette = readPalette(root);
  const colors: ChainColor[] = generateChainColors(chains.length, palette);
  publishChainVars(root, colors);
  colorsFor.clear();
  chains.forEach((c, i) => colorsFor.set(c.id, colors[i]!));

  // The toggle only exists when there is something loose to hide.
  looseToggle.hidden = loose === 0;
  looseToggle.setAttribute('aria-pressed', String(showLoose));
  $('#loose-count').textContent = String(loose);

  workspace.removeAttribute('data-empty');
  renderReadView(readView, verse, chains, colors);

  const words = verse.lines.reduce((n, l) => n + l.words.length, 0);
  const parts = [plural(verse.lines.length, 'line'), plural(words, 'word'), chains.length ? plural(chains.length, 'chain') : 'no rhymes'];
  if (verse.approximateWords.length) parts.push(`${verse.approximateWords.length} approx`);
  $('#read-meta').textContent = parts.join(' · ');

  // On small screens the result sits below the input: bring it into view, rhymes or not.
  if (stacked.matches) readPlate.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });

  const hasChains = chains.length > 0;
  railWrap.hidden = !hasChains;
  renderDetail(detail, null, null);
  rail.scrollLeft = 0;

  if (!hasChains) {
    arcs.clear();
    rail.textContent = '';
    return;
  }

  renderRail(rail, chains, colors, {
    onHover: (id) => {
      hovered = id;
      applyFocus();
    },
    onPin: (id) => {
      pinned = id;
      applyFocus();
      // Pinning a chain also brings its first rhyme into view.
      const first = id ? readStage.querySelector<HTMLElement>(`mark[data-chain="${CSS.escape(id)}"]`) : null;
      first?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    },
  });

  await fontsReady();
  if (run === runId) arcs.show(chains, colors);
}

looseToggle.addEventListener('click', () => {
  showLoose = !showLoose;
  paint().catch((error: unknown) => console.error('Could not render the verse', error));
});

function analyze(): void {
  if (!engine) return;
  if (!input.value.trim()) {
    input.focus();
    return;
  }
  const verse = engine.analyze(input.value);
  result = { verse, chains: detectRhymes(verse) };
  paint().catch((error: unknown) => console.error('Could not render the verse', error));
}

/* ── Hover a word, tag or arc to isolate its chain (fine pointers only) ── */

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

/* The rail scrolls sideways; let a plain mouse wheel drive it. */
rail.addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = rail.scrollWidth - rail.clientWidth;
    const canMove = e.deltaY > 0 ? rail.scrollLeft < max : rail.scrollLeft > 0;
    if (!canMove) return; // let the page have it
    e.preventDefault();
    rail.scrollLeft += e.deltaY;
  },
  { passive: false },
);

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

/* ── Reveal on load ──────────────────────────────────────── */

const revealables = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
revealables.forEach((node, i) => node.style.setProperty('--d', String(i)));
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.1 },
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
    if (input.value.trim()) analyze();
  },
  (error: unknown) => {
    console.error(error);
    analyzeLabel.textContent = 'Dictionary failed to load';
  },
);
