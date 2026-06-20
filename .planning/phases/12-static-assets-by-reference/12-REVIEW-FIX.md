---
phase: 12-static-assets-by-reference
fixed_at: 2026-06-20T00:00:00Z
review_path: .planning/phases/12-static-assets-by-reference/12-REVIEW.md
iteration: 2
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report (iteration 2 / --auto fix loop)

**Fixed at:** 2026-06-20
**Source review:** .planning/phases/12-static-assets-by-reference/12-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 3 (1 surviving Critical + 2 Warning)
- Fixed: 3
- Skipped: 0
- Full test suite after fixes: **498 pass / 0 fail** (`npm test`), up from the
  480-pass green baseline (18 new regression cases added across the 3 findings).

Iteration 1 resolved the original 2 Critical + 4 Warning. This adversarial
re-review (EXECUTING the gated code through `jsdom` as the parser oracle) found
the CR-01 SSRF fix was incomplete (one IPv4 range missed) plus 2 fidelity
Warnings that fail safe today. All three are now fixed, each with executed
regression tests, and the whole suite is green.

## Fixed Issues

### CR-01: `0.0.0.0/8` ("this host", RFC 1122) not blocked -- SSRF to loopback

**Files modified:** `src/renderer/asset-policy.js`, `tests/renderer-asset-policy.test.js`
**Commit:** 5f1db13
**Applied fix:** Added `if (a === 0) return true;` to the IPv4 dotted-quad
branch in `isPrivateOrLocalHost` so the whole `0.0.0.0/8` range (first octet
`0`) is denied -- closing the proven `https://0.0.0.0/admin` ->
loopback-bound-service vector on Linux. Because the IPv4-mapped / IPv4-compatible
IPv6 branch (`::ffff:0:0`, `::ffff:0.0.0.0`) re-runs `isPrivateOrLocalHost` on
the embedded v4, those forms are now covered automatically by the same rule;
`[::]` (unspecified) was already caught by the literal `::` check. Updated the
module-header denylist comment to enumerate `0.0.0.0/8`. Regression: extended
`SSRF_BYPASS_ROWS` (`https://0.0.0.0/admin`, `:8080`, `0.0.0.1`, `0.1.2.3`, and
both IPv4-mapped 0.0.0.0 literals -> all BLOCKED) and `PREDICATE_PRIVATE_ROWS`,
plus a not-over-broad assertion that `1.0.0.0` / `1.2.3.4` stay public.
Verified by direct execution that every payload classifies `private-host` and
public space is unaffected.

### WR-01: backtick-unquoted attribute value defeats the quote-aware tag scanner

**Files modified:** `src/renderer/snapshot.js`, `tests/renderer-asset-gate.test.js`
**Commit:** a2fb3b3 (snapshot.js source) + e9a3425 (shared regression tests)
**Applied fix:** Made `findImgTagEnd` treat the backtick as a third quote
delimiter so a `>` inside a backtick-unquoted value (`alt=` + "`a>b`") no longer
truncates the scanner's tag boundary -- the scanner now stops at the REAL later
`>`, reads the trailing `src`/`srcset`, and gates it. This is the SAFE
over-block divergence direction (a URL a real parser would render inert is still
blocked), and a blocked metadata host can no longer re-emit unmodified (the
prior passthrough is gone -- the opener becomes the dimensioned placeholder).
Added a belt-and-suspenders `attrsBlobIsUnreliable(attrs)` guard in
`gateOneImgTag`: a residual UNBALANCED backtick (odd count, e.g. a backtick
running to EOF) forces the placeholder, so any shape the scanner still cannot
confidently bound fails CLOSED. Updated the CR-02 locator header to document the
backtick handling. Regression (executed through `jsdom`): the
backtick-`>`-then-blocked-src shape -> placeholder with the metadata host gone;
the string-layer output drops the host; an allowed-origin backtick shape is NOT
over-blocked (jsdom confirms the trailing src is inert text, never a fetch); and
the unbalanced-backtick-to-EOF shape fails closed. No regression to the existing
CR-02 / quoted-attribute cases. The vanishingly rare fidelity loss for
legitimate backtick attribute content is documented in code (backticks are not
HTML quote chars). _Note: WR-01 is a logic-bearing scanner change; the executed
jsdom-oracle tests confirm both the security (blocked) and fidelity (allowed,
inert) directions, so no residual human verification is flagged._

### WR-02: srcset parser splits http(s) URLs on commas in query strings (over-block)

**Files modified:** `src/renderer/sanitize.js`, `tests/renderer-asset-gate.test.js`
**Commit:** e9a3425
**Applied fix:** Extended the comma-as-separator suppression in
`parseSrcsetCandidates` from the `data:` carve-out to ANY scheme-bearing
absolute URL (`isAbsolute = /^[a-z][a-z0-9+.\-]*:\/\//i`), so an unencoded comma
inside an http(s) query string (`?w=1,2`) stays attached to the URL token
instead of mis-splitting a benign candidate into a bogus `2` that fails the gate
and degrades the whole `<img>` to a placeholder. This is a fidelity widening
only -- the per-candidate gate decision is unchanged, relative/scheme-less
candidates still split on commas, and `data:` candidates remain intact (WR-03/
WR-04 not regressed). Updated the JSDoc to document the two carve-outs.
Regression (executed end-to-end): a benign comma-in-query `srcset` now renders
as a real `<img>` (no placeholder) through both the snapshot string gate and the
diff ATTR gate; multi-candidate comma-in-query URLs split only at the
descriptor/comma boundary; `data:` and relative candidates behave as before; and
a genuinely private srcset candidate still correctly over-blocks to the
placeholder (the gate is not loosened).

## Skipped Issues

None -- all three in-scope findings were fixed.

## Constraints honored

- Sandbox token untouched (`allow-same-origin` only); no `script-src` /
  `media-src` / `allow-scripts` added; CSP unchanged
  (`default-src 'none'` + `img-src http: https: data:`).
- No changes under `reference/`. Only `src/renderer/asset-policy.js`,
  `src/renderer/snapshot.js`, `src/renderer/sanitize.js`, and the two test files
  were modified.
- CLAUDE.md conventions kept: plain JS ESM, JSDoc, named exports, 2-space
  indent, single quotes, `var` in the cross-runtime renderer modules, no emojis.

---

_Fixed: 2026-06-20_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
