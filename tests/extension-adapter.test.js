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

function createFakeChrome(initialSession = {}) {
  const runtimeMessage = createEvent();
  const alarmEvent = createEvent();
  const storageData = { ...initialSession };
  const tabMessages = [];
  const runtimeMessages = [];
  const alarmCreates = [];

  return {
    storageData,
    tabMessages,
    runtimeMessages,
    alarmCreates,
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
