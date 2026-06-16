---
phase: 10
slug: npm-packaging-0-x-publish
status: complete
created: 2026-06-16
---

# Phase 10 Pattern Map

## Files Likely Modified

| File | Role | Existing Pattern | Phase 10 Guidance |
|------|------|------------------|-------------------|
| `package.json` | Package metadata, scripts, exports, deps | ESM package with explicit subpath exports and demo scripts | Convert export strings to condition objects with `"types"` first and `"default"` last; add types/package validation scripts and dev dependencies |
| `package-lock.json` | npm lockfile | Committed lockfile for reproducible CI | Update only through `npm install`/`npm install -D`; do not hand-edit |
| `.github/workflows/ci.yml` | Test CI | Node 20/22/24 matrix, `actions/checkout@v6`, `actions/setup-node@v6`, read-only permissions | Add package validation job or keep CI test job and add separate package workflow |
| `.github/workflows/publish.yml` | Release CI | New file | Use GitHub-hosted runner, `permissions: contents: read, id-token: write`, setup-node registry URL, package validation before gated publish |
| `README.md` | Main quickstart | Already user-facing, but stale in a few Phase 7/9 details | Refresh install/docs examples, avoid research metric claims, keep quickstarts concise |
| `docs/SECURITY.md` | Security contract | Strong must-never language | Package docs must preserve sandbox/CSP/sanitizer warnings |
| `src/*/README.md` | API docs | Subsystem-level API contracts | Link from package quickstarts instead of duplicating every API detail |
| `tests/*.test.js` | Node test suite | Uses `node:test`, `assert/strict`, temp servers, no extra test framework | Add package validation tests in same style, using temp dirs and child_process/exec where needed |

## Existing Scripts

Current scripts:

```json
{
  "test": "node --test tests/*.test.js tests/differential/*.test.js",
  "demo": "node bin/phantom-stream.js demo",
  "demo:playwright": "node bin/phantom-stream.js playwright-demo",
  "example:loopback": "node examples/serve.js"
}
```

Phase 10 should add scripts without breaking these names. Preferred additions:

- `types`
- `lint:package`
- `attw`
- `pack:dry-run` or `package:pack`
- `package:smoke`
- `package:check`

## Test Style

Follow existing tests:

- import from Node built-ins (`node:test`, `node:assert/strict`, `node:fs`,
  `node:child_process`, `node:path`, `node:os`);
- use temporary directories for install smokes;
- avoid network-dependent assertions except explicit npm registry checks in
  research/planning, not routine tests;
- assert exact package metadata strings and file inclusion/exclusion patterns.

## Release Workflow Pattern

Existing CI uses:

```yaml
permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22, 24]
```

Publish workflow should keep release permissions minimal and add only
`id-token: write` where npm trusted publishing needs it.

## Risks To Encode In Plans

- Package tarball accidentally includes `.planning/`, `reference/`, tests, or
  local context.
- Export map points at files that are not published.
- Type declarations do not line up with subpath exports.
- Release workflow can publish without validation or user-controlled approval.
- README quickstarts claim the package is published before the publish gate is
  actually completed.
