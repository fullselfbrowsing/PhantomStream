// RED Wave-0 scaffold -- filled by Plan 12-03.
// Requirements covered: MSEC-01 (fail-closed origin/scheme classifier:
// https-only + private/internal-range deny). This is the pure, DOM-free,
// network-free function Phase 15 masking will reuse; it is table-tested here
// over the full denylist enumerated in 12-CONTEXT / 12-RESEARCH Security Domain.
//
// RED mechanism: src/renderer/asset-policy.js does NOT exist yet (Plan 12-03
// creates it). Each test dynamically imports the module inside the test body, so
// a missing module surfaces as a per-test FAILURE (ERR_MODULE_NOT_FOUND caught
// and re-asserted with a clear message) rather than a top-level load error -- the
// file parses and runs cleanly under `node --test`.
//
// Expected signature (Plan 12-03):
//   classifyAssetOrigin(url) -> { allowed: boolean, reason: string }
//   reason in {'ok','bad-scheme','private-host','unqualified-host','parse-error'}

import { test } from 'node:test';
import assert from 'node:assert/strict';

const POLICY_MODULE = '../src/renderer/asset-policy.js';

/** Dynamically load the (not-yet-existing) policy module; fail the test cleanly if absent. */
async function loadPolicy() {
  let mod;
  try {
    mod = await import(POLICY_MODULE);
  } catch (err) {
    assert.fail(
      'Plan 12-03 must create src/renderer/asset-policy.js exporting classifyAssetOrigin (' +
        (err && err.code ? err.code : err) + ')'
    );
  }
  assert.equal(
    typeof mod.classifyAssetOrigin,
    'function',
    'Plan 12-03 must export a pure classifyAssetOrigin(url) -> { allowed, reason }'
  );
  return mod.classifyAssetOrigin;
}

// The denylist table (12-RESEARCH Security Domain). One allowed public-https row,
// one bad-scheme row, every private/internal range, two unqualified-host rows,
// and a malformed-url parse-error row -- the Nyquist minimum that catches any
// regression that opens the gate to a non-public-https origin.
const ORIGIN_ROWS = [
  { url: 'https://cdn.example.com/a.png', allowed: true, reason: 'ok' },
  { url: 'http://cdn.example.com/a.png', allowed: false, reason: 'bad-scheme' },
  { url: 'https://localhost/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://127.0.0.1/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://10.1.2.3/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://172.16.5.5/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://192.168.1.1/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://169.254.169.254/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://[::1]/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://[fc00::1]/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://[fd12::1]/a.png', allowed: false, reason: 'private-host' },
  { url: 'https://intranet/a.png', allowed: false, reason: 'unqualified-host' },
  { url: 'https://host.local/a.png', allowed: false, reason: 'unqualified-host' },
  { url: 'not a url', allowed: false, reason: 'parse-error' },
];

for (const row of ORIGIN_ROWS) {
  test('classifyAssetOrigin(' + JSON.stringify(row.url) + ') -> allowed=' + row.allowed + ' reason=' + row.reason + ' (MSEC-01)', async () => {
    const classifyAssetOrigin = await loadPolicy();
    const result = classifyAssetOrigin(row.url);
    assert.equal(result.allowed, row.allowed, 'allowed flag for ' + row.url);
    assert.equal(result.reason, row.reason, 'reason for ' + row.url);
  });
}

test('classifyAssetOrigin fails closed on the 172.16.0.0/12 boundary but allows public 172.32.x (MSEC-01 boundary)', async () => {
  const classifyAssetOrigin = await loadPolicy();
  assert.equal(classifyAssetOrigin('https://172.16.0.1/a.png').allowed, false, '172.16.x is private (start of /12)');
  assert.equal(classifyAssetOrigin('https://172.31.255.255/a.png').allowed, false, '172.31.x is private (end of /12)');
  assert.equal(classifyAssetOrigin('https://172.32.0.1/a.png').allowed, true, '172.32.x is OUTSIDE the /12 -> public');
  assert.equal(classifyAssetOrigin('https://172.15.0.1/a.png').allowed, true, '172.15.x is OUTSIDE the /12 -> public');
});
