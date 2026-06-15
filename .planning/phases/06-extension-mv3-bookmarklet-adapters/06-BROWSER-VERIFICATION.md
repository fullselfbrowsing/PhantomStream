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

## Bookmarklet

Command run:

```bash
node bin/phantom-stream.js bookmarklet-demo --port 0 --no-open
```

Captured output:

```text
PhantomStream bookmarklet demo running on 127.0.0.1
Source page: http://127.0.0.1:52868/bookmarklet/source?room=94c64cd8f64a2e171b2fc9ce00e69fd0&ws=ws%3A%2F%2F127.0.0.1%3A52868%2Fws%3Froom%3D94c64cd8f64a2e171b2fc9ce00e69fd0%26role%3Dsource
Viewer: http://127.0.0.1:52868/bookmarklet/viewer?room=94c64cd8f64a2e171b2fc9ce00e69fd0&ws=ws%3A%2F%2F127.0.0.1%3A52868%2Fws%3Froom%3D94c64cd8f64a2e171b2fc9ce00e69fd0%26role%3Dviewer
Bookmarklet: javascript:(()=>{try{const s=decodeURIComponent("http%3A%2F%2F127.0.0.1%3A52868%2Fbookmarklet%2Floader.js");const w=decodeURIComponent("ws%3A%2F%2F127.0.0.1%3A52868%2Fws%3Froom%3D94c64cd8f64a2e171b2fc9ce00e69fd0%26role%3Dsource");const r=decodeURIComponent("94c64cd8f64a2e171b2fc9ce00e69fd0");const u=new URL(s);u.searchParams.set("ws",w);if(r)u.searchParams.set("room",r);u.searchParams.set("ts",String(Date.now()));const e=document.createElement("script");e.async=true;e.src=u.toString();e.onerror=()=>{window.dispatchEvent(new CustomEvent("phantomstream:bookmarklet-error",{detail:{reason:"script-load-failed"}}));};(document.head||document.documentElement).appendChild(e);}catch(e){window.dispatchEvent(new CustomEvent("phantomstream:bookmarklet-error",{detail:{reason:"script-load-failed"}}));}})()
Room: 94c64cd8...
```

Generated bookmarklet prefix: `Bookmarklet: javascript:(()=>{`

Browser used: human_needed - no browser was opened in this session.

| Evidence point | Status | Evidence / reason |
|---|---|---|
| Bookmarklet source executed | human_needed | Requires opening the source page in a browser and executing the generated bookmarklet. |
| Loader installed bridge | human_needed | Requires confirming `window.__phantomStreamBridge` exists after executing the bookmarklet. Automated tests verify the loader route contains the bridge installation code. |
| Viewer received initial snapshot | human_needed | Requires opening source and viewer pages and confirming the initial mirrored document appears after bookmarklet execution. |
| Source mutation appeared in viewer | human_needed | Requires clicking `Add row` or `Edit text` after bookmarklet execution and observing the viewer update. |
| Blocked-injection diagnostic path exists | human_needed | Requires exercising a browser/page policy block. Automated tests verify `phantomstream:bookmarklet-error` and `script-load-failed` are present in generated source/loader paths. |
