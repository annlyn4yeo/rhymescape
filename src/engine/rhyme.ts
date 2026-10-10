import { clusterCost } from './consonants';
import type { AnalyzedLine, AnalyzedVerse, Pronunciation, RhymeChain, RhymeKind, RhymeMember, RhymeOptions, Stress, SyllableRef } from './types';

/*
 * Rhyme detection. Overview (full write-up in docs/rhyme-algorithm.md):
 *
 *  1. Every word that has a stressed vowel becomes a "site": the line read up to the end of that word.
 *     A site's tail runs from the word's last stressed vowel to the word's end.
 *  2. Two sites are compared backwards, phone by phone (stress ignored), across word boundaries.
 *     They match when the longer tail is identical. If the identical run also reaches earlier syllables,
 *     or earlier vowels line up with equal codas, those syllables count too (multisyllabic).
 *  3. If that fails, slant: same vowels, consonants compared by articulatory distance, within a tolerance.
 *  4. Matches become graph edges; edges are merged into chains strongest first, complete-linkage.
 */

interface Link {
  readonly kind: RhymeKind | 'repeat';
  readonly syllables: number;
  /** Slant only: normalized consonant distance. */
  readonly cost: number;
  /** Which pronunciation of each site's word produced the match (0 = primary). */
  readonly va: number;
  readonly vb: number;
}

interface SPhone {
  readonly sym: string;
  readonly vowel: boolean;
  readonly stress: Stress | null;
  readonly word: number;
  /** For nuclei: how many consonants make up this syllable's onset. */
  readonly onsetLen: number;
}

interface Stream {
  readonly phones: SPhone[];
  readonly vowels: number[];
  readonly prevVowel: number[];
  readonly wordStart: number[];
  readonly wordEnd: number[];
  readonly sylEnd: number[];
  readonly sylRefs: SyllableRef[];
  readonly raw: string[];
  readonly text: string[];
  readonly approx: boolean[];
}

/** One pronunciation of a site's word, with the line flattened around it. */
interface Variant {
  readonly stream: Stream;
  /** Phone index just past the end of the word. */
  readonly end: number;
  readonly tailLen: number;
  readonly tailVowels: number;
}

interface Site {
  readonly id: number;
  readonly line: number;
  readonly word: number;
  readonly position: 'end' | 'internal';
  /** Primary pronunciation first, then CMU alternates ("sow" is S AW1 or S OW1). */
  readonly variants: Variant[];
}

const DEFAULT_STOP_WORDS = [
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as', 'is', 'it', 'i', "i'm", 'my', 'me',
  'you', 'your', 'we', 'he', 'she', 'they', 'be', 'am', 'are', 'was', 'that', 'this', 'there', 'so', 'how',
];

/* ── Streams: a line flattened into phones ───────────────── */

function buildStream(line: AnalyzedLine, swap?: { word: number; pronunciation: Pronunciation }): Stream {
  const phones: SPhone[] = [];
  const wordStart: number[] = [];
  const wordEnd: number[] = [];
  const sylEnd: number[] = [];
  const sylRefs: SyllableRef[] = [];
  line.words.forEach((w, wi) => {
    wordStart.push(phones.length);
    (swap?.word === wi ? swap.pronunciation : w.pronunciation).syllables.forEach((syl, si) => {
      for (const p of syl.onset) phones.push({ sym: p.symbol, vowel: false, stress: null, word: wi, onsetLen: 0 });
      phones.push({ sym: syl.nucleus.symbol, vowel: true, stress: syl.stress, word: wi, onsetLen: syl.onset.length });
      for (const p of syl.coda) phones.push({ sym: p.symbol, vowel: false, stress: null, word: wi, onsetLen: 0 });
      sylRefs.push({ word: wi, syllable: si });
    });
    wordEnd.push(phones.length);
    sylEnd.push(sylRefs.length);
  });
  const vowels: number[] = [];
  const prevVowel: number[] = [];
  let last = -1;
  phones.forEach((p, i) => {
    prevVowel.push(last);
    if (p.vowel) {
      vowels.push(i);
      last = i;
    }
  });
  return {
    phones,
    vowels,
    prevVowel,
    wordStart,
    wordEnd,
    sylEnd,
    sylRefs,
    raw: line.words.map((w) => w.raw),
    text: line.words.map((w) => w.text),
    approx: line.words.map((w) => w.pronunciation.approximate),
  };
}

/* ── Exact (perfect + multisyllabic) ─────────────────────── */

const firstVowelFrom = (s: Stream, from: number, to: number): number => {
  for (let i = from; i < to; i++) if (s.phones[i]!.vowel) return i;
  return -1;
};

const symbols = (s: Stream, from: number, to: number): string => s.phones.slice(from, to).map((p) => p.sym).join(' ');

function exactLink(a: Variant, b: Variant, multi: boolean): Link | null {
  const T = Math.max(a.tailLen, b.tailLen);
  if (a.end < T || b.end < T) return null;
  const pa = a.stream.phones;
  const pb = b.stream.phones;

  // Identical phones walking back from both word ends.
  const cap = multi ? Math.min(a.end, b.end) : T;
  let k = 0;
  while (k < cap && pa[a.end - 1 - k]!.sym === pb[b.end - 1 - k]!.sym) k++;
  if (k < T) return null;

  let curA = firstVowelFrom(a.stream, a.end - k, a.end);
  let curB = firstVowelFrom(b.stream, b.end - k, b.end);
  if (curA < 0 || curB < 0) return null;
  let syllables = a.stream.vowels.filter((v) => v >= curA && v < a.end).length;

  // Earlier syllables: same vowel and same coda; the onset of the syllable after it may differ.
  // Repeated words never count: "I'm fly" / "I'm shy" is one syllable of rhyme, not two.
  if (multi) {
    for (;;) {
      const prevA = a.stream.prevVowel[curA]!;
      const prevB = b.stream.prevVowel[curB]!;
      if (prevA < 0 || prevB < 0) break;
      if (pa[prevA]!.sym !== pb[prevB]!.sym) break;
      const codaA = symbols(a.stream, prevA + 1, curA - pa[curA]!.onsetLen);
      const codaB = symbols(b.stream, prevB + 1, curB - pb[curB]!.onsetLen);
      if (codaA !== codaB) break;
      if (a.stream.text[pa[prevA]!.word] === b.stream.text[pb[prevB]!.word]) break;
      curA = prevA;
      curB = prevB;
      syllables++;
    }
  }

  // Identical sound from the first matched onset on: a repeat, not a rhyme.
  const same = symbols(a.stream, curA - pa[curA]!.onsetLen, a.end) === symbols(b.stream, curB - pb[curB]!.onsetLen, b.end);
  const t = Math.max(a.tailVowels, b.tailVowels);
  if (same) return { kind: 'repeat', syllables: t, cost: 0, va: 0, vb: 0 };
  return { kind: syllables > t ? 'multi' : 'perfect', syllables, cost: 0, va: 0, vb: 0 };
}

/* ── Slant ───────────────────────────────────────────────── */

/** Last `n` vowels of a site, each with the consonants that follow it (up to the next vowel or the word end). */
function chunks(site: Variant, n: number): { vowel: string; consonants: string[] }[] | null {
  const vs = site.stream.vowels.filter((v) => v < site.end);
  if (vs.length < n) return null;
  return vs.slice(vs.length - n).map((v, i, arr) => {
    const stop = arr[i + 1] ?? site.end;
    return { vowel: site.stream.phones[v]!.sym, consonants: site.stream.phones.slice(v + 1, stop).map((p) => p.sym) };
  });
}

function slantLink(a: Variant, b: Variant, tolerance: number): Link | null {
  const n = Math.max(a.tailVowels, b.tailVowels);
  const ca = chunks(a, n);
  const cb = chunks(b, n);
  if (!ca || !cb) return null;
  let total = 0;
  let slots = 0;
  for (let i = 0; i < n; i++) {
    if (ca[i]!.vowel !== cb[i]!.vowel) return null;
    total += clusterCost(ca[i]!.consonants, cb[i]!.consonants);
    slots += Math.max(ca[i]!.consonants.length, cb[i]!.consonants.length);
  }
  if (slots === 0 || total === 0) return null;
  const cost = total / slots;
  return cost <= tolerance ? { kind: 'slant', syllables: n, cost, va: 0, vb: 0 } : null;
}

/** The word at `wi` read up to its end, tail anchored on its last stressed vowel. Null if it has none. */
function variantAt(stream: Stream, wi: number): Variant | null {
  const start = stream.wordStart[wi]!;
  const end = stream.wordEnd[wi]!;
  for (let i = end - 1; i >= start; i--) {
    const p = stream.phones[i]!;
    if (p.vowel && p.stress !== null && p.stress >= 1) {
      return { stream, end, tailLen: end - i, tailVowels: stream.vowels.filter((v) => v >= i && v < end).length };
    }
  }
  return null;
}

/** Best link over every pronunciation pairing: exact beats slant, primary beats alternates. */
function bestLink(a: Site, b: Site, multi: boolean, wantExact: boolean, tolerance: number, wantSlant: boolean): Link | null {
  let repeat: Link | null = null;
  let slant: Link | null = null;
  for (let x = 0; x < a.variants.length; x++) {
    for (let y = 0; y < b.variants.length; y++) {
      if (wantExact) {
        const e = exactLink(a.variants[x]!, b.variants[y]!, multi);
        if (e && e.kind !== 'repeat') return { ...e, va: x, vb: y };
        if (e && !repeat) repeat = { ...e, va: x, vb: y };
      }
      if (wantSlant && !repeat) {
        const l = slantLink(a.variants[x]!, b.variants[y]!, tolerance);
        if (l && (!slant || l.cost < slant.cost)) slant = { ...l, va: x, vb: y };
      }
    }
  }
  return repeat ?? slant;
}

/* ── Detection ───────────────────────────────────────────── */

export function detectRhymes(verse: AnalyzedVerse, options: RhymeOptions = {}): RhymeChain[] {
  const modes = new Set<RhymeKind>(options.modes ?? ['perfect', 'multi', 'slant']);
  const tolerance = options.slantTolerance ?? 0.3;
  const internal = options.internalRhymes ?? true;
  const scope = options.internalScope ?? 'line';
  const stops = new Set(options.internalStopWords ?? DEFAULT_STOP_WORDS);
  const allowRepeats = options.allowRepeats ?? false;

  /* sites */
  const sites: Site[] = [];
  verse.lines.forEach((line, li) => {
    const stream = buildStream(line);
    line.words.forEach((w, wi) => {
      const position = wi === line.words.length - 1 ? 'end' : 'internal';
      if (position === 'internal' && (!internal || stops.has(w.text))) return;
      const variants = [stream, ...w.alternates.map((alt) => buildStream(line, { word: wi, pronunciation: alt }))]
        .map((st) => variantAt(st, wi))
        .filter((v): v is Variant => v !== null);
      if (variants.length === 0) return;
      sites.push({ id: sites.length, line: li, word: wi, position, variants });
    });
  });

  /* pairwise links */
  const n = sites.length;
  const key = (i: number, j: number): number => (i < j ? i * n + j : j * n + i);
  const links = new Map<number, Link>();
  const compared = new Set<number>();
  const wantExact = modes.has('perfect') || modes.has('multi');
  const wantSlant = modes.has('slant') && tolerance > 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sites[i]!;
      const b = sites[j]!;
      const bothEnd = a.position === 'end' && b.position === 'end';
      if (!bothEnd && !(a.line === b.line || scope === 'verse')) continue;
      compared.add(key(i, j));

      let link = bestLink(a, b, modes.has('multi'), wantExact, tolerance, wantSlant);
      if (link?.kind === 'repeat') {
        link = allowRepeats ? { ...link, kind: 'perfect' } : link;
      } else if (link && link.kind !== 'slant' && !modes.has(link.kind)) {
        link = null; // e.g. a multi match when only 'perfect' was asked for
      }
      if (link) links.set(key(i, j), link);
    }
  }

  /* clusters: strongest edges first, merge only when every compared pair across the two sides is linked */
  const strength = (l: Link): number => (l.kind === 'slant' ? 500 - l.cost * 100 : 1000 + l.syllables * 10 + (l.kind === 'multi' ? 5 : 0));
  const edges = [...links]
    .filter(([, l]) => l.kind !== 'repeat')
    .map(([k, l]) => ({ i: Math.floor(k / n), j: k % n, l }))
    .sort((x, y) => strength(y.l) - strength(x.l) || x.i - y.i || x.j - y.j);

  const chosen = new Map<number, number>(); // site -> pronunciation index used by its strongest link
  const clusterOf = sites.map((_, i) => i);
  const clusters = new Map<number, number[]>(sites.map((_, i) => [i, [i]]));
  const compatible = (x: readonly number[], y: readonly number[]): boolean =>
    x.every((p) => y.every((q) => !compared.has(key(p, q)) || links.has(key(p, q))));

  for (const { i, j, l } of edges) {
    const ci = clusterOf[i]!;
    const cj = clusterOf[j]!;
    if (ci === cj) continue;
    const left = clusters.get(ci)!;
    const right = clusters.get(cj)!;
    if (!compatible(left, right)) continue;
    if (!chosen.has(i)) chosen.set(i, l.va);
    if (!chosen.has(j)) chosen.set(j, l.vb);
    for (const s of right) clusterOf[s] = ci;
    clusters.set(ci, [...left, ...right]);
    clusters.delete(cj);
  }

  /* chains */
  const rank: Record<RhymeKind, number> = { slant: 0, perfect: 1, multi: 2 };
  const raw = [...clusters.values()]
    .filter((c) => c.length >= 2)
    .map((c) => c.slice().sort((x, y) => x - y)) // site ids are in reading order
    .map((ids) => {
      let weakest = 2;
      let syllables = Infinity;
      let slantCost = 0;
      for (let x = 0; x < ids.length; x++) {
        for (let y = x + 1; y < ids.length; y++) {
          const l = links.get(key(ids[x]!, ids[y]!));
          if (!l || l.kind === 'repeat') continue;
          weakest = Math.min(weakest, rank[l.kind]);
          syllables = Math.min(syllables, l.syllables);
          slantCost = Math.max(slantCost, l.cost);
        }
      }
      return { ids, kind: (['slant', 'perfect', 'multi'] as const)[weakest]!, syllables, slantCost };
    })
    .sort((x, y) => x.ids[0]! - y.ids[0]!);

  const built = raw.map(({ ids, kind, syllables, slantCost }) => {
    const members = ids.map((id): RhymeMember => {
      const s = sites[id]!;
      const st = (s.variants[chosen.get(id) ?? 0] ?? s.variants[0]!).stream;
      const endIdx = st.sylEnd[s.word]! - 1;
      const startIdx = Math.max(0, endIdx - syllables + 1);
      const start = st.sylRefs[startIdx]!;
      const end = st.sylRefs[endIdx]!;
      const covered = Array.from({ length: end.word - start.word + 1 }, (_, o) => start.word + o);
      return {
        line: s.line,
        start,
        end,
        text: covered.map((w) => st.raw[w]).join(' '),
        position: s.position,
        approximate: covered.some((w) => st.approx[w]),
      };
    });

    const longest = ids
      .map((id) => sites[id]!)
      .map((s) => s.variants[chosen.get(s.id) ?? 0] ?? s.variants[0]!)
      .reduce((best, v) => (v.tailLen > best.tailLen ? v : best));
    const tail = longest.stream.phones.slice(longest.end - longest.tailLen, longest.end);
    const sound = (kind === 'slant' ? tail.filter((p) => p.vowel) : tail).map((p) => p.sym).join(' ');
    const base = sound.toLowerCase().replace(/ /g, '-') + (kind === 'slant' ? '~' : '');
    return { id: base, kind, syllables, sound, members, approximate: members.some((m) => m.approximate), slantCost } satisfies RhymeChain;
  });

  /* A chain whose every member sits inside a member of one longer chain is redundant:
     "bad"/"mad" next to the multi "bad habit"/"mad rabbit". Drop it, then number duplicate IDs. */
  const before = (x: SyllableRef, y: SyllableRef): boolean => x.word < y.word || (x.word === y.word && x.syllable <= y.syllable);
  const inside = (inner: RhymeMember, outer: RhymeMember): boolean =>
    inner.line === outer.line && before(outer.start, inner.start) && before(inner.end, outer.end);
  const kept = built.filter((x) => !built.some((y) => y !== x && y.syllables > x.syllables && x.members.every((m) => y.members.some((o) => inside(m, o)))));

  const used = new Map<string, number>();
  return kept.map((c): RhymeChain => {
    const seen = (used.get(c.id) ?? 0) + 1;
    used.set(c.id, seen);
    return seen === 1 ? c : { ...c, id: `${c.id}-${seen}` };
  });
}
