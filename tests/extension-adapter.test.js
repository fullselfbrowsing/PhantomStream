import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL,
  STREAM,
} from '../src/protocol/messages.js';
import {
  createExtensionAdapter,
  createExtensionContentBridge,
  PHANTOMSTREAM_SESSION_KEY,
  PHANTOMSTREAM_WATCHDOG_ALARM,
} from '../src/adapters/extension.js';

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(fn) {
      listeners.push(fn);
    },
    removeListener(fn) {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    async emit(...args) {
      const results = [];
      for (const listener of [...listeners]) {
        results.push(await listener(...args));
      }
      return results;
    }
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createFakeChrome(initialSession = {}, { webRequest = true } = {}) {
  const runtimeMessage = createEvent();
  const alarmEvent = createEvent();
  const completedEvent = createEvent();
  const storageData = { ...initialSession };
  const tabMessages = [];
  const runtimeMessages = [];
  const alarmCreates = [];
  const webRequestFilters = [];

  const chrome = {
    storageData,
    tabMessages,
    runtimeMessages,
    alarmCreates,
    webRequestFilters,
    completedEvent,
    runtime: {
      onMessage: runtimeMessage,
      sendMessage(message) {
        runtimeMessages.push(clone(message));
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      session: {
        async get(key) {
          if (typeof key === 'string') return { [key]: clone(storageData[key]) };
          if (Array.isArray(key)) {
            return key.reduce((out, item) => {
              out[item] = clone(storageData[item]);
              return out;
            }, {});
          }
          return clone(storageData);
        },
        async set(values) {
          Object.assign(storageData, clone(values));
        },
        async remove(key) {
          delete storageData[key];
        }
      }
    },
    alarms: {
      onAlarm: alarmEvent,
      create(name, info) {
        alarmCreates.push({ name, info: clone(info) });
        return Promise.resolve();
      }
    },
    tabs: {
      sendMessage(tabId, message) {
        tabMessages.push({ tabId, message: clone(message) });
        return Promise.resolve({ ok: true });
      }
    },
    scripting: {
      executeScript() {
        return Promise.resolve([]);
      }
    }
  };

  if (webRequest) {
    chrome.webRequest = {
      onCompleted: {
        addListener(fn, filter, extraInfoSpec) {
          webRequestFilters.push({ filter: clone(filter), extraInfoSpec: clone(extraInfoSpec) });
          completedEvent.addListener(fn);
        },
        removeListener(fn) {
          completedEvent.removeListener(fn);
        }
      }
    };
  }

  return chrome;
}

// Build a synthetic webRequest.onCompleted details object. responseHeaders is
// the Chromium array-of-{name,value} shape; header names may be any casing.
// `tabId` mirrors the Chromium details.tabId field (omitted when undefined).
function fakeDetails(url, contentType, tabId) {
  const responseHeaders = [];
  if (typeof contentType === 'string') {
    responseHeaders.push({ name: 'Content-Type', value: contentType });
  }
  const details = { url, responseHeaders, statusCode: 200, type: 'media' };
  if (typeof tabId === 'number') details.tabId = tabId;
  return details;
}

function lastHint(transport) {
  const hints = transport.sent.filter((entry) => entry.type === STREAM.MEDIA_HINT);
  return hints.length ? hints[hints.length - 1].payload : null;
}

function createTransport() {
  const sent = [];
  return {
    sent,
    send(type, payload) {
      sent.push({ type, payload: clone(payload || {}) });
    }
  };
}

// Mirrors createWebSocketTransport's onMessage contract: handlers are invoked
// as (type, payload), and onMessage returns an unsubscribe function.
function createTransportWithOnMessage() {
  const sent = [];
  const handlers = new Set();
  return {
    sent,
    send(type, payload) {
      sent.push({ type, payload: clone(payload || {}) });
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async emit(type, payload) {
      for (const handler of [...handlers]) {
        await handler(type, clone(payload || {}));
      }
    }
  };
}

function hasForbiddenStoredKey(value, forbidden) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some((key) => {
    if (forbidden.has(key)) return true;
    return hasForbiddenStoredKey(value[key], forbidden);
  });
}

test('factory validates required Chromium MV3 APIs', () => {
  assert.throws(() => createExtensionAdapter(), /extension-chrome-required/);
  assert.throws(() => createExtensionAdapter({ chrome: {} }), /extension-runtime-required/);
  assert.throws(() => createExtensionAdapter({
    chrome: { runtime: { onMessage: createEvent() } }
  }), /extension-storage-session-required/);
  assert.throws(() => createExtensionAdapter({
    chrome: {
      runtime: { onMessage: createEvent() },
      storage: { session: { get() {}, set() {} } }
    }
  }), /extension-alarms-required/);
});

test('install registers runtime and watchdog listeners synchronously', () => {
  const chrome = createFakeChrome();
  const adapter = createExtensionAdapter({ chrome, transport: createTransport() });
  const installed = adapter.install();

  assert.equal(chrome.runtime.onMessage.listeners.length, 1);
  assert.equal(chrome.alarms.onAlarm.listeners.length, 1);

  return installed;
});

test('content bridge forwards page messages through chrome.runtime.sendMessage', () => {
  const source = createExtensionContentBridge();

  assert.equal(typeof source, 'string');
  assert.match(source, /window\.__phantomStreamBridge/);
  assert.match(source, /chrome\.runtime\.sendMessage/);
  assert.match(source, /phantomstream:bridge/);
});

test('stream frames forward to transport without persisting payload content', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  const adapter = createExtensionAdapter({ chrome, transport, now: () => 101 });
  await adapter.install();

  await chrome.runtime.onMessage.emit({
    type: 'phantomstream:bridge',
    message: {
      type: STREAM.SNAPSHOT,
      payload: {
        html: '<main>secret</main>',
        text: 'secret',
        attrs: { title: 'secret' },
        payload: { nested: true },
        url: 'https://example.test/private',
        title: 'Private'
      }
    }
  }, { tab: { id: 9 } });

  assert.deepEqual(transport.sent, [{
    type: STREAM.SNAPSHOT,
    payload: {
      html: '<main>secret</main>',
      text: 'secret',
      attrs: { title: 'secret' },
      payload: { nested: true },
      url: 'https://example.test/private',
      title: 'Private'
    }
  }]);
  assert.equal(chrome.storageData[PHANTOMSTREAM_SESSION_KEY], undefined);
});

test('CONTROL.START stores only content-free stream intent in chrome.storage.session', async () => {
  const chrome = createFakeChrome();
  const adapter = createExtensionAdapter({ chrome, transport: createTransport(), now: () => 202 });
  await adapter.install();

  await chrome.runtime.onMessage.emit({
    type: 'phantomstream:control',
    message: {
      type: CONTROL.START,
      payload: {
        roomKey: 'room-local',
        wsUrl: 'ws://127.0.0.1:4321/ws?room=room-local&role=source',
        tabId: 12,
        html: '<main>do-not-store</main>',
        text: 'do-not-store',
        attrs: { title: 'do-not-store' },
        payload: { html: 'do-not-store' },
        url: 'https://example.test/source',
        title: 'Source'
      }
    }
  }, { tab: { id: 12 } });

  const stored = chrome.storageData[PHANTOMSTREAM_SESSION_KEY];
  assert.deepEqual(stored, {
    roomKey: 'room-local',
    wsUrl: 'ws://127.0.0.1:4321/ws?room=room-local&role=source',
    tabId: 12,
    streamingActive: true,
    lifecycleIntent: CONTROL.START,
    pendingResnapshotReason: null,
    updatedAt: 202
  });
  assert.equal(hasForbiddenStoredKey(stored, new Set(['html', 'text', 'attrs', 'payload', 'url', 'title'])), false);
  assert.deepEqual(chrome.tabMessages.at(-1), {
    tabId: 12,
    message: {
      type: 'phantomstream:control',
      message: {
        type: CONTROL.START,
        payload: {
          roomKey: 'room-local',
          wsUrl: 'ws://127.0.0.1:4321/ws?room=room-local&role=source',
          tabId: 12,
          html: '<main>do-not-store</main>',
          text: 'do-not-store',
          attrs: { title: 'do-not-store' },
          payload: { html: 'do-not-store' },
          url: 'https://example.test/source',
          title: 'Source'
        }
      }
    }
  });
});

test('watchdog alarm rehydrates active state and requests a fresh snapshot', async () => {
  const initialState = {
    [PHANTOMSTREAM_SESSION_KEY]: {
      roomKey: 'room-recover',
      wsUrl: 'ws://127.0.0.1:3333/ws?room=room-recover&role=source',
      tabId: 41,
      streamingActive: true,
      lifecycleIntent: CONTROL.START,
      pendingResnapshotReason: null,
      updatedAt: 303
    }
  };
  const chrome = createFakeChrome(initialState);
  const adapter = createExtensionAdapter({ chrome, transport: createTransport(), now: () => 404 });
  await adapter.install();

  await chrome.alarms.onAlarm.emit({ name: PHANTOMSTREAM_WATCHDOG_ALARM });

  assert.equal(chrome.alarmCreates[0].name, PHANTOMSTREAM_WATCHDOG_ALARM);
  assert.deepEqual(chrome.tabMessages.at(-1), {
    tabId: 41,
    message: {
      type: 'phantomstream:control',
      message: {
        type: CONTROL.START,
        payload: {
          roomKey: 'room-recover',
          wsUrl: 'ws://127.0.0.1:3333/ws?room=room-recover&role=source',
          tabId: 41,
          reason: 'mv3-watchdog-resnapshot'
        }
      }
    }
  });
  assert.equal(chrome.storageData[PHANTOMSTREAM_SESSION_KEY].pendingResnapshotReason, 'mv3-watchdog-resnapshot');
});

test('transport-delivered (type, payload) CONTROL frames are persisted and forwarded', async () => {
  const chrome = createFakeChrome();
  const transport = createTransportWithOnMessage();
  const adapter = createExtensionAdapter({ chrome, transport, now: () => 707 });
  await adapter.install();

  // createWebSocketTransport dispatches viewer-originated frames as (type, payload).
  // This emit is the ONLY trigger — it must persist intent and forward to the tab.
  await transport.emit(CONTROL.START, {
    roomKey: 'room-ws',
    wsUrl: 'ws://127.0.0.1:5555/ws?room=room-ws&role=source',
    tabId: 88
  });

  const stored = chrome.storageData[PHANTOMSTREAM_SESSION_KEY];
  assert.deepEqual(stored, {
    roomKey: 'room-ws',
    wsUrl: 'ws://127.0.0.1:5555/ws?room=room-ws&role=source',
    tabId: 88,
    streamingActive: true,
    lifecycleIntent: CONTROL.START,
    pendingResnapshotReason: null,
    updatedAt: 707
  });
  assert.deepEqual(chrome.tabMessages.at(-1), {
    tabId: 88,
    message: {
      type: 'phantomstream:control',
      message: {
        type: CONTROL.START,
        payload: {
          roomKey: 'room-ws',
          wsUrl: 'ws://127.0.0.1:5555/ws?room=room-ws&role=source',
          tabId: 88
        }
      }
    }
  });

  // A subsequent STOP frame delivered the same way flips streaming off.
  await transport.emit(CONTROL.STOP, { tabId: 88 });
  assert.equal(chrome.storageData[PHANTOMSTREAM_SESSION_KEY].streamingActive, false);
  assert.equal(chrome.storageData[PHANTOMSTREAM_SESSION_KEY].lifecycleIntent, CONTROL.STOP);
});

test('new adapter instance recovers stream state from storage without module globals', async () => {
  const chrome = createFakeChrome();
  const first = createExtensionAdapter({ chrome, transport: createTransport(), now: () => 505 });
  await first.install();
  await chrome.runtime.onMessage.emit({
    type: 'phantomstream:control',
    message: {
      type: CONTROL.START,
      payload: {
        roomKey: 'room-restart',
        wsUrl: 'ws://127.0.0.1:2222/ws?room=room-restart&role=source',
        tabId: 77
      }
    }
  }, { tab: { id: 77 } });
  first.dispose();
  chrome.tabMessages.length = 0;

  const second = createExtensionAdapter({ chrome, transport: createTransport(), now: () => 606 });
  await second.install();
  await chrome.alarms.onAlarm.emit({ name: PHANTOMSTREAM_WATCHDOG_ALARM });

  assert.deepEqual(chrome.tabMessages.at(-1), {
    tabId: 77,
    message: {
      type: 'phantomstream:control',
      message: {
        type: CONTROL.START,
        payload: {
          roomKey: 'room-restart',
          wsUrl: 'ws://127.0.0.1:2222/ws?room=room-restart&role=source',
          tabId: 77,
          reason: 'mv3-watchdog-resnapshot'
        }
      }
    }
  });
});

// --- Opt-in manifest discovery (MADPT-02, Plan 14-04) -----------------------

test('discovery off by default: no webRequest listener and no media hint', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  const adapter = createExtensionAdapter({ chrome, transport });
  await adapter.install();

  assert.equal(chrome.completedEvent.listeners.length, 0, 'no opt-in -> no webRequest listener');

  // Even a fired manifest details produces nothing (no listener attached).
  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/master.m3u8', 'application/vnd.apple.mpegurl'));
  assert.equal(transport.sent.some((entry) => entry.type === STREAM.MEDIA_HINT), false);
});

test('validateChrome does not require webRequest when discovery is off', () => {
  // chrome WITHOUT webRequest still constructs fine when discovery is not opted in.
  const chrome = createFakeChrome({}, { webRequest: false });
  assert.equal(chrome.webRequest, undefined);
  assert.doesNotThrow(() => createExtensionAdapter({ chrome, transport: createTransport() }));
});

test('opt-in .m3u8 details emits a page-scope HLS hint', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  const adapter = createExtensionAdapter({ chrome, transport, discoverManifests: true });
  await adapter.install();

  assert.equal(chrome.completedEvent.listeners.length, 1, 'opt-in registers a webRequest.onCompleted listener');
  assert.ok(chrome.webRequestFilters.length >= 1, 'listener is registered with a url filter');
  assert.ok(
    Array.isArray(chrome.webRequestFilters[0].extraInfoSpec)
    && chrome.webRequestFilters[0].extraInfoSpec.includes('responseHeaders'),
    'listener requests responseHeaders'
  );

  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/live/master.m3u8?token=xyz'));

  const hint = lastHint(transport);
  assert.ok(hint, 'opt-in .m3u8 details emits STREAM.MEDIA_HINT');
  assert.equal(hint.kind, 'hls');
  assert.equal(hint.manifestUrl, 'https://cdn.test/live/master.m3u8?token=xyz');
  assert.equal(hint.scope, 'page');
  assert.equal(Object.prototype.hasOwnProperty.call(hint, 'nid'), false);
  assert.equal(typeof hint.streamSessionId, 'string');
  assert.equal(typeof hint.snapshotId, 'number');
});

test('opt-in dash+xml content-type emits a DASH hint by header', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  const adapter = createExtensionAdapter({ chrome, transport, discoverManifests: true });
  await adapter.install();

  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/signed/stream', 'application/dash+xml'));

  const hint = lastHint(transport);
  assert.ok(hint, 'dash content-type emits a hint without a .mpd extension');
  assert.equal(hint.kind, 'dash');
  assert.equal(hint.contentType, 'application/dash+xml');
});

test('opt-in non-manifest details emit no hint', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  const adapter = createExtensionAdapter({ chrome, transport, discoverManifests: true });
  await adapter.install();

  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/clip.mp4', 'video/mp4'));
  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/poster.jpg', 'image/jpeg'));

  assert.equal(transport.sent.some((entry) => entry.type === STREAM.MEDIA_HINT), false);
});

test('opt-in single-active correlation yields an element-scope hint', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  let activeNid = null;
  const adapter = createExtensionAdapter({
    chrome,
    transport,
    discoverManifests: true,
    resolveActiveMediaNid: () => activeNid,
  });
  await adapter.install();

  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/a.m3u8'));
  let hint = lastHint(transport);
  assert.equal(hint.scope, 'page');
  assert.equal(Object.prototype.hasOwnProperty.call(hint, 'nid'), false);

  activeNid = '88';
  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/b.m3u8'));
  hint = lastHint(transport);
  assert.equal(hint.scope, 'element');
  assert.equal(hint.nid, '88');
});

test('opt-in hint carries the most recently forwarded stream identity', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  const adapter = createExtensionAdapter({ chrome, transport, discoverManifests: true });
  await adapter.install();

  // A forwarded STREAM bridge frame carries identity the adapter snoops.
  await chrome.runtime.onMessage.emit({
    type: 'phantomstream:bridge',
    message: {
      type: STREAM.SNAPSHOT,
      payload: { streamSessionId: 'stream_ext_1', snapshotId: 1234, html: '<main>x</main>' }
    }
  }, { tab: { id: 5 } });

  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/master.m3u8'));

  const hint = lastHint(transport);
  assert.equal(hint.streamSessionId, 'stream_ext_1');
  assert.equal(hint.snapshotId, 1234);
});

test('opt-in degrades gracefully when chrome.webRequest is absent', async () => {
  const chrome = createFakeChrome({}, { webRequest: false });
  const transport = createTransport();
  // Opt-in is requested but the permission/API is missing: construct + install
  // must not throw, no listener is attached, and no hint is ever emitted.
  let adapter;
  assert.doesNotThrow(() => {
    adapter = createExtensionAdapter({ chrome, transport, discoverManifests: true });
  });
  await adapter.install();
  assert.equal(transport.sent.some((entry) => entry.type === STREAM.MEDIA_HINT), false);
});

test('dispose removes the webRequest listener', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  const adapter = createExtensionAdapter({ chrome, transport, discoverManifests: true });
  await adapter.install();
  assert.equal(chrome.completedEvent.listeners.length, 1);

  adapter.dispose();
  assert.equal(chrome.completedEvent.listeners.length, 0, 'dispose unregisters the manifest listener');
});

test('opt-in drops a manifest from an UNRELATED tab and re-scopes the filter to the streamed tab', async () => {
  const chrome = createFakeChrome();
  const transport = createTransport();
  const adapter = createExtensionAdapter({ chrome, transport, discoverManifests: true, now: () => 808 });
  await adapter.install();

  // Before the streamed tab id is known, the broad <all_urls> filter is used
  // and a details object with no tabId is still observed (graceful prior path).
  assert.equal(chrome.webRequestFilters.length, 1, 'one filter at install time');
  assert.equal(chrome.webRequestFilters[0].filter.tabId, undefined, 'broad filter has no tabId yet');
  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/pre/master.m3u8'));
  assert.ok(lastHint(transport), 'a no-tabId manifest is observed before the streamed tab is known');

  // A CONTROL.START establishes the streamed tab id (= 7); the observer
  // re-registers with a tab-scoped filter.
  await chrome.runtime.onMessage.emit({
    type: 'phantomstream:control',
    message: { type: CONTROL.START, payload: { roomKey: 'r', wsUrl: 'ws://127.0.0.1:1/ws', tabId: 7 } }
  }, { tab: { id: 7 } });
  assert.equal(chrome.completedEvent.listeners.length, 1, 'exactly one listener after re-scope');
  assert.equal(chrome.webRequestFilters.at(-1).filter.tabId, 7, 'filter re-scoped to the streamed tab id');

  // A manifest fetched in an UNRELATED tab (tabId 99) is dropped.
  const before = transport.sent.filter((e) => e.type === STREAM.MEDIA_HINT).length;
  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/other-tab/master.m3u8', undefined, 99));
  const afterUnrelated = transport.sent.filter((e) => e.type === STREAM.MEDIA_HINT).length;
  assert.equal(afterUnrelated, before, 'a manifest from an unrelated tab emits no hint');

  // A manifest fetched in the STREAMED tab (tabId 7) is observed.
  await chrome.completedEvent.emit(fakeDetails('https://cdn.test/streamed-tab/master.m3u8', undefined, 7));
  const hint = lastHint(transport);
  assert.equal(hint.manifestUrl, 'https://cdn.test/streamed-tab/master.m3u8', 'the streamed-tab manifest is observed');
});
