import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = join(repoRoot, 'bench/results/local-latest.json');
const generatedPath = join(repoRoot, 'paper/generated-results.tex');
const mainPath = join(repoRoot, 'paper/main.tex');

function fail(message) {
  throw new Error(message);
}

function assertFinite(label, value) {
  if (!Number.isFinite(value)) fail(`${label} must be finite, got ${value}`);
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) fail(`${label} missing ${needle}`);
}

const result = JSON.parse(await readFile(resultPath, 'utf8'));
if (result.schemaVersion !== 1) fail('unexpected benchmark schema version');
if (!Array.isArray(result.runs) || result.runs.length !== 15) fail('benchmark must contain 15 local runs');
if (!result.systems?.webrtc || result.systems.webrtc.available !== false) {
  fail('WebRTC baseline must be explicitly marked unavailable in local headless results');
}

for (const system of ['phantomstream', 'rrweb', 'cdp']) {
  const summary = result.summary?.[system];
  if (!summary) fail(`missing summary for ${system}`);
  if (summary.availableRuns !== 15) fail(`${system} must have 15 available runs`);
  for (const key of ['medianBytes', 'medianKB', 'medianStartupMs', 'medianLatencyMs', 'medianVisualDiffPct', 'meanSemanticScore']) {
    assertFinite(`${system}.${key}`, summary[key]);
  }
}

for (const key of ['testCount', 'testFiles', 'productionFiles', 'productionLoc']) {
  const value = result.project?.[key];
  assertFinite(`project.${key}`, value);
  if (value <= 0) fail(`project.${key} must be positive`);
}

const generated = await readFile(generatedPath, 'utf8');
for (const macro of [
  'PSBenchGeneratedAt',
  'PSPackageVersion',
  'PSTestCount',
  'PSBenchRunCount',
  'PSPhantomMedianKB',
  'PSRrwebMedianKB',
  'PSCDPMedianKB',
  'PSReductionVsCDP',
]) {
  assertIncludes(generated, `\\newcommand{\\${macro}}`, 'generated-results.tex');
}

const main = await readFile(mainPath, 'utf8');
assertIncludes(main, '\\input{generated-results.tex}', 'main.tex');
for (const pattern of [/TODO/i, /TBD/i, /\[X\]/, /\[Y\]/, /planned result/i]) {
  if (pattern.test(main)) fail(`main.tex contains unresolved placeholder pattern ${pattern}`);
}

if (/WebRTC[^.]{0,80}(\\PS|[0-9]+\.?[0-9]*\s*(KB|ms|percent|\\%))/i.test(main)) {
  fail('main.tex appears to make a numeric WebRTC result claim');
}

process.stdout.write('paper-check ok\n');
