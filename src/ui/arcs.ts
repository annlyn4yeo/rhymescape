import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import type { RhymeChain } from '../engine';
import type { ChainColor, LineStyle } from './colors';

/*
 * SVG overlay that joins the members of each rhyme chain with arcs.
 *  - Positions come from the real rendered words (getClientRects), measured once per build
 *    (all reads first, then all writes) and rebuilt on resize and when fonts finish loading.
 *  - Arcs between words on the same row rise above the text; arcs between rows swing out through the right gutter.
 *    Height (or swing) grows with distance; stroke thickness grows with the matched syllables.
 *  - Draw-in follows DESIGN.md: arcs rise from their baseline with --ease-drawer over --dur-reveal, staggered by line,
 *    markers pop with --ease-slap. Easing and duration are read from the CSS tokens, never duplicated here.
 *    Arcs start hidden and play when they scroll into view (IntersectionObserver), so a long verse only ever
 *    animates what is on screen.
 *  - prefers-reduced-motion: a plain fade, no travel, no stagger.
 */

gsap.registerPlugin(CustomEase);
let easesReady = false;

type Pt = readonly [number, number];
const NS = 'http://www.w3.org/2000/svg';

export interface ArcLayer {
  /** Draws arcs for these chains (colours index-aligned). `animate` plays the draw-in. */
  show(chains: readonly RhymeChain[], colors: readonly ChainColor[], animate: boolean): void;
  clear(): void;
}

/* ── Tokens ──────────────────────────────────────────────── */

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const seconds = (name: string): number => {
  const v = token(name);
  return v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v);
};
const bezier = (name: string, fallback: string): string => /cubic-bezier\(([^)]+)\)/.exec(token(name))?.[1]?.replace(/\s/g, '') ?? fallback;
const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (lo: number, v: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/* ── Geometry (pure) ─────────────────────────────────────── */

function sampleCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Points spaced `spacing` apart along a polyline, so offsets (waves, double lines) stay even. */
function resample(pts: readonly Pt[], spacing: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (carry + seg >= spacing) {
      const t = (spacing - carry) / seg;
      x0 += (x1 - x0) * t;
      y0 += (y1 - y0) * t;
      out.push([x0, y0]);
      seg = Math.hypot(x1 - x0, y1 - y0);
      carry = 0;
    }
    carry += seg;
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Shifts each point sideways by fn(distance travelled). */
function offset(pts: readonly Pt[], fn: (along: number) => number): Pt[] {
  let along = 0;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    if (i > 0) along += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]);
    const o = fn(along);
    return [p[0] + (-(b[1] - a[1]) / len) * o, p[1] + ((b[0] - a[0]) / len) * o] as Pt;
  });
}

const toPath = (pts: readonly Pt[]): string => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L');

interface Stroke {
  readonly d: string;
  readonly width: number;
  readonly dash?: string;
  readonly cap: 'butt' | 'round';
}

/** The chain's line style, scaled to the base thickness `w`. */
function strokesFor(style: LineStyle, pts: readonly Pt[], w: number): Stroke[] {
  const d = toPath(pts);
  switch (style) {
    case 'dashed':
      return [{ d, width: w, dash: `${(w * 4).toFixed(1)} ${(w * 2.6).toFixed(1)}`, cap: 'butt' }];
    case 'dotted':
      return [{ d, width: w * 1.3, dash: `0.1 ${(w * 2.4).toFixed(1)}`, cap: 'round' }];
    case 'wavy': {
      const amp = Math.min(2.8, 1 + w * 0.5);
      return [{ d: toPath(offset(resample(pts, 2.2), (s) => Math.sin(s / 2.1) * amp)), width: w * 0.8, cap: 'round' }];
    }
    case 'double': {
      const dense = resample(pts, 2.2);
      const gap = w * 0.55 + 0.9;
      return [-gap, gap].map((o) => ({ d: toPath(offset(dense, () => o)), width: w * 0.5, cap: 'round' as const }));
    }
    default:
      return [{ d, width: w, cap: 'round' }];
  }
}

/* ── Measuring the real words ────────────────────────────── */

interface Anchor {
  x: number; // centre of the highlighted word
  top: number;
  tailX: number; // right edge, after the letter tag
  tailY: number;
  line: number;
}

/** One pass of layout reads: every member's position relative to the stage. */
function measure(stage: HTMLElement): Map<string, Anchor> {
  const base = stage.getBoundingClientRect();
  const out = new Map<string, Anchor>();
  stage.querySelectorAll<HTMLElement>('mark[data-member]').forEach((mark) => {
    const key = mark.dataset.member!;
    const r = mark.getClientRects()[0];
    if (out.has(key) || !r) return;
    out.set(key, {
      x: r.left - base.left + r.width / 2,
      top: r.top - base.top,
      tailX: r.right - base.left,
      tailY: r.top - base.top + r.height / 2,
      line: Number(mark.closest<HTMLElement>('.line')?.dataset.lineIndex ?? 0),
    });
  });
  stage.querySelectorAll<HTMLElement>('.tag[data-member]').forEach((tag) => {
    const a = out.get(tag.dataset.member!);
    if (!a) return;
    const r = tag.getBoundingClientRect();
    a.tailX = r.right - base.left;
    a.tailY = r.top - base.top + r.height / 2;
  });
  return out;
}

/* ── The layer ───────────────────────────────────────────── */

interface Drawn {
  readonly el: SVGGElement;
  readonly rank: number; // line index, drives the stagger
  readonly rise: 'up' | 'out';
  readonly markers: SVGGElement[];
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** `onBuilt` runs after every (re)build, so callers can restore state that lives on the new elements (a dimmed chain). */
export function createArcLayer(stage: HTMLElement, svg: SVGSVGElement, onBuilt?: () => void): ArcLayer {
  let chains: readonly RhymeChain[] = [];
  let colors: readonly ChainColor[] = [];
  let timelines: gsap.core.Timeline[] = [];
  let observer: IntersectionObserver | null = null;
  let waiting = new Map<Element, Drawn>();
  let queued = false;
  let lastWidth = -1; // arcs depend on line wrapping, so only a width change invalidates them

  function stop(): void {
    timelines.forEach((t) => t.kill());
    timelines = [];
    observer?.disconnect();
    observer = null;
    waiting = new Map();
  }

  /** `animate`: arcs start hidden and play as they scroll into view. Otherwise they are simply drawn. */
  function build(animate: boolean): void {
    stop();
    svg.replaceChildren();
    svg.classList.remove('is-settled');
    if (chains.length === 0) return;

    const width = stage.clientWidth;
    lastWidth = width;
    if (width === 0) return; // not displayed (stacked layout before a result): nothing to measure
    const anchors = measure(stage);
    const height = stage.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    const drawn: Drawn[] = [];
    const arcLayer = el('g');
    const markerLayer = el('g');
    svg.append(arcLayer, markerLayer);

    chains.forEach((chain, ci) => {
      const color = colors[ci];
      if (!color) return;
      const thickness = Math.min(5, 1.5 + chain.syllables * 0.9);
      const vars = `--chain-ink: var(--chain-${color.index}-ink)`;

      const addMarker = (x: number, y: number): SVGGElement => {
        const g = el('g', { class: 'arc-marker', 'data-chain': chain.id, style: vars, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(0.9)` });
        g.append(el('path', { d: color.marker.d }));
        markerLayer.append(g);
        return g;
      };

      for (let mi = 0; mi < chain.members.length - 1; mi++) {
        const a = anchors.get(`${ci}:${mi}`);
        const b = anchors.get(`${ci}:${mi + 1}`);
        if (!a || !b) continue;

        const sameRow = Math.abs(a.top - b.top) < 10;
        let pts: Pt[];
        let ends: Pt[];
        if (sameRow) {
          // Over the words: height grows with the distance between them.
          const y = a.top - 4;
          const dx = Math.abs(b.x - a.x);
          const h = clamp(10, 8 + dx * 0.07, 30);
          const dir = Math.sign(b.x - a.x) || 1;
          const k = Math.min(0.36 * dx, h * 1.1) * 0.25;
          pts = sampleCubic([a.x, y], [a.x + dir * k, y - h * 1.28], [b.x - dir * k, y - h * 1.28], [b.x, y], 56);
          ends = [[a.x, y], [b.x, y]];
        } else {
          // Between rows: swing out through the right gutter, further for longer jumps.
          const dy = Math.abs(b.tailY - a.tailY);
          const swing = clamp(18, 14 + dy * 0.05, 40) + (ci % 4) * 5;
          const reach = Math.max(a.tailX, b.tailX) + swing * 1.33;
          const p0: Pt = [a.tailX + 4, a.tailY];
          const p3: Pt = [b.tailX + 4, b.tailY];
          pts = sampleCubic(p0, [reach, a.tailY], [reach, b.tailY], p3, 56);
          ends = [p0, p3];
        }

        const g = el('g', { class: 'arc', 'data-chain': chain.id, 'data-style': color.lineStyle, style: vars });
        g.append(el('path', { class: 'hit', d: toPath(pts) }));
        for (const s of strokesFor(color.lineStyle, pts, thickness)) {
          const p = el('path', { d: s.d, 'stroke-width': s.width.toFixed(2), 'stroke-linecap': s.cap });
          if (s.dash) p.setAttribute('stroke-dasharray', s.dash);
          g.append(p);
        }
        arcLayer.append(g);
        drawn.push({ el: g, rank: a.line, rise: sameRow ? 'up' : 'out', markers: ends.map(([x, y]) => addMarker(x, y)) });
      }
    });

    if (!animate || drawn.length === 0) {
      svg.classList.add('is-settled');
      onBuilt?.();
      return;
    }
    // Hide everything now (inline, so GSAP's clearProps restores the natural state), reveal on intersection.
    observer = new IntersectionObserver(
      (entries) => {
        const batch = entries.filter((e) => e.isIntersecting).map((e) => waiting.get(e.target)!);
        batch.forEach((d) => {
          observer?.unobserve(d.el);
          waiting.delete(d.el);
        });
        if (batch.length) reveal(batch);
      },
      { rootMargin: '0px 0px -4% 0px' },
    );
    for (const d of drawn) {
      d.el.style.opacity = '0';
      d.markers.forEach((m) => (m.style.opacity = '0'));
      waiting.set(d.el, d);
      observer.observe(d.el);
    }
    onBuilt?.();
  }

  /** Arcs rise from their baseline, line by line; markers pop in after them. Tokens drive every number. */
  function reveal(batch: readonly Drawn[]): void {
    const reduce = reducedMotion();
    const dur = seconds('--dur-reveal');
    if (!easesReady) {
      CustomEase.create('rs-drawer', bezier('--ease-drawer', '0.32,0.72,0,1'));
      CustomEase.create('rs-slap', bezier('--ease-slap', '0.34,1.56,0.64,1'));
      easesReady = true;
    }

    const ranks = [...new Set(batch.map((d) => d.rank))].sort((x, y) => x - y);
    const step = reduce ? 0 : Math.min(0.07, 0.7 / ranks.length);
    const at = (rank: number): number => ranks.indexOf(rank) * step;

    // Marker groups carry their position in a transform attribute: only their opacity and inner shape are tweened.
    const groups = batch.flatMap((d) => [d.el, ...d.markers]);
    const shapes = batch.flatMap((d) => d.markers.map((m) => m.firstElementChild!));
    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(groups, { clearProps: 'opacity,transform,transformOrigin' });
        gsap.set(shapes, { clearProps: 'opacity,transform,transformOrigin' });
        timelines = timelines.filter((t) => t !== tl);
        if (waiting.size === 0 && timelines.length === 0) svg.classList.add('is-settled');
      },
    });
    timelines.push(tl);

    for (const d of batch) {
      tl.fromTo(
        d.el,
        reduce ? { opacity: 0 } : d.rise === 'up' ? { opacity: 0, scaleY: 0.5, transformOrigin: '50% 100%' } : { opacity: 0, scaleX: 0.5, transformOrigin: '0% 50%' },
        { opacity: 1, scaleX: 1, scaleY: 1, duration: dur, ease: 'rs-drawer' },
        at(d.rank),
      );
      const popAt = at(d.rank) + (reduce ? 0 : dur * 0.4);
      d.markers.forEach((m) => {
        tl.fromTo(m, { opacity: 0 }, { opacity: 1, duration: reduce ? dur : dur * 0.3, ease: 'none' }, popAt);
        if (!reduce) tl.fromTo(m.firstElementChild!, { scale: 0.4, transformOrigin: '50% 50%' }, { scale: 1, duration: dur * 0.6, ease: 'rs-slap' }, popAt);
      });
    }
  }

  // Rebuild (no animation) whenever the stage reflows or fonts finish loading.
  const requestRebuild = (): void => {
    if (queued || chains.length === 0) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      build(false);
    });
  };
  // Height changes (a verse rendering, the rail appearing) must not rebuild: that would cancel a draw-in in progress.
  new ResizeObserver(() => {
    if (stage.clientWidth !== lastWidth) requestRebuild();
  }).observe(stage);
  document.fonts.addEventListener('loadingdone', requestRebuild);

  return {
    show(nextChains, nextColors, animate) {
      chains = nextChains;
      colors = nextColors;
      build(animate);
    },
    clear() {
      chains = [];
      colors = [];
      build(false);
    },
  };
}
