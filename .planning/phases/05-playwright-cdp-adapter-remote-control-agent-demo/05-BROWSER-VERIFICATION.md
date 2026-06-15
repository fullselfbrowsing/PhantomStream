# Phase 05 Browser Verification

Timestamp: 2026-06-15 04:43:21 CDT

## Commands

- `npx playwright install chromium` — PASS, Chromium already available or installed without error.
- `npx playwright --version` — PASS, `Version 1.60.0`.
- `node --test tests/remote-control-protocol.test.js tests/playwright-adapter.test.js tests/playwright-adapter-cdp.test.js tests/renderer-remote-control.test.js tests/playwright-demo-cli.test.js` — PASS, 31 tests after the code-review containment fix.
- `npm test` — PASS, 289 tests after the code-review containment fix.
- `node bin/phantom-stream.js playwright-demo --drive --headed --port 0` — PASS, started local demo on `127.0.0.1` with `Viewer:`, `Driven page:`, `Room:`, and `Control: default-deny`.
- Real-browser checkpoint via Playwright Chromium — PASS.

FSB note: FSB navigation was attempted first, but the bridge reported that the browser extension was not attached to `ws://localhost:7225`. Because FSB could not open the local viewer, the checkpoint was performed with Playwright Chromium against the same local relay, viewer, source transport, and Playwright/CDP adapter.

## Browser Evidence

- Browser: Playwright Chromium 1.60.0, headless.
- Viewer URL: `http://127.0.0.1:56303/playwright/viewer?room=f2a6354682ee12348a77e76c27dae10a&ws=ws%3A%2F%2F127.0.0.1%3A56303%2Fws%3Froom%3Df2a6354682ee12348a77e76c27dae10a%26role%3Dviewer`
- Driven page URL: `http://127.0.0.1:56303/playwright/fixture?room=f2a6354682ee12348a77e76c27dae10a&ws=ws%3A%2F%2F127.0.0.1%3A56303%2Fws%3Froom%3Df2a6354682ee12348a77e76c27dae10a%26role%3Dsource`
- Room prefix: `f2a63546`
- Lifecycle reached: `Live`
- Final control state before stop: `active`
- Final control state after stop: `stopped`
- Control requests: 2
- Denied requests: 1
- Dispatched actions: 5
- Snapshots observed: 5
- Navigation count: 4

## Denied control inert: PASS

- Initial authorization mode was deny.
- `Request control` transitioned through the adapter denial path.
- Control counters after denial: requests 1, denied 1, dispatched 0.
- A mirror click while denied left the driven click count unchanged at 0.
- The action log and health/status UI did not record printable input content.

## Approved click/type/scroll: PASS

- Authorization was switched to approve and `Request control` reached `active`.
- Approved mirror click changed the real driven click counter and the mirror followed.
- Approved printable key input changed the real driven input length by 1 character.
- The viewer reported `Type sent: 1 chars`; the raw character was not recorded in the verification artifact.
- Approved wheel input changed the real driven scroll region.

## Navigation re-snapshot: PASS

- Approved activation of `Navigate fixture` changed the real driven page URL to the next local fixture navigation.
- The viewer returned to `Live`.
- Snapshot count increased after navigation.
- Navigation count was at least 1 and ended at 4 in the final evidence run.

## Browser-Found Fixes

- The Playwright adapter now restarts injected capture when it receives `dash:dom-stream-start`, so a viewer that attaches after the source page's initial snapshot gets a fresh snapshot.
- The demo segmented-control hidden radio inputs are scoped to their own label boxes, preventing them from intercepting clicks on `Request control`.
