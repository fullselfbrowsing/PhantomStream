---
status: complete
phase: 06-extension-mv3-bookmarklet-adapters
source: [06-VERIFICATION.md]
started: 2026-06-15T10:52:43Z
updated: 2026-06-15T13:50:25Z
---

## Current Test

[testing complete]

## Tests

### 1. Load generated MV3 extension fixture

expected: Run `node bin/phantom-stream.js extension-demo --port 0 --no-open`, load the printed `Extension directory` as an unpacked Chromium extension, confirm the extension loads without service-worker console errors, and confirm the `phantomstream-watchdog` alarm is registered.
result: pass

### 2. Verify MV3 extension live mirror

expected: With the unpacked extension enabled, open the printed source and viewer URLs, confirm the viewer receives the initial snapshot, mutate the source page with `Add row` or `Edit text`, and confirm the viewer updates.
details:
  source: http://127.0.0.1:64421/extension/source?room=2b8b93d888f2d04735e7ccd545ceea25&ws=ws%3A%2F%2F127.0.0.1%3A64421%2Fws%3Froom%3D2b8b93d888f2d04735e7ccd545ceea25%26role%3Dsource
  viewer: http://127.0.0.1:64421/extension/viewer?room=2b8b93d888f2d04735e7ccd545ceea25&ws=ws%3A%2F%2F127.0.0.1%3A64421%2Fws%3Froom%3D2b8b93d888f2d04735e7ccd545ceea25%26role%3Dviewer
attempts:
  - reported: "CSP blocked inline scripts injected from content-script.js; viewer stayed at 0 frames while the source mutated."
    root_cause: "The generated MV3 fixture used script.text/script.textContent to inject the page bridge and capture bundle into the page world."
    fix: "Patched the fixture to inject page-bridge.js and browser-inject.js through chrome.scripting.executeScript in MAIN world, added a dialog-interceptor CSP guard, and updated the Desktop extension folder."
  - reported: "FSB loaded fresh source/viewer pages from a patched fixture and found source bridge/start globals still undefined with viewer at 0 frames."
    root_cause: "Chrome had not reloaded the unpacked extension after the Desktop folder changed, so the patched service worker/content script was not active."
    fix: "FSB cannot operate on chrome://extensions because Chrome blocks automation on internal pages. Human reload of the unpacked extension is required before the FSB retest."
  - reported: "After the human reload, FSB saw source bridge/start/stop globals as functions, disabledDialog true, and the viewer iframe containing the initial source snapshot."
    evidence: "FSB tab ownership reset after the source mutation, so post-mutation viewer inspection was completed in Playwright using the same Desktop unpacked extension folder."
  - reported: "Playwright launched Chromium with /Users/lakshmanturlapati/Desktop/phantomstream-extension-mv3-current, clicked Add row, and confirmed the viewer iframe contained Row 2."
    evidence: "source bridge=function, start=function, disabledDialog=true; viewer iframe included Initial row and Row 2 / Created by source page mutation."
result: pass

### 3. Verify MV3 watchdog recovery

expected: Stop/evict the extension service worker or wait/fire the watchdog alarm while the demo is active, then confirm a fresh `CONTROL.START` with reason `mv3-watchdog-resnapshot` restores the viewer to live mirrored state.
result: skipped
reason: "Deferred by user during UAT."

### 4. Execute generated bookmarklet

expected: Run `node bin/phantom-stream.js bookmarklet-demo --port 0 --no-open`, open the printed source and viewer URLs, execute the printed bookmarklet on the source page, confirm `window.__phantomStreamBridge` installs, confirm the viewer receives an initial snapshot, mutate the source page, and confirm the viewer updates.
details:
  source: http://127.0.0.1:55203/bookmarklet/source?room=f5786d864f6c39c9a386b2af8a6604e7&ws=ws%3A%2F%2F127.0.0.1%3A55203%2Fws%3Froom%3Df5786d864f6c39c9a386b2af8a6604e7%26role%3Dsource
  viewer: http://127.0.0.1:55203/bookmarklet/viewer?room=f5786d864f6c39c9a386b2af8a6604e7&ws=ws%3A%2F%2F127.0.0.1%3A55203%2Fws%3Froom%3Df5786d864f6c39c9a386b2af8a6604e7%26role%3Dviewer
evidence:
  - "FSB executed the generated bookmarklet loader code on the source page."
  - "Source bridge/start/stop were functions and no bookmarklet error was present."
  - "Viewer iframe contained the initial bookmarklet source snapshot."
  - "After FSB clicked Add row, the viewer iframe contained Row 2 / Created by bookmarklet demo mutation."
result: pass

### 5. Verify bookmarklet blocked-injection diagnostics

expected: Exercise the bookmarklet on a page or policy setup that blocks script injection or loader fetch, then confirm the page emits `phantomstream:bookmarklet-error` with a content-free reason such as `script-load-failed`.
result: skipped
reason: "User asked to move on during UAT."

## Summary

total: 5
passed: 3
issues: 0
pending: 0
skipped: 2
blocked: 0

## Gaps
