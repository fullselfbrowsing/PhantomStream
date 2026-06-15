// Purity gate for Phase 3 security chokepoints (plan 03-05).
// This is a static-scan test by design: the behavioral corpora prove the
// sanitizer logic, while this file fails CI when a future edit bypasses the
// named chokepoints, weakens the sandbox contract, adds a raw HTML sink, or
// lets docs/SECURITY.md rot into an empty stub.
//
// Comments are stripped BEFORE source scans so provenance and rationale notes
// remain legal. String literals are NOT stripped because the sandbox token,
// CSP, innerHTML sink, and sanitizer import strings are exactly what this
// contract needs to pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CAPTURE_FILE = path.join(ROOT, 'src/capture/index.js');
const RENDERER_DIR = path.join(ROOT, 'src/renderer');
const SECURITY_MD = path.join(ROOT, 'docs/SECURITY.md');

const CAPTURE_RAW = readFileSync(CAPTURE_FILE, 'utf8');
const CAPTURE_CODE = stripComments(CAPTURE_RAW);

const SERIALIZATION_PATHS = [
  'serializeDOM clone walk',
  'processAddedNode add-op subtrees',
  'attr-op branch',
  'characterData text branch',
  'E2 text-childlist branch'
];

function stripComments(source) {
  // Remove /* ... */ block comments first, then // line comments, so the
  // scan below only sees executable source and string literals.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function rendererModules() {
  return readdirSync(RENDERER_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

function readRendererModule(file) {
  return readFileSync(path.join(RENDERER_DIR, file), 'utf8');
}

function strippedRendererModule(file) {
  return stripComments(readRendererModule(file));
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

test('capture sanitizeForWire chokepoint covers the five serialization paths', () => {
  const definitions = countMatches(CAPTURE_CODE, /function\s+sanitizeForWire\s*\(/g);
  const references = countMatches(CAPTURE_CODE, /sanitizeForWire\s*\(/g);
  const callSites = references - definitions;

  assert.equal(
    definitions,
    1,
    'capture must keep exactly one function sanitizeForWire definition'
  );
  assert.ok(
    callSites >= 10,
    'sanitizeForWire call-site floor is 10 for the five serialization paths: ' +
      SERIALIZATION_PATHS.join(', ')
  );

  for (const dispatch of ['element', 'subtree', 'attr', 'text', 'css']) {
    assert.ok(
      CAPTURE_CODE.includes(`sanitizeForWire('${dispatch}'`),
      `capture serialization dispatch ${dispatch} must route through sanitizeForWire`
    );
  }
});

test('capture serialization inventory comment is present in raw source', () => {
  // This check intentionally targets RAW source rather than stripComments().
  // The inventory is review-facing ground truth; if a sixth path is added,
  // the comment must be updated where reviewers can see it.
  assert.ok(
    CAPTURE_RAW.includes('Serialization-path inventory'),
    'src/capture/index.js must carry the serialization-path inventory marker'
  );
  for (const pathName of SERIALIZATION_PATHS) {
    assert.ok(
      CAPTURE_RAW.includes(pathName),
      `serialization inventory must name ${pathName}`
    );
  }
});

test('renderer module scan is non-vacuous and includes the security modules', () => {
  const modules = rendererModules();
  for (const required of ['index.js', 'snapshot.js', 'diff.js', 'overlays.js', 'sanitize.js']) {
    assert.ok(
      modules.includes(required),
      `src/renderer/${required} must be present for the security purity scan`
    );
  }
});

test('renderer modules never reference allow-scripts outside comments', () => {
  for (const file of rendererModules()) {
    const stripped = strippedRendererModule(file);
    assert.equal(
      countMatches(stripped, /allow-scripts/g),
      0,
      `src/renderer/${file} references allow-scripts outside comments; ` +
        'the iframe sandbox contract is allow-same-origin only'
    );
  }
});

test('renderer innerHTML assignment sinks are allowlisted and explained', () => {
  const expectedInnerHtmlAssignments = {
    'diff.js': 2,
    'index.js': 2,
    'overlays.js': 2
  };

  for (const file of rendererModules()) {
    const stripped = strippedRendererModule(file);
    const count = countMatches(
      stripped,
      /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.innerHTML\s*=/g
    );
    const expected = expectedInnerHtmlAssignments[file] || 0;
    assert.equal(
      count,
      expected,
      `src/renderer/${file} has ${count} innerHTML assignment sink(s); ` +
        'new wire-content sinks must route through sanitizeFragment. ' +
        'Only diff.js/index.js template parsing and overlays.js static ICON_SVG writes are sanctioned.'
    );
  }

  const diff = strippedRendererModule('diff.js');
  assert.ok(
    /tpl\.innerHTML\s*=\s*m\.html/.test(diff),
    'diff.js innerHTML sink must remain the template parse of m.html'
  );
  assert.ok(
    /tpl\.innerHTML\s*=\s*p\.html\s*\|\|\s*''/.test(diff),
    'diff.js shadow root sink must remain the template parse of p.html'
  );
  const index = strippedRendererModule('index.js');
  assert.equal(
    countMatches(index, /tpl\.innerHTML\s*=\s*p\.html\s*\|\|\s*''/g),
    2,
    'index.js sinks must remain the template parses of Phase 8 shadow/subtree p.html'
  );
});

test('render chokepoint wiring remains present at every insertion layer', () => {
  const diff = strippedRendererModule('diff.js');
  const index = strippedRendererModule('index.js');
  const snapshot = strippedRendererModule('snapshot.js');

  assert.ok(diff.includes('sanitizeFragment'), 'diff.js must scrub ADD fragments');
  assert.ok(diff.includes('sanitizeAttrValue'), 'diff.js must scrub ATTR values');
  assert.ok(
    /createElement\s*\(\s*'template'\s*\)/.test(diff),
    'diff.js must parse add-op HTML in template context'
  );
  assert.ok(diff.includes('importNode'), 'diff.js must import sanitized template nodes');
  assert.ok(index.includes('sanitizeFragment'), 'index.js must keep the post-parse scrub');
  assert.ok(snapshot.includes('scrubCssText'), 'snapshot.js must scrub inline CSS values');
  assert.ok(
    snapshot.includes('Content-Security-Policy'),
    'snapshot.js must emit the srcdoc Content-Security-Policy meta'
  );
});

test('docs/SECURITY.md exists and carries the embed security contract markers', () => {
  assert.ok(
    existsSync(SECURITY_MD),
    'docs/SECURITY.md is required so the embed security contract cannot pass vacuously'
  );

  const security = readFileSync(SECURITY_MD, 'utf8');
  const requiredMarkers = [
    'Sandbox token contract',
    'allow-same-origin',
    'allow-scripts',
    'default-src \'none\'',
    'style-src http: https: \'unsafe-inline\'',
    'maskTextSelector',
    'Host must-nevers',
    'frame-ancestors',
    'dialog/overlay side-channel'
  ];

  for (const marker of requiredMarkers) {
    assert.ok(
      security.includes(marker),
      `docs/SECURITY.md must contain marker: ${marker}`
    );
  }
});
