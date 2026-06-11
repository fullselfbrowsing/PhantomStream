// Purity gate for the extracted renderer core (plan 02-03, mirror of the
// Phase 1 capture purity gate in tests/capture-purity.test.js).
// Static-scan equivalent of grepping src/renderer/*.js for FSB/dashboard
// coupling, kept portable as a node:test so CI inherits it with zero extra
// tooling.
//
// Comments are stripped BEFORE the scan so provenance notes (e.g. "ported
// from FSB dashboard.js", "replaces recordDashboardTransportEvent") stay
// legal. String literals are NOT stripped: the forbidden patterns target
// chrome.* API calls, the uppercase FSB namespace, Font Awesome icon
// classes, the reference's dash-preview-* class family, raw WebSocket
// usage, and the FSB dashboard diagnostics ring buffers (02-RESEARCH
// Pitfall 10) -- real coupling fails loud while lowercase wire-adjacent
// literals pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDERER_DIR = fileURLToPath(new URL('../src/renderer/', import.meta.url));

function listRendererModules() {
  // src/renderer/ exists (it holds README.md), so readdirSync cannot ENOENT;
  // an empty .js listing means the renderer core has not been extracted yet.
  return readdirSync(RENDERER_DIR).filter((f) => f.endsWith('.js'));
}

function stripComments(source) {
  // Remove /* ... */ block comments first, then // line comments, so the
  // forbidden-pattern scan below only ever sees executable source and
  // string literals.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('renderer core exists with the planned module split', () => {
  const modules = listRendererModules();
  assert.ok(
    modules.length >= 1,
    'src/renderer contains no .js modules — the renderer core has not been ' +
      'extracted yet, so the purity scan below would pass vacuously'
  );
  // Pin the four-module split (plans 02-01/02-02/02-03) so a future
  // restructure cannot silently drop a scanned file out of the gate.
  for (const required of ['index.js', 'snapshot.js', 'diff.js', 'overlays.js']) {
    assert.ok(
      modules.includes(required),
      `src/renderer/${required} is missing — the renderer module split ` +
        '(index/snapshot/diff/overlays) is part of the purity contract'
    );
  }
});

test('renderer core contains zero FSB/chrome/dashboard references', () => {
  for (const f of listRendererModules()) {
    const source = readFileSync(path.join(RENDERER_DIR, f), 'utf8');
    const stripped = stripComments(source);
    assert.ok(
      !/\bchrome\s*\./.test(stripped),
      `src/renderer/${f} references chrome.* outside comments`
    );
    assert.ok(
      !/\bFSB\b/.test(stripped),
      `src/renderer/${f} references the FSB namespace outside comments`
    );
    assert.ok(
      !/fa-solid/.test(stripped),
      `src/renderer/${f} carries Font Awesome icon classes (icons must be ` +
        'inline SVG — UI-SPEC-locked divergence)'
    );
    assert.ok(
      !/dash-preview/.test(stripped),
      `src/renderer/${f} carries the reference's dash-preview-* class ` +
        'family (renderer classes are ps-overlay-*)'
    );
    assert.ok(
      !/\bWebSocket\b/.test(stripped),
      `src/renderer/${f} touches WebSocket directly (transport is an ` +
        'injected seam; the WS transport is Phase 4)'
    );
    assert.ok(
      !/recordDashboard/.test(stripped),
      `src/renderer/${f} carries FSB dashboard transport-event ring-buffer ` +
        'calls (diagnostics go to the injected logger)'
    );
  }
});
