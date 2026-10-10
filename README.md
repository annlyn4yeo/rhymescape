# Rhymescape

Rhymescape is a lyric-writing tool built around pronunciation, syllable, rhyme, and flow analysis.

## Technology

- **TypeScript** powers the application and rhyme-analysis logic with checked data structures and module boundaries.
- **Vite** bundles the browser application and provides the build pipeline.
- **CMUdict** supplies pronunciation data. Its ARPABET phonemes give the rhyme engine a sound-based foundation.
- **Custom rhyme engine** tokenizes text, resolves pronunciations, handles numbers and slang, counts syllables, and compares phoneme patterns to identify rhyme relationships.
- **Browser-native HTML and CSS** form the interface without a component framework, keeping the writing surface lightweight and direct.
- **GSAP** provides motion and interaction feedback where animation helps communicate changes in the analysis view.
- **Bricolage Grotesque** and **Martian Mono** define the visual typography: expressive text for writing and a technical monospace face for analysis details.

## Architecture

The app is divided into three layers:

1. **Engine** — pronunciation lookup, phoneme processing, syllabification, tokenization, and rhyme scoring.
2. **UI** — verse reading views, analysis panels, color systems, and interaction behavior.
3. **Styles** — the visual system, typography, layout, and motion presentation.

The engine is kept separate from the UI so rhyme and pronunciation analysis can evolve independently from the writing interface.
