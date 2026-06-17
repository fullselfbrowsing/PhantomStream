// Static parity gate for the hand-maintained Playwright/CDP/bookmarklet inject
// bundle (src/adapters/playwright-inject.js), which is a verbatim port of the
// capture core with NO build step to regenerate it. When the module's
// value-diff/select-selection logic changes, the bundle must track it or
// adapter-driven sessions silently diverge. These cheap substring gates fail
// loudly when the bundle drifts on the select selectedIndexes identity path
// (the exact failure surfaced by code review after the masked-select fix).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MODULE = readFileSync('src/capture/index.js', 'utf8');
const INJECT = readFileSync('src/adapters/playwright-inject.js', 'utf8');

// Required in BOTH the module and the bundle so select selection stays
// unambiguous (index identity) yet safe when options are filtered from the wire.
const REQUIRED = [
  'function selectedOptionIndexes',
  'function selectHasFilteredOptions',
  'diff.selectedIndexes = selectedOptionIndexes(control)',
];

test('inject bundle mirrors the module select-selection identity handling', () => {
  for (const needle of REQUIRED) {
    assert.ok(
      MODULE.includes(needle),
      `module src/capture/index.js must contain: ${needle}`
    );
    assert.ok(
      INJECT.includes(needle),
      `inject bundle src/adapters/playwright-inject.js must mirror: ${needle}`
    );
  }
});
