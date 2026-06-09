# renderer (extraction pending)

Viewer-side reconstruction. Source: `reference/dashboard/dashboard.js` (4,096 lines —
the stream-relevant parts are roughly lines 2700–3960: snapshot rendering, diff apply,
scroll/overlay/dialog handlers, scaling, layout modes, remote control).

The reference implementation is interleaved with the FSB dashboard's task UI; extraction
means isolating the preview concerns into a self-contained component:

```
snapshot-renderer.js  rebuild document, write to sandboxed iframe srcdoc, scale-to-fit
diff-applier.js       nid-addressed apply of add/rm/attr/text ops + miss accounting
overlays.js           glow rect, progress card, dialog cards in mirror coordinates
remote-control.js     pointer/keyboard/scroll capture + coordinate reverse-mapping
layout.js             inline / maximized / pip / fullscreen stage modes
index.js              createViewer({ container, transport }) -> { attach, detach }
```

Hard requirements for the standalone version:

- The mirror iframe MUST be sandboxed without `allow-scripts` (see ARCHITECTURE.md §6
  gap #5 — `on*` attributes can survive capture in the reference implementation).
- Diff-apply misses (truncated subtrees, lost messages) must surface as a health signal,
  not silent drift.
