// tests/differential/fixtures/generate-truncation-overflow.js -- deterministic
// generator (committed provenance) for the frozen truncation-overflow.html
// fixture. Zero randomness, zero Date dependence: every run writes
// byte-identical output. Regenerate with:
//   node tests/differential/fixtures/generate-truncation-overflow.js
//
// Sizing: the reference's truncation budget compares clone.innerHTML.length
// -- UTF-16 code units, NOT bytes (01-RESEARCH.md Pitfall 7) -- so this
// fixture is pure-ASCII repetition, where characters === code units. The raw
// fixture targets 1.5x SNAPSHOT_BUDGET_BYTES; the serialized innerHTML only
// grows from there (nid stamps + inlined computed styles), so truncation
// triggers comfortably and identically on both oracle sides.
//
// Layout contract (01-RESEARCH.md Pattern 5): the harness patches
// getBoundingClientRect to read the data-test-top attribute. The above-fold
// header subtree is stamped data-test-top="0"; each overflow section is
// stamped far beyond the jsdom truncation cutoff (innerHeight 768 x
// TRUNCATION_VIEWPORT_MULTIPLIER 3 = 2304), so pass-1 truncation (drop
// below-fold subtrees) has real whole-subtree candidates to remove.

import { writeFileSync } from 'node:fs';
import { SNAPSHOT_BUDGET_BYTES } from '../../../src/protocol/constants.js';

// 1.5x the budget: 1,258,290 chars with the current 838,860-char budget --
// inside the planned 1,200,000..1,500,000 window.
const TARGET_CHARS = Math.floor(SNAPSHOT_BUDGET_BYTES * 1.5);

// Six sibling sections, every top beyond the 2304 jsdom cutoff (768 * 3).
const SECTION_TOPS = [3000, 6000, 9000, 12000, 15000, 18000];

const SENTENCE = 'Deterministic ASCII filler for the truncation overflow '
  + 'fixture; fixed repetition keeps sizing exact because every character '
  + 'is exactly one UTF-16 code unit. ';
const PARAGRAPH = '      <p class="filler">' + SENTENCE.repeat(13).trim() + '</p>\n';

// Deterministic paragraph count: enough paragraphs per section that the six
// sections together reach TARGET_CHARS.
const perSectionTarget = Math.ceil(TARGET_CHARS / SECTION_TOPS.length);
const parasPerSection = Math.ceil(perSectionTarget / PARAGRAPH.length);

const sections = SECTION_TOPS.map(function (top, index) {
  return '    <section class="overflow-block" id="overflow-' + (index + 1)
    + '" data-test-top="' + top + '">\n'
    + '      <h2>Below-fold section ' + (index + 1) + ' stamped at top ' + top + '</h2>\n'
    + PARAGRAPH.repeat(parasPerSection)
    + '    </section>\n';
}).join('');

const html = '<!DOCTYPE html>\n'
  + '<html lang="en">\n'
  + '<head>\n'
  + '  <meta charset="utf-8">\n'
  + '  <title>PhantomStream truncation overflow fixture</title>\n'
  + '</head>\n'
  + '<body>\n'
  + '  <header id="above-fold" data-test-top="0">\n'
  + '    <h1 id="overflow-title">Truncation overflow fixture</h1>\n'
  + '    <p id="above-fold-note">Above-fold subtree that survives pass-1 truncation; every section below is stamped beyond the viewport cutoff.</p>\n'
  + '  </header>\n'
  + sections
  + '</body>\n'
  + '</html>\n';

if (/[^\x00-\x7f]/.test(html)) {
  throw new Error('non-ascii-content: fixture sizing depends on pure ASCII');
}
if (html.length < 1200000) {
  throw new Error('fixture-too-small: ' + html.length + ' chars (need >= 1200000)');
}
if (html.length > 1500000) {
  throw new Error('fixture-too-large: ' + html.length + ' chars (need <= 1500000)');
}

writeFileSync(new URL('./truncation-overflow.html', import.meta.url), html);
console.log('truncation-overflow.html chars: ' + html.length);
