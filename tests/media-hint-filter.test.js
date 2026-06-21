// Phase 14 Plan 01, Task 2: pure manifest-classifier unit tests.
//
// classifyManifest({ url, contentType }) -> 'hls' | 'dash' | null is the pure
// filter both adapters (Playwright page.on('response') / extension webRequest)
// use to decide whether an observed response is an adaptive manifest worth
// emitting as a STREAM.MEDIA_HINT. It is URL-OR-content-type: either an
// .m3u8/.mpd path extension OR a matching content-type classifies; content-type
// is the more robust signal for extensionless/signed CDN manifest URLs.
//
// Project convention: pure helpers return primitives (not the {ok,...} fallible
// shape). The function must NEVER throw -- a malformed/hostile url string is a
// guarded null, so a bad URL can never wedge the adapter (T-14-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyManifest } from '../src/protocol/messages.js';

test('hls by URL extension (.m3u8 path, no content-type)', () => {
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/live/master.m3u8' }), 'hls');
  // Wrong/missing content-type does not override a clear .m3u8 extension (URL-OR).
  assert.equal(
    classifyManifest({ url: 'https://cdn.example.test/live/master.m3u8', contentType: 'text/plain' }),
    'hls'
  );
});

test('hls by content-type (extensionless / signed manifest URL)', () => {
  // application/vnd.apple.mpegurl
  assert.equal(
    classifyManifest({
      url: 'https://cdn.example.test/signed?token=abc',
      contentType: 'application/vnd.apple.mpegurl',
    }),
    'hls'
  );
  // application/x-mpegURL (case-insensitive match)
  assert.equal(
    classifyManifest({ url: 'https://cdn.example.test/p', contentType: 'application/x-mpegURL' }),
    'hls'
  );
  // audio/mpegurl and audio/x-mpegurl
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/p', contentType: 'audio/mpegurl' }), 'hls');
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/p', contentType: 'audio/x-mpegurl' }), 'hls');
  // ;charset suffix tolerated, mixed case tolerated.
  assert.equal(
    classifyManifest({ url: 'https://cdn.example.test/p', contentType: 'Application/VND.Apple.MpegURL; charset=utf-8' }),
    'hls'
  );
});

test('hls by extension with a query string and hash (ignored when parsing the path)', () => {
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/master.m3u8?token=xyz' }), 'hls');
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/master.m3u8#frag' }), 'hls');
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/master.m3u8?token=xyz#frag' }), 'hls');
});

test('dash by URL extension (.mpd path)', () => {
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/dash/manifest.mpd' }), 'dash');
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/dash/manifest.mpd?v=2' }), 'dash');
});

test('dash by content-type (application/dash+xml, extensionless)', () => {
  assert.equal(
    classifyManifest({ url: 'https://cdn.example.test/signed?token=abc', contentType: 'application/dash+xml' }),
    'dash'
  );
  assert.equal(
    classifyManifest({ url: 'https://cdn.example.test/p', contentType: 'APPLICATION/DASH+XML; charset=utf-8' }),
    'dash'
  );
});

test('null for a non-manifest URL with no matching content-type (.mp4, .ts segment, image)', () => {
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/video/clip.mp4' }), null);
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/seg/000123.ts' }), null);
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/img/poster.jpg' }), null);
  // A video content-type that is NOT an adaptive manifest stays null.
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/clip', contentType: 'video/mp4' }), null);
});

test('null for a missing/empty url and content-type', () => {
  assert.equal(classifyManifest({}), null);
  assert.equal(classifyManifest({ url: '', contentType: '' }), null);
  assert.equal(classifyManifest({ url: undefined, contentType: undefined }), null);
  assert.equal(classifyManifest(undefined), null);
  assert.equal(classifyManifest(null), null);
});

test('never throws on a malformed url string (guarded null, not an exception) -- T-14-03', () => {
  assert.doesNotThrow(() => classifyManifest({ url: 'not a url at all ::::' }));
  assert.equal(classifyManifest({ url: 'not a url at all ::::' }), null);
  // A malformed url string that nonetheless contains the extension still classifies
  // via the regex fallback (defensive, mirrors isHlsManifest in 14-RESEARCH).
  assert.equal(classifyManifest({ url: '::::garbage/master.m3u8' }), 'hls');
  assert.equal(classifyManifest({ url: '::::garbage/manifest.mpd' }), 'dash');
  // Non-string url types are tolerated (no throw).
  assert.doesNotThrow(() => classifyManifest({ url: 12345 }));
  assert.equal(classifyManifest({ url: 12345 }), null);
});

test('URL-OR-content-type: each signal independently sufficient', () => {
  // Extension present, content-type absent -> classify by extension.
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/a.m3u8' }), 'hls');
  // Extension absent, content-type present -> classify by content-type.
  assert.equal(
    classifyManifest({ url: 'https://cdn.example.test/a', contentType: 'application/dash+xml' }),
    'dash'
  );
  // Both absent -> null.
  assert.equal(classifyManifest({ url: 'https://cdn.example.test/a' }), null);
});
