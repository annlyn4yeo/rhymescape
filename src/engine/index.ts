export type * from './types';
export { createEngine } from './engine';
export { detectRhymes } from './rhyme';
export { tokenizeVerse, normalizeWord } from './tokenize';
export type { TokenizeOptions } from './tokenize';
export { parseArpabet, formatArpabet } from './arpabet';
export { syllabify } from './syllabify';
export { guessPronunciation } from './guess';
export { consonantDistance } from './consonants';

import { createEngine } from './engine';
import type { Engine, EngineOptions } from './types';

/**
 * Fetches the static dictionary (emitted as an asset by Vite) and builds an engine.
 * Pass `url` when serving the JSON from somewhere else.
 */
export async function loadEngine(options?: EngineOptions, url: string | URL = new URL('./data/cmudict.json', import.meta.url)): Promise<Engine> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the CMU dictionary (${response.status})`);
  return createEngine(await response.json(), options);
}
