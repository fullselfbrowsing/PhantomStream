# relay (extraction pending)

Transport relay between capture hosts and viewers. Source:
`reference/server/ws-handler.js` (367 lines) and the forwarding excerpts in
`reference/extension/background.dom-stream-relay.excerpt.js`.

The reference is a WebSocket fan-out with a 1 MiB per-message cap and envelope-type
diagnostics. The standalone version should be transport-agnostic:

```
relay.js        message routing: capture host <-> N viewers, per-stream addressing
limits.js       per-message size enforcement + oversize classification (envelope-aware)
backends/ws.js  WebSocket backend (reference behavior)
index.js        createRelay({ backend, limits }) 
```

Design notes:

- The per-message cap is a *protocol* constant (`src/protocol/constants.js`) because the
  capture-side truncation budget derives from it; relay and capture must agree.
- Multi-viewer fan-out (one tab mirrored to N watchers) is a near-free win of the DOM
  approach and a paper talking point — the reference only ever had one dashboard.
