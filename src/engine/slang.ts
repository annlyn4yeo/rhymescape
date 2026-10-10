/**
 * Built-in slang the 2015 CMU dictionary does not have. These count as exact ('dictionary') because
 * their pronunciation is settled. Callers can add or replace entries with EngineOptions.overrides.
 */
export const SLANG: Readonly<Record<string, string>> = {
  tryna: 'T R AY1 N AH0',
  finna: 'F IH1 N AH0',
  boutta: 'B AW1 T AH0',
  imma: 'AY1 M AH0',
  lemme: 'L EH1 M IY0',
  gimme: 'G IH1 M IY0',
  bruh: 'B R AH1',
  ayy: 'EY1',
  aight: 'AY1 T',
  ight: 'AY1 T',
  cuz: 'K AH1 Z',
  fam: 'F AE1 M',
  opps: 'AA1 P S',
  opp: 'AA1 P',
  drippy: 'D R IH1 P IY0',
  yessir: 'Y EH1 S ER0',
  nah: 'N AE1',
  yuh: 'Y AH1',
  skrrt: 'S K ER1 T',
  woah: 'W OW1',
};
