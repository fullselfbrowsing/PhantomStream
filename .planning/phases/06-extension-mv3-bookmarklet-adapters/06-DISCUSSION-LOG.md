# Phase 6: Extension MV3 + Bookmarklet Adapters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 06-extension-mv3-bookmarklet-adapters
**Areas discussed:** MV3 adapter surface, Service-worker state and recovery, Bookmarklet loader, Demo and verification shape

---

## Workflow Fallback

The interactive question tool was unavailable in this Conductor mode. Per the GSD fallback, the recommended "all areas" route was selected and conservative defaults were captured.

| Option | Description | Selected |
|--------|-------------|----------|
| All areas | Discuss MV3 surface, recovery semantics, and bookmarklet loader so planning has locked choices. | yes |
| MV3 only | Focus on extension adapter shape and service-worker recovery; use conservative defaults for bookmarklet. | |
| Bookmarklet only | Focus on loader behavior; use conservative defaults for MV3. | |

**User's choice:** Fallback selected recommended default because interactive input was unavailable.
**Notes:** This matches the Phase 4 precedent for Conductor fallback behavior.

---

## MV3 Adapter Surface

| Option | Description | Selected |
|--------|-------------|----------|
| First-class adapter exports | Add reusable `./adapters/extension` and `./adapters/bookmarklet` surfaces plus minimal fixtures. | yes |
| Demo-only glue | Keep all extension/bookmarklet work under examples without package exports. | |
| Full extension product | Build a polished extension app with options/onboarding/distribution UX. | |

**User's choice:** Fallback selected first-class adapter exports.
**Notes:** This follows Phase 5's Playwright adapter precedent while keeping product UX out of scope.

---

## Service-Worker State And Recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Storage-session source of truth | Persist stream intent and connection config in `chrome.storage.session`; module globals are caches only. | yes |
| Module globals plus reconnect | Keep most state in SW globals and reconnect opportunistically after wake. | |
| Durable payload replay | Persist enough message data to replay missed diffs after restart. | |

**User's choice:** Fallback selected `chrome.storage.session` source of truth.
**Notes:** This is required by the roadmap and avoids leaking mirrored contents into durable storage. Recovery should trigger a fresh snapshot.

---

## Bookmarklet Loader

| Option | Description | Selected |
|--------|-------------|----------|
| Honest convenience loader | Generate an executable bookmarklet that injects capture where browser/CSP rules allow and fails visibly otherwise. | yes |
| Direct demo import only | Prove bookmarklet behavior through a page button or module import instead of a real bookmarklet source. | |
| CSP workaround path | Attempt bypass-style fallbacks for pages that block injected scripts. | |

**User's choice:** Fallback selected honest convenience loader.
**Notes:** The phase proves the adapter surface; it does not promise universal bookmarklet compatibility.

---

## Demo And Verification Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit local adapter demos | Add deterministic `extension-demo` / `bookmarklet-demo` style commands or equivalent explicit submodes. | yes |
| Overload existing demo | Add flags onto `phantom-stream demo` for every adapter. | |
| Manual-only verification | Skip local demo commands and rely on docs/manual setup. | |

**User's choice:** Fallback selected explicit local adapter demos.
**Notes:** This follows the existing split between `demo` and `playwright-demo`.

---

## the agent's Discretion

- Exact file layout under `src/adapters/`, `examples/`, and `tests/`.
- Exact public function names, alarm key names, storage key names, and diagnostic event payloads.
- Whether Phase 6 adapter demos are two separate CLI commands or a single explicit adapter-demo command with submodes.
- Exact extension fixture generation strategy.

## Deferred Ideas

- Full extension remote-control parity through Chrome debugger APIs.
- Browser store distribution UX, options pages, QR pairing UI, persistent account auth, and polished extension onboarding.
- Firefox/MV2/mobile extension support.
- Bookmarklet CSP bypass strategies.
- Full adapter quickstart documentation and npm publishing polish.
