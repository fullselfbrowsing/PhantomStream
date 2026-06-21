# Phase 13 — UI Review

**Audited:** 2026-06-21
**Baseline:** `13-UI-SPEC.md` (approved design contract — States A/B/C, parity ledger, accent-reservation discipline)
**Screenshots:** not captured (no dev server on :3000 / :5173 / :8080 — this is a zero-dependency JS library with no app surface; code-only audit, as the scope note prescribes)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Every locked string matches the Copywriting Contract verbatim, all via `textContent`. |
| 2. Visuals | 3/4 | States A and B are faithful and a11y-complete; State C's no-poster caption is **registered but never invoked** — the affordance cannot appear. |
| 3. Color | 4/4 | Only the parity palette is used; `#f59e0b` is reserved exactly to the two actionable controls. |
| 4. Typography | 4/4 | Single `600 13px/1.2 system-ui` pill type + 28px glyph box; zero new sizes/weights. |
| 5. Spacing | 3/4 | Parity tokens (4/6px radius, 4px gap, 4×12 padding, 44px floor) are exact, but the unmute pill hardcodes a `-24` height guess and drops the progress pill's `max-width` overflow guard. |
| 6. Experience Design | 4/4 | Muted-autoplay default, blocked-play recovery, unmute recovery, never-wedge containment, and reset-on-snapshot are all implemented and tested (36/36 media tests, 540/540 suite). |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **State C no-poster caption is dead code (BLOCKER for the State C contract).** `renderMediaPoster` / `.ps-overlay-media-poster` / the `Media (poster only)` copy are all built and registered in `src/renderer/overlays.js:663-687`, but `src/renderer/index.js` never calls `overlays.show('media-poster', ...)` — grep across `src/` finds only the three definition sites, zero call sites (contrast: `media-blocked` and `media-unmute` are each shown from `handleMedia`). **User impact:** the UI-SPEC State C promise — "if, and only if, the element has **no** poster to show, a passive caption … reads `Media (poster only)` … so the region is not a confusing blank" — never fires; a poster-mode `<video>` with no `poster` attribute renders as an unexplained empty rect. **Fix:** in the poster-mode branch of `handleMedia` (currently `index.js:1749`, which early-returns for non-`reference` mode), resolve the element, check whether the gated `poster` survived (`el.getAttribute('poster')` after `gateFragmentMedia`), and call `overlays.show('media-poster', { nid }, { anchorRect: resolveNidRect(nid) })` when it did not — and `overlays.show('media-poster', null)` otherwise. Add an index.js-level test asserting the caption shows for a poster-less element in poster mode and stays hidden when a poster is present.

2. **Unmute pill uses a magic-number height and has no width clamp (WARNING — Spacing/Visuals).** `src/renderer/overlays.js:650-651` positions the pill with `top = anchorRect.top + height - 8 - 24`, where `24` is a hardcoded assumption of the pill's rendered height rather than a measured/derived value; the spec's parity anchor is the progress pill's `bottom: 8px`. The `.ps-overlay-media-unmute` rule (overlays.js:165-177) also omits the progress pill's `max-width: calc(100% - 16px)` (overlays.js:95). **User impact:** over a short `<audio>` rect (or any element shorter than ~32px) the `-24` math can push the pill above or off the element; with no `max-width`, the pill can also overflow a narrow element's right edge. **Fix:** drop a `max-width: calc(100% - 16px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` onto `.ps-overlay-media-unmute` to match the progress pill, and either anchor with a real measured height (read `mediaUnmuteEl.offsetHeight` after it is in the DOM) or anchor the pill's `bottom` against the rect bottom instead of computing `top` from a constant.

3. **The blocked-play scrim has no accessible name on the actionable region's reduced-motion fallback path, and the button is a `div[role=button]` (WARNING — Visuals/Experience).** The control is a `<div role="button" tabindex="0">` (overlays.js:593-597) rather than a native `<button>`; the spec permits this (it explicitly lists `role="button"`/`tabindex="0"` as the additive-a11y divergence), and Enter/Space are wired (overlays.js:557-562), so this is contract-compliant — but the icon-only control's only accessible name is `aria-label="Play mirrored media"`, and the scrim container carries no `role`/label, so a screen-reader user navigating the scrim region (not the button) gets a bare unlabeled `div`. **User impact:** marginal for keyboard users (focus lands on the labeled button), but the surrounding scrim is an unlabeled interactive-looking surface. **Fix:** low priority — optionally add `aria-hidden="true"` to the scrim `div` (`mediaBlockedEl`, overlays.js:590) so only the labeled button is in the a11y tree, mirroring the glow/progress `aria-hidden` precedent while keeping the button itself exposed (the button is a child, so it stays reachable).

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

Audited every affordance string against the Copywriting Contract table.

- Unmute label — `'Unmute'` set via `label.textContent` (`overlays.js:641`). Matches the contract exactly.
- Blocked-play CTA — icon-only, `aria-label="Play mirrored media"` (`overlays.js:597`). Matches "Icon-only play button — `aria-label='Play mirrored media'` (no visible text label)".
- Unmute control name — `aria-label="Unmute mirrored media"` (`overlays.js:634`). Matches.
- Poster caption copy — `'Media (poster only)'` set via `mediaPosterEl.textContent` (`overlays.js:673`). The *string* is correct (it just never renders — see Pillar 2 / Fix 1).
- Voice check: all labels are short, lowercase-tech noun/verb phrases, no exclamation marks, consistent with the `02-UI-SPEC.md` register.
- Security-of-copy invariant honored: the only `innerHTML` writes are the two static `MEDIA_GLYPH` SVG constants (`overlays.js:604, 638`); every label is `textContent`. No capture-influenced string is interpolated into markup — verified by grep and by the passing `security-chokepoint-purity` allowlist (bumped 2→4 for the static glyphs only).

No generic labels (`Submit`/`OK`/`Cancel`/`Click Here`) anywhere in the affordance code. **No deductions.**

### Pillar 2: Visuals (3/4)

- **State A (blocked-play)** — faithful: scrim `div.ps-overlay-media-blocked` clipped to the mapped rect, centered circular button, amber 2px ring + glow, inline-SVG play triangle, `≥44×44` floor set **inline** (`minWidth`/`minHeight`, overlays.js:602-603) so the touch-target floor holds regardless of CSS delivery. Focal point is clear and correct.
- **State B (unmute)** — faithful: bottom-left pill, amber muted-speaker glyph + label, `role=button`/`tabindex=0`/`aria-label`, `pointer-events:auto` on the pill only (layer stays transparent). Icon paired with a text label and an aria-label — no bare icon-only ambiguity.
- **State C (poster caption)** — **BLOCKER:** the renderFn renders correctly in isolation (proven by `renderer-media.test.js:160-171`), but nothing in `src/renderer/index.js` ever drives it. Grep for `media-poster` across `src/` returns only the CSS rule, the className assignment, and the `register('media-poster', …)` line — **no `show('media-poster', …)` call exists**. So the one State-C visual the spec mandates ("the region is not a confusing blank") can never appear in the running viewer. This is the single largest contract gap in the phase and the reason this pillar is not a 4.
- Visual hierarchy and z-order are coherent: blocked scrim `z-index:25` and unmute pill `z-index:25` sit above the progress pill (20) and below the dialog (30); poster caption `z-index:24`. Consistent with the documented sub-layer order.
- Interactive-overlay divergence (first overlays to use `pointer-events:auto`) is correctly localized to the controls; the layer and the passive caption stay `pointer-events:none`.

Score capped at 3/4 by the un-wired State C.

### Pillar 3: Color (4/4)

Enumerated every color literal in the media CSS (`overlays.js:134-198`) and cross-checked the Color table + the accent-reservation list.

- Scrim `rgba(0, 0, 0, 0.5)` (overlays.js:142) — matches the dialog-backdrop parity value.
- Pill / poster background `rgba(0, 0, 0, 0.75)` (overlays.js:168, 190) — matches the progress-pill scrim.
- Accent `#f59e0b` appears on exactly: the play-button ring + `color` (currentColor for the glyph) + glow (overlays.js:151, 153, 155) and the unmute speaker-icon fill (overlays.js:179). **Nowhere else** — not on the scrim, pill background, label text, or poster caption. This is precisely the "reserved EXCLUSIVELY for items 1–2" contract.
- Text `#e0e0e0` on the unmute label and poster caption (overlays.js:171, 193) — parity.
- Glow `box-shadow: 0 0 12px rgba(245, 158, 11, 0.6)` (overlays.js:153) and `backdrop-filter: blur(4px)` (overlays.js:169, 191) — exact parity values.
- No new hue is introduced by this phase. The other colors flagged by the grep (`#38bdf8`, `#1e1e2e`, `#888`, the cyan node-highlight set) are pre-existing built-ins from earlier phases, not media-affordance additions — out of this phase's scope and unchanged.

No hardcoded off-palette colors, no accent overuse. **No deductions.**

### Pillar 4: Typography (4/4)

- Distinct font declarations in the whole overlay sheet: `600 13px/1.2 system-ui` (progress, unmute, poster), `600 12px/1.2 system-ui` (pre-existing node-highlight label), and the 28px dialog/glyph box. The **media affordances introduce zero new sizes or weights** — the unmute pill and poster caption both reuse `font: 600 13px/1.2 system-ui, sans-serif` (overlays.js:172, 194), and the play glyph is the 28px box (overlays.js:229).
- Weights in use across the media family: 600 only (the pills) — within the two-weight (400/600) ceiling.
- The muted-speaker glyph is line-sized at 16px (overlays.js:232) to sit on the 13px text line, matching the spec's "sized to the 13px text line" note.

Matches the Typography parity table exactly. **No deductions.**

### Pillar 5: Spacing (3/4)

- Parity tokens are exact: pill `border-radius: 6px` + `padding: 4px 12px` (overlays.js:174, 173), unmute icon→label `gap: 4px` (overlays.js:167), play-button ring `2px` (overlays.js:151), `border-radius: 50%` circle, and the `44×44` minimum hit target enforced **inline** (overlays.js:602-603) — the hard contract floor. Edge inset `+8px` on the unmute anchor (overlays.js:650) matches the progress pill's `left: 8px` / `bottom: 8px`.
- **Deduction 1 — magic-number anchor:** the unmute pill's vertical position is `anchorRect.top + height - 8 - 24` (overlays.js:651) where `24` is a hardcoded guess at the pill's rendered height rather than a measured/derived value. The spec anchor is the progress pill's `bottom: 8px`; over a rect shorter than the assumed pill height this constant can mis-place the pill. (Fix 2.)
- **Deduction 2 — missing width clamp:** `.ps-overlay-media-unmute` omits the progress pill's `max-width: calc(100% - 16px)` + `overflow: hidden; text-overflow: ellipsis` (overlays.js:95-98). The `Unmute` label is short so this rarely bites, but it is a parity-with-the-progress-pill gap that allows overflow on a narrow element. (Fix 2.)
- No stray arbitrary spacing values; everything else is on the 4px grid.

Two concrete parity gaps on the unmute pill hold this at 3/4.

### Pillar 6: Experience Design (4/4)

State coverage is the strongest pillar — this is fundamentally an interaction-state phase and the states are all handled and tested.

- **Loading/first-bind:** the snapshot `media[]` baseline is applied once per nid on first bind, `readyState`-gated (`applyMediaBaseline`, index.js:1805-1829), then control passes to the reconciler — no re-snapshot playback jump (Pitfall 7).
- **Blocked (autoplay) state:** `ensurePlaying` sets `muted=true` before the first `play()`, guards `play()`'s return for the jsdom-undefined case, and on `NotAllowedError` shows State A **and** invokes the `onMediaBlocked(nid)` config hook (index.js:1658-1676). The hook is contained to the logger and never rethrown (`safeInvokeMediaHook`, index.js:1614-1621) — a throwing host hook cannot wedge the mirror (T-13-12).
- **Recovery:** the blocked-play button's `onActivate` re-issues `play()` user-gesture-backed and hides the affordance on success (index.js:1633-1643); the unmute pill's `onActivate` sets `muted=false`, restores `volume`, and hides itself (index.js:1784-1788).
- **Never-wedge:** every element mutation in `applyMediaAction` is `try/catch`-contained (index.js:1688-1731); a blocked play leaves the rest of the mirror updating. Seeking-hold, `readyState>=1` seek gate, and `seekable.length>0` rejoin guard are all present (Pitfalls 4/6).
- **Reset:** `resetOverlays()` invokes every registered renderFn (including the three media kinds) with a null payload — the universal hide contract — and `mediaFirstBind.clear()` re-arms baseline binding on a new identity (index.js:1456).
- **Backward-compat / disabled path:** an unknown wire type hits the dispatch `default` and is silently ignored (index.js:1869); poster/off mode early-returns with no driver and no affordance (index.js:1749).
- **Destructive actions:** none exist in these affordances (play/unmute are non-destructive and self-reversing), so the absence of destructive confirmation is correct, not a gap.
- Evidence: `node --test tests/renderer-media.test.js tests/renderer-media-csp.test.js` → 36/36; full top-level suite → 540/540.

The State-C wiring gap is scored against Visuals (the missing affordance) rather than double-penalized here, since the *interaction model* for poster mode (no driver, no playback, still frame) is itself correctly implemented — only the explanatory caption is missing. **No deductions at this pillar.**

---

## Registry Safety

Registry audit: not applicable. No `components.json` (shadcn not initialized — confirmed `NO_SHADCN`), and `13-UI-SPEC.md`'s Registry Safety table declares no third-party registries ("none declared"). The vetting gate is not triggered. Zero packages are installed (threat register T-13-SC), consistent with the zero-dependency constraint.

---

## Files Audited

- `src/renderer/overlays.js` — `OVERLAY_CSS` media block (134-198), `MEDIA_GLYPH` constants (227-237), `renderMediaBlocked`/`renderMediaUnmute`/`renderMediaPoster` (583-687), `wireActivation`/`safeActivate`/`anchorAffordance` (549-572), `show()` seam (701-710).
- `src/renderer/index.js` — `handleMedia` (1744-1765), `ensurePlaying` (1658-1676), `applyMediaAction` (1688-1731), `showBlockedPlayAffordance` (1630-1645), `evaluateUnmuteTrigger` (1778-1794), `safeInvokeMediaHook` (1614-1621), `applyMediaBaseline` (1805-1829), `gateFragmentMedia` (450-492), `gateAssetUrl` poster posture (118-170), dispatch `case STREAM.MEDIA` (1863-1864).
- `src/renderer/snapshot.js` — `CSP_META` (545-551), `gateSnapshotAssets`/`gateOneMediaTag`/`nextAssetOpener` (351-531).
- `.planning/phases/13-video-audio-url-playback-sync/13-UI-SPEC.md` (baseline), `13-CONTEXT.md`, `13-03-PLAN.md`, `13-01..04-SUMMARY.md`.
- Test evidence: `tests/renderer-media.test.js`, `tests/renderer-media-csp.test.js` (36/36); full top-level suite (540/540).
