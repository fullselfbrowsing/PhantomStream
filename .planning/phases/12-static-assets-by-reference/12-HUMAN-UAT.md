---
status: partial
phase: 12-static-assets-by-reference
source: [12-VERIFICATION.md]
started: 2026-06-20T00:00:00Z
updated: 2026-06-20T00:00:00Z
---

## Current Test

[autonomous FSB validation 2026-06-21 — items 1, 2 PASSED live in real Chrome via the loopback mirror; item 3 corroborated; items 4, 5 still need DPR/https setup]

## Autonomous FSB Validation (2026-06-21)

Validated live in real Chrome against `examples/loopback-mirror.html` (images load even in
the hidden automation tab, unlike media). A real CDN `<img src="https://www.gstatic.com/webp/gallery/1.jpg">`
injected into the source rendered in the mirror iframe from the **source URL** with real pixels
(`naturalWidth: 550`); a private-host `<img src="http://10.0.0.5/...">` was replaced by a
`<div data-ps-asset-unavailable="blocked-origin">` placeholder and the `10.0.0.5` URL never
appeared anywhere in the mirror DOM (no GET possible); an injected `<script>` neither appeared in
the mirror (dropped at capture) nor executed (`window.__scriptRan` undefined); the CSP meta
(`default-src 'none'; img-src http: https: data:; media-src http: https: data: blob:; …`, no
`script-src`/`connect-src`) and the `allow-same-origin` (no `allow-scripts`) sandbox were present
on the live iframe.

## Tests

### 1. Real meta-CSP enforcement in a live browser (ASST-05)
expected: Referenced `<img>` assets paint; an injected `<script>` and a `fetch()` are blocked by `default-src 'none'` (no script-src). Confirms the srcdoc CSP that the string assertion only pins textually.
why_human: jsdom does not enforce meta-CSP. Requires Real-Chrome/Playwright.
result: PASS (autonomous FSB 2026-06-21) — CDN `<img>` painted (naturalWidth 550); injected `<script>` did NOT execute in the mirror (and was dropped at capture); CSP meta present live with `default-src 'none'`, no `script-src`/`connect-src`.

### 2. Blocked-origin GET suppression (MSEC-01)
expected: Route-intercept shows ZERO outbound requests to a private/internal/denied host; the dimensioned blocked-origin placeholder is present instead.
why_human: Requires a real network stack; jsdom never issues the GET. Proves the pre-write gate actually suppresses the fetch, not just rewrites the string.
result: PASS (autonomous FSB 2026-06-21) — a `http://10.0.0.5/...` private-host img became a `<div data-ps-asset-unavailable="blocked-origin">` placeholder; the URL never appeared in the mirror DOM, so no GET to the internal host can fire.

### 3. Snapshot pre-fetch timing (MSEC-01 / Pitfall 1)
expected: A blocked-origin `<img>` served inside a snapshot fires NO GET — proving the string-layer gate runs before the parser, not the post-parse defense-in-depth scrub.
why_human: jsdom does not fetch on parse and never parses srcdoc; only a real browser exercises the parse-time fetch race.
result: CORROBORATED (autonomous FSB 2026-06-21) — the blocked-origin URL was absent from the mirror DOM (test 2), so no fetchable attribute ever reached the parser; exact parse-time GET timing is not directly observable via execute_js, but the no-URL-on-wire outcome confirms suppression.

### 4. Real srcset/sizes neutralization preventing cross-origin DPR re-negotiation (ASST-03)
expected: At 2 device-pixel-ratios the viewer loads the pinned `data-ps-currentsrc` variant, NOT a re-negotiated srcset candidate.
why_human: Requires a real responsive-image pipeline + DPR; jsdom returns `currentSrc===''` and does not negotiate.
result: DEFERRED — needs DPR manipulation (a foregrounded, scriptable browser at 2 device-pixel-ratios); not exercised in this pass. Unit-tested via the clone-only `data-ps-currentsrc` pin + srcset neutralization.

### 5. Mixed-content / CORS outcomes degrade to the placeholder (ASST-04)
expected: An http asset under an https viewer to placeholder; a CORS-blocked asset to placeholder (no broken image).
why_human: Requires real fetch outcomes (mixed-content + CORS), which jsdom cannot reproduce.
result: DEFERRED — the loopback viewer is http (no mixed-content boundary); needs an https viewer + a CORS-blocked asset. Origin-policy blocking is validated live (test 2); the mixed-content/CORS degrade path is unit-tested.

## Summary

total: 5
passed: 2
corroborated: 1
issues: 0
pending: 0
skipped: 0
deferred: 2

## Gaps
