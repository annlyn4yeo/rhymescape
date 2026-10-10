import { isVowel } from './arpabet';
import type { Phone, Stress, Syllable } from './types';

/* Legal English onsets, for the maximal-onset principle. Single consonants are legal except NG. */
const LEGAL_ONSETS: ReadonlySet<string> = new Set([
  'P L', 'P R', 'P Y', 'B L', 'B R', 'B Y', 'T R', 'T W', 'T Y', 'D R', 'D W', 'D Y', 'K L', 'K R', 'K W', 'K Y', 'G L', 'G R', 'G W', 'G Y',
  'F L', 'F R', 'F Y', 'V Y', 'TH R', 'TH W', 'TH Y', 'SH R', 'S L', 'S W', 'S M', 'S N', 'S P', 'S T', 'S K', 'S F', 'M Y', 'N Y', 'HH Y', 'L Y',
  'S P L', 'S P R', 'S P Y', 'S T R', 'S T Y', 'S K R', 'S K W', 'S K L', 'S K Y',
]);

const isLegalOnset = (cluster: readonly Phone[]): boolean => {
  if (cluster.length === 0) return true;
  if (cluster.length === 1) return cluster[0]!.symbol !== 'NG';
  return LEGAL_ONSETS.has(cluster.map((p) => p.symbol).join(' '));
};

/**
 * Splits phones into syllables with the maximal-onset principle.
 * `spelling` (optional) is sliced alongside so each syllable gets display text.
 */
export function syllabify(phones: readonly Phone[], spelling = ''): Syllable[] {
  const vowelIdx = phones.flatMap((p, i) => (isVowel(p.symbol) ? [i] : []));
  if (vowelIdx.length === 0) return syllabicConsonant(phones, spelling);

  // start[i]: where syllable i begins; syllable i spans start[i] .. start[i+1]
  const starts: number[] = [0];
  for (let v = 0; v < vowelIdx.length - 1; v++) {
    const a = vowelIdx[v]! + 1;
    const b = vowelIdx[v + 1]!;
    let k = a;
    while (k < b && !isLegalOnset(phones.slice(k, b))) k++;
    starts.push(k);
  }

  const bounds = [...starts, phones.length];
  const raw = vowelIdx.map((vi, i) => {
    const from = bounds[i]!;
    const to = bounds[i + 1]!;
    return { onset: phones.slice(from, vi), nucleus: phones[vi]!, coda: phones.slice(vi + 1, to) };
  });
  const texts = splitSpelling(spelling, raw.map((s) => s.onset.length + 1 + s.coda.length));
  return raw.map((s, i) => ({ ...s, stress: (s.nucleus.stress ?? 0) as Stress, text: texts[i]! }));
}

/** Words with no vowel ("hmm", "shh"): the last sonorant, else the last phone, acts as the nucleus. */
function syllabicConsonant(phones: readonly Phone[], spelling: string): Syllable[] {
  if (phones.length === 0) return [];
  let at = phones.length - 1;
  for (let i = phones.length - 1; i >= 0; i--) {
    if (['M', 'N', 'L', 'R', 'NG'].includes(phones[i]!.symbol)) {
      at = i;
      break;
    }
  }
  return [{ onset: phones.slice(0, at), nucleus: phones[at]!, coda: phones.slice(at + 1), stress: 1, text: spelling }];
}

/* ── Spelling slices ────────────────────────────────────── */

const DIGRAPHS = new Set(['th', 'sh', 'ch', 'ph', 'ck', 'ng', 'qu', 'gh', 'wh']);

/** Best-effort. Boundaries sit near the proportional position, preferring V|CV and avoiding split digraphs. */
function splitSpelling(spelling: string, phoneCounts: readonly number[]): string[] {
  const n = phoneCounts.length;
  if (n <= 1 || spelling.length < n) return phoneCounts.map((_, i) => (i === 0 ? spelling : ''));

  const letters = spelling.toLowerCase();
  const total = phoneCounts.reduce((a, b) => a + b, 0);
  const isV = (i: number): boolean => {
    const c = letters[i] ?? '';
    if ('aeiou'.includes(c)) return true;
    return (c === 'w' || c === 'y') && i > 0 && 'aeiou'.includes(letters[i - 1] ?? '');
  };

  const cuts: number[] = [];
  let before = 0;
  for (let j = 1; j < n; j++) {
    before += phoneCounts[j - 1]!;
    const target = Math.round((before / total) * letters.length);
    const lo = (cuts[cuts.length - 1] ?? 0) + 1;
    const hi = letters.length - (n - j);
    let best = Math.min(Math.max(target, lo), hi);
    let bestCost = Infinity;
    for (let p = lo; p <= hi; p++) {
      let cost = Math.abs(p - target);
      const left = isV(p - 1);
      const right = isV(p);
      if (left && !right) cost += 0; // V|C  (the C starts the next syllable)
      else if (!left && !right) cost += 0.4; // C|C
      else if (left && right) cost += 0.5; // V|V
      else cost += 1.5; // C|V splits a consonant from its vowel
      if (DIGRAPHS.has(letters.slice(p - 1, p + 1))) cost += 3;
      if (cost < bestCost) {
        bestCost = cost;
        best = p;
      }
    }
    cuts.push(best);
  }
  const edges = [0, ...cuts, spelling.length];
  return phoneCounts.map((_, i) => spelling.slice(edges[i]!, edges[i + 1]!));
}
