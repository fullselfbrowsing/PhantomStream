# Phase 06 Browser Verification

## Extension MV3

Command run:

```bash
node bin/phantom-stream.js extension-demo --port 0 --no-open
```

Captured output:

```text
PhantomStream extension demo running on 127.0.0.1
Extension directory: /var/folders/xl/twfzpf1s5kq8p523tnbsnxbw0000gn/T/phantomstream-extension-mv3-opKlPh
Source page: http://127.0.0.1:51094/extension/source?room=74d89f48cf0dbf10f3ba09966c0630bd&ws=ws%3A%2F%2F127.0.0.1%3A51094%2Fws%3Froom%3D74d89f48cf0dbf10f3ba09966c0630bd%26role%3Dsource
Viewer: http://127.0.0.1:51094/extension/viewer?room=74d89f48cf0dbf10f3ba09966c0630bd&ws=ws%3A%2F%2F127.0.0.1%3A51094%2Fws%3Froom%3D74d89f48cf0dbf10f3ba09966c0630bd%26role%3Dviewer
Room: 74d89f48...
```

Browser used: human_needed - no browser was opened in this session.

| Evidence point | Status | Evidence / reason |
|---|---|---|
| Extension loaded with no service-worker console errors | human_needed | Requires loading the generated unpacked extension directory in Chromium and inspecting the extension service worker console. |
| Content script injected | human_needed | Requires loading the source URL in Chromium with the unpacked extension enabled and confirming `window.__phantomStreamBridge` installation from the page/devtools context. |
| Viewer receives initial snapshot | human_needed | Requires opening the source and viewer URLs in Chromium and observing the mirrored document. |
| Source page mutation appears in viewer | human_needed | Requires clicking `Add row` or `Edit text` on the source page and observing the viewer update. |
| Watchdog alarm is registered | human_needed | Requires inspecting the extension service worker alarm registration for `phantomstream-watchdog`. Automated tests cover the generated fixture and core adapter alarm wiring. |
| Forced service-worker restart triggers recovery | human_needed | Requires forcing/stopping the MV3 service worker, firing or waiting for the alarm, and confirming `mv3-watchdog-resnapshot` returns the viewer to live state. |
