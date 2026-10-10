import '../style-tile/fonts.css';
import '../style-tile/tokens.css';
import './styles/app.css';

import { detectRhymes, loadEngine, type AnalyzedVerse, type Engine, type RhymeChain } from './engine';
import { createArcLayer } from './ui/arcs';
import { generateChainColors, publishChainVars, readPalette, type ChainColor } from './ui/colors';
import { checkContrast } from './ui/contrast';
import { markActiveChip, renderContrast, renderRail, renderVerdict } from './ui/panels';
import { renderReadView, soloChain } from './ui/readView';
import { SAMPLE_VERSE } from './ui/sample';

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
const readFoot = $('#read-foot');
const contrastBtn = $<HTMLButtonElement>('#contrast-btn');
const contrastSheet = $('#contrast-sheet');
const arcs = createArcLayer(readStage, document.querySelector<SVGSVGElement>('#arcs')!);

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
let runId = 0;

/** Hover wins over a pinned chain; with neither, everything is back to full strength. */
function applyFocus(): void {
  const id = hovered ?? pinned;
  soloChain(readStage, id);
  markActiveChip(rail, id, !reducedMotion());
}

/** Arcs measure real glyph positions, so they wait for the fonts the read view uses. */
const fontsReady = (): Promise<unknown> => Promise.all([document.fonts.load('450 16px "Martian Mono"'), document.fonts.load('650 16px "Martian Mono"'), document.fonts.ready]);

/* ── Contrast sheet ──────────────────────────────────────── */

function setSheet(open: boolean): void {
  contrastSheet.toggleAttribute('data-open', open);
  contrastBtn.setAttribute('aria-expanded', String(open));
}
contrastBtn.addEventListener('click', () => setSheet(!contrastSheet.hasAttribute('data-open')));
document.addEventListener('pointerdown', (e) => {
  if (contrastSheet.hasAttribute('data-open') && !contrastSheet.contains(e.target as Node) && !contrastBtn.contains(e.target as Node)) setSheet(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && contrastSheet.hasAttribute('data-open')) {
    setSheet(false);
    contrastBtn.focus();
  }
});

/* ── Rendering ───────────────────────────────────────────── */

/** Chain colours are solved against the live stock tokens, so they are regenerated for every analysis. */
async function paint(): Promise<void> {
  if (!result) return;
  const run = ++runId;
  pinned = null;
  hovered = null;
  setSheet(false);
  const { verse, chains } = result;
  const palette = readPalette(root);
  const colors: ChainColor[] = generateChainColors(chains.length, palette);
  publishChainVars(root, colors);

  workspace.removeAttribute('data-empty');
  renderReadView(readView, verse, chains, colors);

  const words = verse.lines.reduce((n, l) => n + l.words.length, 0);
  const parts = [plural(verse.lines.length, 'line'), plural(words, 'word'), chains.length ? plural(chains.length, 'chain') : 'no rhymes'];
  if (verse.approximateWords.length) parts.push(`${verse.approximateWords.length} approx`);
  $('#read-meta').textContent = parts.join(' · ');

  const hasChains = chains.length > 0;
  railWrap.hidden = !hasChains;
  readFoot.hidden = !hasChains;
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

  const report = checkContrast(root, colors, palette);
  renderVerdict(contrastBtn, $('#contrast-verdict'), report);
  renderContrast($('#contrast-view'), report);

  // On small screens the result sits below the input: bring it into view once it exists.
  if (stacked.matches) readPlate.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });

  await fontsReady();
  if (run === runId) arcs.show(chains, colors, true);
}

function analyze(): void {
  if (!engine) return;
  if (!input.value.trim()) {
    input.focus();
    return;
  }
  const verse = engine.analyze(input.value);
  result = { verse, chains: detectRhymes(verse) };
  void paint();
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
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || rail.scrollWidth <= rail.clientWidth) return;
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
$('#sample-btn').addEventListener('click', () => {
  input.value = SAMPLE_VERSE;
  updateInputMeta();
  analyze();
});

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
