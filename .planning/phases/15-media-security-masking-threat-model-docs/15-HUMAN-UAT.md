---
status: partial
phase: 15-media-security-masking-threat-model-docs
source: [15-VERIFICATION.md]
started: 2026-06-21T00:00:00Z
updated: 2026-06-21T00:00:00Z
validation_note: deferred — jsdom issues no real subresource requests and enforces no CSP; FSB automation runs tabs hidden. String-layer contracts are unit-asserted. Same precedent as Phases 13-14.
---

## Current Test

[deferred — real-browser security observation (no-referrer header, CSP enforcement) requires a foregrounded/non-headless Chrome; not exercisable in jsdom or the hidden-tab FSB automation browser.]

## Environment Note

All 13 automated must-haves pass (masking vocabulary + pure helper byte-identity, fail-closed `maskAssetUrlFn`, masked-media-emits-no-state, the `<meta name="referrer" content="no-referrer">` ordering, no-crossorigin, deps byte-unchanged, sandbox `allow-same-origin`, the object-URL threat model + all 18 purity markers; suite 704/704, oracle 48/48, purity 8/8). The two items below need a real browser. This is the same documented limit as Phases 13–14: jsdom does not parse the srcdoc / issue real subresource requests / enforce CSP, and the FSB automation browser runs its tab hidden. The string-layer security contracts (meta present + ordered, no crossorigin, CSP shape) are all unit-asserted.

## Tests

### 1. Real-browser no-referrer header suppression
expected: Loading the mirror with a cross-origin CDN asset issues subresource GETs that carry NO `Referer` header (Chrome devtools Network tab).
result: DEFERRED (environment) — the document-level `<meta name="referrer" content="no-referrer">` (after CSP_META, before the first subresource, no crossorigin) is string-asserted; live header suppression needs a real browser.

### 2. Real CSP enforcement on live mirrored content
expected: Real Chrome — scripts in the mirror iframe blocked (no `script-src`), media/`blob:` plays (`media-src blob:`), no `connect-src` needed, `default-src 'none'` enforced.
result: DEFERRED (environment) — the CSP string shape is unit-pinned; live enforcement needs a real browser. jsdom does not enforce CSP.

## Summary

total: 2
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 2

## Gaps

No defects found. Real-browser security UAT deferred pending a foregrounded/non-headless session. All string-layer contracts are unit-asserted; the masking spine and the parent-realm object-URL threat model are verified in code/docs.
