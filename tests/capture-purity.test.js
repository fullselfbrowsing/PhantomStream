// Purity gate for the extracted capture core (CAPT-01 enforcement, D-13).
// Static-scan equivalent of `grep -E 'chrome\.|FSB' src/capture/*.js`, kept
// portable as a node:test so CI inherits it with zero extra tooling.
//
// Comments are stripped BEFORE the scan so provenance notes (e.g. "extracted
// from FSB dom-stream.js", "replaces chrome.runtime.sendMessage") stay legal.
// String literals are NOT stripped: the scan regexes target chrome.* API
// calls and the uppercase FSB namespace, so lowercase wire-adjacent literals
// like 'fsb-dialog' pass while real coupling fails loud.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPTURE_DIR = fileURLToPath(new URL('../src/capture/', import.meta.url));

function listCaptureModules() {
  // src/capture/ exists (it holds README.md), so readdirSync cannot ENOENT;
  // an empty .js listing means the core has not been extracted yet.
  return readdirSync(CAPTURE_DIR).filter((f) => f.endsWith('.js'));
}

function stripComments(source) {
  // Remove /* ... */ block comments first, then // line comments, so the
  // FSB/chrome scan below only ever sees executable source and string
  // literals.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('capture core exists', () => {
  const modules = listCaptureModules();
  assert.ok(
    modules.length >= 1,
    'src/capture contains no .js modules — the capture core has not been ' +
      'extracted yet, so the purity scan below would pass vacuously'
  );
});

test('capture core contains zero chrome.* and window.FSB references', () => {
  for (const f of listCaptureModules()) {
    const source = readFileSync(path.join(CAPTURE_DIR, f), 'utf8');
    const stripped = stripComments(source);
    assert.ok(
      !/\bchrome\s*\./.test(stripped),
      `src/capture/${f} references chrome.* outside comments`
    );
    assert.ok(
      !/window\.FSB|\bFSB\b/.test(stripped),
      `src/capture/${f} references the FSB namespace outside comments`
    );
  }
});
