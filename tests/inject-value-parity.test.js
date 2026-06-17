// Static parity gate for the hand-maintained Playwright/CDP/bookmarklet inject
// bundle (src/adapters/playwright-inject.js), a verbatim port of the capture
// core with NO build step to regenerate it. When the module's capture-core
// behavior changes, the bundle must track it or adapter-driven sessions
// silently diverge. These cheap substring gates fail loudly on the capture-core
// invariants that have actually drifted before:
//   - select selection identity (selectedIndexes), and
//   - CSSOM snapshot-budget pruning (styleSources), which was missing from the
//     bundle and could blow the relay per-message cap on the adapter path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MODULE = readFileSync('src/capture/index.js', 'utf8');
const INJECT = readFileSync('src/adapters/playwright-inject.js', 'utf8');

// Must appear VERBATIM in BOTH the module and the bundle.
const REQUIRED = [
  // select selection identity (PR #2): index-addressed, filter-safe
  'function selectedOptionIndexes',
  'function selectHasFilteredOptions',
  'diff.selectedIndexes = selectedOptionIndexes(control)',
  // CSSOM snapshot-budget pruning of styleSources (commit c241282): an oversized
  // stylesheet must not push the snapshot past the relay per-message cap
  'next.styleSources = next.styleSources.slice()',
  'next.styleSources.pop()',
  'if (Array.isArray(next.styleSources)) next.styleSources = []',
];

test('inject bundle mirrors module capture-core invariants (select selection + CSSOM budget)', () => {
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
