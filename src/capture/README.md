# capture (extraction pending)

Page-side capture core. Source: `reference/extension/dom-stream.js` (1,117 lines).

The reference implementation is coupled to two FSB-specific things that the extraction
must abstract away:

1. **`chrome.runtime.sendMessage`** — replace with an injected `Transport` interface
   (`send(type, payload)`) so the core runs in any injection context: extension content
   script, Playwright/CDP `Page.addScriptToEvaluateOnNewDocument`, bookmarklet, or an
   embedded SDK.
2. **`window.FSB` namespace** (logger, overlay-state readers) — replace with an options
   object: `{ logger, overlayProvider, skipElement(el) }`. The overlay side channel and
   the "skip our own UI" predicate become host concerns.

Planned module split:

```
serializer.js    serializeDOM + style capture + URL absolutification + truncation
differ.js        MutationObserver batching, diff op generation, watchdog
side-channels.js scroll tracker, overlay broadcaster, dialog interceptor
session.js       stream session lifecycle + control message handling
index.js         createCapture({ transport, options }) -> { start, stop, pause, resume }
```

Behavioral changes queued for the standalone version (vs. the reference):

- Capture computed styles for nodes added after the snapshot (reference gap #2 in
  ARCHITECTURE.md §6).
- Sanitize `on*` attributes and `javascript:` URLs in all serialization paths, not just
  the html/body shell (gap #5).
- Optional stylesheet-centric capture mode (CSSOM) for the paper's ablation study.
