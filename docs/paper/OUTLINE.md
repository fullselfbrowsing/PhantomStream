# Paper Outline — PhantomStream: DOM-Native Live Mirroring for Agentic Browsing

> Working title. Status: outline. Venue candidates: WWW / UIST / CHI (system track),
> or an agents/HCI workshop for an early version.

## Abstract (draft sketch)

AI agents increasingly operate real browsers on a user's behalf. Supervising such an agent
requires a live, trustworthy view of what it is doing — but video streaming is
bandwidth-heavy, semantically opaque (which element is the agent touching?), and awkward to
control through. We present PhantomStream, a DOM-native mirroring system that streams a
live tab as a style-inlined snapshot plus display-matched MutationObserver diffs addressed
by stable node identities, over a compressed, size-capped relay, reconstructed in a
sandboxed viewer with bidirectional control. Deployed inside an open-source browsing agent
(FSB), PhantomStream achieves [X]% lower bandwidth than WebRTC screen capture and [Y] ms
mirror latency while preserving element-level semantics that enable action highlighting and
click-through remote control. We report the reliability mechanisms — dual watchdogs,
session-identity staleness guards, budgeted truncation — that emerged from production
failures, and quantify the fidelity/bandwidth trade-offs of computed-style capture
strategies.

## 1. Introduction

- The agentic-browsing supervision problem: trust, observability, intervention.
- Why pixels are the wrong abstraction for watching an agent: no element identity, no
  cheap idle state, no semantic overlay channel.
- Contributions:
  1. A DOM-native live-mirroring architecture (snapshot + nid-addressed diffs +
     side channels + reverse control path).
  2. Reliability mechanisms for hostile runtime conditions (MV3 SW eviction, relay
     message caps, slow/heavy pages) with production failure data.
  3. An empirical comparison of style-capture strategies (full enumeration vs. curated
     inlining vs. stylesheet-centric) on fidelity, payload size, and serialize latency.
  4. Open-source framework + evaluation harness.

## 2. Related work

- **Session replay:** rrweb, SessionStack, LogRocket — record/replay vs. live mirroring;
  rrweb's stylesheet capture vs. our computed-style inlining (discuss trade-off honestly).
- **Remote display:** VNC/RDP, WebRTC screen capture, Chrome DevTools Protocol screencast.
- **Co-browsing:** Surfly, Upscope — commercial DOM co-browsing, little published detail.
- **DOM diffing/virtual DOM literature**; CRDTs for DOM (peritext-adjacent) — why a
  single-writer mirror needs none of that.
- **Agent observability:** browser-use/agent frameworks' screenshot streams; computer-use
  model viewers.

## 3. System design

Map of docs/ARCHITECTURE.md §§2–4, reframed as design decisions with rationale:

- 3.1 Node identity (nid stamping; observability trade-off; WeakMap alternative)
- 3.2 Snapshot serialization (parallel TreeWalker, URL absolutification, canvas, iframes)
- 3.3 Style capture (the 45 s YouTube story; curated 85-prop list; default elision)
- 3.4 Diff pipeline (rAF batching = display-matched delivery)
- 3.5 Size budgeting (relay caps, 2-pass whole-subtree truncation, single-flush layout reads)
- 3.6 Transport (LZ envelope, session identity, staleness rejection)
- 3.7 Viewer (srcdoc reconstruction, scaling, layout modes, overlays, dialogs)
- 3.8 Reverse path (remote control coordinate reverse-mapping)

## 4. Reliability in production

The dual-watchdog design; MV3 service-worker eviction as an adversary; pending-intent
re-arm for the startup race; staleFlushCount telemetry. Frame as: "what a lab prototype
would not have needed, and a deployed system did" — supported by the inserted-phase
history (122.1–122.4, 211, 276).

## 5. Evaluation (planned)

- **Bandwidth:** PhantomStream vs. WebRTC screen capture vs. CDP screencast vs. rrweb
  live-mode across a site corpus (static article, infinite scroll feed, SPA dashboard,
  video-heavy page) and activity levels (idle, reading, agent-driven automation).
- **Latency:** mutation-to-mirror-paint time distribution; snapshot time vs. page weight.
- **Fidelity:** perceptual diff (SSIM / pixel-diff of mirror vs. real tab screenshots)
  across Alexa/Tranco top-N pages; failure taxonomy (shadow DOM, canvas, video, iframes).
- **Style strategies ablation:** full-enumeration vs. curated-inlined vs.
  stylesheet-centric capture on the three axes above.
- **Reliability:** watchdog rescue rates and stream-strand incidence from FSB telemetry
  (if usable) or synthetic fault injection.

## 6. Discussion & limitations

Frozen-style drift; un-mirrored realms (shadow DOM, cross-origin iframes, media);
sanitization/security model of rendering attacker-influenced HTML in the viewer; privacy
of mirroring (the stream is the page content — implications and redaction hooks).

## 7. Future work

Stylesheet-centric capture; on-demand subtree fetch; multi-viewer fan-out; CRDT-free
multi-tab; integration as the standard observability layer for computer-use agents.

---

## TODO toward a draft

- [ ] Build the evaluation harness (`examples/` + a bench runner)
- [ ] Pick and freeze the site corpus
- [ ] Implement the stylesheet-centric capture variant (needed for the ablation)
- [ ] Pull watchdog/telemetry numbers from FSB if available
- [ ] Related-work deep dive: rrweb internals, Surfly patents, CDP screencast docs
- [ ] Decide venue + format (sets page budget)
