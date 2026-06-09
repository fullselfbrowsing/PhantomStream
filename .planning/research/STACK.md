# Stack Research

**Domain:** DOM-native live browser-mirroring framework — npm SDK extraction, multi-context injection bundles, WS relay, browser testing, research evaluation harness
**Researched:** 2026-06-09
**Confidence:** HIGH (all versions verified against the npm registry on 2026-06-09; claims verified against official docs except where flagged)

This research answers what the **extraction and publication** need — not what the already-proven capture/diff/render design needs. Organized around the six open stack questions.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript (`tsc` only, dev-dep) | 6.0.3 | `--checkJs` type enforcement in CI + `.d.ts` emit from JSDoc | The only tool that generates `.d.ts` from JSDoc-typed JS. TS 6.0 is current and is the bridge release to the native TS 7 — its JS-file analysis was tightened, so adopting 6.0 now (rather than 5.9) means the JSDoc dialect you write survives the TS 7 transition. **Caveats below are load-bearing.** |
| esbuild | 0.28.0 (pin exact) | Per-adapter single-file IIFE injection bundles | Built-in `--format=iife --bundle --minify`, runs from a 20-line Node build script, no config files, no plugins needed for plain dependency-free JS. The library itself stays zero-build; esbuild only produces the injection artifacts. Pre-1.0 semver — pin the exact version. |
| `CompressionStream` / `DecompressionStream` (native) | built-in | Default wire-envelope codec (`deflate-raw`) | Baseline Widely Available since May 2023 (Chrome, Firefox, Safari); global in Node 18+ (verified `gzip` + `deflate-raw` working in Node 24 locally). Zero bytes added to injection bundles — decisive for the bookmarklet adapter. Replaces lz-string as default; lz-string retained as legacy decode for FSB wire compat. |
| ws | 8.21.0 | WebSocket relay server (reference transport) | Actively maintained (last publish 2026-05-22), pure JS, zero native deps, installs from the registry — required for `npx phantom-stream demo` to be plug-and-play. The reference relay (`reference/server/ws-handler.js`) already uses ws, so extraction is 1:1. |
| @playwright/test | 1.60.0 | All browser-side testing (capture, renderer, adapters) AND the evaluation harness driver | One install covers both needs. Officially supports loading MV3 extensions (`launchPersistentContext` + `--load-extension`, headless via the `chromium` channel) — the only test framework that can exercise the content-script adapter in its real context. Real layout engine is non-negotiable for this codebase (see jsdom disqualification below). |
| node:test + node:assert/strict | built-in (Node ≥22) | Pure-logic tests (protocol, envelope, serialization helpers) | Already in use for `src/protocol/`; zero dependencies; keep it. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lz-string | 1.5.0 | Legacy codec: decode (and optionally encode) the shipped `{_lz, d}` envelope | FSB swap-in compatibility only. Unmaintained since 2023-03 but frozen/stable. Keep it vendored (as the reference does) or as an optional dep injected into `src/protocol/envelope.js`'s codec seam — never in the default injection bundles. |
| fflate | 0.8.3 | Sync deflate fallback | Only if a synchronous compression path proves necessary (CompressionStream is async-only) or for a non-native-support environment. Actively maintained (2026-05). Do not add until a concrete need appears. |
| pixelmatch | 7.2.0 | Pixel-level diff for fidelity scoring | Eval harness. Actively maintained (2026-04, Mapbox). v6+ is ESM-only — fine, this repo is `"type": "module"`. |
| ssim.js | 3.5.0 | SSIM scores for fidelity scoring | Eval harness. Unmaintained since 2022-06 but the algorithm is stable and it's the standard pure-JS SSIM implementation. Pair with pixelmatch — report both metrics in the paper. |
| pngjs | 7.0.0 | Decode Playwright PNG screenshots to raw pixels for pixelmatch/ssim.js | Eval harness only. |
| sharp | 0.34.5 | Screenshot normalization before comparison (resize to common dimensions, DPR alignment, crop to viewport) | Eval harness only. Native module — acceptable because the harness is repo-internal dev tooling, never a published dependency. |
| rrweb | 2.0.1 | Evaluation baseline (DOM-recording competitor) | Harness only. rrweb 2.0 is now the stable `latest` on npm (the long 2.0.0-alpha line concluded). Measure its serialized event-stream bytes under the same envelope compression for fairness. |
| simple-statistics | 7.9.0 | Means/medians/percentiles/CIs for harness result aggregation | Optional; a hand-rolled percentile function is also fine. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsc (TypeScript 6.0.3) | Two configs: `tsconfig.json` (`checkJs` + `noEmit` for CI gate) and `tsconfig.build.json` (`declaration` + `emitDeclarationOnly` + `declarationMap` → `dist/types/`) | **TS 6.0 changed defaults** (`strict: true`, `module: esnext`, `target: es2025`, `types: []`) — write every option explicitly, rely on nothing implicit. Avoid `@enum` and `@constructor` JSDoc patterns (de-recognized in the TS 7 native rewrite; 6.0 begins the tightening). Use the `@import` JSDoc tag (TS 5.5+) for type-only imports across modules. |
| @arethetypeswrong/cli | 0.18.3 | Validates the `exports` map + generated `.d.ts` resolve correctly for consumers (`attw --pack`) | Run in CI before publish — catches the classic "types condition missing/mismatched" packaging bugs that JSDoc-emit projects hit. |
| publint | 0.3.21 | Lints package.json publishing metadata (`files`, `exports`, ESM correctness) | Run in CI alongside attw. |
| npm trusted publishing (OIDC) | n/a | Tokenless publish from GitHub Actions with automatic provenance attestation | GA since July 2025. Configure the Trusted Publisher on npmjs.com (org/repo/workflow), grant `id-token: write` in the workflow; provenance is generated automatically — no `--provenance` flag, no NPM_TOKEN secret. |
| Node.js | ≥22 (`engines`) | Dev + relay runtime floor | Node 18 and 20 are EOL as of mid-2026. Node ≥22 gives stable built-in WebSocket **client** (usable by demo/harness viewers with zero deps) and CompressionStream globals. Develop on 24 (current LTS). |

## Question-by-Question Recommendations

### 1. Publishing a zero-build browser framework to npm

**Recommendation:** Ship `src/` ESM as the package's real entry points; generate `.d.ts` + maps into `dist/types/` with `tsc`; build per-adapter IIFE artifacts into `dist/adapters/`; publish via trusted publishing.

`package.json` shape (the parts that matter):

```json
{
  "name": "@fullselfbrowsing/phantom-stream",
  "type": "module",
  "engines": { "node": ">=22" },
  "files": ["src", "dist"],
  "exports": {
    ".":            { "types": "./dist/types/index.d.ts", "default": "./src/index.js" },
    "./protocol":   { "types": "./dist/types/protocol/index.d.ts", "default": "./src/protocol/index.js" },
    "./capture":    { "types": "./dist/types/capture/index.d.ts",  "default": "./src/capture/index.js" },
    "./relay":      { "types": "./dist/types/relay/index.d.ts",    "default": "./src/relay/index.js" },
    "./renderer":   { "types": "./dist/types/renderer/index.d.ts", "default": "./src/renderer/index.js" },
    "./adapters/*": { "types": "./dist/types/adapters/*/index.d.ts", "default": "./src/adapters/*/index.js" },
    "./bundles/*":  "./dist/adapters/*"
  },
  "publishConfig": { "access": "public" }
}
```

- `"types"` condition **first** in every conditional block (TS requirement).
- No `"main"`/`"module"` needed when `exports` is present; keep a `"main"` only if very old tooling support is desired (it isn't, for a Chromium-first framework).
- ESM-only is correct here: every consumption context (extension, Playwright script, modern Node, bundlers) handles ESM; dual CJS/ESM publishing would force a build step on the library core, violating the project constraint. Confidence: HIGH.
- The three injection contexts consume **different artifact types**: embedded SDK imports ESM subpaths; content script and `addInitScript` and bookmarklet consume prebuilt IIFE files from `dist/adapters/` (next section).

### 2. Bundling per-adapter artifacts — esbuild, not Rollup

**Recommendation:** esbuild 0.28.0, invoked from a small Node build script (`build/bundle.js`) with one entry per adapter → `--bundle --format=iife --minify`, plus a non-minified variant for debugging.

Why esbuild over Rollup here:
- The published library is unbundled ESM; bundling exists **only** to produce single-file plain-script injection artifacts. That's esbuild's exact sweet spot: zero config, native IIFE format, banner/footer injection, build script under 30 lines.
- Rollup's advantages (fine-grained tree-shaking control, plugin ecosystem, readable chunked output) buy nothing for 4 small dependency-free IIFE outputs, and cost a config file + slower builds.
- Don't use wrappers (tsup, tsdown, vite lib mode): they exist to orchestrate TS compilation + multi-format output — this project's `tsc` does types separately and only one bundle format is needed.

Why IIFE is the right format per context (this is forced, not stylistic):
- **MV3 content scripts:** manifest-declared content scripts cannot be ES modules; the only ESM route is a dynamic-import workaround via `web_accessible_resources`, which adds a world/CSP complication. A classic single-file script is the robust artifact. Confidence: MEDIUM-HIGH (Chrome docs + long-standing community consensus; re-verify against current Chrome docs during the adapter phase since extension capabilities move).
- **Playwright `addInitScript`:** accepts a file path or string evaluated as a classic script — an IIFE file works directly.
- **Bookmarklet:** must be a single self-contained expression. Build the IIFE, then a tiny post-step URL-encodes it into `javascript:` form. Document the known limitation: page CSP can block bookmarklet execution on hardened sites (`script-src` without `unsafe-inline`); the standard mitigation (inject a `<script src>` to a hosted copy) is also CSP-subject — this belongs in adapter docs, not engineering effort.

### 3. Wire-envelope compression — native CompressionStream replaces lz-string as default

**Recommendation:** Default codec = `CompressionStream('deflate-raw')` + base64, in a new self-identifying envelope tag (e.g. `{_dfl: true, d}`), alongside retained decode support for the shipped `{_lz, d}` envelope. The injected-codec seam already in `src/protocol/envelope.js` makes this a configuration, not a redesign.

Why move off lz-string as the default:
- **Zero footprint:** no vendored 4.8 KB lib in any injection bundle (bookmarklet especially). Native in every target context — content script, MV3 service worker, page main world, workers, Node ≥18 relay (gzip + deflate-raw verified locally on Node 24). Confidence: HIGH (MDN Baseline + local verification).
- **Speed:** published JS benchmarks put deflate-family compression at ~3–4× faster than lz-string on ~100 KB JSON (≈80–90 ms vs ≈316 ms). On the rAF-cadence diff path, less codec time = less main-thread stall. Confidence: MEDIUM (single-source benchmark; numbers vary by payload).
- **Ratio:** evidence conflicts — one benchmark showed lz-string's UTF-16 mode edging deflate on ratio for specific JSON, but lz-string's *base64* output mode (what the wire actually carries) is generally weaker than deflate+base64 on HTML-heavy payloads. **Do not assert a ratio win in the paper from training data — the evaluation harness should measure lz-string vs deflate-raw vs gzip on the real corpus.** This doubles as a paper micro-benchmark. Confidence: LOW on exact ratios, by design — flagged for measurement.
- **Maintenance:** lz-string has had no release since 2023-03; native API has platform-level maintenance.

Two engineering consequences to plan for (extraction-phase design decisions, not surprises):
1. **Asynchrony:** CompressionStream is async; lz-string was sync inside the flush path. The capture flush must `await` encode **and preserve send ordering** (serialize sends through a promise chain or queue) — out-of-order diff delivery would corrupt the mirror. This is the single biggest pitfall of the codec swap.
2. **Base64 overhead:** +33% on the wire inside the JSON envelope. Binary WebSocket frames with a small header would reclaim it but break envelope/diagnostics uniformity and FSB compat. Keep text+base64 for v1; have the harness quantify the binary-framing win; cite it as future work / discussion in the paper.

Do not adopt pako (superseded by fflate, unmaintained since 2022, larger). Do not adopt fflate preemptively (native API covers all v1 contexts).

### 4. WebSocket relay — ws, definitively not uWebSockets.js

**Recommendation:** ws 8.21.0.

- The relay's job is thin fan-out at trivial scale (one producer, a handful of viewers, 1 MiB/message cap). ws handles this with margin; it is the ecosystem default, pure JS, actively maintained (2026-05 release).
- **uWebSockets.js is disqualified on distribution grounds, verified:** it is not published to the npm registry (`npm view uWebSockets.js` fails) — it installs from a GitHub URL with prebuilt native binaries. That breaks `npx phantom-stream demo` plug-and-play, complicates consumer installs, and adds native-binary supply-chain surface. Its raw throughput advantage is irrelevant at this scale. Confidence: HIGH.
- Config: keep `perMessageDeflate: false` (ws default) — the envelope is already app-level compressed; double compression wastes CPU, and permessage-deflate has a documented memory-fragmentation history in ws. Set `maxPayload` to the 1 MiB protocol cap so the relay enforces it at the socket layer too.
- Client side: Node ≥22's built-in `WebSocket` client means the demo's viewer-side Node processes and the harness need no client library at all.

### 5. Browser-side testing — Playwright Test; jsdom is disqualified for capture/renderer

**Recommendation:** Two-layer testing. `node:test` for pure logic (protocol, envelope, sanitization string-paths — keep what exists). `@playwright/test` 1.60.0 for everything that touches a real DOM.

Why jsdom (and happy-dom) cannot test this codebase's core:
- **No layout engine:** `getBoundingClientRect()` returns zeros → the truncation budget logic (rect-driven subtree dropping) is untestable.
- **`getComputedStyle` is non-cascading/incomplete** → curated style capture and the CSSOM stylesheet-centric mode are untestable.
- jsdom *does* implement MutationObserver, but observing mutations without real style/layout/paint semantics tests the wrong thing; rAF exists only as a shim with no paint cadence.
- No real iframe rendering/`srcdoc` document lifecycle, no Shadow DOM rendering → renderer reconstruction untestable.
- Confidence: HIGH on layout/computed-style absence (long-documented jsdom scope decisions); use jsdom for nothing here.

Why Playwright Test over Vitest 4 browser mode:
- **Extension context is mandatory:** the content-script adapter must be tested as a real MV3 content script. Playwright officially supports this (`launchPersistentContext` + `--disable-extensions-except`/`--load-extension`, headless via the `chromium` channel; MV3 SW suspend/restart semantics are documented). Vitest browser mode cannot load extensions. Confidence: HIGH (official Playwright docs).
- **Multi-page scenarios are the product:** capture in page A, render in page B, assert mirror equivalence — Playwright's multi-context model is built for exactly this; Vitest browser mode is built for single-page component tests.
- **One toolchain:** the evaluation harness already requires Playwright; reusing it means one browser install, one runner, one trace/debug story. Adding Vitest brings the Vite toolchain into a zero-dependency project for no unique capability.
- Vitest 4 browser mode *is* now stable (Oct 2025, provider split into `@vitest/browser-playwright` 4.1.8, built-in `toMatchScreenshot` visual regression) — it's the credible alternative if fine-grained renderer unit tests with watch-mode DX ever become a bottleneck. Revisit then, not now.

### 6. Evaluation harness tooling

**Recommendation:** Playwright-driven, app-level byte accounting, pixelmatch + ssim.js fidelity scoring.

- **Scripted browsing + frozen corpus:** Playwright with HAR record/replay. Record each corpus site once (`recordHar` / `routeFromHAR` with `update: true`), commit the HARs, replay offline with `routeFromHAR` for byte-identical network conditions across all four systems (PhantomStream, WebRTC capture, CDP screencast, rrweb) and across machines/runs. This is the reproducibility backbone the paper's methodology section needs. Activity levels = deterministic Playwright scripts (idle / scroll / interact). Confidence: HIGH (stable first-party Playwright feature).
- **Traffic measurement (per system):**
  - *PhantomStream:* count bytes at the relay per message type — the reference relay's diagnostics classification already does most of this; extend it into the harness's metrics sink.
  - *WebRTC screen capture:* `RTCPeerConnection.getStats()` — `bytesSent`, `framesEncoded`, `qualityLimitationReason` from the outbound-rtp report. Standard API, no library.
  - *CDP screencast:* drive `Page.startScreencast` through Playwright's `context.newCDPSession(page)`; sum decoded frame payload sizes per `screencastFrame` event (account for the base64 inflation consistently with how PhantomStream's envelope is counted).
  - *rrweb 2.0.1:* serialize the recorded event stream; apply the same envelope compression before counting, so the comparison is transport-fair.
  - Measure all four at the same conceptual boundary (application payload bytes entering the transport). Validate once against an OS-level packet count (e.g., loopback pcap) to show app-level counting is honest, then rely on app-level for all runs. Confidence: MEDIUM (methodology synthesis; individual APIs are HIGH).
- **Latency:** same-machine loopback; stamp `performance.now()` at capture-flush and at viewer-apply; align clocks across contexts with an RTT/offset handshake (or rely on shared `timeOrigin` where contexts permit). No library needed.
- **Fidelity scoring:** screenshot the source tab and the mirror iframe at matched moments → `sharp` normalizes (crop to viewport, resize to identical dimensions, flatten DPR) → `pngjs` decodes → `pixelmatch` (pixel-diff ratio) + `ssim.js` (SSIM) per pair. Report both; SSIM is the headline metric (perceptual), pixel-diff the strict one. If corpus-scale throughput hurts, `odiff-bin` 4.3.8 is a fast native drop-in for the pixel-diff leg.

## Installation

```bash
# Runtime dependency of the published package (relay reference transport)
npm install ws@8.21.0

# Optional/legacy codec (or keep vendored as in reference/)
npm install lz-string@1.5.0

# Dev: types, bundling, package validation
npm install -D typescript@6.0.3 esbuild@0.28.0 @arethetypeswrong/cli@0.18.3 publint@0.3.21

# Dev: browser testing
npm install -D @playwright/test@1.60.0
npx playwright install chromium

# Dev: evaluation harness
npm install -D pixelmatch@7.2.0 ssim.js@3.5.0 pngjs@7.0.0 sharp@0.34.5 rrweb@2.0.1 simple-statistics@7.9.0
```

(Consider isolating harness deps in a `harness/` workspace package so the published package's dev-dep surface stays small — sharp and rrweb have no business near the SDK's install story.)

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| esbuild (direct API) | Rollup 4.61.1 | If adapter bundles ever need sophisticated plugin transforms or readable preserved-modules output — not foreseeable for 4 small IIFE artifacts |
| esbuild (direct API) | tsup / tsdown / vite lib mode | If the project abandoned zero-build and needed orchestrated multi-format output with TS compilation — contradicts a core constraint |
| CompressionStream (deflate-raw) | fflate 0.8.3 | A synchronous compression requirement emerges, or a target context without native support appears |
| ws | uWebSockets.js | Relay must scale to thousands of concurrent viewers (explicitly out of scope for v1/paper) and GitHub-URL install friction is acceptable |
| @playwright/test (all browser tests) | Vitest 4 browser mode (`@vitest/browser-playwright` 4.1.8) | Fine-grained renderer component unit tests with watch-mode DX become a real bottleneck; never for extension-context or multi-page tests |
| pixelmatch + ssim.js | odiff-bin 4.3.8 | Corpus-scale screenshot comparison becomes a throughput bottleneck |
| Playwright HAR replay (frozen corpus) | wget/single-file static mirrors + local server | If a baseline can't route through Playwright's network stack (e.g., WebRTC tab-capture of an externally-served page needs identical serving for non-Playwright consumers) |
| TypeScript 6.0.3 | TypeScript 5.9.x | Only if 6.0's tightened JS-file analysis produces blocking false positives on the JSDoc dialect — pin 5.9 temporarily and file the upstream issue; do not design around 5.x long-term (TS 7 native inherits 6.0 behavior) |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| lz-string as the *default* codec | Unmaintained since 2023-03; 3–4× slower than deflate; 4.8 KB added to every injection bundle; non-standard format | Native CompressionStream `deflate-raw`; keep lz-string only as the FSB-compat legacy envelope codec |
| pako | Superseded by fflate (smaller, faster); unmaintained since 2022-11; and native CompressionStream removes the need entirely | CompressionStream; fflate if sync needed |
| uWebSockets.js | Not on the npm registry (verified) — GitHub-URL install with native binaries breaks `npx` demo plug-and-play and consumer installs | ws 8.21.0 |
| jsdom / happy-dom for capture/renderer tests | No layout engine (`getBoundingClientRect` → zeros kills truncation tests), non-cascading `getComputedStyle` kills style-capture tests, no real iframe/Shadow DOM rendering | @playwright/test against real Chromium |
| TypeScript-as-source migration | Violates the zero-build injection constraint; project decision already locked | Plain JS + JSDoc, `tsc --checkJs` + declaration emit |
| `@enum` / `@constructor` JSDoc patterns | De-recognized in the TS 7 native rewrite; tightening began in TS 6.0 — types built on them will silently degrade | Plain `@typedef` unions, `class` syntax, `@import` tags |
| ws `perMessageDeflate: true` | Double-compresses already-enveloped payloads; documented memory-fragmentation history | App-level envelope compression only (and it's the ws default anyway) |
| Long-lived npm tokens in CI | Superseded; exfiltration risk | npm trusted publishing (OIDC, GA since 2025-07) with automatic provenance |
| `--outFile` / monolithic tsc output tricks | Removed/deprecated territory in TS 6/7 | esbuild for any concatenation needs |

## Stack Patterns by Variant

**If the codec swap to async CompressionStream destabilizes the capture flush path during extraction:**
- Ship v1 with lz-string as default (it's proven) and CompressionStream behind the codec seam as opt-in
- Because wire-compat + proven behavior beats a stalled extraction; the harness will quantify what the swap is worth before forcing it

**If `tsc` 6.0 declaration emit from JSDoc produces broken `.d.ts` for some module shape:**
- Hand-write a `.d.ts` for that one subpath (the `exports` map's per-subpath `types` condition supports mixing generated and hand-written declarations); validate with `attw --pack`
- Because one hand-maintained declaration file is cheaper than restructuring source or abandoning generated types

**If the bookmarklet adapter exceeds practical `javascript:` URL size after minification:**
- Ship the bookmarklet as a loader stub that injects `<script src>` pointing at the full IIFE bundle (self-hosted or CDN), and document the CSP failure mode
- Because URL-length and CSP limits are environmental, not engineering-solvable

**If the relay needs multi-viewer scale later (explicitly out of v1 scope):**
- Revisit uWebSockets.js or a Go/Rust relay behind the same Transport interface
- Because the transport-agnostic relay design makes the backend swappable without touching capture/renderer

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| typescript@6.0.3 | Node ≥20 | Defaults changed vs 5.x (`strict`, `module: esnext`, `target: es2025`, `types: []`) — explicit tsconfig required; `tsc foo.js` alongside a tsconfig now errors without `--ignoreConfig` |
| @playwright/test@1.60.0 | Node ≥20 (project floor: ≥22) | Extension testing requires `chromium` channel for headless; MV3 SW suspends ~30 s idle — in-flight `evaluate()` throws "Service worker restarted" (harness retry logic needed) |
| pixelmatch@7.2.0 | ESM-only | Fine: repo is `"type": "module"`; CJS consumers would need dynamic import (n/a here) |
| ws@8.21.0 | Node ≥10 | Trivially compatible; set `maxPayload` to protocol's 1 MiB cap |
| esbuild@0.28.0 | pin exact | Pre-1.0: minor versions may break flags; pin and bump deliberately |
| sharp@0.34.5 | Node ≥18, prebuilt binaries | Native module — keep in harness workspace, never in published package deps |
| CompressionStream (`deflate-raw`) | Chrome/FF/Safari since May 2023; Node ≥18 (verified Node 24) | Async-only: capture flush must serialize sends to preserve message ordering |
| rrweb@2.0.1 | `latest` dist-tag (verified) | 2.0 stable line; do not pin the old 2.0.0-alpha.x tags |

## Sources

- npm registry (`npm view`, 2026-06-09) — all versions, dist-tags, and last-publish dates above; verified uWebSockets.js absent from registry — HIGH
- [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) — default changes, deprecations, TS 7 preparation — HIGH
- [Socket: TypeScript 6.0 last JS-based major](https://socket.dev/blog/typescript-6-0-will-be-the-last-javascript-based-major-release), [DEV: TS 7 native / TS 6 defaults](https://dev.to/matheus_releaserun/typescript-70-goes-native-in-go-ts-60-breaks-defaults-3kb8) — JSDoc pattern de-recognition (`@enum`, `@constructor`) in TS 6/7 — MEDIUM
- [MDN: CompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream) — Baseline Widely Available since May 2023, worker availability — HIGH; local Node 24 verification of `gzip`/`deflate-raw` globals — HIGH
- [Playwright: Chrome extensions](https://playwright.dev/docs/chrome-extensions) — MV3 testing via persistent context, headless `chromium` channel, SW suspend semantics — HIGH
- [npm Docs: Trusted publishers](https://docs.npmjs.com/trusted-publishers/), [GitHub changelog: npm trusted publishing GA](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/), [npm Docs: provenance](https://docs.npmjs.com/generating-provenance-statements/) — OIDC publish flow, automatic provenance — HIGH
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4), [InfoQ: Vitest 4 browser mode stable](https://www.infoq.com/news/2025/12/vitest-4-browser-mode/) — browser mode stabilization, provider package split — HIGH
- [Chrome for Developers: content scripts manifest reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts), [Medium: ES modules in content scripts](https://stephencowchau.medium.com/using-es-module-in-chrome-browser-extension-content-script-4144a70dd59a) — MV3 content scripts not ESM-capable without dynamic-import workaround — MEDIUM-HIGH (re-verify in adapter phase)
- [Medium: JS compression strategies benchmark](https://medium.com/@1988hz/exploring-data-compression-strategies-in-javascript-d012f645f237), [fflate GitHub](https://github.com/101arrowz/fflate) — lz-string vs deflate speed/ratio data points — LOW-MEDIUM on exact numbers; flagged for harness measurement by design
- `reference/` codebase + `docs/ARCHITECTURE.md` — shipped envelope format, relay cap, ws usage, lz-string vendoring — HIGH (first-party)

---
*Stack research for: PhantomStream extraction and publication*
*Researched: 2026-06-09*
