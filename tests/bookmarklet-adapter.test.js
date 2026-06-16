import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BOOKMARKLET_ERROR_EVENT,
  createBookmarkletLoaderSource,
  createBookmarkletSource,
} from '../src/adapters/bookmarklet.js';

test('generated bookmarklet source is single-line and embeds encoded connection config', () => {
  const scriptUrl = 'https://127.0.0.1:3456/bookmarklet-loader.js';
  const wsUrl = 'ws://127.0.0.1:3456/ws?room=room-one&role=source';
  const source = createBookmarkletSource({
    scriptUrl,
    wsUrl,
    roomKey: 'room-one'
  });

  assert.equal(source.startsWith('javascript:(()=>{'), true);
  assert.equal(source.includes('\n'), false);
  assert.match(source, /document\.createElement\("script"\)/);
  assert.match(source, /script-load-failed/);
  assert.equal(source.includes(encodeURIComponent(scriptUrl)), true);
  assert.equal(source.includes(encodeURIComponent(wsUrl)), true);
  assert.equal(source.includes(encodeURIComponent('room-one')), true);
  assert.equal(source.includes('eval('), false);
  assert.equal(source.includes('Function('), false);
});

test('bookmarklet source validates script and websocket URL schemes', () => {
  assert.throws(() => createBookmarkletSource({
    scriptUrl: '',
    wsUrl: 'ws://127.0.0.1:3456/ws'
  }), /bookmarklet-script-url-required/);
  assert.throws(() => createBookmarkletSource({
    scriptUrl: 'javascript:alert(1)',
    wsUrl: 'ws://127.0.0.1:3456/ws'
  }), /bookmarklet-script-url-required/);
  assert.throws(() => createBookmarkletSource({
    scriptUrl: 'https://127.0.0.1:3456/bookmarklet-loader.js',
    wsUrl: 'https://127.0.0.1:3456/ws'
  }), /bookmarklet-ws-url-required/);
});

test('loader source installs bridge and visible content-free failure path', () => {
  const loader = createBookmarkletLoaderSource({
    browserInjectSource: 'window.__phantomStreamStart=function(){return true;}'
  });

  assert.equal(BOOKMARKLET_ERROR_EVENT, 'phantomstream:bookmarklet-error');
  assert.match(loader, /window\.__phantomStreamBridge/);
  assert.match(loader, /createWebSocketTransport/);
  assert.match(loader, /phantomStreamBrowserInjectSource/);
  assert.match(loader, new RegExp(BOOKMARKLET_ERROR_EVENT));
  assert.match(loader, /script-load-failed/);
  assert.match(loader, /invalid-ws-url/);
  assert.equal(loader.includes('eval('), false);
  assert.equal(loader.includes('Function('), false);
});

test('bookmarklet adapter source never introduces eval or Function execution', async () => {
  const source = await readFile(new URL('../src/adapters/bookmarklet.js', import.meta.url), 'utf8');

  assert.equal(source.includes('eval('), false);
  assert.equal(source.includes('Function('), false);
});
