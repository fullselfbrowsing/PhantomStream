import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { getPlaywrightInjectSource } from '../src/adapters/playwright.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

test('checked-in Playwright inject artifact emits CSSOM snapshot and style ops in Chromium', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const messages = [];
  const startedAt = Date.now();
  try {
    await page.exposeFunction('__phantomStreamBridge', (message) => {
      messages.push(message);
      return { ok: true };
    });
    await page.setContent(`<!doctype html>
      <html>
        <head>
          <style id="theme">.css-abc123{color:rgb(10, 20, 30)}</style>
        </head>
        <body>
          <main>
            <div class="css-abc123 adopted-target">CSSOM target</div>
            <x-card id="host"></x-card>
            <iframe id="same-frame"></iframe>
          </main>
        </body>
      </html>`);
    await page.evaluate(() => {
      const host = document.getElementById('host');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>.shadow-target{color:rgb(1, 2, 3)}</style><span class="shadow-target">Shadow</span>';
      const frame = document.getElementById('same-frame');
      const doc = frame.contentDocument;
      doc.open();
      doc.write('<!doctype html><html><head><style>.frame-target{color:rgb(4, 5, 6)}</style></head><body><p class="frame-target">Frame</p></body></html>');
      doc.close();
      if ('adoptedStyleSheets' in document && 'CSSStyleSheet' in window) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('.adopted-target{border-color:rgb(7, 8, 9)}');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
    });

    await page.addScriptTag({
      content: getPlaywrightInjectSource({ captureOptions: { styleMode: 'cssom' } }),
    });
    await page.waitForFunction(() => window.__phantomStreamCapture);
    await page.waitForFunction(() => window.__phantomStreamGetNodeId(document.querySelector('.css-abc123')));

    await page.waitForFunction(() => window.__phantomStreamBridge, null, { timeout: 1000 }).catch(() => {});
    const snapshotMessage = await waitForMessage(messages, (message) => message.type === STREAM.SNAPSHOT);
    const snapshot = snapshotMessage.payload;
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
    const latencyMs = Date.now() - startedAt;

    assert.equal(snapshot.styleStrategy.mode, 'cssom');
    assert.equal(typeof snapshotBytes, 'number');
    assert.equal(typeof latencyMs, 'number');
    assert.ok(snapshotBytes > 0);
    assert.ok(latencyMs >= 0);
    assert.ok(snapshot.styleSources.some((source) => source.cssText.includes('.css-abc123')));
    assert.ok((snapshot.shadowRoots || []).some((root) => (root.styleSources || []).some((source) => source.scope.kind === 'shadow')));
    assert.ok((snapshot.frames || []).some((frame) => (frame.styleSources || []).some((source) => source.scope.kind === 'frame')));
    assert.equal(snapshot.html.includes('color:rgb(10, 20, 30)'), false);

    await page.evaluate(() => {
      document.getElementById('theme').sheet.insertRule('.css-abc123{background-color:rgb(20, 30, 40)}', 0);
    });
    const mutationMessage = await waitForMessage(messages, (message) => (
      message.type === STREAM.MUTATIONS
      && (message.payload.mutations || []).some((op) => op.op === DIFF_OP.STYLE_SOURCE)
    ));
    const styleOp = mutationMessage.payload.mutations.find((op) => op.op === DIFF_OP.STYLE_SOURCE);
    assert.equal(styleOp.action, 'replace');
    assert.equal(styleOp.scope.kind, 'document');
    assert.ok(styleOp.source.cssText.includes('background-color'));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
});

async function waitForMessage(messages, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('timed out waiting for Playwright CSSOM message');
}
