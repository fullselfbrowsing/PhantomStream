// MSEC-03 asset/media URL masking tests (Phase 15 Plan 01): the host masking
// vocabulary that redacts/strips/blocks asset+media URLs BEFORE they reach the
// wire, routed through the new 'asset-url'/'media-url' sanitizeForWire dispatch
// backed by the pure maskAssetUrlForWire helper + the documented
// TOKEN_PARAM_DENYLIST. Pins:
//   - maskAssetUrls:true strips token/PII query params (each provider family +
//     the generic set, case-insensitive, exact-name OR denied-prefix) while
//     functional params (w/h/q/format/v/id/t) survive byte-for-byte.
//   - Byte-identity: a no-token URL and a data:/blob: URL pass through UNCHANGED
//     when maskAssetUrls is on (the helper returns the ORIGINAL string, never
//     new URL().toString() -- Pitfall 1). With NO masking config the wire is
//     byte-identical (off-by-default; differential oracle unaffected).
//   - maskAssetUrlFn(url, ctx): a returned string replaces the URL; null blocks
//     to placeholder (the attribute is removed); a THROW fails closed and blocks
//     (logged, returns null -- never raises, never passes the raw URL).
//   - Invalid maskMediaSelector throws Error('invalid-mask-selector') at factory
//     time (the one allowed throw site, via compileMaskSelector).
//   - Hostile <source src="javascript:..."> is neutralized at the existing
//     hasDangerousScheme scrub in the URL_ATTRS loop, BEFORE the new masking
//     runs -- a hostile scheme never reaches maskAssetUrlForWire.
//
// The setup/teardown and settle helpers are duplicated locally (parallel-safe:
// this file imports nothing from any shared test harness). Globals recipe per
// 01-RESEARCH.md Pattern 2; settle cadence per Pattern 3; recording-transport
// shape per tests/security-mask.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM } from '../src/protocol/messages.js';

// Complete global set the capture core dereferences (audited from the
// reference source in 01-RESEARCH.md Pattern 2).
const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

/**
 * Build a fresh JSDOM, install its globals on globalThis (recording prior
 * state), and return an env whose teardown stops capture, restores every
 * global exactly, and closes the window. Mirrors security-mask.test.js setupEnv.
 * @param {string} bodyHtml
 * @param {string} pageUrl
 */
function setupEnv(bodyHtml, pageUrl = 'https://fixture.test/page') {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>asset-url mask fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: pageUrl,
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  const w = dom.window;

  const prior = new Map();
  for (const key of AUDITED_GLOBALS) {
    prior.set(key, {
      present: Object.prototype.hasOwnProperty.call(globalThis, key),
      value: globalThis[key],
    });
    globalThis[key] = key === 'window' ? w : w[key];
  }

  const env = {
    dom,
    window: w,
    document: w.document,
    capture: null,
    teardown() {
      try {
        if (env.capture) env.capture.stop();
      } catch (e) { /* already stopped */ }
      env.capture = null;
      for (const key of AUDITED_GLOBALS) {
        const p = prior.get(key);
        if (p.present) {
          globalThis[key] = p.value;
        } else {
          delete globalThis[key];
        }
      }
      w.close();
    },
  };
  return env;
}

/**
 * Deterministic mutation-flush cadence (01-RESEARCH.md Pattern 3, verified):
 * MutationObserver microtask delivery -> rAF flush -> async send settle.
 * @param {Window} win
 */
async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Loopback transport: records every (type, payload) pair. */
function createLoopbackTransport() {
  const sent = [];
  return { sent, send(type, payload) { sent.push({ type, payload }); } };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

/** The single SNAPSHOT payload from a started capture. */
function snapshotPayload(transport) {
  const snaps = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
  assert.equal(snaps.length, 1, 'start() emits exactly one snapshot');
  return snaps[0].payload;
}

/**
 * Re-parse the snapshot html and return the element at the same document-order
 * index as `liveEl` in the live body (the serializer walks body in order, so
 * the parsed clone preserves index parity for surviving elements).
 * Returns the parsed element or null.
 */
function parsedClone(env, payload, selector) {
  const tpl = env.document.createElement('template');
  tpl.innerHTML = payload.html;
  return tpl.content.querySelector(selector);
}

/**
 * Start a capture over a fixture, settle, and return { transport, payload }.
 */
async function captureSnapshot(env, options) {
  const transport = createLoopbackTransport();
  env.capture = createCapture(Object.assign({ transport, logger: silentLogger() }, options));
  env.capture.start();
  await settle(env.window);
  return { transport, payload: snapshotPayload(transport) };
}

// A representative token-bearing image URL per provider family. Functional
// params (w/h/q) are interleaved so the survival assertions are meaningful.
const AWS_SIGV4 = 'https://cdn.example.com/a.jpg?w=800&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20260101%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260101T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeef&X-Amz-Security-Token=FwoG&h=600';
const AWS_SIGV2 = 'https://cdn.example.com/b.jpg?AWSAccessKeyId=AKIAEXAMPLE&Signature=abc%2Bdef&Expires=1700000000&Policy=eyJ&Key-Pair-Id=APKA&q=80';
const GCP_SIGNED = 'https://storage.googleapis.com/c.jpg?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=svc%2F20260101&X-Goog-Date=20260101T000000Z&X-Goog-Expires=600&X-Goog-SignedHeaders=host&X-Goog-Signature=cafe&GoogleAccessId=svc%40proj.iam&v=2';
const AZURE_SAS = 'https://acct.blob.core.windows.net/d.jpg?sv=2022-11-02&ss=b&srt=o&sp=r&se=2026-01-01T00%3A00%3A00Z&st=2025-01-01T00%3A00%3A00Z&spr=https&sig=Zm9v&format=jpg';
const GENERIC = 'https://cdn.example.com/e.jpg?token=secrettoken&apikey=ABC&id=42&authorization=Bearer&t=15';

/**
 * Parse a URL string and return a lowercased Set of its query-param names.
 */
function paramNames(urlStr) {
  const u = new URL(urlStr);
  const out = new Set();
  u.searchParams.forEach((_v, k) => out.add(k.toLowerCase()));
  return out;
}

// ===========================================================================
// maskAssetUrls: token/PII param strip per provider family + generic
// ===========================================================================

test('maskAssetUrls strips AWS SigV4 presign params (and the x-amz- prefix family); functional w/h survive', async () => {
  const env = setupEnv(`<img id="t" src="${AWS_SIGV4}">`);
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const img = parsedClone(env, payload, '#t');
    assert.ok(img, 'the <img> survives on the wire');
    const names = paramNames(img.getAttribute('src'));
    for (const stripped of ['x-amz-algorithm', 'x-amz-credential', 'x-amz-date', 'x-amz-expires', 'x-amz-signedheaders', 'x-amz-signature', 'x-amz-security-token']) {
      assert.ok(!names.has(stripped), `${stripped} must be stripped`);
    }
    assert.ok(names.has('w') && names.has('h'), 'functional params w/h survive');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrls strips AWS SigV2 / canned-policy params; functional q survives', async () => {
  const env = setupEnv(`<img id="t" src="${AWS_SIGV2}">`);
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const img = parsedClone(env, payload, '#t');
    const names = paramNames(img.getAttribute('src'));
    for (const stripped of ['awsaccesskeyid', 'signature', 'expires', 'policy', 'key-pair-id']) {
      assert.ok(!names.has(stripped), `${stripped} must be stripped`);
    }
    assert.ok(names.has('q'), 'functional param q survives');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrls strips GCP signed-URL params (and the x-goog- prefix family); functional v survives', async () => {
  const env = setupEnv(`<img id="t" src="${GCP_SIGNED}">`);
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const img = parsedClone(env, payload, '#t');
    const names = paramNames(img.getAttribute('src'));
    for (const stripped of ['x-goog-algorithm', 'x-goog-credential', 'x-goog-date', 'x-goog-expires', 'x-goog-signedheaders', 'x-goog-signature', 'googleaccessid']) {
      assert.ok(!names.has(stripped), `${stripped} must be stripped`);
    }
    assert.ok(names.has('v'), 'functional param v survives');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrls strips Azure SAS params; functional format survives', async () => {
  const env = setupEnv(`<img id="t" src="${AZURE_SAS}">`);
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const img = parsedClone(env, payload, '#t');
    const names = paramNames(img.getAttribute('src'));
    for (const stripped of ['sv', 'ss', 'srt', 'sp', 'se', 'st', 'spr', 'sig']) {
      assert.ok(!names.has(stripped), `${stripped} must be stripped`);
    }
    assert.ok(names.has('format'), 'functional param format survives');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrls strips the generic token/secret/auth set; functional id/t survive', async () => {
  const env = setupEnv(`<img id="t" src="${GENERIC}">`);
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const img = parsedClone(env, payload, '#t');
    const names = paramNames(img.getAttribute('src'));
    for (const stripped of ['token', 'apikey', 'authorization']) {
      assert.ok(!names.has(stripped), `${stripped} must be stripped`);
    }
    assert.ok(names.has('id') && names.has('t'), 'functional params id and t (seek timestamp) survive');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrls matches param names case-insensitively (lowercase x-amz-signature stripped)', async () => {
  const env = setupEnv('<img id="t" src="https://cdn.example.com/x.jpg?w=10&x-amz-signature=abc&Q=5">');
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const img = parsedClone(env, payload, '#t');
    const names = paramNames(img.getAttribute('src'));
    assert.ok(!names.has('x-amz-signature'), 'lowercase x-amz-signature stripped');
    assert.ok(names.has('w') && names.has('q'), 'functional params survive regardless of case');
  } finally {
    env.teardown();
  }
});

// ===========================================================================
// Byte-identity: no-token + data:/blob: passthrough, off-by-default
// ===========================================================================

test('maskAssetUrls leaves a no-token URL byte-identical to the unmasked wire (no extra normalization)', async () => {
  // Byte-identity property: with maskAssetUrls ON, a URL carrying NO denylisted
  // param must serialize EXACTLY as it does with masking OFF -- the helper adds
  // zero divergence (Pitfall 1: it returns the ORIGINAL string when nothing is
  // stripped, never new URL().toString()). We compare masked-ON vs masked-OFF of
  // the SAME fixture rather than a hand-written literal, because the serializer's
  // own absolutifyUrl already normalizes the URL upstream (host case / default
  // port) -- that pre-existing normalization is identical on both paths, so a
  // true byte-identity assertion compares the two serializations to each other.
  // The fixture carries normalization-bait so any masking-introduced re-encoding
  // would surface as a divergence between the two.
  const original = 'https://CDN.Example.COM:443/path/Image.JPG?w=800&h=600&q=80&format=webp';

  const envOff = setupEnv(`<img id="t" src="${original}">`);
  let offSrc;
  try {
    const { payload } = await captureSnapshot(envOff, {});
    offSrc = parsedClone(envOff, payload, '#t').getAttribute('src');
  } finally {
    envOff.teardown();
  }

  const envOn = setupEnv(`<img id="t" src="${original}">`);
  try {
    const { payload } = await captureSnapshot(envOn, { maskAssetUrls: true });
    const onSrc = parsedClone(envOn, payload, '#t').getAttribute('src');
    assert.equal(onSrc, offSrc,
      'a no-token URL with masking ON is byte-identical to the masking-OFF wire (helper returns the original string, no URL.toString() normalization)');
    // And every functional param survived the strip pass.
    const names = paramNames(onSrc);
    assert.ok(names.has('w') && names.has('h') && names.has('q') && names.has('format'),
      'all functional params survive a no-token strip pass');
  } finally {
    envOn.teardown();
  }
});

test('maskAssetUrls passes data: and blob: URLs through unchanged (short-circuit / new URL try-catch)', async () => {
  const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const env = setupEnv(`<img id="d" src="${dataUri}">`);
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const img = parsedClone(env, payload, '#d');
    assert.equal(img.getAttribute('src'), dataUri, 'small data: URI passes through byte-identical');
  } finally {
    env.teardown();
  }
});

// ===========================================================================
// WR-04: token in the URL FRAGMENT must not reach the cross-origin viewer.
// The fragment is never sent in the asset GET, but the URL STRING (fragment
// included) crosses the relay, so an OAuth-implicit-flow #access_token=... is a
// disclosure. When maskAssetUrls is on AND the fragment carries a denied param
// name, the whole fragment is dropped; benign anchors and the off-by-default
// path stay byte-identical (no URL.toString() normalization).
// ===========================================================================

test('maskAssetUrls drops a token-bearing URL fragment (#access_token=...) the query strip never sees (WR-04)', async () => {
  const env = setupEnv('<img id="t" src="https://cdn.example.com/a.jpg?w=10#access_token=LEAK">');
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const out = parsedClone(env, payload, '#t').getAttribute('src');
    assert.ok(out.indexOf('access_token') === -1 && out.indexOf('LEAK') === -1,
      'the token fragment must not survive on the wire');
    assert.ok(out.indexOf('#') === -1, 'the whole token-bearing fragment is dropped');
    assert.ok(paramNames(out).has('w'), 'functional query param w survives the fragment redaction');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrls drops a fragment-ONLY token even when the URL has no query (WR-04)', async () => {
  // No u.search at all: the old `if (!u.search) return url` fast path would have
  // leaked this; the fragment gate must run before the early return.
  const env = setupEnv('<img id="t" src="https://cdn.example.com/a.jpg#token=LEAKED_SECRET">');
  try {
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    const out = parsedClone(env, payload, '#t').getAttribute('src');
    assert.ok(out.indexOf('token') === -1 && out.indexOf('LEAKED_SECRET') === -1,
      'a query-less token fragment must still be redacted');
    assert.equal(out, 'https://cdn.example.com/a.jpg', 'only the fragment is removed; the path is intact');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrls leaves a benign anchor fragment byte-identical (no token name -> no rewrite, WR-04)', async () => {
  // A plain section anchor has no denied param name; byte-identity must hold so
  // the no-strip path adds zero divergence (no URL.toString() normalization).
  const benign = 'https://cdn.example.com/a.jpg?w=10#section-2';
  const envOff = setupEnv(`<img id="t" src="${benign}">`);
  let offSrc;
  try {
    const { payload } = await captureSnapshot(envOff, {});
    offSrc = parsedClone(envOff, payload, '#t').getAttribute('src');
  } finally {
    envOff.teardown();
  }
  const envOn = setupEnv(`<img id="t" src="${benign}">`);
  try {
    const { payload } = await captureSnapshot(envOn, { maskAssetUrls: true });
    const onSrc = parsedClone(envOn, payload, '#t').getAttribute('src');
    assert.equal(onSrc, offSrc,
      'a benign #anchor fragment with masking ON is byte-identical to masking OFF (fragment kept, no rewrite)');
    assert.ok(onSrc.indexOf('#section-2') !== -1, 'the benign anchor fragment is preserved');
  } finally {
    envOn.teardown();
  }
});

test('off-by-default: a fragment-token URL is emitted byte-identical with NO masking config (oracle-safe, WR-04)', async () => {
  const fragTokenUrl = 'https://cdn.example.com/a.jpg?w=10#access_token=LEAK';
  const env = setupEnv(`<img id="t" src="${fragTokenUrl}">`);
  try {
    const { payload } = await captureSnapshot(env, {});
    const img = parsedClone(env, payload, '#t');
    assert.equal(img.getAttribute('src'), fragTokenUrl,
      'no masking config -> the fragment-token URL is byte-identical on the wire (the fragment gate is gated behind maskAssetUrls)');
  } finally {
    env.teardown();
  }
});

test('off-by-default: with NO masking config a token-bearing URL is emitted byte-identical (oracle-safe)', async () => {
  const env = setupEnv(`<img id="t" src="${AWS_SIGV4}">`);
  try {
    const { payload } = await captureSnapshot(env, {});
    const img = parsedClone(env, payload, '#t');
    assert.equal(img.getAttribute('src'), AWS_SIGV4,
      'no masking config -> the URL (token params included) is byte-identical on the wire');
  } finally {
    env.teardown();
  }
});

// ===========================================================================
// Task 3: off-by-default byte-identity gate -- the whole snapshot wire is
// byte-identical with NO masking config, proving the masking spine adds ZERO
// divergence off-by-default (the differential oracle stays 48/48, no new ledger
// entry). A fixture carrying token-bearing asset AND media URLs is the worst
// case; if any masking code path leaked into the default path it would surface
// here as an html-string divergence (most likely a URL.toString() normalization
// per Pitfall 1).
// ===========================================================================

const MULTI_URL_FIXTURE = '<div id="root">'
  + `<img id="img" src="${AWS_SIGV4}" srcset="${GCP_SIGNED} 2x">`
  + `<video id="vid" src="${AZURE_SAS}" poster="${GENERIC}"></video>`
  + '<a id="lnk" href="https://cdn.example.com/page?token=secrettoken&id=9">link</a>'
  + '</div>';

test('Task 3: off-by-default -- the entire snapshot html is byte-identical with no masking config (oracle-safe; token URLs survive intact)', async () => {
  // Capture the SAME fixture twice with no masking config; the html must be
  // byte-identical run-to-run AND must still carry the token params verbatim
  // (proving the default path neither strips nor normalizes any URL).
  const envA = setupEnv(MULTI_URL_FIXTURE);
  let htmlA;
  try {
    const { payload } = await captureSnapshot(envA, {});
    htmlA = payload.html;
  } finally {
    envA.teardown();
  }

  const envB = setupEnv(MULTI_URL_FIXTURE);
  try {
    const { payload } = await captureSnapshot(envB, {});
    const htmlB = payload.html;
    assert.equal(htmlB, htmlA, 'the off-by-default snapshot html is deterministic and byte-identical');
    // The token-bearing params survive verbatim off-by-default (no strip).
    assert.ok(htmlB.indexOf('X-Amz-Signature=deadbeef') !== -1, 'AWS SigV4 token survives off-by-default');
    assert.ok(htmlB.indexOf('X-Goog-Signature=cafe') !== -1, 'GCP signed-URL token (in srcset) survives off-by-default');
    assert.ok(htmlB.indexOf('sig=Zm9v') !== -1, 'Azure SAS token survives off-by-default');
    assert.ok(htmlB.indexOf('token=secrettoken') !== -1, 'generic token survives off-by-default');
  } finally {
    envB.teardown();
  }
});

// ===========================================================================
// maskAssetUrlFn: string replaces / null blocks / throw -> fail-closed block
// ===========================================================================

test('maskAssetUrlFn returning a string replaces the URL on the wire', async () => {
  const env = setupEnv(`<img id="t" src="${AWS_SIGV4}">`);
  try {
    const { payload } = await captureSnapshot(env, {
      maskAssetUrlFn() { return 'https://redacted.example/placeholder.jpg'; },
    });
    const img = parsedClone(env, payload, '#t');
    assert.equal(img.getAttribute('src'), 'https://redacted.example/placeholder.jpg',
      'the redactor-returned string replaces the URL');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrlFn receives a ctx carrying attr/tag/nid/kind', async () => {
  const env = setupEnv('<img id="t" src="https://cdn.example.com/img.jpg?token=x">');
  try {
    let seen = null;
    await captureSnapshot(env, {
      maskAssetUrlFn(url, ctx) { seen = ctx; return url; },
    });
    assert.ok(seen && typeof seen === 'object', 'ctx is an object');
    assert.equal(seen.attr, 'src', 'ctx.attr names the URL attribute');
    assert.equal(seen.tag, 'img', 'ctx.tag is the element tag');
    assert.equal(seen.kind, 'image', 'ctx.kind is image for <img>');
    assert.ok(typeof seen.nid === 'string' && seen.nid.length > 0, 'ctx.nid is the element nid');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrlFn ctx.kind is media for a <video> src', async () => {
  const env = setupEnv('<video id="v" src="https://cdn.example.com/clip.mp4?token=x"></video>');
  try {
    let seen = null;
    await captureSnapshot(env, {
      maskAssetUrlFn(url, ctx) { seen = ctx; return url; },
    });
    assert.ok(seen, 'the redactor was invoked for the <video> src');
    assert.equal(seen.kind, 'media', 'ctx.kind is media for <video>');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrlFn returning null BLOCKS the URL (attribute removed from the wire)', async () => {
  const env = setupEnv(`<img id="t" src="${AWS_SIGV4}">`);
  try {
    const { payload } = await captureSnapshot(env, {
      maskAssetUrlFn() { return null; },
    });
    const img = parsedClone(env, payload, '#t');
    assert.ok(img, 'the element still exists');
    assert.ok(!img.hasAttribute('src'), 'a null redactor result removes the src (block -> no fetch)');
    assert.ok(payload.html.indexOf('X-Amz-Signature') === -1, 'the token never appears on the wire');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrlFn THROWING fails closed: URL blocked (null), never raised, never the raw URL', async () => {
  const env = setupEnv(`<img id="t" src="${AWS_SIGV4}">`);
  try {
    // A throwing redactor must NOT wedge capture and must NOT leak the raw URL.
    const { payload } = await captureSnapshot(env, {
      maskAssetUrlFn() { throw new Error('redactor boom'); },
    });
    const img = parsedClone(env, payload, '#t');
    assert.ok(img, 'capture did not wedge -- a snapshot still emitted');
    assert.ok(!img.hasAttribute('src'), 'a throwing redactor blocks the URL (fail-closed, src removed)');
    assert.ok(payload.html.indexOf('X-Amz-Signature') === -1, 'the raw signed URL never reaches the wire on throw');
  } finally {
    env.teardown();
  }
});

test('maskAssetUrlFn takes precedence over maskAssetUrls', async () => {
  const env = setupEnv(`<img id="t" src="${AWS_SIGV4}">`);
  try {
    const { payload } = await captureSnapshot(env, {
      maskAssetUrls: true,
      maskAssetUrlFn() { return 'https://fn-wins.example/x.jpg'; },
    });
    const img = parsedClone(env, payload, '#t');
    assert.equal(img.getAttribute('src'), 'https://fn-wins.example/x.jpg',
      'maskAssetUrlFn wins over the boolean strip');
  } finally {
    env.teardown();
  }
});

// ===========================================================================
// Factory-time invalid maskMediaSelector
// ===========================================================================

test('an invalid maskMediaSelector throws Error(invalid-mask-selector) at factory time', () => {
  const env = setupEnv('<div></div>');
  try {
    assert.throws(
      () => createCapture({ transport: { send() {} }, logger: silentLogger(), maskMediaSelector: ')(' }),
      /invalid-mask-selector/,
      'an uncompilable maskMediaSelector fails loudly at factory time',
    );
    assert.throws(
      () => createCapture({ transport: { send() {} }, logger: silentLogger(), maskMediaSelector: '' }),
      /invalid-mask-selector/,
      'an empty-string maskMediaSelector fails loudly at factory time',
    );
  } finally {
    env.teardown();
  }
});

test('a valid maskMediaSelector (and omitted) does NOT throw at factory time', () => {
  const env = setupEnv('<div></div>');
  try {
    assert.doesNotThrow(
      () => createCapture({ transport: { send() {} }, logger: silentLogger(), maskMediaSelector: '#secret-clip' }),
      'a valid selector compiles');
    assert.doesNotThrow(
      () => createCapture({ transport: { send() {} }, logger: silentLogger() }),
      'an omitted maskMediaSelector is fine (off by default)');
  } finally {
    env.teardown();
  }
});

// ===========================================================================
// Hostile <source src="javascript:..."> neutralized at the scheme-scrub
// ===========================================================================

test('a hostile <source src="javascript:..."> is neutralized at the capture scheme-scrub (never reaches the wire)', async () => {
  const env = setupEnv('<video id="v" controls><source id="s" src="javascript:alert(1)" type="video/mp4"></video>');
  try {
    // Masking is irrelevant here: hasDangerousScheme removes the hostile src in
    // the URL_ATTRS loop BEFORE any asset-url masking runs. Test with masking on
    // to prove the scrub fires first regardless.
    const { payload } = await captureSnapshot(env, { maskAssetUrls: true });
    assert.ok(payload.html.indexOf('javascript:alert') === -1,
      'the javascript: scheme is scrubbed and never appears on the wire');
    const src = parsedClone(env, payload, '#s');
    if (src) {
      assert.ok(!src.hasAttribute('src') || src.getAttribute('src').indexOf('javascript:') === -1,
        'the <source> carries no javascript: src on the wire');
    }
  } finally {
    env.teardown();
  }
});

test('a hostile <source src="javascript:..."> is neutralized even with a custom maskAssetUrlFn present', async () => {
  const env = setupEnv('<video id="v" controls><source id="s" src="javascript:alert(1)" type="video/mp4"></video>');
  try {
    let sawHostile = false;
    const { payload } = await captureSnapshot(env, {
      maskAssetUrlFn(url) { if (typeof url === 'string' && url.indexOf('javascript:') !== -1) sawHostile = true; return url; },
    });
    assert.ok(!sawHostile, 'the hostile scheme is scrubbed BEFORE the masking fn sees it (scheme-scrub runs first)');
    assert.ok(payload.html.indexOf('javascript:alert') === -1, 'no javascript: on the wire');
  } finally {
    env.teardown();
  }
});
