// Static renderer identity regression gates for Phase 7.
//
// The renderer must not return to the old per-op identity selector hot path.
// This test intentionally checks exact source substrings so it is cheap and
// resistant to test-only mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/renderer/diff.js',
  'src/renderer/index.js',
  'src/renderer/overlays.js',
];

const FORBIDDEN = [
  "querySelector('[' + NID_ATTR",
  '[data-fsb-nid',
];

test('renderer nid resolution does not use the retired identity selector hot path', () => {
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    for (const needle of FORBIDDEN) {
      assert.equal(
        source.includes(needle),
        false,
        file + ' must not contain ' + needle
      );
    }
  }
});
