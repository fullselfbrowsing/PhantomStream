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

/** Load the exported isPrivateOrLocalHost predicate (Phase-15-reusable seam, review WR-01). */
async function loadIsPrivateOrLocalHost() {
  const mod = await import(POLICY_MODULE);
  assert.equal(
    typeof mod.isPrivateOrLocalHost,
    'function',
    'asset-policy.js must export isPrivateOrLocalHost(host) for the Phase-15 reuse seam'
  );
  return mod.isPrivateOrLocalHost;
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

// ---- Review CR-01: SSRF bypasses that MUST be fail-closed (empirically verified) ----
// IPv4-mapped IPv6, IPv6 link-local, NAT64, the unspecified address, and the
// trailing-dot loopback all reach internal/metadata endpoints unless blocked.
// Each row below is the EXACT payload the reviewer drove through classifyAssetOrigin.
const SSRF_BYPASS_ROWS = [
  // IPv4-mapped IPv6 -> embedded IPv4 re-classified against the v4 denylist.
  { url: 'https://[::ffff:169.254.169.254]/x', allowed: false, reason: 'private-host', note: 'AWS/GCP/Azure metadata, IPv4-mapped' },
  { url: 'https://[::ffff:7f00:1]/x', allowed: false, reason: 'private-host', note: '127.0.0.1 loopback, IPv4-mapped (hex hextets)' },
  // IPv6 link-local fe80::/10.
  { url: 'https://[fe80::1]/x', allowed: false, reason: 'private-host', note: 'IPv6 link-local fe80::/10' },
  // NAT64 well-known prefix 64:ff9b::/96 (here mapping the metadata host).
  { url: 'https://[64:ff9b::a9fe:a9fe]/x', allowed: false, reason: 'private-host', note: 'NAT64 of 169.254.169.254' },
  // Trailing-dot loopback (WHATWG keeps the dot on non-IP hosts).
  { url: 'https://localhost./x', allowed: false, reason: 'private-host', note: 'trailing-dot loopback' },
  // Unspecified address and IPv6 loopback hardening.
  { url: 'https://[::]/x', allowed: false, reason: 'private-host', note: 'unspecified ::' },
  // IPv4-compatible (no ::ffff:) form of the metadata host.
  { url: 'https://[::169.254.169.254]/x', allowed: false, reason: 'private-host', note: 'IPv4-compatible metadata' },
];

for (const row of SSRF_BYPASS_ROWS) {
  test('classifyAssetOrigin BLOCKS SSRF bypass ' + JSON.stringify(row.url) + ' (' + row.note + ', CR-01)', async () => {
    const classifyAssetOrigin = await loadPolicy();
    const result = classifyAssetOrigin(row.url);
    assert.equal(result.allowed, row.allowed, row.url + ' must be BLOCKED (' + row.note + ')');
    assert.equal(result.reason, row.reason, 'reason for ' + row.url);
  });
}

test('classifyAssetOrigin still ALLOWS an IPv4-mapped IPv6 whose embedded v4 is public (CR-01 fail-closed not over-broad)', async () => {
  const classifyAssetOrigin = await loadPolicy();
  // ::ffff:8.8.8.8 maps a public address; it must NOT be collateral-blocked.
  assert.equal(classifyAssetOrigin('https://[::ffff:8.8.8.8]/x').allowed, true, '::ffff:8.8.8.8 maps a public v4 -> allowed');
});

// ---- Review WR-01: isPrivateOrLocalHost must be safe on un-normalized hosts ----
// The predicate is an exported Phase-15-reusable seam; it must NOT depend on a
// caller having pre-normalized through new URL(). Trailing-dot, uppercase, and
// bracketed/zone-id IPv6 forms must all be denied by the predicate alone.
const PREDICATE_PRIVATE_ROWS = [
  '127.0.0.1.',
  '10.0.0.5.',
  'localhost.',
  'LOCALHOST',
  '169.254.169.254',
  '[::ffff:7f00:1]',
  '[::ffff:169.254.169.254]',
  '[fe80::1]',
  '[fe80::1%eth0]',
  '[64:ff9b::a9fe:a9fe]',
  '[::]',
];

for (const host of PREDICATE_PRIVATE_ROWS) {
  test('isPrivateOrLocalHost(' + JSON.stringify(host) + ') -> true on un-normalized host (WR-01)', async () => {
    const isPrivateOrLocalHost = await loadIsPrivateOrLocalHost();
    assert.equal(isPrivateOrLocalHost(host), true, host + ' must classify as private without URL pre-normalization');
  });
}

test('isPrivateOrLocalHost stays false for a genuinely public host/IP (WR-01 not over-broad)', async () => {
  const isPrivateOrLocalHost = await loadIsPrivateOrLocalHost();
  assert.equal(isPrivateOrLocalHost('cdn.example.com'), false, 'public hostname is not private');
  assert.equal(isPrivateOrLocalHost('8.8.8.8'), false, 'public IPv4 is not private');
  assert.equal(isPrivateOrLocalHost('172.32.0.1'), false, '172.32.x is outside the /12');
});
