# Paper Draft — PhantomStream: DOM-Native Live Mirroring for Agentic Browsing

Status: IEEE-style LaTeX draft exists in [`paper/main.tex`](../../paper/main.tex), with
measured local benchmark results generated from [`bench/results/local-latest.json`](../../bench/results/local-latest.json).

## Build

From the repository root:

```sh
npm run bench:local
npm run paper:check
```

`npm run bench:local` runs the deterministic local corpus and refreshes
`paper/generated-results.tex`. `npm run paper:check` validates the benchmark result
shape, checks for unresolved placeholders, and builds `paper/main.pdf` through
`tectonic`.

## Current Draft Scope

- Format: IEEE conference LaTeX, matching the Lattice paper style.
- Evaluation: deterministic local corpus with five pages and three activities.
- Baselines: PhantomStream, rrweb recorder/replay, and CDP PNG screencast.
- WebRTC: explicitly not claimed in this draft because headless Chromium does not provide
  the same interactive `getDisplayMedia` permission surface as a real capture session.

## Next Paper Work

- Add a public HAR record/replay corpus.
- Add a real WebRTC baseline with documented encoder and capture settings.
- Expand related work on co-browsing systems and agent-observability viewers.
- Turn the deterministic local benchmark into a CI performance-regression gate.
