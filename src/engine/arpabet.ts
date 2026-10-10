import type { Phone, Stress } from './types';

export const VOWELS: ReadonlySet<string> = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

const CONSONANTS: ReadonlySet<string> = new Set(['B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH']);

export const isVowel = (symbol: string): boolean => VOWELS.has(symbol);

/** "HH AH0 L OW1" to phones. Vowels without a digit count as unstressed. */
export function parseArpabet(s: string): Phone[] {
  const out: Phone[] = [];
  for (const token of s.trim().split(/\s+/)) {
    if (!token) continue;
    const m = /^([A-Z]+)([012])?$/.exec(token);
    const symbol = m?.[1];
    if (!symbol || !(VOWELS.has(symbol) || CONSONANTS.has(symbol))) throw new Error(`Unknown ARPAbet symbol: "${token}"`);
    out.push({ symbol, stress: VOWELS.has(symbol) ? ((m?.[2] ? Number(m[2]) : 0) as Stress) : null });
  }
  return out;
}

export function formatArpabet(phones: readonly Phone[]): string {
  return phones.map((p) => (p.stress === null ? p.symbol : `${p.symbol}${p.stress}`)).join(' ');
}

export const vowel = (symbol: string, stress: Stress): Phone => ({ symbol, stress });
export const consonant = (symbol: string): Phone => ({ symbol, stress: null });
