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

/* ── Rhymes ─────────────────────────────────────────────── */

/**
 * perfect: identical from the last stressed vowel to the end ("flow"/"glow", feminine "reason"/"season").
 * multi:   a perfect match that also continues backwards through earlier syllables
 *          ("bad habit"/"mad rabbit" = 3 syllables). `syllables` reports how many.
 * slant:   same vowels, consonants only loosely alike ("fame"/"rain"), within `slantTolerance`.
 */
export type RhymeKind = 'perfect' | 'multi' | 'slant';

/** One syllable of a line: word index within the line, syllable index within that word. */
export interface SyllableRef {
  readonly word: number;
  readonly syllable: number;
}

export interface RhymeMember {
  readonly line: number;
  /** First and last matched syllable (inclusive). Can sit in different words ("stranger us"). */
  readonly start: SyllableRef;
  readonly end: SyllableRef;
  /** The words the range touches, as typed, space separated. */
  readonly text: string;
  /** 'end' when the member finishes the line, otherwise 'internal'. */
  readonly position: 'end' | 'internal';
  /** True if any word in the range has an approximate pronunciation. */
  readonly approximate: boolean;
}

export interface RhymeChain {
  /** Derived from the rhyme sound ("ow", "ey-n-jh-er-ah-s", "ay~" for slant), numbered "-2" on a collision. Same input, same IDs. */
  readonly id: string;
  /** The weakest link in the chain: multi > perfect > slant. */
  readonly kind: RhymeKind;
  /** Syllables matched by every member (the smallest link in the chain). */
  readonly syllables: number;
  /** ARPAbet (no stress) of the longest member tail; slant chains list the vowels only. */
  readonly sound: string;
  /** Reading order. */
  readonly members: readonly RhymeMember[];
  readonly approximate: boolean;
  /** Worst consonant distance among slant links (0..1); 0 for exact chains. */
  readonly slantCost: number;
}

export interface RhymeOptions {
  /** Which kinds to report. Default all three. Without 'multi', multi matches are reported as perfect on the stressed tail. */
  readonly modes?: readonly RhymeKind[];
  /** 0..1, how different the consonants may be. 0 turns slant off; ~0.2 allows m/n; default 0.3. */
  readonly slantTolerance?: number;
  /** Rhymes inside a line. Default true. */
  readonly internalRhymes?: boolean;
  /** 'line': an internal word only rhymes with words of its own line. 'verse': with any line. Default 'line'. */
  readonly internalScope?: 'line' | 'verse';
  /** Function words that never count as internal rhymes. Defaults to a short list (i, my, the, you, ...). */
  readonly internalStopWords?: readonly string[];
  /** Let identical words form chains ("flow" ... "flow"). Default false. */
  readonly allowRepeats?: boolean;
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
  /** analyze + detectRhymes. */
  rhymes(text: string, options?: RhymeOptions): RhymeChain[];
}
