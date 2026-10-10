import type { Line, Verse, Word } from './types';

const APOSTROPHES = /[’‘ʼ`´]/g;

/**
 * Lookup form of a word: lowercase, apostrophes straightened, punctuation dropped.
 * Inner apostrophes ("ain't") and edge apostrophes that look like elision or dropped g
 * ("'cause", "drivin'") are kept; a pair of wrapping quote marks ("'hello'") is removed.
 */
export function normalizeWord(raw: string): string {
  let s = raw.normalize('NFC').replace(APOSTROPHES, "'").toLowerCase();
  s = s.replace(/[^\p{L}\p{N}'-]/gu, '');
  s = s.replace(/^-+|-+$/g, '');
  if (s.length > 2 && s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
  return s.replace(/-{2,}/g, '-');
}

export interface TokenizeOptions {
  /** Return true to keep a hyphenated word whole ("half-time") instead of splitting it. */
  readonly keepWord?: (normalized: string) => boolean;
}

const WORD_RUN = /[\p{L}\p{N}'’‘ʼ`´-]+/gu;

interface Piece {
  readonly text: string;
  readonly start: number;
}

/** Splits a run on "--" always, and on single hyphens unless the whole hyphenated word is known. */
function splitRun(run: string, offset: number, keepWord: (w: string) => boolean): Piece[] {
  const pieces: Piece[] = [];
  const dashed = /[^-]+(?:-[^-]+)*/g;
  for (let m = dashed.exec(run); m; m = dashed.exec(run)) {
    const segment = m[0];
    const at = offset + m.index;
    if (!segment.includes('-') || keepWord(normalizeWord(segment))) {
      pieces.push({ text: segment, start: at });
      continue;
    }
    let pos = 0;
    for (const part of segment.split('-')) {
      if (part) pieces.push({ text: part, start: at + pos });
      pos += part.length + 1;
    }
  }
  return pieces;
}

/** Verse text to lines and words. Blank lines (or lines with no words) only start a new stanza. */
export function tokenizeVerse(text: string, options: TokenizeOptions = {}): Verse {
  const keepWord = options.keepWord ?? (() => false);
  const lines: Line[] = [];
  let stanza = 0;
  let pendingBreak = false;
  let offset = 0;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const lineStart = offset;
    offset += rawLine.length + (text.slice(offset + rawLine.length).startsWith('\r\n') ? 2 : 1);

    const words: Word[] = [];
    for (let m = WORD_RUN.exec(rawLine); m; m = WORD_RUN.exec(rawLine)) {
      for (const piece of splitRun(m[0], m.index, keepWord)) {
        const normalized = normalizeWord(piece.text);
        if (!normalized || !/[\p{L}\p{N}]/u.test(normalized)) continue;
        words.push({
          raw: piece.text.replace(/^-+|-+$/g, ''),
          text: normalized,
          span: { start: lineStart + piece.start, end: lineStart + piece.start + piece.text.length },
          index: words.length,
        });
      }
    }

    if (words.length === 0) {
      pendingBreak = lines.length > 0;
      continue;
    }
    if (pendingBreak) {
      stanza++;
      pendingBreak = false;
    }
    lines.push({
      index: lines.length,
      stanza,
      raw: rawLine,
      span: { start: lineStart, end: lineStart + rawLine.length },
      words,
    });
  }
  return { raw: text, lines };
}
