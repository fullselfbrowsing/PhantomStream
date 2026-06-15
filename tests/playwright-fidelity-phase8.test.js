import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPlaywrightAdapter } from '../src/adapters/playwright.js';
import { CONTROL, STREAM } from '../src/protocol/messages.js';

const INJECT_PATH = fileURLToPath(new URL('../src/adapters/playwright-inject.js', import.meta.url));

async function withCapturePage(run) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const messages = [];
  await page.exposeFunction('__phantomStreamBridge', (message) => {
    messages.push(message);
    return { ok: true };
  });
  try {
    await run({ page, messages });
  } finally {
    await browser.close();
  }
}

function createAdapterTransport(messages) {
  const handlers = new Set();
  return {
    send(type, payload) {
      messages.push({ type, payload: payload || {} });
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit(type, payload) {
      for (const handler of handlers) handler(type, payload || {});
    },
  };
}

async function withAdapterCapturePage(run) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const messages = [];
  const transport = createAdapterTransport(messages);
  const adapter = createPlaywrightAdapter({ page, transport });
  try {
    await adapter.install();
    await run({ page, messages, transport, adapter });
  } finally {
    adapter.dispose();
    await browser.close();
  }
}

async function installCheckedInInjectArtifact(page) {
  await page.addScriptTag({ path: INJECT_PATH });
}

async function waitForMessage(messages, predicate, label) {
  for (let i = 0; i < 100; i++) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for ' + label);
}

async function waitForNewMessage(messages, startIndex, predicate, label) {
  for (let i = 0; i < 100; i++) {
    const found = messages.slice(startIndex).find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for ' + label);
}

function countOccurrences(value, needle) {
  return String(value || '').split(needle).length - 1;
}

function frameFor(frames, nid) {
  return (frames || []).find((frame) => frame && (frame.nid === nid || frame.frameNid === nid));
}

test('Chromium open shadow roots preserve default/named slots and slot reassignment without duplicate slotted text', async () => {
  await withCapturePage(async ({ page, messages }) => {
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <article id="shadow-host">
            <span id="slot-title" slot="title">Named title</span>
            <span id="default-copy">Default light text</span>
          </article>
          <script>
            const host = document.getElementById('shadow-host');
            const root = host.attachShadow({ mode: 'open' });
            root.innerHTML = '<header><slot name="title"></slot></header><main><slot></slot></main><footer><slot name="body"></slot></footer>';
          </script>
        </body>
      </html>
    `, { waitUntil: 'load' });
    await installCheckedInInjectArtifact(page);
    await waitForMessage(messages, (m) => m.type === STREAM.SNAPSHOT, 'initial snapshot');
    const hostNid = await page.evaluate(() => window.__phantomStreamGetNodeId(
      document.getElementById('shadow-host')
    ));

    const baseline = messages.length;
    await page.evaluate(() => {
      document.getElementById('slot-title').setAttribute('slot', 'body');
      window.__phantomStreamStart();
    });
    const snapshot = await waitForNewMessage(
      messages,
      baseline,
      (m) => m.type === STREAM.SNAPSHOT,
      'post-reassignment snapshot'
    );

    assert.ok(hostNid, 'shadow host has a public capture nid');
    assert.ok(Array.isArray(snapshot.payload.shadowRoots), 'snapshot carries shadowRoots sidecar');
    const shadow = snapshot.payload.shadowRoots.find((entry) => entry && entry.hostNid === hostNid);
    assert.ok(shadow, 'shadow root payload is keyed by host nid');
    assert.match(shadow.html, /<slot name="body"|<slot name="title"|<slot>/,
      'shadow payload preserves slot elements');
    assert.ok(Array.isArray(shadow.nodeIds) && shadow.nodeIds.length > 0,
      'shadow descendants carry nodeIds');
    assert.equal(
      shadow.html.includes('Default light text'),
      false,
      'default slotted light-DOM text is not duplicated into shadow html'
    );
    assert.equal(
      shadow.html.includes('Named title'),
      false,
      'named slotted light-DOM text is not duplicated into shadow html'
    );
    const combinedWire = snapshot.payload.html + shadow.html;
    assert.equal(countOccurrences(combinedWire, 'Default light text'), 1);
    assert.equal(countOccurrences(combinedWire, 'Named title'), 1);
  });
});

test('Chromium iframe capture mirrors same-origin content and labels inaccessible frames content-free', async () => {
  await withCapturePage(async ({ page, messages }) => {
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <iframe id="same-frame" srcdoc="<main><h1 id='inside'>Same origin frame</h1><button>Frame button</button></main>"></iframe>
          <iframe id="opaque-frame" sandbox srcdoc="<main><h1>Opaque frame secret</h1></main>"></iframe>
        </body>
      </html>
    `, { waitUntil: 'load' });
    await page.waitForSelector('#same-frame');
    await page.waitForSelector('#opaque-frame');
    await installCheckedInInjectArtifact(page);
    const snapshot = await waitForMessage(messages, (m) => m.type === STREAM.SNAPSHOT, 'iframe snapshot');
    const ids = await page.evaluate(() => ({
      same: window.__phantomStreamGetNodeId(document.getElementById('same-frame')),
      opaque: window.__phantomStreamGetNodeId(document.getElementById('opaque-frame')),
    }));

    assert.ok(ids.same && ids.opaque, 'iframe elements are addressable');
    assert.ok(Array.isArray(snapshot.payload.frames), 'snapshot carries frames sidecar');
    const sameFrame = frameFor(snapshot.payload.frames, ids.same);
    const opaqueFrame = frameFor(snapshot.payload.frames, ids.opaque);
    assert.ok(sameFrame, 'same-origin frame payload is keyed by iframe nid');
    assert.equal(sameFrame.kind, 'same-origin');
    assert.match(sameFrame.html, /Same origin frame/);
    assert.ok(Array.isArray(sameFrame.nodeIds) && sameFrame.nodeIds.length > 0,
      'same-origin frame payload carries scoped nodeIds');
    assert.ok(opaqueFrame, 'inaccessible frame payload is keyed by iframe nid');
    assert.match(opaqueFrame.kind, /blocked|cross-origin|inaccessible/);
    assert.doesNotMatch(JSON.stringify(opaqueFrame), /Opaque frame secret/,
      'inaccessible frame payload is content-free');
    assert.match(JSON.stringify(opaqueFrame), /iframe|frame|inaccessible|cross-origin|blocked/,
      'inaccessible frame is labeled honestly');
  });
});

test('Chromium input and change events stream text, textarea, select, checkbox, and radio state updates', async () => {
  await withCapturePage(async ({ page, messages }) => {
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <form id="controls">
            <input id="text-input" type="text" value="initial">
            <textarea id="notes">initial notes</textarea>
            <select id="plan-select">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
            </select>
            <label><input id="updates-check" type="checkbox"> updates</label>
            <label><input id="radio-a" type="radio" name="mode" value="a" checked> A</label>
            <label><input id="radio-b" type="radio" name="mode" value="b"> B</label>
          </form>
        </body>
      </html>
    `, { waitUntil: 'load' });
    await installCheckedInInjectArtifact(page);
    await waitForMessage(messages, (m) => m.type === STREAM.SNAPSHOT, 'form snapshot');

    const baseline = messages.length;
    await page.fill('#text-input', 'typed text from chromium');
    await page.dispatchEvent('#text-input', 'change');
    await page.fill('#notes', 'textarea value from chromium');
    await page.dispatchEvent('#notes', 'change');
    await page.selectOption('#plan-select', 'pro');
    await page.dispatchEvent('#plan-select', 'change');
    await page.check('#updates-check');
    await page.dispatchEvent('#updates-check', 'change');
    await page.check('#radio-b');
    await page.dispatchEvent('#radio-b', 'change');

    await waitForNewMessage(
      messages,
      baseline,
      (m) => m.type !== STREAM.SCROLL && m.type !== STREAM.STATE,
      'input/change value frame'
    );
    const valueWire = JSON.stringify(messages.slice(baseline));
    assert.match(valueWire, /typed text from chromium/, 'text input value is streamed');
    assert.match(valueWire, /textarea value from chromium/, 'textarea value is streamed');
    assert.match(valueWire, /pro/, 'select value or selected option state is streamed');
    assert.match(valueWire, /updates-check|checkbox|checked/, 'checkbox checked state is streamed');
    assert.match(valueWire, /radio-b|radio|checked/, 'radio checked state is streamed');
  });
});

test('Chromium adapter path forwards subtree requests to injected capture and returns sanitized responses', async () => {
  await withAdapterCapturePage(async ({ page, messages, transport }) => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <section id="recover-root">
            <h2>Recover me</h2>
            <button id="recover-button" onclick="window.__leak = true">Recover child</button>
          </section>
        </body>
      </html>
    `;
    const navigationBaseline = messages.length;
    await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html), { waitUntil: 'load' });
    await waitForNewMessage(
      messages,
      navigationBaseline,
      (m) => m.type === STREAM.SNAPSHOT && m.payload.html.includes('recover-root'),
      'adapter snapshot'
    );
    await page.waitForTimeout(50);
    const snapshot = messages
      .filter((m) => m.type === STREAM.SNAPSHOT && m.payload.html.includes('recover-root'))
      .at(-1);
    const nid = await page.evaluate(() => window.__phantomStreamGetNodeId(
      document.getElementById('recover-root')
    ));

    assert.ok(snapshot, 'adapter snapshot carries the recovery fixture');
    assert.ok(nid, 'subtree root has a public capture nid');
    const baseline = messages.length;
    transport.emit(CONTROL.SUBTREE_REQUEST, {
      requestId: 'browser-subtree-1',
      nid,
      streamSessionId: snapshot.payload.streamSessionId,
      snapshotId: snapshot.payload.snapshotId,
      reason: 'truncated-marker-click',
    });

    const response = await waitForNewMessage(
      messages,
      baseline,
      (m) => m.type === STREAM.SUBTREE_RESPONSE,
      'adapter subtree response'
    );

    assert.equal(response.payload.requestId, 'browser-subtree-1');
    assert.equal(response.payload.nid, nid);
    assert.equal(response.payload.status, 'ok');
    assert.match(response.payload.html, /Recover me/);
    assert.doesNotMatch(response.payload.html, /onclick|__leak/,
      'subtree response uses capture sanitization');
    assert.ok(Array.isArray(response.payload.nodeIds)
      && response.payload.nodeIds.includes(nid));
    assert.ok(Array.isArray(response.payload.shadowRoots));
    assert.ok(Array.isArray(response.payload.frames));
  });
});
