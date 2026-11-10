# Cross-machine Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Send and receive a matched Git commit, Docker database snapshot, private source files and AI context between two Windows computers via OneDrive.

**Architecture:** Node CLI creates immutable transfer folders with checksummed payloads and a manifest. Git transports code/context/selected project skills. Receive validates everything, detects local changes, backs up and transactionally restores Docker PostgreSQL. OneDrive completion is explicitly checked by the user; the CLI does not pretend a local copy proves upload completion.

**Tech Stack:** Node >=26, existing pg dependency, Git, Docker Compose, PostgreSQL 18, OneDrive.

**Spec:** docs/cross-machine-workflow-design.md (approved 2026-11-10; Docker source confirmed).

## Global Constraints

- Windows + Codex, Docker primary on both machines; use one machine at a time.
- Docker source is port 5434, never the legacy db:backup command on 5433.
- Back up destination before replacing data; stop on unshipped code/data.
- Keep secrets and database contents out of Git and tool output.
- Preserve pre-existing globals.css changes. Reuse current checkout on codex/cross-machine-handoff.
- No production restore during development. Rehearse with a separately named database only.

## Review Focus

- Partial/corrupt OneDrive transfer: reject before destination changes.
- Git mismatch/dirty tree: reject before destination changes.
- Unsent edits in database or private files: reject against last baseline; first receive rejects a nonempty unknown database.
- Unsafe paths and symlinks: reject before copying private files.
- Restore failure: preserve backup, use a single transaction, keep app stopped, do not record success.

### Task 1: Transfer integrity and tests

**Files:** scripts/handoff/core.mjs, tests/handoff.test.mjs.
**Interfaces:** writeBundle(directory, metadata, payloads), validateBundle(directory, commit), assertBaseline(previous,current).

- [x] Write and run failing tests for corruption, missing files, commit mismatch, traversal, unknown destinations and changed data.
- [x] Implement manifest validation and immutable publication; rerun tests.

### Task 2: Docker adapter and send/receive CLI

**Files:** scripts/handoff/database.mjs, scripts/handoff/cli.mjs, package.json, .gitignore, tests/handoff.integration.test.mjs.
**Interfaces:** database fingerprint/backup/restore; npm run handoff:send/receive/status; explicit --bundle and --cloud paths; ignored local state/config.

- [x] Write failing integration test against isolated DB, then implement snapshot/transactional restore and state baseline guards.
- [x] Rehearse backup/restore and blocked receives in isolated database; verify source fingerprint unchanged.
- [x] Send packages only after clean Git, current context, and commit pushed. Record baseline only once snapshot/publication succeeds.

### Task 3: Portable context and operating guide

**Files:** AGENTS.md, docs/CURRENT.md, docs/cross-machine-guide.md, selected .agents/skills/, README.md.

- [x] Add project startup/handoff instructions, current work summary, selected portable skill and home bootstrap guide.
- [x] Verify project skills have no machine-specific absolute dependency; provide private-file configuration and first-run setup instructions.
- [x] Run focused tests, full npm test, npm run check and fresh reviewer; address important findings.

## Execution record

- Ruling: implement inline in the current checkout on a feature branch, preserving existing user edits; no new worktree or dependency install needed.
- Ruling: no automatic Git commit/push or production restore while building. Provide commands; user source changes remain reviewable.

- Final verification: LTHAI_HANDOFF_TEST=1 npm test passed 42/42; npm run check passed. Fresh review has no remaining P1/P2. Production DB unchanged; initial transport follows commit/push.
- Ruling: retries reuse pending sends or retry app startup after receive; Windows file identity is case-insensitive; restore atomically replaces public and rolls back on failed verification. Fingerprints include normalized schema dump from the same exported read-only snapshot; unsupported database objects stop transfer.
