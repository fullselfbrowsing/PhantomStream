---
status: partial
phase: 01-capture-core-extraction-differential-oracle
source: [01-VERIFICATION.md]
started: 2026-06-10T06:30:00Z
updated: 2026-06-10T06:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. GitHub Actions CI matrix run

expected: Push the branch and confirm the `CI` workflow goes green on Node 20, 22, and 24 (50/50 tests including the purity gate and differential oracle). Local proof covers Node 24 only; review-fix CR-01 (`9db86b2`) changed the test script specifically for Node 20/22 glob portability — only a real matrix run confirms it.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
