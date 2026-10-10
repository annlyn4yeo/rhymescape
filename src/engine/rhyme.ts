import { clusterCost } from './consonants';
import type { AnalyzedLine, AnalyzedVerse, Pronunciation, RhymeChain, RhymeKind, RhymeMember, RhymeOptions, Stress, SyllableRef } from './types';

/*
 * Rhyme detection. Overview (full write-up in docs/rhyme-algorithm.md):
 *
 *  1. Every word that has a stressed vowel becomes a "site": the line read up to the end of that word.
 *     A site's tail runs from the word's last stressed vowel to the word's end. Two more kinds of site
 *     catch what sits off the word edge: "partial" sites stop after a stressed syllable inside a word
 *     ("chop" of "chopper"), and "phrase" sites end on a trailing function word ("bet it", "went in").
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
  /** Reduced vowel: unstressed, or the vowel of a one-syllable function word. These blur into each other (vomit / on it). */
  readonly weak: boolean;
  readonly word: number;
  /** For nuclei: how many consonants make up this syllable's onset. */
  readonly onsetLen: number;
}

interface Stream {
  readonly phones: SPhone[];
  readonly vowels: number[];
  /** vowelsBefore[i] = number of vowels in phones[0, i). Length phones.length + 1. */
  readonly vowelsBefore: number[];
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
  /** The tail stops inside its word. */
  readonly partial: boolean;
  /** The tail runs on into a trailing function word ("bet it"). */
  readonly phrase: boolean;
}

interface Site {
  readonly id: number;
  readonly line: number;
  readonly word: number;
  readonly form: 'whole' | 'partial' | 'phrase';
  readonly position: 'end' | 'internal';
  /** Primary pronunciation first, then CMU alternates ("sow" is S AW1 or S OW1). */
  readonly variants: Variant[];
}

const DEFAULT_STOP_WORDS = [
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as', 'is', 'it', 'i', "i'm", 'my', 'me',
  'you', 'your', 'we', 'he', 'she', 'they', 'be', 'am', 'are', 'was', 'that', 'this', 'there', 'so', 'how',
];

/** Small words that trail a rhyming word and borrow its sound: "bet it", "went in", "lot of it", "give him". */
const PHRASE_ENDINGS: ReadonlySet<string> = new Set([
  'it', 'em', "'em", 'him', 'her', 'us', 'them', 'me', 'you', 'up', 'out', 'in', 'on', 'off', 'of', 'to', 'at',
]);

/** Pronouns can sit one word further from what they trail: "lot of it", "go for it". */
const PHRASE_PRONOUNS: ReadonlySet<string> = new Set(['it', 'em', "'em", 'him', 'her', 'us', 'them']);

/* ── Streams: a line flattened into phones ───────────────── */

function buildStream(line: AnalyzedLine, weakWords: ReadonlySet<string>, swap?: { word: number; pronunciation: Pronunciation }): Stream {
  const phones: SPhone[] = [];
  const wordStart: number[] = [];
  const wordEnd: number[] = [];
  const sylEnd: number[] = [];
  const sylRefs: SyllableRef[] = [];
  line.words.forEach((w, wi) => {
    wordStart.push(phones.length);
    const pron = swap?.word === wi ? swap.pronunciation : w.pronunciation;
    const functionWord = pron.syllables.length === 1 && weakWords.has(w.text);
    pron.syllables.forEach((syl, si) => {
      for (const p of syl.onset) phones.push({ sym: p.symbol, vowel: false, stress: null, weak: false, word: wi, onsetLen: 0 });
      phones.push({ sym: syl.nucleus.symbol, vowel: true, stress: syl.stress, weak: syl.stress === 0 || functionWord, word: wi, onsetLen: syl.onset.length });
      for (const p of syl.coda) phones.push({ sym: p.symbol, vowel: false, stress: null, weak: false, word: wi, onsetLen: 0 });
      sylRefs.push({ word: wi, syllable: si });
    });
    wordEnd.push(phones.length);
    sylEnd.push(sylRefs.length);
  });
  const vowels: number[] = [];
  const vowelsBefore: number[] = [0];
  const prevVowel: number[] = [];
  let last = -1;
  phones.forEach((p, i) => {
    prevVowel.push(last);
    if (p.vowel) {
      vowels.push(i);
      last = i;
    }
    vowelsBefore.push(vowels.length);
  });
  return {
    phones,
    vowels,
    vowelsBefore,
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

/** Unstressed "uh", "ih" and "er" are one lazy mouth shape in rap: "vomit" rhymes with "on it", "sweater" with "bet a". */
const REDUCED: ReadonlySet<string> = new Set(['AH', 'IH', 'ER']);

/** Same sound, or two reduced vowels (both must be weak, so a stressed "cut" never matches a bare "it"). */
const alike = (x: SPhone, y: SPhone): boolean => x.sym === y.sym || (x.weak && y.weak && x.vowel && y.vowel && REDUCED.has(x.sym) && REDUCED.has(y.sym));

function exactLink(a: Variant, b: Variant, multi: boolean): Link | null {
  const T = Math.max(a.tailLen, b.tailLen);
  if (a.end < T || b.end < T) return null;
  const pa = a.stream.phones;
  const pb = b.stream.phones;

  // Identical phones walking back from both word ends.
  const cap = multi ? Math.min(a.end, b.end) : T;
  let k = 0;
  while (k < cap && alike(pa[a.end - 1 - k]!, pb[b.end - 1 - k]!)) k++;
  if (k < T) return null;

  let curA = firstVowelFrom(a.stream, a.end - k, a.end);
  let curB = firstVowelFrom(b.stream, b.end - k, b.end);
  if (curA < 0 || curB < 0) return null;
  let syllables = a.stream.vowelsBefore[a.end]! - a.stream.vowelsBefore[curA]!;

  // Earlier syllables: same vowel and same coda; the onset of the syllable after it may differ.
  // Repeated words never count: "I'm fly" / "I'm shy" is one syllable of rhyme, not two.
  if (multi) {
    for (;;) {
      const prevA = a.stream.prevVowel[curA]!;
      const prevB = b.stream.prevVowel[curB]!;
      if (prevA < 0 || prevB < 0) break;
      if (!alike(pa[prevA]!, pb[prevB]!)) break;
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

/** Last `n` vowels of a site, each with the consonants that follow it (up to the next vowel or the site end). */
function chunks(site: Variant, n: number): { vowel: SPhone; consonants: string[] }[] | null {
  const upTo = site.stream.vowelsBefore[site.end]!;
  if (upTo < n) return null;
  return site.stream.vowels.slice(upTo - n, upTo).map((v, i, arr) => {
    const stop = arr[i + 1] ?? site.end;
    return { vowel: site.stream.phones[v]!, consonants: site.stream.phones.slice(v + 1, stop).map((p) => p.sym) };
  });
}

/** The vowel that ends the site's sound: the last one before its end. */
const lastVowel = (v: Variant): SPhone | undefined => {
  const i = v.stream.vowelsBefore[v.end]! - 1;
  return i < 0 ? undefined : v.stream.phones[v.stream.vowels[i]!];
};

function slantLink(a: Variant, b: Variant, tolerance: number): Link | null {
  // Different final vowels can never be a slant rhyme; this rejects most pairs without allocating.
  const la = lastVowel(a);
  const lb = lastVowel(b);
  if (!la || !lb || !alike(la, lb)) return null;
  const n = Math.max(a.tailVowels, b.tailVowels);
  const ca = chunks(a, n);
  const cb = chunks(b, n);
  if (!ca || !cb) return null;
  let total = 0;
  let slots = 0;
  for (let i = 0; i < n; i++) {
    if (!alike(ca[i]!.vowel, cb[i]!.vowel)) return null;
    // A trailing function word has to line up consonant for consonant ("shell a" is not "hell of").
    if ((a.phrase || b.phrase) && ca[i]!.consonants.length !== cb[i]!.consonants.length) return null;
    total += clusterCost(ca[i]!.consonants, cb[i]!.consonants);
    slots += Math.max(ca[i]!.consonants.length, cb[i]!.consonants.length);
  }
  if (slots === 0 || total === 0) return null;
  const cost = total / slots;
  return cost <= tolerance ? { kind: 'slant', syllables: n, cost, va: 0, vb: 0 } : null;
}

const isStressed = (p: SPhone): boolean => p.vowel && p.stress !== null && p.stress >= 1;

/** The tail that starts at phone `from` and runs to `end`. */
const tailVariant = (stream: Stream, from: number, end: number, kind: 'whole' | 'partial' | 'phrase'): Variant => ({
  stream,
  end,
  tailLen: end - from,
  tailVowels: stream.vowelsBefore[end]! - stream.vowelsBefore[from]!,
  partial: kind === 'partial',
  phrase: kind === 'phrase',
});

/** The word at `wi` read up to its end, tail anchored on its last stressed vowel. Null if it has none. */
function variantAt(stream: Stream, wi: number): Variant | null {
  const start = stream.wordStart[wi]!;
  const end = stream.wordEnd[wi]!;
  for (let i = end - 1; i >= start; i--) if (isStressed(stream.phones[i]!)) return tailVariant(stream, i, end, 'whole');
  return null;
}

/** Short vowels pull the consonant after them into their own syllable: "chop-per", "bet-ter", not "pay-per". */
const LAX: ReadonlySet<string> = new Set(['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'UH', 'ER']);

/**
 * Primary-stressed vowels of the word at `wi` that are followed by more of the word: the places a mid-word rhyme can end.
 * The rhyme part is the vowel plus the consonants that close its syllable. The syllabifier hands an in-between
 * consonant to the next syllable, so a short stressed vowel with nothing after it takes that consonant back.
 */
function partialVariants(stream: Stream, wi: number): Variant[] {
  const start = stream.wordStart[wi]!;
  const end = stream.wordEnd[wi]!;
  const out: Variant[] = [];
  for (let i = start; i < end; i++) {
    const p = stream.phones[i]!;
    if (!p.vowel || p.stress !== 1) continue; // secondary stress is too faint to anchor a rhyme on its own
    const next = stream.vowels[stream.vowelsBefore[i + 1]!]; // first vowel after this one
    if (next === undefined || next >= end) continue; // last syllable of the word: that is the whole-word site
    let stop = next - stream.phones[next]!.onsetLen;
    if (stop === i + 1) {
      // Open syllable: only a short vowel borrows the next consonant, and only if there is one to borrow.
      if (!LAX.has(p.sym) || stream.phones[next]!.onsetLen === 0) continue;
      stop++;
    }
    out.push(tailVariant(stream, i, stop, 'partial'));
  }
  return out;
}

/**
 * A phrase that ends on the function word at `wi` ("bet it", "went in", "lot of it"): the tail starts at the
 * stressed vowel of the nearest content word one word back (two for a pronoun), or the nearest stressed word if there is none.
 */
function phraseVariant(stream: Stream, wi: number, weakWords: ReadonlySet<string>): Variant | null {
  let fallback = -1;
  const reach = PHRASE_PRONOUNS.has(stream.text[wi]!) ? 2 : 1;
  for (let back = 1; back <= reach && wi - back >= 0; back++) {
    const w = wi - back;
    let at = -1;
    for (let i = stream.wordEnd[w]! - 1; i >= stream.wordStart[w]!; i--) {
      if (isStressed(stream.phones[i]!)) {
        at = i;
        break;
      }
    }
    if (at < 0) continue;
    if (!weakWords.has(stream.text[w]!)) return tailVariant(stream, at, stream.wordEnd[wi]!, 'phrase');
    if (fallback < 0) fallback = at;
  }
  return fallback < 0 ? null : tailVariant(stream, fallback, stream.wordEnd[wi]!, 'phrase');
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
  const scope = options.internalScope ?? 'nearby';
  const window = scope === 'line' ? 0 : scope === 'verse' ? Infinity : Math.max(0, options.internalWindow ?? 2);
  const midWord = (options.midWord ?? true) && internal;
  const stops = new Set(options.internalStopWords ?? DEFAULT_STOP_WORDS);
  const allowRepeats = options.allowRepeats ?? false;

  /* sites */
  const sites: Site[] = [];
  verse.lines.forEach((line, li) => {
    const stream = buildStream(line, stops);
    line.words.forEach((w, wi) => {
      const position = wi === line.words.length - 1 ? 'end' : 'internal';
      const add = (form: Site['form'], variants: Variant[], where: Site['position'] = position): void => {
        if (variants.length) sites.push({ id: sites.length, line: li, word: wi, form, position: where, variants });
      };

      // A trailing function word reads together with what leads into it: "bet it", "lot of it".
      if (wi > 0 && PHRASE_ENDINGS.has(w.text) && (internal || position === 'end')) {
        const phrase = phraseVariant(stream, wi, stops);
        if (phrase) add('phrase', [phrase]);
      }

      if (position === 'internal' && (!internal || stops.has(w.text))) return;
      const whole = [stream, ...w.alternates.map((alt) => buildStream(line, stops, { word: wi, pronunciation: alt }))]
        .map((st) => variantAt(st, wi))
        .filter((v): v is Variant => v !== null);
      add('whole', whole);
      if (midWord) for (const v of partialVariants(stream, wi)) add('partial', [v], 'internal');
    });
  });

  /* pairwise links */
  const n = sites.length;
  const key = (i: number, j: number): number => (i < j ? i * n + j : j * n + i);
  const links = new Map<number, Link>();
  const wantExact = modes.has('perfect') || modes.has('multi');
  const wantSlant = modes.has('slant') && tolerance > 0;

  // Which pairs are ever compared: end words with end words, anything with a word of its own line, internal
  // words with nearby lines (never a mid-word site: it stays within its line), and (scope 'verse') everything.
  // Only those are generated, and only those can block a merge later.
  const isCompared = (a: Site, b: Site): boolean => {
    if (a.line === b.line || scope === 'verse') return true;
    if (a.position === 'end' && b.position === 'end') return true;
    return a.form !== 'partial' && b.form !== 'partial' && Math.abs(a.line - b.line) <= window;
  };

  const tried = new Set<number>();
  const consider = (i: number, j: number): void => {
    if (tried.has(key(i, j))) return;
    tried.add(key(i, j));
    const a = sites[i]!;
    const b = sites[j]!;
    let link = bestLink(a, b, modes.has('multi'), wantExact, tolerance, wantSlant);
    // Across lines, an internal word has less going for it than an end word: a lone slanted syllable is noise.
    if (link?.kind === 'slant' && link.syllables < 2 && a.line !== b.line && !(a.position === 'end' && b.position === 'end')) link = null;
    if (link?.kind === 'repeat') {
      link = allowRepeats ? { ...link, kind: 'perfect' } : link;
    } else if (link && link.kind !== 'slant' && !modes.has(link.kind)) {
      link = null; // e.g. a multi match when only 'perfect' was asked for
    }
    if (link) links.set(key(i, j), link);
  };

  const endIds = sites.filter((x) => x.position === 'end').map((x) => x.id);
  const lineSites: number[][] = [];
  for (const x of sites) (lineSites[x.line] ??= []).push(x.id);
  let nextEnd = 0; // index into endIds of the first end site after the current one
  for (let i = 0; i < n; i++) {
    const a = sites[i]!;
    if (scope === 'verse') {
      for (let j = i + 1; j < n; j++) consider(i, j);
      continue;
    }
    for (let l = a.line; l <= Math.min(a.line + window, lineSites.length - 1); l++) {
      for (const j of lineSites[l] ?? []) {
        if (j > i && (l === a.line || (a.form !== 'partial' && sites[j]!.form !== 'partial'))) consider(i, j);
      }
    }
    if (a.position === 'end') {
      while (nextEnd < endIds.length && endIds[nextEnd]! <= i) nextEnd++;
      for (let e = nextEnd; e < endIds.length; e++) consider(i, endIds[e]!);
    }
  }

  /* clusters: strongest edges first, merge only when every compared pair across the two sides is linked */
  const strength = (l: Link, a: Site, b: Site): number => {
    if (l.kind === 'slant') return 500 - l.cost * 100;
    const midWordPenalty = a.form === 'partial' || b.form === 'partial' ? 300 : 0;
    return 1000 - midWordPenalty + l.syllables * 10 + (l.kind === 'multi' ? 5 : 0);
  };
  const edges = [...links]
    .filter(([, l]) => l.kind !== 'repeat')
    .map(([k, l]) => ({ i: Math.floor(k / n), j: k % n, l, w: strength(l, sites[Math.floor(k / n)]!, sites[k % n]!) }))
    .sort((x, y) => y.w - x.w || x.i - y.i || x.j - y.j);

  const chosen = new Map<number, number>(); // site -> pronunciation index used by its strongest link
  const clusterOf = sites.map((_, i) => i);
  const clusters = new Map<number, number[]>(sites.map((_, i) => [i, [i]]));
  // Two sites on one word (the whole word and a mid-word slice of it) never share a chain.
  const sameWord = (a: Site, b: Site): boolean => a.line === b.line && a.word === b.word;
  const compatible = (x: readonly number[], y: readonly number[]): boolean =>
    x.every((p) => y.every((q) => !sameWord(sites[p]!, sites[q]!) && (!isCompared(sites[p]!, sites[q]!) || links.has(key(p, q)))));

  // Clusters that grew from exact links only. Two of them stay apart even when their sounds are close enough
  // to slant ("stop/top" and "clock/block"): they are two rhymes, not one loose one.
  const exactCore = new Set<number>();
  for (const { i, j, l } of edges) {
    const ci = clusterOf[i]!;
    const cj = clusterOf[j]!;
    if (ci === cj) continue;
    const left = clusters.get(ci)!;
    const right = clusters.get(cj)!;
    if (l.kind === 'slant' && exactCore.has(ci) && exactCore.has(cj)) continue;
    if (!compatible(left, right)) continue;
    const bothExact = l.kind !== 'slant' && (left.length === 1 || exactCore.has(ci)) && (right.length === 1 || exactCore.has(cj));
    exactCore.delete(cj);
    if (bothExact) exactCore.add(ci);
    else exactCore.delete(ci);
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
      const v = s.variants[chosen.get(id) ?? 0] ?? s.variants[0]!;
      const st = v.stream;
      const endIdx = st.vowelsBefore[v.end]! - 1; // every syllable has one vowel-flagged nucleus, so this is a syllable index
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
        partial: v.partial,
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
  /* A mid-word member that a longer chain already claims ("bet" inside "better sweater") only adds noise. */
  const pruned = built
    .map((x) => {
      const members = x.members.filter((m) => !m.partial || !built.some((y) => y.syllables > x.syllables && y.members.some((o) => inside(m, o))));
      return members.length === x.members.length ? x : { ...x, members };
    })
    .filter((x) => x.members.length >= 2);
  const kept = pruned.filter((x) => !pruned.some((y) => y !== x && y.syllables > x.syllables && x.members.every((m) => y.members.some((o) => inside(m, o)))));

  const used = new Map<string, number>();
  return kept.map((c): RhymeChain => {
    const seen = (used.get(c.id) ?? 0) + 1;
    used.set(c.id, seen);
    return seen === 1 ? c : { ...c, id: `${c.id}-${seen}` };
  });
}
