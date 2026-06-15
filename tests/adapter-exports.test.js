import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getBrowserInjectSource } from '../src/adapters/browser-inject.js';
import { createExtensionAdapter } from '../src/adapters/extension.js';
import { createBookmarkletSource } from '../src/adapters/bookmarklet.js';

test('package exports extension and bookmarklet adapter subpaths', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(pkg.exports['./adapters/extension'], './src/adapters/extension.js');
  assert.equal(pkg.exports['./adapters/bookmarklet'], './src/adapters/bookmarklet.js');
});

test('browser inject source is a checked-in classic script with capture bridge hooks', () => {
  const source = getBrowserInjectSource();

  assert.equal(source.includes('import '), false);
  assert.equal(source.includes('export '), false);
  assert.match(source, /createCapture/);
  assert.match(source, /window\.__phantomStreamBridge/);
  assert.match(source, /window\.__phantomStreamStart/);
  assert.match(source, /window\.__phantomStreamStop/);
});

test('adapter modules expose stable public factory functions', () => {
  assert.equal(typeof createExtensionAdapter, 'function');
  assert.equal(typeof createBookmarkletSource, 'function');
});
