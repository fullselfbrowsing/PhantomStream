## v0.9.9.1 Phantom Stream (Shipped: 2026-03-31)

**Phases completed:** 9 phases (5 planned + 4 inserted fixes), 16 plans

**Key accomplishments:**

- Auto-connect DOM stream on WebSocket handshake with active tab tracking, recovery on disconnect, and 4-state health badge
- LZ-string compression for WS payloads (90%+ reduction on 100KB+ DOM snapshots) with envelope-based backward compat
- 4-mode layout system (inline, maximized, PiP with drag-to-reposition, fullscreen with mouse-tracked exit overlay)
- Full computed style capture (66 CSS properties) fixing broken layouts on complex sites like Google and YouTube
- Native alert/confirm/prompt dialog mirroring to dashboard with styled overlay cards
- Remote browser control (click/type/scroll) through preview with coordinate reverse-scaling and blue border active state
- Idempotent stop signals with promise resolution, eliminating hanging promises and duplicate task-complete messages
- Orange glow overlay broadcast during automation for visual element targeting in preview

**Stats:**

- 9 phases, 16 plans
- Key files: dashboard.js (2,718 lines), dom-stream.js (878 lines), ws-client.js (527 lines)

---

