// PhantomStream renderer: pure snapshot HTML builder.
//
// Verbatim port of the FSB reference viewer's srcdoc assembly
// (reference/dashboard/dashboard.js:2671-2694 escapePreviewAttribute +
// buildShellAttributeString, :2785-2800 full-page assembly inside
// handleDOMSnapshot), extracted as a pure transform: SnapshotPayload in,
// srcdoc string out. No DOM access, no module-level side effects -- the
// caller (createViewer, plan 02-03) owns the iframe write.
//
// Known gap preserved on purpose (parity pin, 02-RESEARCH.md Pitfall 9):
// inlineStyles entries and payload.html are inserted RAW -- a '</style>'
// inside captured CSS can break out of its style tag, and the body html is
// attacker-influenced. Script execution is blocked downstream by the
// allow-same-origin-only sandbox (plan 02-03 criterion 3); the render-side
// sanitization chokepoint lands in Phase 3 (SEC-01/SEC-02). Stylesheet link
// hrefs escape ONLY double quotes, exactly like the reference.

/** @typedef {import('../protocol/messages.js').SnapshotPayload} SnapshotPayload */

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
 * values are dropped; trimmed styleText is appended last as style="...".
 * Values are escaped via escapeAttribute.
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
  var style = String(styleText || '').trim();
  if (style) parts.push('style="' + escapeAttribute(style) + '"');
  return parts.length ? ' ' + parts.join(' ') : '';
}

/**
 * Build the full mirror srcdoc string for a snapshot payload. Assembly per
 * dashboard.js:2785-2800, in order: doctype + html shell attrs (from
 * payload.htmlAttrs/payload.htmlStyle) + head with charset meta, viewport
 * meta width=(payload.viewportWidth || 1920), stylesheet links (each with
 * ONLY double quotes escaped to &quot;), inline style tags RAW, the exact
 * parity reset-CSS style tag (02-UI-SPEC "Mirror page reset CSS") + body
 * shell attrs (payload.bodyAttrs/payload.bodyStyle) + payload.html RAW +
 * closing tags. Pure transform: no DOM access anywhere.
 * @param {SnapshotPayload} payload
 * @returns {string}
 */
export function buildSnapshotHtml(payload) {
  var p = payload || {};

  var stylesheetLinks = (p.stylesheets || []).map(function (url) {
    return '<link rel="stylesheet" href="' + url.replace(/"/g, '&quot;') + '">';
  }).join('\n');

  var inlineStyleTags = (p.inlineStyles || []).map(function (css) {
    return '<style>' + css + '</style>';
  }).join('\n');

  var htmlAttrs = buildShellAttributeString(p.htmlAttrs, p.htmlStyle);
  var bodyAttrs = buildShellAttributeString(p.bodyAttrs, p.bodyStyle);

  return '<!DOCTYPE html><html' + htmlAttrs + '><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=' + (p.viewportWidth || 1920) + '">' +
    stylesheetLinks +
    inlineStyleTags +
    '<style>body { margin: 0; overflow: hidden; } *::selection { background: transparent; } ::-webkit-scrollbar { display: none; }</style>' +
    '</head><body' + bodyAttrs + '>' + (p.html || '') + '</body></html>';
}
