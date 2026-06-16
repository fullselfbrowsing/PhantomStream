import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);

function pathOf(...parts) {
  return join(ROOT.pathname, ...parts);
}

function readJson(...parts) {
  return JSON.parse(readFileSync(pathOf(...parts), 'utf8'));
}

function readText(...parts) {
  return readFileSync(pathOf(...parts), 'utf8');
}

function hasFileEntry(files, expected) {
  return Array.isArray(files) && files.some((entry) => {
    const normalized = String(entry).replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized === expected || normalized === expected + '/**';
  });
}

function exportKeys(pkg) {
  return [
    '.',
    './protocol',
    './capture',
    './renderer',
    './relay',
    './transport/websocket',
    './adapters/playwright',
    './adapters/extension',
    './adapters/bookmarklet',
  ];
}

test('package scripts and files whitelist define the publish validation surface', () => {
  const pkg = readJson('package.json');

  for (const script of ['types', 'lint:package', 'attw', 'package:pack', 'package:smoke', 'package:check']) {
    assert.equal(typeof pkg.scripts?.[script], 'string', `package.json scripts.${script} exists`);
  }

  for (const entry of ['src', 'dist/types', 'bin', 'examples', 'README.md', 'LICENSE']) {
    assert.equal(hasFileEntry(pkg.files, entry), true, `files whitelist includes ${entry}`);
  }
  for (const privateEntry of ['.planning', 'reference', 'tests', '.context']) {
    assert.equal(hasFileEntry(pkg.files, privateEntry), false, `files whitelist excludes ${privateEntry}`);
  }
});

test('public package exports expose types first and runtime defaults last', () => {
  const pkg = readJson('package.json');

  for (const key of exportKeys(pkg)) {
    const entry = pkg.exports?.[key];
    assert.equal(typeof entry, 'object', `exports.${key} is a condition object`);
    assert.notEqual(entry, null, `exports.${key} is non-null`);

    const conditions = Object.keys(entry);
    assert.equal(conditions[0], 'types', `exports.${key} puts types first`);
    assert.equal(conditions[conditions.length - 1], 'default', `exports.${key} puts default last`);
    assert.match(entry.types, /^\.\/dist\/types\//, `exports.${key}.types points at generated declarations`);
    assert.match(entry.default, /^\.\/src\//, `exports.${key}.default points at source runtime`);
  }
});

test('TypeScript declaration config emits declarations from JavaScript only', () => {
  assert.equal(existsSync(pathOf('tsconfig.types.json')), true, 'tsconfig.types.json exists');
  const tsconfig = readJson('tsconfig.types.json');
  const options = tsconfig.compilerOptions || {};

  for (const key of ['allowJs', 'checkJs', 'declaration', 'emitDeclarationOnly', 'declarationMap']) {
    assert.equal(options[key], true, `compilerOptions.${key} is true`);
  }
  assert.equal(options.outDir, 'dist/types');
});

test('CI and publish workflows validate package shape before release', () => {
  const ci = readText('.github', 'workflows', 'ci.yml');
  assert.match(ci, /npm run package:check/);

  assert.equal(existsSync(pathOf('.github', 'workflows', 'publish.yml')), true, 'publish workflow exists');
  const publish = readText('.github', 'workflows', 'publish.yml');
  assert.match(publish, /id-token:\s*write/);
  assert.match(publish, /registry-url:\s*['"]https:\/\/registry\.npmjs\.org['"]/);
  assert.match(publish, /npm run package:check/);
  assert.match(publish, /npm publish --access public/);
  assert.doesNotMatch(publish, /NPM_TOKEN/);
});

test('package docs cover quickstarts, release gates, and shipped CSSOM mode', () => {
  assert.equal(existsSync(pathOf('docs', 'QUICKSTARTS.md')), true, 'docs/QUICKSTARTS.md exists');
  assert.equal(existsSync(pathOf('docs', 'RELEASE.md')), true, 'docs/RELEASE.md exists');

  const readme = readText('README.md');
  assert.match(readme, /docs\/QUICKSTARTS\.md/);
  assert.match(readme, /styleMode: 'cssom'/);
  assert.match(readme, /WeakMap/);
  assert.match(readme, /nodeIds/);
  assert.doesNotMatch(readme, /CSSOM capture mode.*Planned/i);
  assert.doesNotMatch(readme, /v1 capture enhancements.*Planned/i);
});
