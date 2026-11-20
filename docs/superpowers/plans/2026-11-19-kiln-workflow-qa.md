# Kiln Workflow QA Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable QA model to validate the agreed kiln workflow with persistent trial records and a separate restored PostgreSQL database.
**Architecture:** Add a QA-gated prototype module to the existing authenticated app. Read copied production catalogs/orders/sources; keep simulated plans, reservations, firings, QC, repairs, allocations and receipts in a versioned QA-only aggregate. No production inventory writes or deployable production migration are implied by this prototype.
**Tech Stack:** Existing React/Next.js, Express/TypeScript, PostgreSQL; no new runtime dependency.
**Spec:** docs/superpowers/specs/2026-11-19-kiln-workflow-design.md (approved for QA by user on 2026-11-19).

## Global Constraints
- Backup current lthai-docker/lthai before restore. Verify lthai_kiln_workflow_qa and limited lthai_kiln_qa user before any migration/test.
- Main web remains port 3001; QA web/API ports 3141/4141.
- QA-only data and credentials stay in .qa/ and .env, outside Git.
- This is the requested model, not a production rollout; controls are explicitly marked QA.
- Native execution in managed worktree on codex/kiln-workflow-qa. User authorized continuing work; no new execution-method approval is needed.

## Review Focus
- Two people reserve the same ready pieces: serialized writes and revision conflict, no overdraft.
- A rail can be reused while old round waits QC: rounds and physical rail state are independent.
- Repair partial readiness and repeated firing: no duplicate fresh-source debit or finished receipt.
- Grade policy absent: keep pending, never silently sell or stock a grade.
- Main connection or feature flag absent: prototype unavailable and refuses creating its table.

### Task 1: Isolated QA and baseline
**Files:** .qa/kiln-workflow/setup.mjs (private), .env (private), docs/CURRENT.md.
**Interfaces:** QA DATABASE_URL in .env; existing migrate(pool) remains the copied baseline only.
- [x] Backup/verify SHA-256, restore as limited QA owner, record target and baseline counts.
- [x] Install existing lockfile and run baseline check/tests against QA only.

### Task 2: Trial workflow model and store
**Files:** apps/api/src/kiln-prototype/model.ts, store.ts, routes.ts; apps/api/tests/kiln-prototype.test.ts; apps/api/src/app.ts.
**Interfaces:** transition(state, command, actor): State; summarize(state): derived counts. GET /kiln-qa/state; POST /kiln-qa/action {request_id,revision,command}; POST /kiln-qa/demo. Existing SessionRouteAccess enforces permissions.
- [x] Prove invariants with failing model tests: rail occupancy, reserve/release, three temperature ranges, partial QC, repair loops, grade policies, correction, retries and stale revisions.
- [x] Implement typed immutable transitions; persist only after successful validation, transaction + advisory lock; audit before/after.
- [x] Gate database name and KILN_QA_MODE, import actual copied source identities as read-only references, seed clearly synthetic examples on explicit demo action.
- [x] Run focused tests including database/API permission and gating checks.

### Task 3: Integrated trial workspace
**Files:** apps/web/src/components/kiln-prototype/{panel.tsx,forms.tsx,types.ts}; apps/web/src/components/workspace.tsx.
**Interfaces:** Api and SessionUser from existing web lib. All actions go through versioned QA endpoint; sources/grades/history use same state.
- [x] Add QA banner, guided scenario controls, kiln/rail summary, plan and prepare, firing/log, QC, repairs, grade allocation/stock, correction/history/report tabs.
- [x] Reuse existing visual components/styles; responsive desktop/mobile; preserve entered values on failed request; refresh on conflict.
- [x] Check/build; exercise real browser flow including safety failures and mobile view.

### Task 4: Review and deliver runnable QA
**Files:** docs/CURRENT.md, docs/kiln-qa-guide.md, this plan.
- [x] Run suite/build and review source with fresh reviewer; fix material issues and rerun affected checks.
- [x] Verify QA health, main health, QA-only tables, retained backup and synthetic trial totals; record exact limitations.
- [x] Leave QA running for user review and document URL, test login and walkthrough; no merge/main rollout or QA cleanup until review.

## Execution ledger
Ruling: user requested a QA model, so prototype persistence is a single versioned trial aggregate with read-only copied source references. Full production migrations/inventory integration follow after validating workflow. This avoids changing the production model before the user tries it, and must remain visibly QA-only.

2026-11-20 delivery: final narrow review found one material history defect (second defect entry omitted); fixed with a real-store regression RED→GREEN covering quantity change and rename. Fresh verification: 126 pass, 5 existing Python-dependent skips; check/build passed. Full suite was partitioned only to satisfy the incompatible exact QA database guards of the prototype and employee column-order tests; the temporary column-order QA database was removed. Browser checked rebuilt QA at desktop/390px; revision50 retained. Guide, private screenshots/access details, and CURRENT/handoff updated. QA remains running pending user review; no commit/merge/push or main deployment.
