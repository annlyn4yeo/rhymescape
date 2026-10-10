import { describe, expect, it } from 'vitest';
import { formatArpabet, syllabify, parseArpabet, tokenizeVerse, normalizeWord } from './index';
import { testEngine } from './test-utils';

const engine = testEngine();
const phones = (word: string) => formatArpabet(engine.pronounce(word).phones);

describe('tokenizer', () => {
  it('lowercases, straightens curly apostrophes and strips edge punctuation', () => {
    expect(normalizeWord('"Ain’t!"')).toBe("ain't");
    expect(normalizeWord('(Y’ALL),')).toBe("y'all");
    expect(normalizeWord("Drivin'")).toBe("drivin'"); // trailing apostrophe is slang, kept
    expect(normalizeWord("'hello'")).toBe('hello'); // quote marks, not elision
    expect(normalizeWord("'Cause")).toBe("'cause"); // leading elision kept
  });

  it('splits lines and stanzas, keeps spans into the original text', () => {
    const text = 'Yo, check it—\nI’m back!\n\n\nNew stanza, same flow';
    const verse = tokenizeVerse(text);
    expect(verse.lines.map((l) => l.stanza)).toEqual([0, 0, 1]);
    expect(verse.lines.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(verse.lines[0]!.words.map((w) => w.text)).toEqual(['yo', 'check', 'it']);
    const back = verse.lines[1]!.words[1]!;
    expect(text.slice(back.span.start, back.span.end)).toBe('back');
    expect(verse.lines[1]!.words[0]!.text).toBe("i'm");
  });

  it('splits hyphens and dashes unless told the whole word is known', () => {
    expect(tokenizeVerse('half-time--now').lines[0]!.words.map((w) => w.text)).toEqual(['half', 'time', 'now']);
    const keep = tokenizeVerse('half-time', { keepWord: (w) => w === 'half-time' });
    expect(keep.lines[0]!.words.map((w) => w.text)).toEqual(['half-time']);
  });
});

describe('syllables', () => {
  it('uses maximal onset and keeps stress and spelling slices', () => {
    const [a, b] = syllabify(parseArpabet('HH AH0 L OW1'), 'hello').slice(0, 2);
    expect([a!.onset.length, a!.coda.length, a!.stress]).toEqual([1, 0, 0]);
    const sylls = syllabify(parseArpabet('D R AO1 IH0 NG'), 'drawing');
    expect(sylls.map((s) => s.text)).toEqual(['draw', 'ing']);
    expect(b).toBeDefined();
    const mix = syllabify(parseArpabet('M IH1 K S T EY2 P'), 'mixtape');
    expect(mix).toHaveLength(2);
    expect(mix[0]!.stress).toBe(1);
  });
});

describe('pronounce: dictionary, variants, compounds, guesses', () => {
  it('returns exact CMU entries as non-approximate, with alternates', () => {
    const p = engine.pronounce('flow');
    expect(p.source).toBe('dictionary');
    expect(p.approximate).toBe(false);
    expect(phones('flow')).toBe('F L OW1');
    expect(engine.analyze('read it').lines[0]!.words[0]!.alternates.length).toBeGreaterThan(0);
  });

  it('derives dropped-g and suffix forms from real entries', () => {
    const p = engine.pronounce("ballin'");
    expect(p.source).toBe('variant');
    expect(p.approximate).toBe(true);
    expect(phones("ballin'")).toBe('B AO1 L IH0 N');
    expect(phones('mixtapes')).toMatch(/T EY2 P S$/);
  });

  it('joins two known words for compounds and flags them', () => {
    const p = engine.pronounce('mixtape');
    expect(p.source).toBe('compound');
    expect(p.approximate).toBe(true);
    expect(p.syllables).toHaveLength(2);
  });

  it('guesses unknown slang with a stressed vowel and flags it', () => {
    const p = engine.pronounce('yeet');
    expect(p.source).toBe('guess');
    expect(p.approximate).toBe(true);
    expect(phones('yeet')).toMatch(/IY1 T$/);
    expect(engine.pronounce('zzzxq').syllables.length).toBeGreaterThan(0); // never throws
  });

  it('lets built-in slang overrides count as exact', () => {
    expect(engine.pronounce('tryna').approximate).toBe(false);
    expect(phones('tryna')).toBe('T R AY1 N AH0');
  });

  it('spells out numbers and marks them approximate', () => {
    const p = engine.pronounce('24');
    expect(p.approximate).toBe(true);
    expect(p.syllables.length).toBeGreaterThanOrEqual(3); // twen-ty four
  });
});
