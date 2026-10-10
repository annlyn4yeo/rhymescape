import { describe, expect, it } from 'vitest';
import { chainAt, memberKeys, testEngine } from './test-utils';

const engine = testEngine();
const rhymes = (text: string, options?: Parameters<typeof engine.rhymes>[1]) => engine.rhymes(text, options);

/* Word indices below are counted per line from 0, so "0:8" is line 0, word 8. */

describe('perfect rhymes', () => {
  const verse = [
    'I light up the night with a steady flow', //  flow = 0:8, light = 0:1, night = 0:4
    'Watch the whole crowd start to glow', //      glow = 1:6
    'Every bar is a seed that I sow', //            sow  = 2:7
    'Nothing here moves slow', //                   slow = 3:3
  ].join('\n');

  it('chains single-syllable end rhymes from the last stressed vowel', () => {
    const chains = rhymes(verse);
    const chain = chainAt(chains, 0, 8)!;
    expect(chain).toBeDefined();
    expect(memberKeys(chain)).toEqual(['0:8', '1:6', '2:7', '3:3']);
    expect(chain.kind).toBe('perfect');
    expect(chain.syllables).toBe(1);
    expect(chain.sound).toBe('OW');
    expect(chain.members.every((m) => m.position === 'end')).toBe(true);
    expect(chain.approximate).toBe(false);
  });

  it('finds internal rhymes inside one line and marks them internal', () => {
    const chain = chainAt(rhymes(verse), 0, 1)!;
    expect(memberKeys(chain)).toEqual(['0:1', '0:4']);
    expect(chain.members.every((m) => m.position === 'internal')).toBe(true);
    expect(chain.kind).toBe('perfect');
    expect(chain.sound).toBe('AY T');
  });

  it('does not rhyme words that only share a vowel (whole/glow) when slant is off', () => {
    const chains = rhymes(verse, { slantTolerance: 0 });
    expect(chainAt(chains, 1, 2)).toBeUndefined(); // "whole"
  });

  it('can switch internal rhymes off', () => {
    const chains = rhymes(verse, { internalRhymes: false });
    expect(chainAt(chains, 0, 1)).toBeUndefined();
    expect(chainAt(chains, 0, 8)).toBeDefined();
  });

  it('keeps function words out of internal rhymes', () => {
    const chains = rhymes('I try my best to fly high');
    const chain = chainAt(chains, 0, 1)!; // try
    expect(chain.members.map((m) => m.text)).toEqual(['try', 'fly', 'high']);
  });

  it('does not chain a repeated word with itself unless asked', () => {
    const text = 'Feel the flow\nLet it flow';
    expect(rhymes(text)).toHaveLength(0);
    expect(rhymes(text, { allowRepeats: true })).toHaveLength(1);
  });
});

describe('multisyllabic rhymes', () => {
  it('counts syllables matched before the stressed tail (elevator / alligator = 3)', () => {
    const chains = rhymes('Watch me ride the elevator\nTeeth wide like an alligator');
    const chain = chainAt(chains, 0, 4)!;
    expect(chain.kind).toBe('multi');
    expect(chain.syllables).toBe(3);
    expect(chain.members.map((m) => [m.start.word, m.start.syllable, m.end.word, m.end.syllable])).toEqual([
      [4, 1, 4, 3],
      [4, 1, 4, 3],
    ]);
  });

  it('extends backwards over different words but not repeated ones (bad habit / mad rabbit)', () => {
    const chains = rhymes('She got a bad habit\nHe got a mad rabbit');
    const chain = chainAt(chains, 0, 4)!;
    expect(chain.kind).toBe('multi');
    expect(chain.syllables).toBe(3);
    expect(chain.members.map((m) => m.text)).toEqual(['bad habit', 'mad rabbit']);
    expect(chain.members.map((m) => m.start.word)).toEqual([3, 3]);
  });

  it('rhymes a word with a phrase and flags the guessed compound as approximate (mixtape / six tape)', () => {
    const chains = rhymes('Fresh off the mixtape\nNothing but six tape');
    const chain = chainAt(chains, 0, 3)!;
    expect(chain.kind).toBe('multi');
    expect(chain.syllables).toBe(2);
    expect(chain.approximate).toBe(true);
    expect(chain.members.map((m) => m.text)).toEqual(['mixtape', 'six tape']);
  });

  it('matches a stressed tail that spans words (dangerous / stranger us)', () => {
    const chains = rhymes('Out here every block is dangerous\nEveryone you meet, a stranger us');
    const chain = chainAt(chains, 0, 5)!;
    expect(chain).toBeDefined();
    expect(chain.syllables).toBe(3);
    expect(chain.members.map((m) => m.text)).toEqual(['dangerous', 'stranger us']);
    expect(chain.members[1]!.start).toEqual({ word: 4, syllable: 0 });
    expect(chain.members[1]!.end).toEqual({ word: 5, syllable: 0 });
  });

  it('reports the stressed tail only when multi is switched off', () => {
    const chains = rhymes('Watch me ride the elevator\nTeeth wide like an alligator', { modes: ['perfect', 'slant'] });
    const chain = chainAt(chains, 0, 4)!;
    expect(chain.kind).toBe('perfect');
    expect(chain.syllables).toBe(2);
  });

  it('does not count repeated words as extra syllables (I\'m fly / I\'m shy)', () => {
    const chain = chainAt(rhymes("Yeah I'm fly\nNah I'm shy"), 0, 2)!;
    expect(chain.kind).toBe('perfect');
    expect(chain.syllables).toBe(1);
  });
});

describe('slant rhymes', () => {
  const verse = 'Calling out my name\nCutting through the rain';

  it('rhymes same vowels with close consonants (name / rain)', () => {
    const chain = chainAt(rhymes(verse), 0, 3)!;
    expect(chain.kind).toBe('slant');
    expect(chain.syllables).toBe(1);
    expect(chain.sound).toBe('EY');
    expect(chain.id).toContain('~');
    expect(chain.slantCost).toBeGreaterThan(0);
    expect(chain.slantCost).toBeLessThanOrEqual(0.35);
  });

  it('honours the tolerance setting', () => {
    expect(chainAt(rhymes(verse, { slantTolerance: 0 }), 0, 3)).toBeUndefined();
    expect(chainAt(rhymes(verse, { slantTolerance: 0.1 }), 0, 3)).toBeUndefined();
    expect(chainAt(rhymes(verse, { slantTolerance: 0.25 }), 0, 3)).toBeDefined();
  });

  it('does not slant-rhyme distant consonants (hold / home) at the default tolerance', () => {
    expect(rhymes('Never gonna hold\nTake me to my home')).toHaveLength(0);
  });

  it('can be left out via modes', () => {
    expect(rhymes(verse, { modes: ['perfect', 'multi'] })).toHaveLength(0);
  });

  it('joins a slant word to a perfect pair when it slants with both, and reports the weakest link', () => {
    const text = 'Say my name\nI play the game\nCutting through the rain';
    const chain = chainAt(rhymes(text), 0, 2)!;
    expect(memberKeys(chain)).toEqual(['0:2', '1:3', '2:3']);
    expect(chain.kind).toBe('slant');
    // With slant off the perfect pair survives on its own.
    const exact = chainAt(rhymes(text, { slantTolerance: 0 }), 0, 2)!;
    expect(memberKeys(exact)).toEqual(['0:2', '1:3']);
    expect(exact.kind).toBe('perfect');
  });

  it('does not bridge two unrelated slant words through a third (complete linkage)', () => {
    // map~mat (p/t) and mat~mad (t/d) are close, map~mad (p/d: place and voice) is not.
    const chains = rhymes('Hold the map\nOn the mat\nWatch him mad', { slantTolerance: 0.25 });
    expect(chains.length).toBeGreaterThan(0);
    const together = chains.some((c) => memberKeys(c).includes('0:2') && memberKeys(c).includes('2:2'));
    expect(together).toBe(false);
  });
});

describe('slang verse', () => {
  const verse = [
    "Finna pull up in the whip, I'm ballin'", // ballin' = 0:7
    "Tryna keep it cool, but they keep stallin'", // stallin' = 1:7
    "Drip so cold, shorty lovin' how I'm callin'", // callin' = 2:7
    'Hop out the whip and I yeet', //            yeet = 3:6
    'Run it back, we own the street', //          street = 4:6
  ].join('\n');

  it('chains dropped-g words and marks them approximate', () => {
    const chain = chainAt(rhymes(verse), 0, 7)!;
    expect(memberKeys(chain)).toEqual(['0:7', '1:7', '2:7']);
    expect(chain.kind).toBe('perfect');
    expect(chain.syllables).toBe(2); // AO1 L IH0 N
    expect(chain.approximate).toBe(true);
    expect(chain.members.every((m) => m.approximate)).toBe(true);
  });

  it('rhymes a guessed word with a dictionary word', () => {
    const chain = chainAt(rhymes(verse), 3, 6)!;
    expect(memberKeys(chain)).toEqual(['3:6', '4:6']);
    expect(chain.approximate).toBe(true);
    expect(chain.members[1]!.approximate).toBe(false);
  });

  it('is not confused by the slang the engine knows (finna, tryna)', () => {
    const analysis = engine.analyze(verse);
    const approx = analysis.approximateWords.map((w) => w.text);
    expect(approx).not.toContain('finna');
    expect(approx).not.toContain('tryna');
    expect(approx).toContain("ballin'");
  });
});

describe('chain IDs', () => {
  const base = 'Hold the line\nI feel fine\nWatch me flow\nLet it go';

  it('are the same for the same input', () => {
    expect(rhymes(base).map((c) => c.id)).toEqual(rhymes(base).map((c) => c.id));
  });

  it('come from the rhyme sound, so unrelated edits do not renumber chains', () => {
    const edited = 'Brand new opening bar here\n' + base + '\nThe end of the verse is near';
    const ids = (text: string) => rhymes(text).map((c) => c.id).sort();
    for (const id of ids(base)) expect(ids(edited)).toContain(id);
    expect(rhymes(base).map((c) => c.id)).toEqual(expect.arrayContaining(['ay-n', 'ow']));
  });

  it('are unique when two chains share a sound', () => {
    const chains = rhymes('Say it low\nFeel it go\n\nDark and cold\nStay on hold\nMy flow\nIs slow');
    const ids = chains.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
