# Changelog

All notable changes to `@full-self-browsing/phantom-stream` are documented here. The project follows semantic versioning.

## 0.2.1 — 2026-06-22

Security hardening of the media gate introduced in 0.2.0. This is also the first npm release to carry the 0.2.0 Asset and Media Streaming work, so installing 0.2.1 brings both the media features and these fixes. No API changes, fully backward compatible.

### Fixed

- **Gate `<source srcset>` at the string layer.** A responsive `<picture><source srcset>` candidate at a blocked origin could be prefetched during srcdoc parse. The pre parse gate now checks every srcset candidate the same way the `<img>` path does, stripping the offending srcset or falling back to the placeholder when no allowed source remains. (Codex P1)
- **Scan `<audio>` in the pre parse media gate.** An `<audio src>` was never string gated, so a real browser could start the media request during parse before the post parse pass removed it. The scanner now includes `<audio>`, and the container orphan guard is generalized so a neutralized `<audio>` consumes its own close tag and children. (Codex P1)
- **Preserve poster mode for media `src` mutations.** A poster mode `video.src` or `source.src` mutation was gated as an image and slipped through to the live mirror. The diff gate now picks the gate kind from the live element tag, so poster mode withholds the playable source on a mutation too. (Codex P2)

### Quality

Full suite green at 712 of 712 (eight new tests), differential oracle at 48 of 48, generated types clean. The package publishes from CI over OIDC trusted publishing with no token.

## 0.2.0 — 2026-06-21

The Asset and Media Streaming milestone. The viewer now mirrors media by reference: it renders images, video, and audio by loading the original source URL over its own network, while the relay keeps carrying only text and small state messages. Media bytes never traverse the relay, so the low bandwidth core value is preserved. Tagged and released on GitHub, and first published to npm as part of 0.2.1.

### Added

- **Static assets by reference.** Images, srcset, picture, source, SVG image, CSS background image, and video poster resolve to absolute source URLs and render in the viewer from the origin. The displayed variant is pinned, non shareable references degrade to a dimensioned placeholder, and a fail closed viewer fetch model is established: an https only origin policy that blocks private and internal ranges, a `mediaMode` switch, and a precise Content Security Policy.
- **Progressive video and audio with playback sync.** Video and audio play in the viewer from the source URL, driven cross realm from the parent so no player code runs in the sandbox. Playback state streams over a throttled `STREAM.MEDIA` side channel and applies with a pure, drift corrected reconciler: small drift holds within tolerance, large drift triggers a hard seek, and live streams rejoin the edge. A muted autoplay default honors autoplay policy, with an observable affordance when playback is blocked. Validated live in real Chrome, including lockstep sync and hard seek reconvergence to within 0.02 seconds after a 25 second source jump.
- **Adaptive streaming with discovery and fallback.** HLS and DASH manifests play through an optional, lazy player in a renderer owned parent realm that binds a MediaSource object URL cross realm to the inert in iframe element. Playwright and extension adapters surface manifest URLs by network observation as opt in hints. Media that cannot be referenced degrades to a poster with an observable reason, so the mirror never breaks. hls.js is an optional peer dependency loaded through a dynamic import, so the published module stays free of hard runtime dependencies.
- **Media security completion.** An asset and media URL masking vocabulary, a document level `referrerpolicy="no-referrer"` with no credentials by default, a threat model of the parent realm object URL blast radius, media security tests, and updated security and architecture docs.

### Quality

All 20 milestone requirements satisfied, cross phase integration sound, full suite at 704 of 704, differential oracle at 48 of 48. No new hard dependencies, the sandbox stays exactly `allow-same-origin`, and the envelope and relay are unchanged.

## 0.1.0 — 2026-06-16

Initial release of the standalone framework, extracted from FSB (Full Self-Browsing) milestone v0.9.9.1 and decoupled from `chrome.runtime` and the FSB namespace.

### Added

- **Protocol module.** Wire types, the self identifying LZ string envelope, shared constants, and per session and per snapshot identity.
- **Capture core.** One style inlined snapshot, then paint cadence MutationObserver diffs, with WeakMap node identity and `nodeIds` sidecars, curated computed style inlining, budgeted snapshots, and dual watchdogs.
- **Renderer.** Viewer reconstruction in an iframe sandboxed to exactly `allow-same-origin`, diff apply by node id, overlays, and scale to fit, behind a CSP meta tag and a post parse scrub.
- **Relay.** A transport agnostic routing core with a 1 MiB per message cap and backpressure drop, plus a pluggable WebSocket backend.
- **Transport and adapters.** A browser compatible WebSocket transport for both ends and a Playwright and CDP injection adapter with authorized reverse remote control.
- **Security pipeline.** Capture side sanitization, the sandboxed render contract, and privacy masking (`blockSelector`, `maskTextSelector`, `maskInputs`, custom mask functions, passwords always masked).
- **Fidelity completion.** Shadow DOM, same origin iframes, subtree recovery, and an opt in CSSOM capture mode.
- **Demos and tests.** Two tab, Playwright, and embedded loopback demos, plus the `node:test` suite and a differential oracle against the FSB reference.
