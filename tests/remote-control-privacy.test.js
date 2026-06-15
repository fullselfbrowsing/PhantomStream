import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_CONTROL,
  REMOTE_CONTROL_STATE,
  createRemoteControlStateEvent,
  summarizeRemoteControlAction,
} from '../src/protocol/index.js';

const SECRET_TEXT = 'secret typed words';
const FORBIDDEN_KEYS = ['html', 'text', 'attrs', 'payload', 'url', 'title'];

function assertContentFree(value) {
  const serialized = JSON.stringify(value);

  assert.equal(serialized.includes(SECRET_TEXT), false);
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(Object.hasOwn(value, key), false);
    assert.equal(serialized.includes('"' + key + '"'), false);
  }
}

test('text summaries contain character counts and never typed printable text', () => {
  const summary = summarizeRemoteControlAction(REMOTE_CONTROL.TEXT, {
    text: SECRET_TEXT,
    payload: { text: SECRET_TEXT },
  });

  assert.deepEqual(summary, {
    type: REMOTE_CONTROL.TEXT,
    kind: 'text',
    chars: SECRET_TEXT.length,
  });
  assertContentFree(summary);
});

test('click summaries omit mirrored content fields from noisy payloads', () => {
  const summary = summarizeRemoteControlAction(REMOTE_CONTROL.CLICK, {
    x: 10,
    y: 20,
    button: 'left',
    clickCount: 1,
    html: '<button>secret typed words</button>',
    text: SECRET_TEXT,
    attrs: { value: SECRET_TEXT },
    payload: { text: SECRET_TEXT },
    url: 'https://secret.example/?q=' + encodeURIComponent(SECRET_TEXT),
    title: SECRET_TEXT,
  });

  assert.deepEqual(summary, {
    type: REMOTE_CONTROL.CLICK,
    kind: 'click',
    x: 10,
    y: 20,
    button: 'left',
    clickCount: 1,
  });
  assertContentFree(summary);
});

test('state events whitelist state reason and numeric counts only', () => {
  const state = createRemoteControlStateEvent(REMOTE_CONTROL_STATE.ACTIVE, 'authorization-approved', {
    counts: {
      requested: 2,
      approved: 1,
      rejected: Number.NaN,
      label: SECRET_TEXT,
    },
    html: '<input value="secret typed words">',
    text: SECRET_TEXT,
    attrs: { value: SECRET_TEXT },
    payload: { text: SECRET_TEXT },
    url: 'https://secret.example/?text=' + encodeURIComponent(SECRET_TEXT),
    title: SECRET_TEXT,
  });

  assert.deepEqual(state, {
    state: 'active',
    reason: 'authorization-approved',
    counts: {
      requested: 2,
      approved: 1,
    },
  });
  assertContentFree(state);
});
