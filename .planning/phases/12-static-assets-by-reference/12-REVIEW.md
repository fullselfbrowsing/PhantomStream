---
phase: 12-static-assets-by-reference
reviewed: 2026-06-20T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/renderer/asset-policy.js
  - src/renderer/snapshot.js
  - src/renderer/sanitize.js
  - src/renderer/diff.js
  - src/renderer/index.js
findings:
  critical: 0
  warning: 0
  info: 1
  total: 1
status: clean
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** clean

## Summary

Final re-review (iteration 3 of the --auto loop). Iteration 2 left one surviving
Critical (CR-01: the `0.0.0.0/8` "this host" SSRF gap) plus two fail-closed
Warnings (WR-01 backtick-unquoted `<img>` scanner divergence, WR-02 srcset
in-query comma over-split). The fixer applied three commits (5f1db13, a2fb3b3,
e9a3425). I confirmed every fix adversarially by reading the code AND executing
the exported functions against the canonical SSRF payloads and a broad bypass
sweep — I did not trust the fixer or the test names.

**Verdict: the SSRF surface is now fully closed.** All three fixes hold, no new
bypass was introduced by either the backtick-as-quote scanner logic or the
srcset comma carve-out, and the Phase-12 security invariants are intact. The
72 asset tests and 93 renderer/security tests pass. Only one cosmetic Info item
remains (a benign trailing-comma artifact in one parser branch that does not
affect any gate decision).

### CR-01 (0.0.0.0/8) — CONFIRMED FIXED

`isPrivateOrLocalHost` (asset-policy.js:95) now carries the `if (a === 0) return true;`
branch inside the IPv4 dotted-quad block, and it is reached by BOTH paths:
- **Dotted-quad path:** `https://0.0.0.0/admin` → regex match → `a === 0` → denied.
- **IPv4-mapped-IPv6 path:** `https://[::ffff:0:0]/` and `https://[::ffff:0.0.0.0]/`
  → bracket strip → mapped regex (line 121) extracts embedded `0.0.0.0` →
  recursive `isPrivateOrLocalHost('0.0.0.0')` → `a === 0` → denied.

All four mandated payloads are blocked (executed, not asserted):

| Payload | Verdict |
|---|---|
| `https://0.0.0.0/admin` | `{allowed:false, reason:'private-host'}` |
| `https://[::ffff:0:0]/` | `{allowed:false, reason:'private-host'}` |
| `https://[::ffff:0.0.0.0]/` | `{allowed:false, reason:'private-host'}` |
| `https://[::]/` | `{allowed:false, reason:'private-host'}` |

**Broad SSRF bypass sweep (38 payloads) — ZERO leaks.** I exercised
`classifyAssetOrigin` against the metadata host in every representation
(`169.254.169.254`, `::ffff:169.254.169.254`, `::ffff:a9fe:a9fe`,
`64:ff9b::a9fe:a9fe`, `64:ff9b::169.254.169.254`), loopback in every form
(`127.0.0.1`, `127.1`, `127.0.0.1.`, `::ffff:7f00:1`, `::127.0.0.1`,
fully-expanded `0:0:0:0:0:ffff:7f00:1`), decimal/hex/octal integer IP encodings
(`2130706433`, `0x7f000001`, `0177.0.0.1`, `2852039166`, bare `0`), all RFC1918
ranges, IPv6 ULA/link-local (`fd00::1`, `fc00::1`, `fe80::1`, `fe80::1%eth0`),
`::1` (compressed and expanded), uppercase-hex IPv6 literals, and dotless/.local
names. Every one returned `allowed:false`. The integer/octal/hex encodings are
caught because WHATWG `new URL()` normalizes them to dotted-quad form
(`0` → `0.0.0.0`, `2130706433` → `127.0.0.1`) before the host reaches the regex,
and `classifyAssetOrigin` lowercases the host so uppercase-hex IPv6 is covered.

**The exported `isPrivateOrLocalHost` raw seam (Phase-15 reuse) is self-contained.**
I tested it directly with un-normalized host strings (no `new URL()`
pre-normalization): trailing-dot (`localhost.`, `127.0.0.1.`), zone-id
(`fe80::1%eth0`), IPv4-mapped with hex hextets decoding to private ranges
(`::ffff:a9fe:a9fe`, `::ffff:0a00:0001`, `::ffff:c0a8:0101`) all return `true`,
while genuinely public mapped forms (`::ffff:8.8.8.8`, `::ffff:0808:0808`,
`8.8.8.8`, `example.com`) correctly return `false`. **No over-block** of public
hosts in either the raw seam or `classifyAssetOrigin` (`example.com`, `8.8.8.8`,
`cdn.example.com`, `sub.domain.co.uk` all allowed).

### WR-01 (backtick scanner) — CONFIRMED FIXED, no new bypass

The quote-aware `findImgTagEnd` + `attrsBlobIsUnreliable` fail-closed gate holds:
- `<img alt="a>b" src="https://169.254.169.254/x">` → placeholder (the in-quote
  `>` no longer splits the tag; the blocked metadata src is gated).
- `<img alt='x>y' src='https://127.0.0.1/x'>` → placeholder.
- backtick `alt` carrying `>` then blocked `0.0.0.0`/metadata src → placeholder
  (odd backtick count flags the blob unreliable → fail closed).
- `<img src="https://169.254.169.254/x` (unbalanced quote to EOF) → placeholder
  for the remainder, scan stops. Fail closed.

**I specifically hunted for a NEW bypass introduced by treating the backtick as a
third quote delimiter** (the scanner deliberately stops LATER than a real parser).
The one case that re-emits the opener unchanged —
`<img alt=` + "`a>https://169.254.169.254/x`" + ` foo="bar">` (even backtick
count, so not flagged unreliable) — is **NOT a fetchable leak**: a real browser
tokenizer treats `alt` as an *unquoted* value ending at the first `>` (backtick
is an ordinary char, not a quote), so the resulting `<img>` has only `alt` and
**no src** — the metadata URL is inert text content, never a GET. I verified this
with a parser-faithful extractor (quotes = `"`/`'` only, backtick excluded) that
found zero fetchable blocked attributes in the output. The divergence is strictly
in the safe (over-block) direction. The reverse case where a real browser WOULD
fetch — backtick-prefixed unquoted `alt` then a genuine blocked `src` before the
first unquoted `>` — is correctly neutralized to a placeholder (lone backtick →
unbalanced → fail closed). Multi-img scanning resumes correctly after both
placeholder and pass-through branches.

### WR-02 (srcset comma) — CONFIRMED FIXED, per-candidate gate preserved

`parseSrcsetCandidates` now keeps in-query commas attached to scheme-bearing
absolute URLs (the `isAbsolute` carve-out, sanitize.js:125), mirroring the
existing `data:` carve-out. I confirmed the fidelity widening did NOT weaken the
per-candidate origin gate at any of the three write sites:
- A blocked metadata candidate after a comma-bearing public CDN URL is still
  split out and detected as blocked
  (`...crop=1,2,3,4 1x, https://169.254.169.254/x 2x` → blocked candidate
  detected).
- A blocked candidate placed FIRST with an in-query comma is still blocked.
- **Snapshot string layer:** src-less `<img srcset>` with a public+blocked comma
  srcset → dimensioned placeholder; allowed-src + blocked-candidate srcset → src
  kept, srcset stripped; fully-public comma srcset → passed through unchanged (no
  over-block regression).
- **Diff ATTR live-element path:** verified through the exported `applyMutations`
  seam (tests/renderer-asset-gate.test.js:241) — a blocked-origin srcset mutation
  yields `img.getAttribute('srcset') === null` (dropped, never written to the live
  DOM), while a fully-public comma srcset is written unchanged.
- **Dangerous-scheme candidates** (`javascript:`) in comma srcset are still
  dropped per-candidate by `neutralizeSrcset` / `sanitizeAttrValue`.

### Part 3 (no regression) — CONFIRMED

- **Sandbox token unchanged:** `iframe.setAttribute('sandbox', 'allow-same-origin')`
  (index.js:443), read back and asserted to be EXACTLY one token `allow-same-origin`
  (lines 444–446), else `throw new Error('viewer-sandbox-invalid')`. Cross-origin
  frame placeholders also use `allow-same-origin` only (line 1184).
- **No `allow-scripts`** anywhere in `src/renderer/` (only in explanatory
  comments/docs).
- **No `script-src` / `media-src`:** CSP is
  `default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:`.
  Scripts remain governed by `default-src 'none'`; no media-src is introduced
  (Phase 13 scope).
- **clone-only currentSrc:** the ASST-03 pin reads the captured clone attribute
  `data-ps-currentsrc`, pins `src` to it, and strips `srcset`/`sizes`/`data-ps-currentsrc`
  (snapshot.js:230–242, index.js:370–377). No live `.currentSrc` DOM read in the
  renderer.

**Test suite:** `tests/renderer-asset-policy.test.js` + `tests/renderer-asset-gate.test.js`
= 72 pass / 0 fail; renderer + render-security suites (snapshot, diff, viewer,
iframe, purity, security-sanitize-render, loopback) = 93 pass / 0 fail.

## Info

### IN-01: Trailing comma retained on a blocked srcset candidate token

**File:** `src/renderer/sanitize.js:126-131`
**Issue:** When a candidate URL is gated by the absolute-URL comma carve-out and
the character immediately following an in-query comma is whitespace, the URL
token can retain a trailing comma (e.g. `https://10.0.0.1/a?x=1, https://...`
parses the first candidate URL as `https://10.0.0.1/a?x=1,` with the comma
attached). This is cosmetic only: the candidate is still classified by host and
the host (`10.0.0.1`) is unchanged by the trailing comma, so the gate decision
is identical — the candidate is still blocked, and a public candidate so affected
still resolves to the same public host. No security impact and no fetch-behavior
impact; flagged purely for tidiness.
**Fix:** Optionally trim a trailing `,` from the captured `url` token before
`out.push(...)`:
```js
var url = raw.slice(urlStart, i).replace(/,+$/, '');
```
Low priority — leave as-is if byte-for-byte fidelity of the descriptor split is
preferred, since the current behavior never changes a host or a gate verdict.

---

_Reviewed: 2026-06-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
