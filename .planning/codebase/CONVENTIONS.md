# Coding Conventions

**Analysis Date:** 2026-06-09

## Two-Style Codebase

PhantomStream contains two distinct style zones that must not be mixed:

| Zone | Path | Style | Module System |
|------|------|-------|---------------|
| New framework | `src/` | ES modules, named exports, JSDoc | ESM (`export`/`import`) |
| FSB reference | `reference/extension/`, `reference/server/` | IIFE / CommonJS globals, `var` | CJS (`require`) or IIFE |

All new code in `src/` follows the **new-style** conventions described below. The reference code in `reference/` is verbatim FSB source — **do not apply new-style conventions there**.

---

## Naming Patterns

**Files:**
- Lowercase, hyphen-separated: `constants.js`, `envelope.js`, `messages.js`
- Index barrel files named exactly `index.js`
- Test files: `<module>.test.js` (e.g., `protocol.test.js`)

**Functions:**
- `camelCase` for all functions: `encodeEnvelope`, `decodeEnvelope`, `createStreamSessionId`, `isCurrentStream`, `isCompressedEnvelope`
- Boolean predicate functions prefixed `is`: `isCurrentStream`, `isCompressedEnvelope`
- Factory functions prefixed `create`: `createStreamSessionId`
- Encode/decode pairs named symmetrically: `encodeEnvelope` / `decodeEnvelope`

**Variables:**
- `camelCase` for local variables and parameters
- `UPPER_SNAKE_CASE` for module-level constants: `RELAY_PER_MESSAGE_LIMIT_BYTES`, `SNAPSHOT_BUDGET_BYTES`, `SCROLL_THROTTLE_MS`, `NID_ATTR`

**Constants:**
- Plain `const` for computed derivations: `SNAPSHOT_BUDGET_BYTES = Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES * SNAPSHOT_BUDGET_FRACTION)`
- Object literals for grouped enum-like constants: `export const CONTROL = { START: '...', STOP: '...' }`, `export const STREAM = { SNAPSHOT: '...', ... }`, `export const DIFF_OP = { ADD: '...', ... }`

**Types (JSDoc `@typedef`):**
- `PascalCase` for typedef names: `LZCodec`, `SnapshotPayload`, `DialogPayload`

---

## Code Style

**Formatting:**
- No formatter config file detected (no `.prettierrc`, `biome.json`, `.eslintrc`)
- Observed style: 2-space indentation, single quotes, no trailing commas in function signatures
- `var` is used in `envelope.js` (new framework) for cross-runtime compatibility — intentional, not a mistake
- `const`/`let` used in `reference/server/ws-handler.js` (Node.js target)

**Linting:**
- No linting config detected

---

## Module System

**New `src/` code:**
- Pure ES modules: `export const`, `export function`, `export *`
- Explicit `.js` extensions on all relative imports (required for native ESM): `import { ... } from './constants.js'`
- Barrel `index.js` re-exports everything: `export * from './constants.js'; export * from './messages.js'; export * from './envelope.js'`
- Package `exports` field maps subpath to module: `"./protocol": "./src/protocol/index.js"`

**Reference `reference/` code:**
- Extension content scripts: IIFEs with `window.FSB` namespace attachment
- Service worker: `var` globals (no `import`/`export`) loaded by Chrome MV3
- Server: CommonJS `require`/`module.exports`

---

## Import Organization

**New-style test files:**
```js
import { test } from 'node:test';           // 1. Node built-ins (node: protocol)
import assert from 'node:assert/strict';    // 2. Node built-ins
import { ... } from '../src/protocol/index.js';  // 3. Local source (relative, .js extension)
```

**Order:**
1. `node:` built-in imports
2. Third-party package imports (none yet in `src/`)
3. Local relative imports with explicit `.js` extension

---

## Dependency Philosophy

**`src/` modules are dependency-free by design.** The LZ-string codec in `src/protocol/envelope.js` is injected at call time (`encodeEnvelope(msg, lz, threshold)`) rather than imported. This keeps the module usable in any runtime: extension content script, service worker, browser page, or Node.

```js
// Correct: caller provides the codec
export function encodeEnvelope(msg, lz, thresholdBytes) { ... }

// NOT correct for this codebase:
import LZString from 'lz-string';  // would tie to npm dependency
```

---

## Error Handling

**Return-value errors (new style):**
- Functions that can fail return discriminated union objects: `{ok: true, msg}` or `{ok: false, error: string}`
- Error strings are lowercase, hyphen-separated identifiers: `'json-parse-failed'`, `'decompress-unavailable'`, `'decompress-failed'`, `'inner-json-parse-failed'`
- No exceptions thrown from protocol functions — callers always check `.ok`

```js
// Pattern used in envelope.js
try {
  outer = JSON.parse(raw);
} catch (e) {
  return { ok: false, error: 'json-parse-failed' };
}
```

**Reference-style error handling:**
- `try/catch` blocks with console logging (`logger.error(...)`)
- Early-return guards: `if (!url || typeof url !== 'string') return true`

---

## Comments

**File-level comment block (new style):**
- Plain `//` comment at top of file stating what the file is, where it was extracted from, and any compatibility notes

```js
// PhantomStream compression envelope.
//
// Large payloads travel as a self-identifying envelope { _lz: true, d: <base64> }
// ...
// The LZ-string implementation is injected rather than imported so this module
// works in any runtime ...
```

**Function-level JSDoc (new style):**
- All exported functions have JSDoc blocks with `@param`, `@returns`, and inline commentary on design constraints
- `@typedef` blocks describe payload shapes rather than separate type files

```js
/**
 * Encode a message object for the wire.
 * @param {Object} msg                 The full message ({ type, payload, ... })
 * @param {LZCodec} lz                 LZ-string (or compatible) codec
 * @param {number} [thresholdBytes=0]  Compress only when the JSON exceeds this size
 * @returns {string} JSON string ready to send
 */
```

**Inline comments:**
- Numeric literals always have a comment explaining units and derivation: `1048576; // 1 MiB`
- Phase references in comments link constants to the FSB phase that introduced them: `// Phase 211-02`, `// FSB Phase 122.3 backward-compatibility requirement`

**Constant grouping:**
- Thematically related constants grouped with a blank line and a short prose comment above the group

---

## Function Design

**Purity:** Protocol functions are pure — no I/O, no global state, no `Date.now()` calls. Entropy is passed in by the caller:
```js
// Caller supplies entropy so the protocol layer stays pure (and replayable in tests)
export function createStreamSessionId(nowMs, rand) {
  return 'stream_' + nowMs.toString(36) + '_' + rand;
}
```

**Size:** Functions are focused; the largest in `src/protocol/` is `decodeEnvelope` (~22 lines). No mega-functions.

**Parameters:**
- Optional parameters use `||` defaulting inline, not destructuring defaults (for cross-runtime compat): `var threshold = thresholdBytes || 0`

**Return Values:**
- Return discriminated unions for fallible operations
- Return plain primitives/objects for infallible operations

---

## Module Design

**Exports:**
- Named exports only, no default exports in `src/`
- Constants exported as `const` objects (not frozen, but treated as immutable by convention)
- Barrel `index.js` re-exports all named exports from sub-modules

**File organization within a module:**
1. File-level comment block
2. `@typedef` blocks
3. Functions (exported), in logical grouping (encode then decode, or: constants → factory → guards)

---

## Wire Protocol String Conventions

Message type strings use prefix-colon namespacing preserved from FSB for backward compatibility:
- `'ext:...'` — capture host → viewer messages
- `'dash:...'` — viewer → capture host messages

Diff op codes are short lowercase strings: `'add'`, `'rm'`, `'attr'`, `'text'`

Stream session IDs have a deterministic format: `'stream_' + nowMs.toString(36) + '_' + rand`

---

*Convention analysis: 2026-06-09*
