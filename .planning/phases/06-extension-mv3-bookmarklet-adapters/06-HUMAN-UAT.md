---
status: partial
phase: 06-extension-mv3-bookmarklet-adapters
source: [06-VERIFICATION.md]
started: 2026-06-15T10:52:43Z
updated: 2026-06-15T10:52:43Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Load generated MV3 extension fixture

expected: Run `node bin/phantom-stream.js extension-demo --port 0 --no-open`, load the printed `Extension directory` as an unpacked Chromium extension, confirm the extension loads without service-worker console errors, and confirm the `phantomstream-watchdog` alarm is registered.
result: pending

### 2. Verify MV3 extension live mirror

expected: With the unpacked extension enabled, open the printed source and viewer URLs, confirm the viewer receives the initial snapshot, mutate the source page with `Add row` or `Edit text`, and confirm the viewer updates.
result: pending

### 3. Verify MV3 watchdog recovery

expected: Stop/evict the extension service worker or wait/fire the watchdog alarm while the demo is active, then confirm a fresh `CONTROL.START` with reason `mv3-watchdog-resnapshot` restores the viewer to live mirrored state.
result: pending

### 4. Execute generated bookmarklet

expected: Run `node bin/phantom-stream.js bookmarklet-demo --port 0 --no-open`, open the printed source and viewer URLs, execute the printed bookmarklet on the source page, confirm `window.__phantomStreamBridge` installs, confirm the viewer receives an initial snapshot, mutate the source page, and confirm the viewer updates.
result: pending

### 5. Verify bookmarklet blocked-injection diagnostics

expected: Exercise the bookmarklet on a page or policy setup that blocks script injection or loader fetch, then confirm the page emits `phantomstream:bookmarklet-error` with a content-free reason such as `script-load-failed`.
result: pending

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
