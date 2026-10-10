/*
 * How alike two consonants sound, 0 (same) to 1 (nothing in common).
 * Built from articulation features so "m/n" and "t/d" are close and "p/d" is not:
 *   distance = place (max 0.2) + manner (0..0.6) + voicing (0.15), capped at 1.
 */

type Manner = 'stop' | 'affricate' | 'fricative' | 'nasal' | 'lateral' | 'rhotic' | 'glide' | 'aspirate';

// Place of articulation on a front-to-back axis.
const PLACE: Readonly<Record<string, number>> = {
  P: 0, B: 0, M: 0, W: 0,
  F: 1, V: 1,
  TH: 2, DH: 2,
  T: 3, D: 3, S: 3, Z: 3, N: 3, L: 3,
  CH: 4, JH: 4, SH: 4, ZH: 4, R: 4,
  Y: 5,
  K: 6, G: 6, NG: 6,
  HH: 7,
};

const MANNER: Readonly<Record<string, Manner>> = {
  P: 'stop', B: 'stop', T: 'stop', D: 'stop', K: 'stop', G: 'stop',
  CH: 'affricate', JH: 'affricate',
  F: 'fricative', V: 'fricative', TH: 'fricative', DH: 'fricative', S: 'fricative', Z: 'fricative', SH: 'fricative', ZH: 'fricative',
  M: 'nasal', N: 'nasal', NG: 'nasal',
  L: 'lateral', R: 'rhotic', W: 'glide', Y: 'glide',
  HH: 'aspirate',
};

const VOICELESS = new Set(['P', 'T', 'K', 'CH', 'F', 'TH', 'S', 'SH', 'HH']);

const isObstruent = (m: Manner): boolean => m === 'stop' || m === 'affricate' || m === 'fricative';
const isSonorant = (m: Manner): boolean => m === 'lateral' || m === 'rhotic' || m === 'glide';

function mannerCost(a: Manner, b: Manner): number {
  if (a === b) return 0;
  if (a === 'aspirate' || b === 'aspirate') return 0.6;
  if (isObstruent(a) && isObstruent(b)) return 0.3;
  if (isSonorant(a) && isSonorant(b)) return 0.3;
  const [x, y] = a === 'nasal' ? [a, b] : b === 'nasal' ? [b, a] : [a, b];
  if (x === 'nasal') {
    if (y === 'stop') return 0.3;
    if (isSonorant(y)) return 0.4;
    return 0.5;
  }
  return 0.6; // obstruent against sonorant
}

export function consonantDistance(a: string, b: string): number {
  if (a === b) return 0;
  const ma = MANNER[a];
  const mb = MANNER[b];
  const pa = PLACE[a];
  const pb = PLACE[b];
  if (!ma || !mb || pa === undefined || pb === undefined) return 1;
  const place = (Math.min(Math.abs(pa - pb), 3) / 3) * 0.2;
  const voice = VOICELESS.has(a) !== VOICELESS.has(b) ? 0.15 : 0;
  return Math.min(1, place + mannerCost(ma, mb) + voice);
}

/** Cost of turning one consonant cluster into another: substitutions by distance, missing consonants at `gap`. */
export function clusterCost(a: readonly string[], b: readonly string[], gap = 0.6): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j * gap;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i * gap;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(diag + consonantDistance(a[i - 1]!, b[j - 1]!), up + gap, prev[j - 1]! + gap);
      diag = up;
    }
  }
  return prev[b.length]!;
}
