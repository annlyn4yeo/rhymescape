# Rhymescape

Rhymescape is a lyric-writing tool for exploring rhyme, pronunciation, syllables, and flow. It combines a rhyme engine with a visual verse-analyzer interface.

## Run locally

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite, usually `http://localhost:5173`.

## Useful commands

```bash
npm run typecheck   # Check TypeScript without creating a build
npm run build       # Create a production build
npm run preview     # Preview the production build locally
npm run tile        # Open the visual style tile
```

## How it works

- **Vite** runs the local development server and bundles the app for production.
- **TypeScript** makes the application code safer by checking data shapes and function inputs before it runs.
- **The rhyme engine** tokenizes text, looks up pronunciations, counts syllables, and compares sounds to find rhyme relationships.
- **CMUdict** provides a large pronunciation dictionary. The engine uses its ARPABET phoneme data as the sound-based foundation for rhyme matching.
- **The UI** is built with browser-native HTML and CSS, with small TypeScript modules for panels, reading views, colors, and visual details.
- **GSAP** handles interface motion where animated feedback improves the writing experience.
- **Bricolage Grotesque** and **Martian Mono** provide the display and technical type styles.

## Project layout

```text
src/
  main.ts                 App entry point
  engine/                 Pronunciation, syllable, and rhyme logic
  ui/                     Interface modules
  styles/                 Application styles
style-tile/               Visual design reference and tokens
scripts/                  Small build and development helpers
```

## Status

Rhymescape is an active prototype. The core rhyme engine and first verse-analyzer interface are in place, while the writing workflow and analysis features continue to evolve.
