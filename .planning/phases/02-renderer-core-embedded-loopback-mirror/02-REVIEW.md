---
phase: 02-renderer-core-embedded-loopback-mirror
reviewed: 2026-06-11T18:24:02Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - examples/loopback-mirror.html
  - examples/loopback-transport.js
  - examples/serve.js
  - src/capture/README.md
  - src/capture/index.js
  - src/renderer/README.md
  - src/renderer/diff.js
  - src/renderer/index.js
  - src/renderer/overlays.js
  - src/renderer/snapshot.js
  - tests/capture-overlay-forward.test.js
  - tests/renderer-diff.test.js
  - tests/renderer-loopback.test.js
  - tests/renderer-overlays.test.js
  - tests/renderer-purity.test.js
  - tests/renderer-snapshot.test.js
  - tests/renderer-viewer.test.js
  - tests/differential/divergence-ledger.js
  - tests/differential/oracle.test.js
  - tests/differential/scenarios/text-childlist.js
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-11T18:24:02Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Reviewed the Phase 2 renderer core extraction (`src/renderer/*`), the two capture
extensions (E1 overlay forwarding, E2 text-childlist fidelity fix), the loopback
demo (`examples/*`), and the test/oracle additions. Parity claims were verified
against the reference (`reference/dashboard/dashboard.js:2831-2869` scale math
and `:3209-3356` mutation handler both match the extraction, including the
`viewportHeight || 1080` asymmetry that looks like a typo but is exact parity).
The documented Phase 3 deferrals (raw `inlineStyles`/`html`, `on*` survival,
sandbox-as-control) were treated as accepted and are not re-flagged here.

Two findings were verified by executable probe rather than inspection:

1. **The E2 extension has a structural data-loss bug** (CR-01): any childList
   record containing a bare text node emits a flattening `text` op for the
   target, which destroys mirrored element children that still exist in the
   live DOM. `el.innerHTML = 'hello <b>world</b>'` and
   `el.appendChild(textNode)` on a mixed-content element both corrupt the
   mirror with little or no self-heal signal. The D6 oracle scenario and the
   loopback tests only exercise pure-text targets, so the suite is green
   around the bug.
2. **The demo server can be crashed by one request** (WR-01): a read-stream
   error after a successful `stat` (unreadable file, stat/open race) is an
   unhandled `'error'` event — probe-confirmed uncaught exception.

The remainder of the extraction is solid: containment discipline is consistent
(every post-factory error routes to the injected logger), the sandbox assertion
is correct and pinned, identity reservation in E1 is enforced last-write, the
resync latch has exactly one release site, and the differential-ledger D1/D6
predicates are tightly scoped with stale-entry detection. Test coverage is
unusually rigorous (negative controls, empty-ledger guards, both-direction
belt-and-braces assertions).

## Critical Issues

### CR-01: E2 text op flattens mixed-content targets, destroying live mirrored elements

**File:** `src/capture/index.js:959-971` (emission), `src/renderer/diff.js:134-142` (applier side of the interaction)
**Severity:** BLOCKER

**Issue:** The E2 fidelity fix emits `{ op: 'text', nid: targetNid, text: m.target.textContent }`
whenever a childList record contains **any** bare TEXT/CDATA node among its
added/removed nodes. The renderer applies this via `textContent = m.text`,
which **replaces all children** of the mirrored target. For the pure case
(`el.textContent = '...'` on a text-only element — the only shape D6, the
`text-childlist` oracle scenario, and the loopback tests cover) this is
correct. For mixed-content records it destroys mirrored structure that still
exists in the live DOM.

Probe-verified (jsdom, capture → `applyMutations` end-to-end):

- **Shape A — `box.appendChild(document.createTextNode('!'))`** where `box`
  contains `<span data-fsb-nid="2">a</span>`:
  emitted ops = `[{op:'text', nid:'1', text:'a!'}]` only.
  Live: `<div nid=1><span nid=2>a</span>!</div>`. Mirror: `<div nid=1>a!</div>`
  — the span (its element, id, inline styles) is gone from the mirror,
  **zero stale misses counted**, no resync trigger. Silent permanent drift.
- **Shape B — `box.innerHTML = 'hello <b>world</b>'`**:
  emitted ops = `add(<b nid=2>)`, then `text(nid 1, 'hello world')` — the
  trailing text op destroys the `<b>` the add op just inserted.
  Live: `hello <b>world</b>`. Mirror: `hello world` flat. Only 1 stale miss
  accrues (the follow-up nid-attr echo op), below the 3-miss resync threshold.

These are extremely common mutation shapes (`innerHTML` with mixed content,
text-node appends to mixed containers), so the "trustworthy mirror" core value
is violated in a way the reference never was — the reference dropped the text
(drift in text only); E2 trades that for **destruction of mirrored element
subtrees plus stale nids**. The comment at `src/capture/index.js:955-958`
("orders its rm ops before the text op ... matching the live DOM end state")
only reasons about the removal case; the mixed-add and append cases were not
considered.

**Fix:** Gate the emission on the live target having no element children at
process time. For `textContent = '...'` (the D6 case) the element children were
just removed, so `firstElementChild` is null and the op still emits; for mixed
content the flattening op is suppressed:

```js
if (sawBareTextNode) {
  var textTargetNid = m.target.getAttribute ? m.target.getAttribute(NID_ATTR) : null;
  if (textTargetNid && !textOpNids[textTargetNid]
      && !m.target.firstElementChild) {   // never flatten a target that still
    textOpNids[textTargetNid] = true;     // has live element children
    diffs.push({ op: 'text', nid: textTargetNid, text: m.target.textContent });
  }
}
```

This reverts mixed-content text changes to the reference's drop behavior
(text drift, structure intact) — strictly better than structural destruction.
Document the residual gap in the E2 README entry and the D6 ledger rationale,
or close it properly with a target-subtree re-serialization op. Add oracle/
loopback coverage for both probe shapes (the current `text-childlist` scenario
and `tests/renderer-loopback.test.js` rows are all text-only elements, which
is why 126/126 stays green around this bug).

## Warnings

### WR-01: One request can crash the demo server (unhandled read-stream error)

**File:** `examples/serve.js:76`
**Severity:** WARNING

**Issue:** `createReadStream(filePath).pipe(res)` attaches no `'error'`
handler, and `pipe()` does not forward source errors. If `stat` succeeds but
the stream open/read fails — unreadable file (mode 000), file deleted between
`stat` and open (TOCTOU), special file — the `'error'` event is unhandled and
the whole Node process dies. Probe-confirmed: a mode-000 file produces
`UNCAUGHT EXCEPTION ... EACCES` and process exit with the exact handler shape
from this file. The security-posture header (T-02-16/T-02-17) covers traversal
and binding, but a single-request full-process DoS is outside that accepted
register. Also related: `stats.isFile()` is never checked, so a FIFO/socket in
the tree would hang the response.

**Fix:**
```js
if (!stats.isFile()) { res.writeHead(404, ...); res.end('not found'); return; }
res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
const stream = createReadStream(filePath);
stream.on('error', () => res.destroy()); // headers already sent; abort the socket
stream.pipe(res);
```

### WR-02: Add-op parse-drop is silent — context-dependent elements vanish from the mirror with no self-heal signal

**File:** `src/renderer/diff.js:100-103`
**Severity:** WARNING

**Issue:** The add op parses `m.html` via a `<div>` fragment
(`temp.innerHTML = m.html; var newNode = temp.firstElementChild;`). HTML
parsing is context-sensitive: `<tr>`, `<td>`, `<tbody>`, `<col>`, `<option>`
etc. are discarded when parsed in a div context, so `newNode` is null and the
op is dropped via `if (!newNode) break;` — **no stale miss, no apply failure,
no log line**. A live table-row insertion (a very common dynamic-page
mutation) silently never reaches the mirror, and because nothing is counted,
the resync threshold never engages — the same "silent drift, no self-heal"
class the E2 fix exists to eliminate. This is verified reference parity
(`dashboard.js:3241-3244` is byte-identical), but unlike the other inherited
gaps it appears in neither the renderer README's Phase 3+ queue nor the
divergence ledger, so it is currently untracked.

**Fix:** Parse through a `<template>` element, which accepts any content
context:
```js
var temp = doc.createElement('template');
temp.innerHTML = m.html;
var newNode = temp.content ? temp.content.firstElementChild : null;
```
At minimum, count the parse-drop (`recordStaleMiss(DIFF_OP.ADD, m.parentNid)`
or an applyFailure) and add a logger.warn so the miss-accounting resync path
can self-heal — and record the gap in the README's queued-changes list if the
fix is deferred.

### WR-03: `viewportWidth` interpolated raw into srcdoc markup — undocumented injection point in the future sanitizer chokepoint

**File:** `src/renderer/snapshot.js:91`
**Severity:** WARNING

**Issue:** `'<meta name="viewport" content="width=' + (p.viewportWidth || 1920) + '">'`
inserts a wire-controlled value into the srcdoc with no escaping and no
numeric coercion. A non-numeric `viewportWidth` (e.g.
`'1"><img src=x onerror=...>'`) breaks out of the attribute into head markup.
Today this grants nothing beyond the already-raw `payload.html` (and the
sandbox blocks execution), but the file header documents exactly two raw
insertions (`inlineStyles`, `payload.html`) plus quote-escaped stylesheet
hrefs — this third raw path is **not** in that inventory, and
`buildSnapshotHtml` is the declared Phase 3 sanitization chokepoint. An
unlisted injection point in the chokepoint is precisely what gets missed when
SEC-02 lands. The typed contract (`SnapshotPayload.viewportWidth: number`)
is not enforced anywhere on the receive side.

**Fix:** Coerce to a number at the insertion site and add it to the header's
insertion inventory:
```js
'<meta name="viewport" content="width=' + (parseInt(p.viewportWidth, 10) || 1920) + '">'
```

## Info

### IN-01: Dialog `type` flows into prototype-chain lookup and an uncoerced `charAt` call

**File:** `src/renderer/overlays.js:411` and `src/renderer/overlays.js:427-428`
**Severity:** INFO

**Issue:** `ICON_SVG[type] || ICON_SVG.alert` on attacker-influenced wire data:
`type: 'constructor'` resolves a truthy prototype member, so the fallback is
skipped and `dialogIconEl.innerHTML` is set to the stringified native function
(garbage text; not exploitable, since only native-function strings are
reachable). Separately, a non-string `type` (e.g. `123`) throws at
`type.charAt(0)` — contained by `createViewer`'s dispatch wrapper, but
uncontained for direct consumers of the exported `createOverlays` handle.
**Fix:** `var type = String(dialog.type || 'alert');` and guard the icon map:
`Object.prototype.hasOwnProperty.call(ICON_SVG, type) ? ICON_SVG[type] : ICON_SVG.alert`
(or build `ICON_SVG` with `Object.create(null)`).

### IN-02: ResizeObserver resolved from the importing realm, not the host window

**File:** `src/renderer/index.js:467`
**Severity:** INFO

**Issue:** The factory carefully derives `doc`/`win` from
`container.ownerDocument` ("works in any window — host page, jsdom test,
future multi-doc", line 148-152), but the resize wiring checks the bare global
`typeof ResizeObserver !== 'undefined'`. In a multi-window host the observer
is constructed from (or missed in) the wrong realm, silently disabling
container-resize rescaling.
**Fix:** `if (win && typeof win.ResizeObserver === 'function') { resizeObserver = new win.ResizeObserver(...); }`

### IN-03: Null mirror document drops mutation batches with zero accounting

**File:** `src/renderer/diff.js:70`
**Severity:** INFO

**Issue:** `if (!doc || !doc.body) return;` silently discards the whole batch.
Unlike stale misses there is no counter, log, or resync path, so a torn-down
or inaccessible `contentDocument` after streaming begins drifts invisibly.
Reference parity (`dashboard.js:3216`), and pre-onload drops are documented —
but this branch is reachable post-onload too.
**Fix:** At minimum `logger.warn('[Renderer] mutation batch skipped: no mirror document')`
so the condition is observable; consider counting it toward `applyFailures`.

### IN-04: Loopback fan-out lets one throwing handler starve the rest of the subscribers

**File:** `examples/loopback-transport.js:44-46`
**Severity:** INFO

**Issue:** `handlers.forEach(function (h) { h(type, payload); })` runs all
subscribers in one microtask: a throwing handler aborts delivery to every
later subscriber for that message and surfaces as an unhandled microtask
error. The viewer's dispatch is containment-wrapped, but the demo's
`onControl` glue and any host-added handler are not. The duplicated copy in
`tests/renderer-loopback.test.js:135-139` has the same property (benign there —
recorder handlers never throw).
**Fix:** Isolate per handler:
```js
handlers.forEach(function (h) {
  try { h(type, payload); } catch (e) { console.error('loopback handler failed', e); }
});
```

---

## Verification notes

- Full suite re-run during review: 126/126 pass (`node --test tests/*.test.js tests/differential/*.test.js`).
- CR-01 verified by probe: capture core + `applyMutations` end-to-end in jsdom; both shapes reproduced with exact op streams and mirror states recorded above.
- WR-01 verified by probe: exact handler shape from `examples/serve.js` reproduced; uncaught `EACCES` exception confirmed.
- WR-02 parity verified against `reference/dashboard/dashboard.js:3241-3244`.
- `updateScale`'s `viewportHeight || 1080` (no `pageHeight` fallback) checked against `dashboard.js:2834-2835` — exact parity, deliberately not flagged.
- Phase 3 deferrals (raw inlineStyles/html, `on*` survival, per-op querySelector) honored as accepted scope; not flagged.

_Reviewed: 2026-06-11T18:24:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
