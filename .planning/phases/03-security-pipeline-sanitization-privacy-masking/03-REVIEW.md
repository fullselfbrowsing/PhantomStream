---
phase: 03-security-pipeline-sanitization-privacy-masking
reviewed: "2026-06-14T01:33:27Z"
depth: standard
files_reviewed: 20
files_reviewed_list:
  - README.md
  - docs/SECURITY.md
  - src/capture/README.md
  - src/capture/index.js
  - src/renderer/README.md
  - src/renderer/diff.js
  - src/renderer/index.js
  - src/renderer/sanitize.js
  - src/renderer/snapshot.js
  - tests/differential/divergence-ledger.js
  - tests/differential/fixtures/sanitize-corpus.html
  - tests/differential/oracle.test.js
  - tests/differential/scenarios/sanitize-divergence.js
  - tests/renderer-diff.test.js
  - tests/renderer-purity.test.js
  - tests/renderer-snapshot.test.js
  - tests/security-chokepoint-purity.test.js
  - tests/security-mask.test.js
  - tests/security-sanitize-capture.test.js
  - tests/security-sanitize-render.test.js
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-06-14T01:33:27Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Reviewed the Phase 03 capture/render sanitizer, masking, D7 oracle, docs, and tests. The main snapshot/add/attr/text chokepoints are well covered, but two secondary URL surfaces still bypass the intended inert-output behavior: external stylesheet links are emitted without URL sanitization, and capture-side `srcset` scrubbing rewrites hostile candidates into malformed relative candidates instead of removing them.

## Warnings

### WR-01: Stylesheet URLs bypass the URL sanitizer

**File:** `src/capture/index.js:1594`
**Issue:** `serializeDOM()` pushes `absolutifyUrl(href)` from `head link[rel="stylesheet"]` directly into `payload.stylesheets`. That side channel is not routed through `sanitizeForWire`, so a page-controlled `<link rel="stylesheet" href="javascript:alert(1)">` is emitted on the wire as `["javascript:alert(1)"]`. The renderer then interpolates the value into `<link rel="stylesheet" href="...">` in `src/renderer/snapshot.js:125-126`, and `tests/renderer-snapshot.test.js:123-134` currently pins quote-only escaping rather than sanitizer behavior. CSP is a backstop, but this violates the Phase 03 contract that dangerous URL schemes are removed before transport/render.
**Fix:**
```js
// src/capture/index.js, inside the stylesheet collection loop
var href = links[s].getAttribute('href');
if (href) {
  var stylesheetHref = absolutifyUrl(href);
  if (hasDangerousScheme(stylesheetHref)) {
    sanitizeCounters.blockedUrlSchemes++;
  } else {
    stylesheets.push(stylesheetHref);
  }
}
```
Also add render-side defense before building stylesheet `<link>` tags, and flip/add tests that assert `javascript:`, `vbscript:`, and `data:text/html` stylesheet values do not appear in `payload.stylesheets` or `buildSnapshotHtml()` output.

### WR-02: Hostile `srcset` candidates become relative URLs instead of being removed

**File:** `src/capture/index.js:203`
**Issue:** `scrubSrcset()` handles a dangerous candidate by setting `parts[0] = ''` and rejoining the descriptor. In practice, `srcset="javascript:alert(1) 1x, https://safe.test/a.png 2x"` becomes a surviving malformed candidate (`1x`, observed as `https://fixture.test/1x` in a snapshot). That means the dangerous candidate is not cleanly removed; it is transformed into an unintended relative fetch target, and render-side sanitization cannot recognize it later because the dangerous scheme is already gone.
**Fix:**
```js
function scrubSrcset(srcset) {
  if (!srcset) return srcset;
  try {
    var entries = srcset.split(',');
    var kept = [];
    var changed = false;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i].trim();
      if (!entry) continue;
      var parts = entry.split(/\s+/);
      if (parts[0] && hasDangerousScheme(parts[0])) {
        changed = true;
        continue;
      }
      kept.push(entry);
    }
    return changed ? kept.join(', ') : srcset;
  } catch (e) {
    return srcset;
  }
}
```
Add capture regressions for snapshot, add-op, and attr-op `srcset` values that assert no `javascript:` and no leftover `/1x` or bare `1x` candidate survives. If data URI srcset fidelity matters, use a parser that does not split inside `data:image/...` payloads.

---

_Reviewed: 2026-06-14T01:33:27Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
