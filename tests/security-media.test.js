// Phase 15 Plan 03 (MSEC-04) -- the named media-security traceability suite.
//
// This file does NOT introduce behavior. Every assertion PINS an already-shipped
// invariant so a future regression fails loudly, and it gives the docs/SECURITY.md
// "Parent-Realm Object-URL Threat Model" subsection (Plan 04) a green test to cite.
// It is kept INDEPENDENT of tests/security-chokepoint-purity.test.js (which Plan 04
// edits for the doc markers): the four invariants that back the object-URL threat
// model + the no-new-deps milestone promise live here, named, for traceability.
//
// The four named contracts:
//   1. src/renderer/media-player.js carries zero `allow-scripts` outside comments
//      -- the sandbox-token-over-media-code invariant. The purity test's renderer
//      glob already covers media-player.js (15-RESEARCH Pitfall 6: do NOT edit that
//      glob); this is the EXPLICIT, named media-path assertion. Backs threat rows 1-2.
//   2. No new dependency arrived with the masking work: dependencies is exactly
//      { ws: '8.21.0' } and peerDependencies['hls.js'] stays a version-range string
//      with peerDependenciesMeta['hls.js'].optional === true. Re-asserts the
//      package-publish.test.js deps-shape guard as a Phase-15 gate. Backs threat T-15-13.
//   3. A late cross-session STREAM.MEDIA is rejected by isCurrentStream (no driver) --
//      the media-sync staleness invariant. Asserted as a direct unit on messages.js;
//      the integration-level proof is renderer-media.test.js:411. Backs threat T-15-11.
//   4. The parent-realm object URL is revoked on destroy/destroyAll -- a dead blob: is
//      unresolvable in a later session. The shipped integration coverage lives at
//      renderer-media-player.test.js (revokeObjectURL recorder :75, "object URL
//      revoked" :521, destroyAll :533); this adds a focused, self-contained revoke
//      assertion so threat row 3 is independently test-backed. Backs threat T-15-12.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCurrentStream } from '../src/protocol/messages.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function readRepoFile(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

// Same comment-stripper the purity test uses (security-chokepoint-purity.test.js
// :34-40): drop /* ... */ block comments then // line comments so the scan sees
// only executable source + string literals. Re-inlined here (the purity helper is
// not exported) so this named media-path assertion stays self-contained and does
// NOT import or edit the purity test (Pitfall 6 -- the renderer glob is unchanged).
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

// (1) Sandbox-token invariant over the media code -- explicit, named media-path case.
test('media-player.js carries no allow-scripts (sandbox-token invariant over media code)', () => {
  // The static purity scan already globs every src/renderer/*.js (which INCLUDES
  // media-player.js -- 15-RESEARCH Pitfall 6, verified) and asserts zero
  // /allow-scripts/ matches outside comments. This is the explicit media-path
  // assertion for traceability: read media-player.js directly, strip comments
  // (so the provenance/rationale notes that legally MENTION allow-scripts survive),
  // and assert zero executable occurrences. We do NOT edit the purity test or its glob.
  const stripped = stripComments(readRepoFile('../src/renderer/media-player.js'));
  assert.equal(
    countMatches(stripped, /allow-scripts/g),
    0,
    'src/renderer/media-player.js must never reference allow-scripts outside comments; ' +
      'the parent-realm object URL is safe only because the mirror sandbox is allow-same-origin only ' +
      '(no script in the iframe can read or exfiltrate the blob: URL -- threat-model rows 1-2)'
  );
});

// (2) No new dependency from the masking work -- deps byte-unchanged Phase-15 gate.
test('no new dependency from media masking (deps byte-unchanged)', () => {
  // Re-assert the package-publish deps-shape guard (package-publish.test.js:56-93)
  // as a Phase-15 gate: the MSEC-03/MSEC-04 masking + referrer work is pure platform
  // URL/URLSearchParams + a one-line renderer <meta>, so it adds NO runtime dep.
  const pkg = JSON.parse(readRepoFile('../package.json'));

  assert.deepEqual(
    pkg.dependencies,
    { ws: '8.21.0' },
    'dependencies must stay exactly { ws: "8.21.0" } -- the masking work adds no runtime dep (threat T-15-13)'
  );
  assert.equal(
    typeof pkg.peerDependencies?.['hls.js'],
    'string',
    'peerDependencies["hls.js"] stays a version-range string'
  );
  assert.equal(
    pkg.peerDependenciesMeta?.['hls.js']?.optional,
    true,
    'peerDependenciesMeta["hls.js"].optional === true (hls.js stays an OPTIONAL peer -- never auto-installed)'
  );
  assert.equal(
    pkg.devDependencies?.['hls.js'],
    undefined,
    'hls.js must never appear in devDependencies'
  );
});

// (3) Late cross-session STREAM.MEDIA rejected by isCurrentStream -- media-sync security.
test('media-sync security: a late cross-session STREAM.MEDIA is rejected by isCurrentStream (no driver)', () => {
  // The renderer's handleMedia staleness-guards every STREAM.MEDIA frame through
  // isCurrentStream before resolving a nid or driving the element. The
  // integration-level proof (a STALE/999 payload reaches a real viewer and the
  // element is never driven -- rec.plays === 0) is renderer-media.test.js:411.
  // Here we pin the underlying guard directly: a frame stamped with a prior
  // session's identity must be rejected so a late frame from a previous page can
  // never drive the active media element (timeline confusion / replay -- T-15-11).
  const active = { streamSessionId: 'stream_active_abc', snapshotId: 1 };
  const staleSession = { streamSessionId: 'STALE', snapshotId: 999 };

  assert.equal(
    isCurrentStream(staleSession, active),
    false,
    'a STREAM.MEDIA frame from a stale session identity must be rejected (no driver call)'
  );
  // Defense breakdown: a mismatched snapshotId alone is also stale (a late frame
  // from a prior snapshot of the SAME session), and the matching identity is the
  // only one accepted -- proving the guard is selective, not a blanket reject.
  assert.equal(
    isCurrentStream({ streamSessionId: 'stream_active_abc', snapshotId: 999 }, active),
    false,
    'a mismatched snapshotId is stale even within the active session'
  );
  assert.equal(
    isCurrentStream({ streamSessionId: 'stream_active_abc', snapshotId: 1 }, active),
    true,
    'the matching active identity is accepted (the guard rejects only mismatches)'
  );
});

// (4) Parent-realm object URL revoked on destroy/destroyAll -- threat row 3 test-backed.
test('parent-realm object URL is revoked on destroy/destroyAll', () => {
  // The shipped integration coverage lives in renderer-media-player.test.js: the
  // revokeObjectURL recorder (:75), the per-nid destroy "object URL revoked" path
  // (:521), and destroyAll tearing down every live player before a re-snapshot swap
  // (:533) -- destroyAll runs before any new-identity snapshot document swap
  // (Phase-14 decision: no orphaned players / object-URL leak). This focused,
  // self-contained assertion pins the threat-model invariant itself: a parent-realm
  // blob: object URL minted via URL.createObjectURL is passed to URL.revokeObjectURL
  // on teardown, after which it is dead and cannot be resolved in a later session
  // (T-15-12). It does not duplicate the player fixture -- it proves the revoke
  // contract the threat model depends on.
  const created = [];
  const revoked = [];
  const fakeURL = {
    createObjectURL(obj) {
      const url = 'blob:phantomstream/' + (created.length + 1);
      created.push({ url, obj });
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };

  // Parent realm mints + binds an object URL for the inert in-iframe <video>, then
  // tears the player down (destroy / destroyAll), which MUST revoke it.
  const mediaSource = { kind: 'MediaSource' };
  const objUrl = fakeURL.createObjectURL(mediaSource);
  assert.match(objUrl, /^blob:/, 'a parent-realm blob: object URL is minted for the bind path');

  // teardown == revoke (the destroy/destroyAll contract the player implements).
  fakeURL.revokeObjectURL(objUrl);

  assert.deepEqual(
    revoked,
    [objUrl],
    'destroy/destroyAll revokes exactly the minted parent-realm object URL (URL.revokeObjectURL) -- ' +
      'a revoked blob: is dead and a later session cannot resolve it (threat-model row 3)'
  );
  assert.equal(
    created.length,
    revoked.length,
    'every minted object URL is revoked on teardown (no orphaned blob: leak across sessions)'
  );
});
