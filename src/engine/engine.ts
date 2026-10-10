import { parseArpabet, vowel } from './arpabet';
import { guessPronunciation } from './guess';
import { numberToWords } from './numbers';
import { makePronunciation } from './pronunciation';
import { detectRhymes } from './rhyme';
import { SLANG } from './slang';
import { normalizeWord, tokenizeVerse } from './tokenize';
import type { AnalyzedLine, AnalyzedVerse, AnalyzedWord, CmuDict, Engine, EngineOptions, Phone, Pronunciation, PronunciationSource } from './types';

const SIBILANTS = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);
const VOICELESS = new Set(['P', 'T', 'K', 'F', 'TH']);

export function createEngine(dict: CmuDict, options: EngineOptions = {}): Engine {
  const overrides: Record<string, string> = { ...SLANG };
  for (const [word, arpabet] of Object.entries(options.overrides ?? {})) overrides[normalizeWord(word)] = arpabet;
  const expandNumbers = options.expandNumbers ?? true;
  const cache = new Map<string, { primary: Pronunciation; alternates: Pronunciation[] }>();

  const own = (key: string): boolean => Object.hasOwn(dict, key);
  const entries = (key: string): string[] | null => {
    if (Object.hasOwn(overrides, key)) return [overrides[key]!];
    if (!own(key)) return null;
    const e = dict[key]!;
    return typeof e === 'string' ? [e] : [...e];
  };
  /** Primary phones of a known word (dictionary or override). */
  const known = (key: string): Phone[] | null => {
    const e = entries(key);
    return e ? parseArpabet(e[0]!) : null;
  };
  const lastSymbol = (phones: readonly Phone[]): string => phones[phones.length - 1]?.symbol ?? '';

  /* ── Variants of known words ─────────────────────────── */

  const withS = (stem: Phone[]): Phone[] => {
    const last = lastSymbol(stem);
    if (SIBILANTS.has(last)) return [...stem, vowel('IH', 0), { symbol: 'Z', stress: null }];
    return [...stem, { symbol: VOICELESS.has(last) ? 'S' : 'Z', stress: null }];
  };
  const withEd = (stem: Phone[]): Phone[] => {
    const last = lastSymbol(stem);
    if (last === 'T' || last === 'D') return [...stem, vowel('IH', 0), { symbol: 'D', stress: null }];
    return [...stem, { symbol: VOICELESS.has(last) || last === 'S' || last === 'SH' || last === 'CH' ? 'T' : 'D', stress: null }];
  };
  const withIng = (stem: Phone[]): Phone[] => [...stem, vowel('IH', 0), { symbol: 'NG', stress: null }];

  /** Candidate stems for a suffixed spelling: "stalling" gives "stall", "stalle", "stal". */
  const stemsFor = (word: string, suffixLen: number): string[] => {
    const stem = word.slice(0, -suffixLen);
    const out = [stem, stem + 'e'];
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) out.push(stem.slice(0, -1));
    if (stem.endsWith('i')) out.push(stem.slice(0, -1) + 'y');
    return out;
  };
  const firstKnown = (candidates: string[]): Phone[] | null => {
    for (const c of candidates) {
      const p = c.length > 1 ? known(c) : null;
      if (p) return p;
    }
    return null;
  };

  const suffixed = (word: string): Phone[] | null => {
    if (word.length > 4 && word.endsWith('ing')) {
      const stem = firstKnown(stemsFor(word, 3));
      if (stem) return withIng(stem);
    }
    if (word.length > 3 && word.endsWith('ed')) {
      const stem = firstKnown(stemsFor(word, 2));
      if (stem) return withEd(stem);
    }
    if (word.length > 3 && word.endsWith('es')) {
      const stem = firstKnown(stemsFor(word, 2).slice(0, 1).concat(word.slice(0, -1)));
      if (stem) return withS(stem);
    }
    if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss')) {
      const stem = firstKnown([word.slice(0, -1)]);
      if (stem) return withS(stem);
    }
    return null;
  };

  /** Dropped-g slang: "ballin'" and "ballin" as "balling" with the final NG softened to N. */
  const droppedG = (base: string): Phone[] | null => {
    if (!base.endsWith('in') || base.length < 4) return null;
    const full = known(base + 'g') ?? suffixed(base + 'g');
    if (!full || lastSymbol(full) !== 'NG') return null;
    return [...full.slice(0, -1), { symbol: 'N', stress: null }];
  };

  const variant = (key: string): Phone[] | null => {
    if (key.startsWith("'") && key.length > 2) {
      const rest = key.slice(1);
      const p = known(rest) ?? variant(rest);
      if (p) return p;
    }
    if (key.endsWith("'") && key.length > 2) {
      const base = key.slice(0, -1);
      const p = droppedG(base) ?? known(base) ?? suffixed(base); // "ballin'" is slang even though CMU has the surname Ballin
      if (p) return p;
    }
    if (key.endsWith("'s") && key.length > 3) {
      const stem = known(key.slice(0, -2)) ?? droppedG(key.slice(0, -2));
      if (stem) return withS(stem);
    }
    const dropped = droppedG(key);
    if (dropped) return dropped;
    const collapsed = key.replace(/(.)\1{2,}/g, '$1$1');
    if (collapsed !== key) {
      const p = known(collapsed) ?? known(key.replace(/(.)\1{2,}/g, '$1')) ?? suffixed(collapsed);
      if (p) return p;
    }
    return suffixed(key);
  };

  /* ── Compounds and numbers ───────────────────────────── */

  const demote = (phones: Phone[]): Phone[] => phones.map((p) => (p.stress === 1 ? { ...p, stress: 2 } : p));

  const compound = (key: string): Phone[] | null => {
    if (!/^[a-z]+$/.test(key) || key.length < 6) return null;
    let best: { score: number; left: Phone[]; right: Phone[] } | null = null;
    for (let i = 3; i <= key.length - 3; i++) {
      const left = known(key.slice(0, i)) ?? suffixed(key.slice(0, i));
      const right = left ? (known(key.slice(i)) ?? suffixed(key.slice(i))) : null;
      if (!left || !right) continue;
      const score = Math.min(i, key.length - i) * 10 + i;
      if (!best || score > best.score) best = { score, left, right };
    }
    return best ? [...best.left, ...demote(best.right)] : null;
  };

  const numberPhones = (key: string): Phone[] | null => {
    if (!expandNumbers || !/^\d+$/.test(key)) return null;
    const out: Phone[] = [];
    for (const w of numberToWords(key)) {
      const p = known(w);
      if (p) out.push(...p);
    }
    return out.length ? out : null;
  };

  /* ── Public ──────────────────────────────────────────── */

  const dictionaryPronunciations = (key: string, spelling: string): Pronunciation[] | null => {
    const e = entries(key);
    return e ? e.map((a) => makePronunciation(parseArpabet(a), spelling, 'dictionary')) : null;
  };

  const resolve = (word: string): { primary: Pronunciation; alternates: Pronunciation[] } => {
    const key = normalizeWord(word);
    const hit = cache.get(key);
    if (hit) return hit;

    let result: { primary: Pronunciation; alternates: Pronunciation[] };
    const exact = dictionaryPronunciations(key, key);
    if (exact) {
      result = { primary: exact[0]!, alternates: exact.slice(1) };
    } else {
      const derived: [PronunciationSource, Phone[] | null][] = [
        ['variant', variant(key)],
        ['compound', numberPhones(key)],
        ['compound', compound(key)],
      ];
      const found = derived.find(([, phones]) => phones && phones.length > 0);
      result = {
        primary: found ? makePronunciation(found[1]!, key, found[0]) : guessPronunciation(key),
        alternates: [],
      };
    }
    cache.set(key, result);
    return result;
  };

  const tokenize = (text: string) =>
    tokenizeVerse(text, { keepWord: (w) => entries(w) !== null });

  const analyze = (text: string): AnalyzedVerse => {
    const verse = tokenize(text);
    const approximateWords: AnalyzedWord[] = [];
    const lines: AnalyzedLine[] = verse.lines.map((line) => {
      const words = line.words.map((w): AnalyzedWord => {
        const { primary, alternates } = resolve(w.text);
        const analyzed: AnalyzedWord = { ...w, pronunciation: primary, alternates };
        if (primary.approximate) approximateWords.push(analyzed);
        return analyzed;
      });
      return { ...line, words, syllableCount: words.reduce((n, w) => n + w.pronunciation.syllables.length, 0) };
    });
    return { raw: text, lines, approximateWords };
  };

  return {
    tokenize,
    lookup: (word) => {
      const key = normalizeWord(word);
      return dictionaryPronunciations(key, key)?.[0] ?? null;
    },
    pronounce: (word) => resolve(word).primary,
    analyze,
    rhymes: (text, rhymeOptions) => detectRhymes(analyze(text), rhymeOptions),
  };
}
