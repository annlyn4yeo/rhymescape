/* Rhymescape engine: public types (proposal, types only, no implementation yet). */

/** ARPAbet symbol without its stress digit, e.g. 'AH', 'NG'. CMU dictionary uses 39 of these. */
export type ArpabetSymbol = string;

/** CMU stress: 0 none, 1 primary, 2 secondary. */
export type Stress = 0 | 1 | 2;

/** One phoneme. Vowels carry stress; consonants have `stress: null`. */
export interface Phone {
  readonly symbol: ArpabetSymbol;
  readonly stress: Stress | null;
}

/** Onset / nucleus / coda split, so later phases can compare rhyme parts (nucleus + coda). */
export interface Syllable {
  readonly onset: readonly Phone[];
  readonly nucleus: Phone;
  readonly coda: readonly Phone[];
  /** Stress of the nucleus. */
  readonly stress: Stress;
  /** Best-effort slice of the spelling for display ("draw", "ing"). Joined, the syllables give the word. */
  readonly text: string;
}

/** How a pronunciation was obtained. Only 'dictionary' is exact. */
export type PronunciationSource =
  | 'dictionary' // exact CMU entry
  | 'variant' //    derived from a CMU entry: dropped-g (drivin'), plural/-ed/-ing, possessive
  | 'compound' //    two or more CMU words joined (beatdrop)
  | 'guess'; //      letter-to-sound rules

export interface Pronunciation {
  readonly phones: readonly Phone[];
  readonly syllables: readonly Syllable[];
  readonly source: PronunciationSource;
  /** True for every source except 'dictionary'. The UI shows these words as "approximate". */
  readonly approximate: boolean;
}

/* ── Tokenizing ─────────────────────────────────────────── */

/** Offsets into the original verse string, end exclusive. Lets the UI highlight what the user typed. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Word {
  /** Exactly as typed, minus surrounding punctuation: "Drivin'", "ain’t". */
  readonly raw: string;
  /** Normalized for lookup: lowercase, curly apostrophes straightened, edge punctuation removed. */
  readonly text: string;
  readonly span: Span;
  /** Position within its line, from 0. */
  readonly index: number;
}

export interface Line {
  /** Index among non-blank lines, from 0. */
  readonly index: number;
  /** Stanza number, from 0. Blank lines separate stanzas and are not Lines themselves. */
  readonly stanza: number;
  readonly raw: string;
  readonly span: Span;
  readonly words: readonly Word[];
}

export interface Verse {
  readonly raw: string;
  readonly lines: readonly Line[];
}

/* ── Analysis ───────────────────────────────────────────── */

export interface AnalyzedWord extends Word {
  /** Best pronunciation. */
  readonly pronunciation: Pronunciation;
  /** Other CMU variants of the same word ("read" has two). Empty for most. */
  readonly alternates: readonly Pronunciation[];
}

export interface AnalyzedLine extends Omit<Line, 'words'> {
  readonly words: readonly AnalyzedWord[];
  readonly syllableCount: number;
}

export interface AnalyzedVerse {
  readonly raw: string;
  readonly lines: readonly AnalyzedLine[];
  /** Every word whose pronunciation is approximate, in reading order. */
  readonly approximateWords: readonly AnalyzedWord[];
}

/* ── Dictionary ─────────────────────────────────────────── */

/**
 * Static JSON shape of src/engine/data/cmudict.json: lowercase word to ARPAbet string(s).
 * Compact on purpose (about 134k entries). Words with several pronunciations map to an array,
 * first entry is the primary one.
 *   { "hello": "HH AH0 L OW1", "read": ["R IY1 D", "R EH1 D"] }
 */
export type CmuDict = Readonly<Record<string, string | readonly string[]>>;

/* ── Engine ─────────────────────────────────────────────── */

export interface EngineOptions {
  /** Spell digits out ("24" becomes "twenty four") and mark them approximate. Default true. */
  readonly expandNumbers?: boolean;
  /** Extra words that win over CMU, e.g. slang: { tryna: 'T R AY1 N AH0' }. Treated as 'dictionary'. */
  readonly overrides?: Readonly<Record<string, string>>;
}

export interface Engine {
  /** Verse text to lines and words. Pure, needs no dictionary. */
  tokenize(text: string): Verse;
  /** Exact CMU lookup only. Null if the word is not in the dictionary (no fallbacks). */
  lookup(word: string): Pronunciation | null;
  /** Never throws, never returns null: dictionary, then variants, compounds, letter-to-sound. */
  pronounce(word: string): Pronunciation;
  /** tokenize + pronounce every word. */
  analyze(text: string): AnalyzedVerse;
}

/* ── Public functions (src/engine/index.ts) ─────────────── */

/*
 * export function createEngine(dict: CmuDict, options?: EngineOptions): Engine;
 *   Sync and pure: inject a dictionary. Tests pass a tiny fixture.
 *
 * export function loadEngine(options?: EngineOptions): Promise<Engine>;
 *   Dynamically imports ./data/cmudict.json (code-split by Vite) and calls createEngine.
 *
 * export function tokenizeVerse(text: string): Verse;
 * export function normalizeWord(raw: string): string;
 *
 * export function parseArpabet(s: string): Phone[];        // "HH AH0 L OW1"
 * export function formatArpabet(phones: readonly Phone[]): string;
 * export function syllabify(phones: readonly Phone[], spelling?: string): Syllable[];
 * export function guessPronunciation(word: string): Pronunciation;   // letter-to-sound only
 */
