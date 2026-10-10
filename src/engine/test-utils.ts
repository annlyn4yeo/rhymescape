import { readFileSync } from 'node:fs';
import { createEngine } from './index';
import type { CmuDict, Engine, EngineOptions, RhymeChain } from './types';

let dict: CmuDict | undefined;

/** Real CMU dictionary, parsed once per test run. */
export function realDict(): CmuDict {
  dict ??= JSON.parse(readFileSync(new URL('./data/cmudict.json', import.meta.url), 'utf8')) as CmuDict;
  return dict;
}

export function testEngine(options?: EngineOptions): Engine {
  return createEngine(realDict(), options);
}

/** "line:word" keys of the chain's members, e.g. ["0:8", "1:5"]. */
export function memberKeys(chain: RhymeChain): string[] {
  return chain.members.map((m) => `${m.line}:${m.end.word}`);
}

/** Finds the chain containing the member that ends at (line, word). */
export function chainAt(chains: readonly RhymeChain[], line: number, word: number): RhymeChain | undefined {
  return chains.find((c) => c.members.some((m) => m.line === line && m.end.word === word));
}
