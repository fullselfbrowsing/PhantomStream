# PhantomStream IEEE Conference Paper

This directory contains an IEEE-style research-paper draft for PhantomStream,
matching the artifact style used by the Lattice paper: one LaTeX source file,
one BibTeX file, inline TikZ/pgfplots figures, and a generated PDF.

- Title: PhantomStream: DOM-Native Live Mirroring for Agentic Browsing
- Author: Lakshman Turlapati, Full Self Browsing
- Email: lakshmanturlapati@gmail.com
- Code: https://github.com/fullselfbrowsing/PhantomStream
- Document class: `\documentclass[conference]{IEEEtran}`

## Files

- `main.tex` is the two-column paper draft.
- `refs.bib` is the bibliography.
- `generated-results.tex` is produced by `npm run bench:local`; do not edit it by hand.
- `main.pdf` is generated from `main.tex`.
- `Makefile` runs the build through `tectonic`.

## Build

From the repository root:

```sh
npm run bench:local
npm run paper:pdf
```

Or from this directory:

```sh
make
```

The paper intentionally uses measured local benchmark results. Re-run
`npm run bench:local` before rebuilding the PDF if benchmark code, corpus pages,
or runtime behavior changes.
