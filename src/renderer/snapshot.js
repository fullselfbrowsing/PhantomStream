// PhantomStream renderer: pure snapshot HTML builder.
//
// Verbatim port of the FSB reference viewer's srcdoc assembly
// (reference/dashboard/dashboard.js:2671-2694 escapePreviewAttribute +
// buildShellAttributeString, :2785-2800 full-page assembly inside
// handleDOMSnapshot), extracted as a pure transform: SnapshotPayload in,
// srcdoc string out. No DOM access, no module-level side effects -- the
// caller (createViewer, plan 02-03) owns the iframe write.
//
// Phase 3 (plan 03-02, SEC-02): the adopted CSP meta is injected as the
// first element after <head>, and inlineStyles entries are CSS-scrubbed at
// assembly via scrubCssText (a pure string pass -- this module stays
// DOM-free per the contract above; the DOM-fragment chokepoint lives in
// sanitize.js and may never land here). payload.html stays raw AT THE
// STRING LAYER by design: string-level scrubbing is the mXSS anti-pattern
// (scrub-then-reparse), so that insertion point is protected by the
// layered chain instead -- capture chokepoint upstream, the viewer's
// post-parse sanitizeFragment scrub on load (src/renderer/index.js), the
// CSP meta below, and the allow-same-origin-only sandbox.
//
// Wire-value insertion-point inventory (keep ACCURATE -- this list is what
// the sanitization chokepoint audits; review WR-03):
//   1. inlineStyles entries           -- CSS-scrubbed via scrubCssText
//                                        (03-02; was RAW)
//   2. payload.html                   -- intentionally RAW at the string
//                                        layer; defense chain: capture
//                                        chokepoint + post-parse scrub +
//                                        CSP meta + sandbox (03-02)
//   3. stylesheet hrefs               -- dangerous schemes filtered, then
//                                        double quotes escaped
//   4. html/body shell attrs + styles -- attrs escapeAttribute; styleText
//                                        scrubCssText + escapeAttribute
//   5. viewportWidth                  -- numerically coerced
//                                        (parseInt(_, 10) || 1920), never
//                                        interpolated raw: the typed
//                                        contract says number, but wire
//                                        values are not trusted

import { scrubCssText, parseSrcsetCandidates } from './sanitize.js';

/** @typedef {import('../protocol/messages.js').SnapshotPayload} SnapshotPayload */

// ---- Phase 12 (MSEC-01/MSEC-02/ASST-03): string-layer snapshot asset gate ----
//
// THE critical timing rule (12-RESEARCH Pitfall 1): a real browser's HTML
// parser begins fetching <img src> DURING srcdoc parse, before the iframe's
// post-parse `load` scrub can run. So for the SNAPSHOT, the authoritative
// fetch gate must run at the STRING/payload layer -- before buildSnapshotHtml
// assembles the srcdoc -- so a blocked origin never reaches the parser and
// the viewer's browser never issues the GET. The post-parse DOM scrub
// (src/renderer/index.js) and the diff-path gates remain as defense-in-depth.
//
// This is NOT the mXSS scrub-then-reparse anti-pattern guarded by the module
// header (lines 14-19): we rewrite TYPED attribute values inside the markup
// we are ABOUT TO EMIT (the wire payload's <img> src/srcset/poster), never a
// sanitized DOM serialized back to a string and re-parsed. payload.html stays
// raw for everything else; only fetchable asset attributes are rewritten, and
// only into a non-fetchable dimensioned placeholder or a pinned same-origin
// value. No DOM is constructed here (this module stays DOM-free by contract).

// ---- Quote-aware <img> start-tag locator (review CR-02) ----
//
// A regex over HTML (`/<img\b([^>]*)>/`) is the wrong tool for a security
// boundary: `[^>]*` terminates the tag at the FIRST literal `>`, but `>` is
// legal inside a quoted attribute value (`<img alt="a>b" src="https://...">`)
// and does NOT end the start tag for a real parser. That split let a blocked
// `src` AFTER the in-attribute `>` slip through the gate unchanged and fetch
// during srcdoc parse. The scanner below finds the REAL end of each `<img`
// start tag by consuming `"..."` / `'...'` spans atomically, so a `>` inside
// quotes never terminates the tag. If a tag end cannot be found (an unbalanced
// quote runs to EOF), the opener is treated as unparseable and FAILS CLOSED
// (its asset attributes are neutralized) rather than passing through. The one
// remaining scanner/parser divergence -- a backtick-unquoted value carrying a
// `>` (backtick is not an HTML quote char, so the scanner stops INSIDE it) --
// is ALSO failed closed: attrsBlobIsUnreliable detects the unbalanced backtick
// and gateOneImgTag emits the placeholder instead of re-emitting the opener
// (review WR-01), so no `<img>` shape re-emits unmodified.

/**
 * Find the index of the `>` that closes a start tag, honoring quoted attribute
 * values (a `>` inside `"..."`, `'...'`, or a backtick span does not end the
 * tag). The scanner is tag-name agnostic -- it consumes from the index just
 * past the matched opener token, so it serves `<img`, `<video`, and `<source`
 * identically (Phase 13 generalized findImgTagEnd -> findTagEnd; no behavior
 * change for the <img> path).
 *
 * Backtick handling (review WR-01): the backtick is NOT an HTML quote char, so
 * a real parser ends the tag at the FIRST `>` even when it sits inside a
 * backtick-unquoted value (`alt=` + "`a>b`"). Treating the backtick as a third
 * delimiter here makes the scanner deliberately stop LATER than the parser --
 * it reads the trailing `src` as an attribute and gates it. That is the SAFE
 * divergence direction (over-block: a URL the real parser would render inert is
 * still blocked) and it never lets a later fetchable `src` slip past the gate.
 * A genuine `>`-terminated tag a real browser would fetch from is found by the
 * `"`/`'` rules unchanged.
 * @param {string} html  The full markup.
 * @param {number} from  Index just past the opener token (the matched opener).
 * @returns {number} Index of the closing `>`, or -1 if none (unbalanced quote).
 */
function findTagEnd(html, from) {
  var quote = null; // null = outside a quoted value; else the open-quote char
  for (var i = from; i < html.length; i++) {
    var ch = html.charAt(i);
    if (quote !== null) {
      if (ch === quote) quote = null; // matching close quote (incl. backtick)
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch; // entering a quoted (or backtick-unquoted) attribute value
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

/**
 * True when a bounded <img> attribute blob cannot be confidently parsed, so the
 * scanner's tag boundary may disagree with a real HTML parser's and the tag
 * must FAIL CLOSED instead of being re-emitted (review WR-01).
 *
 * findImgTagEnd treats only `"` and `'` as quote delimiters (correct per the
 * HTML tokenizer). A backtick is NOT a quote char, so an unquoted attribute
 * value containing a backtick AND a `>` (`alt=` + "`a>b`") makes the scanner
 * stop at the `>` INSIDE the backticks -- the bounded blob ends mid-value and a
 * later `src` is excluded from the gate. A real browser instead reads the
 * unquoted value up to the FIRST `>` (so that later `src` is inert text, never
 * a fetch), which is why this is a fail-closed-intent drift, not a live SSRF.
 * The reliable, parser-free signal is an ODD number of backticks in the bounded
 * blob: a backtick opened a value but its partner sits beyond the `>` the
 * scanner stopped at. When detected we emit the dimensioned placeholder rather
 * than re-emit the opener, accepting a vanishingly rare fidelity loss for
 * legitimate backtick attribute content (backticks are not HTML quote chars).
 * @param {string} attrs  The bounded img attribute blob.
 * @returns {boolean}
 */
function attrsBlobIsUnreliable(attrs) {
  if (typeof attrs !== 'string' || attrs.indexOf('`') === -1) return false;
  var backticks = 0;
  for (var i = 0; i < attrs.length; i++) {
    if (attrs.charAt(i) === '`') backticks++;
  }
  return (backticks % 2) === 1; // unbalanced backtick -> scanner boundary suspect
}

/** Match the START of an <img start tag only (`<img` + a name boundary). */
var IMG_OPEN_RE = /<img\b/gi;
/** Match the START of a <video start tag (`<video` + a name boundary). */
var VIDEO_OPEN_RE = /<video\b/gi;
/** Match the START of a <source start tag (`<source` + a name boundary). */
var SOURCE_OPEN_RE = /<source\b/gi;
/** Pull a double/single/unquoted attribute value out of an attrs blob. */
function readTagAttr(attrs, name) {
  var re = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i');
  var m = re.exec(attrs);
  if (!m) return null;
  return m[1] != null ? m[1] : (m[2] != null ? m[2] : (m[3] != null ? m[3] : ''));
}
/** Remove an attribute (all quote forms) from an attrs blob. */
function stripTagAttr(attrs, name) {
  return attrs.replace(
    new RegExp('\\s' + name + '\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s"\'>]+)', 'gi'),
    ''
  );
}
/** Set/replace a double-quoted attribute on an attrs blob (value HTML-escaped). */
function setTagAttr(attrs, name, value) {
  var cleaned = stripTagAttr(attrs, name);
  return cleaned + ' ' + name + '="' + escapeAttribute(value) + '"';
}

/**
 * Build the dimensioned blocked-origin placeholder STRING (renderer-owned;
 * never imported from capture per the project's duplicate-don't-couple style).
 * Mirrors the capture placeholder visual: a dimension-only <div> carrying
 * rr_width/rr_height (read from the element's own rr_width/rr_height or
 * width/height attrs) and the machine-readable
 * data-ps-asset-unavailable="blocked-origin" reason. Replacing an <img> 1:1
 * with this <div> keeps the renderer's positional nid pairing consistent (the
 * index pairs elements with the nodeIds sidecar by position, not by any live
 * identity attribute -- Phase 7), so no identity attribute is carried here.
 * @param {string} attrs The original img attribute blob.
 * @returns {string}
 */
function assetUnavailablePlaceholderTag(attrs) {
  var w = readTagAttr(attrs, 'rr_width') || readTagAttr(attrs, 'width') || '';
  var h = readTagAttr(attrs, 'rr_height') || readTagAttr(attrs, 'height') || '';
  var out = '<div data-ps-asset-unavailable="blocked-origin"';
  if (w) out += ' rr_width="' + escapeAttribute(w) + '"';
  if (h) out += ' rr_height="' + escapeAttribute(h) + '"';
  out += '></div>';
  return out;
}

/**
 * True when a srcset value contains a candidate the gate blocks. Reuses the
 * shared per-candidate parser so the snapshot string layer gates srcset with
 * the same vocabulary as the diff/fragment gates (review WR-03/WR-04). Any
 * unparseable input fails closed (treated as blocked).
 * @param {string} srcset
 * @param {(url: string, kind: string) => { allow: boolean }} gate
 * @returns {boolean}
 */
function srcsetHasBlockedCandidate(srcset, gate) {
  if (!srcset) return false;
  try {
    var candidates = parseSrcsetCandidates(srcset);
    for (var i = 0; i < candidates.length; i++) {
      var url = candidates[i].url;
      if (!url) continue;
      var verdict = gate(url, 'image');
      if (!verdict || !verdict.allow) return true;
    }
    return false;
  } catch (e) {
    return true; // unparseable srcset: fail closed
  }
}

/**
 * Gate the bounded attribute blob of a single <img> start tag and return the
 * replacement markup for the whole tag. Applies the ASST-03 currentSrc pin,
 * then gates the effective src AND srcset; any blocked fetchable URL -> the
 * dimensioned blocked-origin placeholder (no fetchable attribute emitted).
 * @param {string} attrs  The img attribute blob (already correctly bounded).
 * @param {(url: string, kind: string) => { allow: boolean }} gate
 * @returns {string}
 */
function gateOneImgTag(attrs, gate) {
  // Fail closed when the bounded blob is unreliable (review WR-01): a backtick-
  // unquoted value containing `>` truncates the scanner's boundary so a later
  // src/srcset is excluded from the gate. Rather than re-emit the (possibly
  // fetchable) opener unchanged, neutralize the whole tag to a placeholder.
  if (attrsBlobIsUnreliable(attrs)) {
    return assetUnavailablePlaceholderTag(attrs);
  }
  var pinned = readTagAttr(attrs, 'data-ps-currentsrc');
  var src = readTagAttr(attrs, 'src');
  var srcset = readTagAttr(attrs, 'srcset');
  var nextAttrs = attrs;
  var effective = src;
  if (pinned) {
    // ASST-03: pin the displayed variant and neutralize re-negotiation.
    effective = pinned;
    nextAttrs = setTagAttr(nextAttrs, 'src', pinned);
    nextAttrs = stripTagAttr(nextAttrs, 'srcset');
    nextAttrs = stripTagAttr(nextAttrs, 'sizes');
    nextAttrs = stripTagAttr(nextAttrs, 'data-ps-currentsrc');
    srcset = null; // neutralized above; nothing left to gate
  }
  if (effective) {
    var verdict = gate(effective, 'image');
    if (!verdict || !verdict.allow) {
      // Blocked origin -> dimensioned placeholder; no fetchable src emitted.
      return assetUnavailablePlaceholderTag(attrs);
    }
  }
  // srcset gate (WR-03/WR-04): a blocked candidate on a src-less or src-allowed
  // <img> would still let the parser fetch a responsive variant. If any
  // candidate is blocked AND no allowed src remains, fall back to the
  // placeholder; otherwise strip srcset so only the (allowed) src can fetch.
  if (srcset && srcsetHasBlockedCandidate(srcset, gate)) {
    if (!effective) return assetUnavailablePlaceholderTag(attrs);
    nextAttrs = stripTagAttr(nextAttrs, 'srcset');
  }
  return '<img' + nextAttrs + '>';
}

/**
 * Gate the bounded attribute blob of a single <video> or <source> start tag and
 * return the replacement markup. Phase 13 (MEDIA-01 / V12 SSRF): a real
 * browser's parser prefetches <video src>, <video poster>, and <source src>
 * DURING srcdoc parse -- exactly like <img src> -- so any blocked fetchable URL
 * here must be neutralized at the string layer before the parser sees it. If
 * EITHER the `src` OR (for <video>) the `poster` is blocked, the whole tag is
 * replaced by the dimensioned blocked-origin placeholder (no fetchable
 * attribute emitted) -- the same fail-closed posture as the <img> path. The
 * void <source> has no closing tag and no meaningful dimensions, but the
 * placeholder <div> is inert and harmless inside a <video> (it is a non-source
 * child, so the element simply has no selectable source -- zero media GET).
 * @param {string} tagName  'video' or 'source' (re-emit token when allowed).
 * @param {string} attrs    The attribute blob (already correctly bounded).
 * @param {(url: string, kind: string) => { allow: boolean }} gate
 * @returns {string}
 */
function gateOneMediaTag(tagName, attrs, gate) {
  // Fail closed when the bounded blob is unreliable (review WR-01 parity): a
  // backtick-unquoted value carrying `>` truncates the scanner boundary so a
  // later src/poster is excluded from the gate. Neutralize the whole tag.
  if (attrsBlobIsUnreliable(attrs)) {
    return assetUnavailablePlaceholderTag(attrs);
  }
  var src = readTagAttr(attrs, 'src');
  if (src) {
    var srcVerdict = gate(src, tagName === 'source' ? 'media' : 'media');
    if (!srcVerdict || !srcVerdict.allow) {
      return assetUnavailablePlaceholderTag(attrs);
    }
  }
  // <video poster> is a fetchable image; <source> has no poster.
  if (tagName === 'video') {
    var poster = readTagAttr(attrs, 'poster');
    if (poster) {
      var posterVerdict = gate(poster, 'poster');
      if (!posterVerdict || !posterVerdict.allow) {
        return assetUnavailablePlaceholderTag(attrs);
      }
    }
  }
  return '<' + tagName + nextSelfClose(attrs);
}

/**
 * Re-emit the bounded attribute blob and closing `>` for an allowed media tag.
 * The blob is re-emitted verbatim (a trailing self-closing `/` is preserved by
 * appending it before `>`), so an allowed <video>/<source> is byte-identical to
 * its input. Kept tiny and separate so the gate's re-emit path is explicit.
 * @param {string} attrs
 * @returns {string}
 */
function nextSelfClose(attrs) {
  return attrs + '>';
}

/**
 * Rewrite fetchable <img> assets in a raw snapshot HTML string against an
 * injected pre-write fetch gate (MSEC-01) and apply the ASST-03 currentSrc
 * pin. For each <img>:
 *   1. currentSrc pin: if data-ps-currentsrc is present, the effective src
 *      becomes that value and srcset/sizes are neutralized (removed) so the
 *      cross-origin viewer's DPR cannot re-negotiate a different variant.
 *   2. fetch gate: gate(effectiveSrc, 'image') and gate every srcset
 *      candidate; if blocked, the entire <img> is replaced by the dimensioned
 *      blocked-origin placeholder (or srcset is stripped when an allowed src
 *      remains) so the parser never sees a fetchable blocked URL.
 * An <img> with no src/currentsrc/srcset is left untouched.
 *
 * QUOTE-AWARE TAG SCAN (review CR-02): every start tag is located with a
 * quote-aware scanner (findTagEnd), NOT a `[^>]*` regex -- a `>` inside a
 * quoted attribute value (`alt="a>b"`) does not terminate the tag, so a
 * blocked `src` after such a `>` can no longer slip through unmodified. An
 * opener whose tag end cannot be located (an unbalanced quote running to EOF)
 * is FAILED CLOSED: it is replaced by the dimensioned placeholder rather than
 * passed through, so a malformed shape can never emit a fetchable blocked URL.
 * The gate is fail-closed by construction (createViewer's gateAssetUrl); a
 * missing gate leaves the markup unchanged (no-op) so this stays a pure string
 * transform.
 *
 * PHASE 13 MEDIA GENERALIZATION (MEDIA-01 / V12): the scan now covers <img>
 * (src/srcset + currentSrc pin), <video> (src + poster), and <source> (src) in
 * ONE left-to-right pass -- at each cursor it advances to the nearest of the
 * three openers and gates that tag, so a blocked media URL is neutralized at
 * the string layer BEFORE the srcdoc parser can prefetch it (13-RESEARCH
 * Pitfall 5). Nesting (<source> inside <video>) is handled naturally: the
 * openers are independent matches, so each is gated on its own.
 * @param {string} html  Raw payload.html (string layer, pre-srcdoc).
 * @param {(url: string, kind: string) => { allow: boolean }} gate
 * @returns {string}
 */
export function gateSnapshotAssets(html, gate) {
  if (typeof html !== 'string' || !html) return html;
  if (typeof gate !== 'function') return html;
  var out = '';
  var cursor = 0; // index of the next un-copied char in html
  while (cursor < html.length) {
    // Find the nearest of the three openers at or after the cursor.
    var next = nextAssetOpener(html, cursor);
    if (!next) {
      break; // no more asset openers
    }
    var tagStart = next.index;          // index of '<' in the opener
    var attrsStart = next.attrsStart;   // index just past the opener token
    // Copy everything before this opener verbatim.
    out += html.slice(cursor, tagStart);
    var tagEnd = findTagEnd(html, attrsStart); // quote-aware
    if (tagEnd === -1) {
      // Unbalanced quote: the tag never closes. Fail closed -- emit a
      // placeholder for the remainder so no fetchable blocked URL survives,
      // and stop (the rest of the string is inside an unterminated tag).
      out += assetUnavailablePlaceholderTag(html.slice(attrsStart));
      cursor = html.length;
      break;
    }
    var attrs = html.slice(attrsStart, tagEnd); // bounded attribute blob
    // A self-closing '/' just before '>' is part of the blob; the helpers
    // tolerate a trailing '/' (it is not a quote/value char), and re-emitting
    // the opener token + attrs + '>' preserves it.
    if (next.tag === 'img') {
      out += gateOneImgTag(attrs, gate);
    } else {
      out += gateOneMediaTag(next.tag, attrs, gate);
    }
    cursor = tagEnd + 1; // resume just past this tag's '>'
  }
  out += html.slice(cursor);
  return out;
}

/**
 * Find the nearest <img>/<video>/<source> start-tag opener at or after `from`.
 * Returns { index, attrsStart, tag } for the earliest match, or null when none
 * remains. Each regex is reset and seeked from `from` so the scan is
 * cursor-driven (the unified gateSnapshotAssets loop owns the cursor; we do not
 * rely on a single regex's stateful lastIndex across heterogeneous tags).
 * @param {string} html
 * @param {number} from
 * @returns {?{index: number, attrsStart: number, tag: string}}
 */
function nextAssetOpener(html, from) {
  var best = null;
  var specs = [
    { re: IMG_OPEN_RE, tag: 'img' },
    { re: VIDEO_OPEN_RE, tag: 'video' },
    { re: SOURCE_OPEN_RE, tag: 'source' }
  ];
  for (var i = 0; i < specs.length; i++) {
    var re = specs[i].re;
    re.lastIndex = from;
    var m = re.exec(html);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, attrsStart: re.lastIndex, tag: specs[i].tag };
    }
  }
  return best;
}

// The ADOPTED srcdoc CSP (backstop behind both sanitization chokepoints,
// delivered via meta because the mirror is never a fetched URL). Baseline
// from 03-CONTEXT with ONE documented adjustment under the decision's own
// clause ("adjust only with documented rationale if mirror fidelity
// requires, never weaker than script-blocking"): style-src gains
// http: https: because the capture deliberately emits external stylesheet
// links (stylesheets[] collection, src/capture/index.js) and
// 'unsafe-inline' alone would block every link-rel-stylesheet load in the
// mirror, breaking real-world fidelity from Phase 4 on. Script-blocking is
// untouched: default-src 'none' still governs scripts (no script-src is
// introduced). Meta-unsupported directives are deliberately absent
// (03-RESEARCH Pitfall 8); the iframe-level sandbox attribute asserted in
// createViewer is the analogous control. Documented in docs/SECURITY.md
// (plan 03-05).
// Phase 13 (MEDIA-01/V14): media-src is the twin of img-src, added so the
// viewer's browser may fetch <video>/<audio>/<source> bytes from the source
// origin (the by-reference media model). NO `blob:` this phase -- that is
// Phase 14's MSE concern; `data:` is for small poster data URIs only (media
// bytes are never inlined). default-src 'none' and the absence of script-src
// are untouched (the string-layer gateSnapshotAssets is the primary control;
// CSP is the backstop -- 13-RESEARCH V14).
var CSP_META = '<meta http-equiv="Content-Security-Policy" content="'
  + "default-src 'none'; "
  + 'img-src http: https: data:; '
  + 'media-src http: https: data:; '
  + "style-src http: https: 'unsafe-inline'; "
  + 'font-src http: https: data:'
  + '">';

function hasDangerousStylesheetUrl(value) {
  if (!value || typeof value !== 'string') return false;
  var compact = value.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  return compact.indexOf('javascript:') === 0
    || compact.indexOf('vbscript:') === 0
    || compact.indexOf('data:text/html') === 0;
}

function escapeStyleSourceId(value) {
  return escapeAttribute(value);
}

function styleSourceTagsForDocument(styleSources) {
  var sources = Array.isArray(styleSources) ? styleSources.slice() : [];
  sources.sort(function (a, b) {
    return (a && typeof a.order === 'number' ? a.order : 0)
      - (b && typeof b.order === 'number' ? b.order : 0);
  });
  return sources.filter(function (source) {
    return source && source.scope && source.scope.kind === 'document';
  }).map(function (source) {
    var sourceId = escapeStyleSourceId(source.sourceId || '');
    if (source.href && !hasDangerousStylesheetUrl(source.href)) {
      return '<link rel="stylesheet" data-ps-style-source-id="' + sourceId +
        '" href="' + String(source.href).replace(/"/g, '&quot;') + '">';
    }
    return '<style data-ps-style-source-id="' + sourceId + '">' +
      scrubCssText(source.cssText || '') +
      '</style>';
  }).join('\n');
}

/**
 * Escape a value for inclusion inside a double-quoted HTML attribute.
 * Renamed port of escapePreviewAttribute (dashboard.js:2671-2677): null and
 * undefined map to '', then &, ", <, > are escaped in that exact order
 * (&-first so the other replacements are never themselves re-escaped).
 * @param {*} value
 * @returns {string}
 */
export function escapeAttribute(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the attribute string for an html/body shell tag. Verbatim port of
 * dashboard.js:2679-2694: names are lowercased and must match
 * /^[a-z][a-z0-9_:.~-]*$/; 'style' and any on*-prefixed name are dropped
 * (shell event-handler attributes never reach the mirror); null/undefined
 * values are dropped; trimmed styleText is scrubbed and appended last as
 * style="...". Values are escaped via escapeAttribute.
 * @param {Object|null|undefined} attrs     Captured shell attributes (name -> value)
 * @param {string|null|undefined} styleText Shell computed style text
 * @returns {string} ' name="value" ...' (leading-space-prefixed) or ''
 */
export function buildShellAttributeString(attrs, styleText) {
  var parts = [];
  if (attrs && typeof attrs === 'object') {
    Object.keys(attrs).forEach(function (rawName) {
      var name = String(rawName || '').toLowerCase();
      if (!/^[a-z][a-z0-9_:.~-]*$/.test(name)) return;
      if (name === 'style' || name.indexOf('on') === 0) return;
      var value = attrs[rawName];
      if (value === undefined || value === null) return;
      parts.push(name + '="' + escapeAttribute(value) + '"');
    });
  }
  var style = scrubCssText(String(styleText || '')).trim();
  if (style) parts.push('style="' + escapeAttribute(style) + '"');
  return parts.length ? ' ' + parts.join(' ') : '';
}

/**
 * Build the full mirror srcdoc string for a snapshot payload. Assembly per
 * dashboard.js:2785-2800 extended by 03-02, in order: doctype + html shell
 * attrs (from payload.htmlAttrs/payload.htmlStyle) + head with the adopted
 * CSP meta FIRST, charset meta, viewport meta
 * width=(parseInt(payload.viewportWidth, 10) || 1920) -- numerically
 * coerced, never raw (review WR-03), stylesheet links (each with
 * ONLY double quotes escaped to &quot;), inline style tags CSS-scrubbed
 * via scrubCssText, the exact parity reset-CSS style tag (02-UI-SPEC
 * "Mirror page reset CSS") + body shell attrs
 * (payload.bodyAttrs/payload.bodyStyle) + payload.html raw at the string
 * layer (see the insertion-point inventory above) + closing tags.
 * Pure transform: no DOM access anywhere.
 * @param {SnapshotPayload} payload
 * @returns {string}
 */
export function buildSnapshotHtml(payload) {
  var p = payload || {};

  var stylesheetLinks = (p.stylesheets || [])
    .filter(function (url) { return !hasDangerousStylesheetUrl(url); })
    .map(function (url) {
      return '<link rel="stylesheet" href="' + url.replace(/"/g, '&quot;') + '">';
    }).join('\n');

  var inlineStyleTags = (p.inlineStyles || []).map(function (css) {
    // CSS scrub at assembly (03-02): pure string pass; the scrub also
    // rewrites any literal style-closing sequence so captured CSS cannot
    // break out of this tag.
    return '<style>' + scrubCssText(css) + '</style>';
  }).join('\n');
  var cssomStyleTags = styleSourceTagsForDocument(p.styleSources || []);

  var htmlAttrs = buildShellAttributeString(p.htmlAttrs, p.htmlStyle);
  var bodyAttrs = buildShellAttributeString(p.bodyAttrs, p.bodyStyle);

  // CSP meta FIRST after <head> so the policy applies before any
  // parser-initiated fetch (03-RESEARCH "CSP meta injection").
  return '<!DOCTYPE html><html' + htmlAttrs + '><head>' + CSP_META + '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=' + (parseInt(p.viewportWidth, 10) || 1920) + '">' +
    stylesheetLinks +
    inlineStyleTags +
    cssomStyleTags +
    '<style>body { margin: 0; overflow: hidden; } *::selection { background: transparent; } ::-webkit-scrollbar { display: none; }</style>' +
    '</head><body' + bodyAttrs + '>' + (p.html || '') + '</body></html>';
}

export function buildFramePlaceholderHtml(frame) {
  var f = frame || {};
  var label = escapeAttribute(f.label || 'Cross-origin iframe');
  var origin = escapeAttribute(f.origin || '');
  var src = escapeAttribute(f.src || '');
  var meta = '';
  if (origin) meta += '<p>Origin: ' + origin + '</p>';
  if (src) meta += '<p>Source: ' + src + '</p>';
  return '<!DOCTYPE html><html><head>' + CSP_META + '<meta charset="UTF-8">' +
    '<style>body{margin:0;font:13px system-ui,sans-serif;color:#30333a;background:#f6f7f9;}' +
    '.ps-frame-placeholder{box-sizing:border-box;min-height:100vh;display:flex;flex-direction:column;gap:6px;' +
    'justify-content:center;align-items:center;text-align:center;border:1px dashed #9aa3af;padding:16px;}' +
    '.ps-frame-placeholder strong{font-size:14px;} .ps-frame-placeholder p{margin:0;color:#5f6673;word-break:break-word;}</style>' +
    '</head><body><div class="ps-frame-placeholder" role="note"><strong>' + label + '</strong>' +
    meta + '</div></body></html>';
}
