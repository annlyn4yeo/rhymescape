import { consonant, vowel } from './arpabet';
import { makePronunciation } from './pronunciation';
import type { Phone, Pronunciation, Stress } from './types';

/*
 * Letter-to-sound guess for words the dictionary does not know (mostly slang).
 * Deliberately simple: longest-match rules over letters, a magic-e rule, and a default stress
 * pattern. Everything it returns is flagged approximate.
 */

type Token = { readonly symbol: string; readonly vowel: boolean };

const V = (symbol: string): Token => ({ symbol, vowel: true });
const C = (symbol: string): Token => ({ symbol, vowel: false });
const isVowelLetter = (ch: string | undefined): boolean => ch !== undefined && 'aeiou'.includes(ch);

const LONG: Readonly<Record<string, string>> = { a: 'EY', e: 'IY', i: 'AY', o: 'OW', u: 'UW' };
const SHORT: Readonly<Record<string, string>> = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH' };

function letterToTokens(w: string): Token[] {
  const out: Token[] = [];
  const n = w.length;
  let i = 0;
  const at = (k: number): string => w[k] ?? '';
  const startsWith = (s: string): boolean => w.startsWith(s, i);
  const push = (len: number, ...tokens: Token[]): void => {
    out.push(...tokens);
    i += len;
  };

  while (i < n) {
    const ch = at(i);
    const next = at(i + 1);
    const atEnd = i === n - 1;
    const prevOut = out[out.length - 1];

    /* silent endings and syllabic -le */
    if (ch === 'l' && next === 'e' && i + 2 === n && prevOut && !prevOut.vowel && i > 1) {
      push(2, V('AH'), C('L'));
      continue;
    }
    if (ch === 'e' && atEnd && n > 2 && prevOut && !prevOut.vowel) {
      i++; // silent final e
      continue;
    }

    /* multi-letter consonants */
    if (startsWith('tch')) { push(3, C('CH')); continue; }
    if (startsWith('dge')) { push(3, C('JH')); continue; }
    if (startsWith('tion')) { push(4, C('SH'), V('AH'), C('N')); continue; }
    if (startsWith('sion')) { push(4, C('ZH'), V('AH'), C('N')); continue; }
    if (startsWith('ch')) { push(2, C('CH')); continue; }
    if (startsWith('sh')) { push(2, C('SH')); continue; }
    if (startsWith('th')) { push(2, C('TH')); continue; }
    if (startsWith('ph')) { push(2, C('F')); continue; }
    if (startsWith('ck')) { push(2, C('K')); continue; }
    if (startsWith('nk')) { push(2, C('NG'), C('K')); continue; }
    if (startsWith('ng')) { push(2, C('NG')); continue; }
    if (startsWith('qu')) { push(2, C('K'), C('W')); continue; }
    if (startsWith('wh')) { push(2, C('W')); continue; }
    if (i === 0 && startsWith('kn')) { push(2, C('N')); continue; }
    if (i === 0 && startsWith('wr')) { push(2, C('R')); continue; }
    if ((i === 0 || i + 2 === n) && startsWith('gn')) { push(2, C('N')); continue; }
    if (startsWith('mb') && i + 2 === n) { push(2, C('M')); continue; }
    if (startsWith('gh')) {
      if (i === 0) push(2, C('G'));
      else i += 2; // "night", "though": silent
      continue;
    }

    /* vowels: longest patterns first */
    if (startsWith('eigh')) { push(4, V('EY')); continue; }
    if (startsWith('igh')) { push(3, V('AY')); continue; }
    if (startsWith('augh')) { push(4, V('AO')); continue; }
    if (startsWith('air')) { push(3, V('EH'), C('R')); continue; }
    if (startsWith('ear')) { push(3, V('IH'), C('R')); continue; }
    if (startsWith('all')) { push(3, V('AO'), C('L')); continue; }
    if (startsWith('ee') || startsWith('ea') || startsWith('ie')) { push(2, V('IY')); continue; }
    if (startsWith('oo')) { push(2, V('UW')); continue; }
    if (startsWith('oa')) { push(2, V('OW')); continue; }
    if (startsWith('ai') || startsWith('ay')) { push(2, V('EY')); continue; }
    if (startsWith('ey')) { push(2, V(i + 2 === n ? 'IY' : 'EY')); continue; }
    if (startsWith('ei')) { push(2, V('IY')); continue; }
    if (startsWith('oi') || startsWith('oy')) { push(2, V('OY')); continue; }
    if (startsWith('ou')) { push(2, V('AW')); continue; }
    if (startsWith('ow')) {
      const long = i + 2 === n || (at(i + 2) === 'n' && 'lrnkh'.includes(at(i - 1) || '-')) || at(i + 2) === 'e';
      push(2, V(long ? 'OW' : 'AW'));
      continue;
    }
    if (startsWith('au') || startsWith('aw')) { push(2, V('AO')); continue; }
    if (startsWith('ew') || startsWith('eu') || startsWith('ue') || startsWith('ui')) { push(2, V('UW')); continue; }
    if (startsWith('ar')) { push(2, V('AA'), C('R')); continue; }
    if (startsWith('or')) { push(2, V('AO'), C('R')); continue; }
    if (startsWith('er') || startsWith('ir') || startsWith('ur')) { push(2, V('ER')); continue; }

    if (ch === 'y') {
      if (i === 0 && isVowelLetter(next)) push(1, C('Y'));
      else if (atEnd) push(1, V(n <= 3 ? 'AY' : 'IY'));
      else push(1, V('IH'));
      continue;
    }

    if ('aeiou'.includes(ch)) {
      // magic e: V + single consonant + final e ("make", "ride", "flow-e")
      const magic = !isVowelLetter(next) && next !== '' && at(i + 2) === 'e' && i + 3 === n;
      if (magic) push(1, V(LONG[ch]!));
      else if (atEnd && ch !== 'a' && ch !== 'e') push(1, V(LONG[ch]!)); // "go", "taxi", "menu"
      else if (atEnd && ch === 'e' && n <= 3) push(1, V('IY')); // "me", "she"
      else if (atEnd && ch === 'a') push(1, V(n <= 2 ? 'AA' : 'AH'));
      else if (ch === 'i' && (startsWith('ind') || startsWith('ild'))) push(1, V('AY'));
      else if (ch === 'o' && (startsWith('old') || startsWith('olt') || startsWith('ost'))) push(1, V('OW'));
      else push(1, V(SHORT[ch]!));
      continue;
    }

    /* single consonants */
    if (ch === next && ch !== 'c' && ch !== 'g') { i++; continue; } // doubled letter sounds once
    if (ch === 'c') {
      if (next === 'c' && 'eiy'.includes(at(i + 2))) { push(2, C('K'), C('S')); continue; }
      push(next === 'c' ? 2 : 1, C('eiy'.includes(next) ? 'S' : 'K'));
      continue;
    }
    if (ch === 'g') {
      if (next === 'g') { push(2, C('G')); continue; }
      push(1, C('eiy'.includes(next) ? 'JH' : 'G'));
      continue;
    }
    if (ch === 's') {
      const between = isVowelLetter(at(i - 1)) && isVowelLetter(next);
      push(1, C(between ? 'Z' : 'S'));
      continue;
    }
    if (ch === 'x') { push(1, ...(i === 0 ? [C('Z')] : [C('K'), C('S')])); continue; }
    const direct: Readonly<Record<string, string>> = { b: 'B', d: 'D', f: 'F', h: 'HH', j: 'JH', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P', q: 'K', r: 'R', t: 'T', v: 'V', w: 'W', z: 'Z' };
    const symbol = direct[ch];
    if (symbol) push(1, C(symbol));
    else i++; // anything unexpected is skipped
  }
  return out;
}

function toPhones(tokens: readonly Token[]): Phone[] {
  const vowelCount = tokens.filter((t) => t.vowel).length;
  const primary = vowelCount <= 2 ? 0 : vowelCount - 3; // two syllables: first; longer: antepenult
  let seen = 0;
  return tokens.map((t) => {
    if (!t.vowel) return consonant(t.symbol);
    const stress: Stress = seen === primary ? 1 : 0;
    seen++;
    const symbol = stress === 0 && ['AE', 'EH', 'AA', 'AO'].includes(t.symbol) ? 'AH' : t.symbol;
    return vowel(symbol, stress);
  });
}

export function guessPronunciation(word: string): Pronunciation {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  const phones = letters ? toPhones(letterToTokens(letters)) : [vowel('AH', 1)];
  return makePronunciation(phones, letters, 'guess');
}
