import { parseArpabet } from './arpabet';
import { syllabify } from './syllabify';
import type { Phone, Pronunciation, PronunciationSource } from './types';

export function makePronunciation(phones: readonly Phone[], spelling: string, source: PronunciationSource): Pronunciation {
  return { phones, syllables: syllabify(phones, spelling), source, approximate: source !== 'dictionary' };
}

export const fromArpabet = (arpabet: string, spelling: string, source: PronunciationSource): Pronunciation =>
  makePronunciation(parseArpabet(arpabet), spelling, source);
