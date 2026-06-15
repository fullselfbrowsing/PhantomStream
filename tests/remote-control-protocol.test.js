import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_CONTROL,
  REMOTE_CONTROL_STATE,
  createRemoteControlStateEvent,
  isRemoteControlType,
  summarizeRemoteControlAction,
  validateRemoteControlMessage,
} from '../src/protocol/index.js';
import { createRelay } from '../src/relay/index.js';

function fakeSocket(name) {
  return {
    name,
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send(raw) {
      this.sent.push(raw);
    },
  };
}

test('remote-control protocol constants use PhantomStream wire names', () => {
  assert.deepEqual(REMOTE_CONTROL, {
    REQUEST: 'dash:ps-control-request',
    STOP: 'dash:ps-control-stop',
    CLICK: 'dash:ps-control-click',
    TEXT: 'dash:ps-control-text',
    KEY: 'dash:ps-control-key',
    SCROLL: 'dash:ps-control-scroll',
    STATE: 'ext:ps-control-state',
  });

  assert.deepEqual(REMOTE_CONTROL_STATE, {
    LOCKED: 'locked',
    REQUESTING: 'requesting',
    ACTIVE: 'active',
    DENIED: 'denied',
    STOPPED: 'stopped',
  });
});

test('remote-control constants do not expose legacy reference route names', () => {
  const legacy = new Set([
    'dash:remote-click',
    'dash:remote-key',
    'dash:remote-scroll',
    'dash:remote-control-start',
    'dash:remote-control-stop',
  ]);

  for (const value of Object.values(REMOTE_CONTROL)) {
    assert.equal(legacy.has(value), false);
  }
});

test('remote-control type predicate recognizes only control frame types', () => {
  assert.equal(isRemoteControlType(REMOTE_CONTROL.REQUEST), true);
  assert.equal(isRemoteControlType(REMOTE_CONTROL.CLICK), true);
  assert.equal(isRemoteControlType(REMOTE_CONTROL.TEXT), true);
  assert.equal(isRemoteControlType(REMOTE_CONTROL.KEY), true);
  assert.equal(isRemoteControlType(REMOTE_CONTROL.SCROLL), true);
  assert.equal(isRemoteControlType(REMOTE_CONTROL.STOP), true);
  assert.equal(isRemoteControlType(REMOTE_CONTROL.STATE), true);
  assert.equal(isRemoteControlType('ext:dom-snapshot'), false);
  assert.equal(isRemoteControlType('dash:ps-control-hover'), false);
});

test('validators normalize valid control payloads without copying content fields', () => {
  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.CLICK, {
      x: 12.5,
      y: 40,
      button: 'left',
      clickCount: 2,
      html: '<button>secret</button>',
    }),
    {
      ok: true,
      action: {
        type: REMOTE_CONTROL.CLICK,
        kind: 'click',
        x: 12.5,
        y: 40,
        button: 'left',
        clickCount: 2,
      },
    }
  );

  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.SCROLL, {
      x: 10,
      y: 11,
      deltaX: 0,
      deltaY: 125,
      attrs: { value: 'secret' },
    }),
    {
      ok: true,
      action: {
        type: REMOTE_CONTROL.SCROLL,
        kind: 'scroll',
        x: 10,
        y: 11,
        deltaX: 0,
        deltaY: 125,
      },
    }
  );

  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.KEY, {
      key: 'Enter',
      event: 'down',
      text: 'must not be copied',
    }),
    {
      ok: true,
      action: {
        type: REMOTE_CONTROL.KEY,
        kind: 'key',
        key: 'Enter',
        event: 'down',
      },
    }
  );
});

test('validators reject malformed remote-control payloads before replay', () => {
  assert.deepEqual(
    validateRemoteControlMessage('dash:ps-control-hover', { x: 1, y: 2 }),
    { ok: false, error: 'remote-type-unsupported' }
  );
  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.CLICK, { x: Number.POSITIVE_INFINITY, y: 2 }),
    { ok: false, error: 'remote-coordinate-invalid' }
  );
  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.CLICK, { x: -1, y: 2 }),
    { ok: false, error: 'remote-coordinate-invalid' }
  );
  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.SCROLL, { x: 1, y: 2, deltaX: 0, deltaY: NaN }),
    { ok: false, error: 'remote-coordinate-invalid' }
  );
  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.CLICK, { x: 1, y: 2, button: 'primary' }),
    { ok: false, error: 'remote-button-invalid' }
  );
  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.KEY, { key: 'Enter', event: 'press' }),
    { ok: false, error: 'remote-key-event-invalid' }
  );
  assert.deepEqual(
    validateRemoteControlMessage(REMOTE_CONTROL.TEXT, { text: 'x'.repeat(4097) }),
    { ok: false, error: 'remote-text-too-long' }
  );
});

test('text action summaries expose character counts instead of printable text', () => {
  const payload = { text: 'typed printable text' };
  const summary = summarizeRemoteControlAction(REMOTE_CONTROL.TEXT, payload);

  assert.deepEqual(summary, {
    type: REMOTE_CONTROL.TEXT,
    kind: 'text',
    chars: payload.text.length,
  });
  assert.equal(JSON.stringify(summary).includes(payload.text), false);
});

test('state events expose only state reason and counts', () => {
  const state = createRemoteControlStateEvent(REMOTE_CONTROL_STATE.DENIED, 'authorization-denied', {
    counts: { requested: 3, denied: 2 },
    html: '<main>secret</main>',
    text: 'secret',
    attrs: { value: 'secret' },
    payload: { text: 'secret' },
    url: 'https://secret.example/',
    title: 'secret title',
  });

  assert.deepEqual(state, {
    state: 'denied',
    reason: 'authorization-denied',
    counts: { requested: 3, denied: 2 },
  });
});

test('relay fans out remote-control frames byte-identically without execution', () => {
  const relay = createRelay({ now: () => 1000 });
  const viewer = fakeSocket('viewer');
  const sourceA = fakeSocket('source-a');
  const sourceB = fakeSocket('source-b');
  const raw = JSON.stringify({
    type: REMOTE_CONTROL.CLICK,
    payload: { x: 25, y: 30, button: 'left' },
  });

  relay.addClient({ roomId: 'room-a', role: 'viewer', socket: viewer });
  relay.addClient({ roomId: 'room-a', role: 'source', socket: sourceA });
  relay.addClient({ roomId: 'room-a', role: 'source', socket: sourceB });

  const result = relay.receive({ roomId: 'room-a', role: 'viewer', socket: viewer, raw });

  assert.deepEqual(sourceA.sent, [raw]);
  assert.deepEqual(sourceB.sent, [raw]);
  assert.equal(result.deliveredCount, 2);
});
