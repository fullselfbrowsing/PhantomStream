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

import { scrubCssText } from './sanitize.js';

/** @typedef {import('../protocol/messages.js').SnapshotPayload} SnapshotPayload */

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
var CSP_META = '<meta http-equiv="Content-Security-Policy" content="'
  + "default-src 'none'; "
  + 'img-src http: https: data:; '
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
