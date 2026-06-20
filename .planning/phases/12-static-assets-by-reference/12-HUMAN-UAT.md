---
status: partial
phase: 12-static-assets-by-reference
source: [12-VERIFICATION.md]
started: 2026-06-20T00:00:00Z
updated: 2026-06-20T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Real meta-CSP enforcement in a live browser (ASST-05)
expected: Referenced `<img>` assets paint; an injected `<script>` and a `fetch()` are blocked by `default-src 'none'` (no script-src). Confirms the srcdoc CSP that the string assertion only pins textually.
why_human: jsdom does not enforce meta-CSP. Requires Real-Chrome/Playwright.
result: [pending]

### 2. Blocked-origin GET suppression (MSEC-01)
expected: Route-intercept shows ZERO outbound requests to a private/internal/denied host; the dimensioned blocked-origin placeholder is present instead.
why_human: Requires a real network stack; jsdom never issues the GET. Proves the pre-write gate actually suppresses the fetch, not just rewrites the string.
result: [pending]

### 3. Snapshot pre-fetch timing (MSEC-01 / Pitfall 1)
expected: A blocked-origin `<img>` served inside a snapshot fires NO GET — proving the string-layer gate runs before the parser, not the post-parse defense-in-depth scrub.
why_human: jsdom does not fetch on parse and never parses srcdoc; only a real browser exercises the parse-time fetch race.
result: [pending]

### 4. Real srcset/sizes neutralization preventing cross-origin DPR re-negotiation (ASST-03)
expected: At 2 device-pixel-ratios the viewer loads the pinned `data-ps-currentsrc` variant, NOT a re-negotiated srcset candidate.
why_human: Requires a real responsive-image pipeline + DPR; jsdom returns `currentSrc===''` and does not negotiate.
result: [pending]

### 5. Mixed-content / CORS outcomes degrade to the placeholder (ASST-04)
expected: An http asset under an https viewer to placeholder; a CORS-blocked asset to placeholder (no broken image).
why_human: Requires real fetch outcomes (mixed-content + CORS), which jsdom cannot reproduce.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
