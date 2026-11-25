# QC Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved LT-PD-S-01 document workflow with drafts, partial confirmation, source traceability and versioned A4 printing.

**Architecture:** Extend the existing kiln workflow state additively with optional `qcDocuments`; all document mutations run under the existing state row lock, request replay, catalog version and audit transaction. A document entry confirms into the existing per-load Qc records, so repair/allocation/stock retain their source IDs. Official report snapshots remain immutable inside document history.

**Tech Stack:** Express/TypeScript/PostgreSQL; React/Next.js; browser A4 print CSS; node:test/tsx.

**Spec:** [Approved QC design](../specs/2026-11-25-qc-document-design.md), approved for development 25 November 2026.

## Global Constraints

- One document per round + product/production type/clay/clay color/glaze identity; preserve per-load and per-order quantities.
- New results allow only A+, waste, underfired and touchup. Retain persisted A-/B and their downstream records.
- Drafts never change confirmed quantities; confirmed partial entries feed existing downstream operations immediately.
- Input quantity is read from fired loads; output equals input. Waste is the sum of main symptoms; never derive A+ from uncounted material.
- `QC-2569-000001` uses Bangkok creation year, immutable sequence and all source order references.
- Official snapshots require complete confirmed quantities, worker/date/header data and no pending drafts. Corrections require reason, permission and coherent downstream quantities.
- Work in the existing checkout per recorded project preference; unrelated skill edits stay untouched. Main Docker images/database are not updated during QA.
- Fresh main backup restored and verified in `lthai_qc_documents_qa` with its own role before any DB-writing verification. Secrets/backups remain outside Git.

## Review Focus

1. Same product across two orders: grouping must not assign one order's rejects to another (Task 1 tests).
2. Concurrent confirmation/retry: no duplicate Qc, document number or official version (Task 2 DB tests).
3. Old A-/B history: remains readable while new direct/API paths reject retired grades (Tasks 1–2).
4. Partial confirmed with pending draft: draft must not inflate stock/repair or appear as official (Tasks 1, 4).
5. Correction after downstream use or official issue: atomic rejection and immutable old snapshot (Tasks 1–2, 4).

## File Map and Interfaces

- `apps/api/src/qc-documents/model.ts`: document/entry/report types, grouping, commands and projection; exports `transitionDocument(state, command, context): Model`, `documentReport(state, document): QcReport`, `documentCandidates(state): Candidate[]`, `synchronizeDocuments(before, after): Model`.
- `apps/api/src/qc-documents/types.ts`: shared serialization-only types for browser and API; `Model.qcDocuments?: QcDocument[]` references these types.
- `apps/api/src/kiln-workflow/store.ts`: resolve worker context, route document commands, return worker name projection, enforce direct-QC/retired-grade boundaries and synchronize correction state.
- `apps/api/src/kiln-workflow/routes.ts`: existing permission map extended for document commands and correction dependencies.
- `apps/web/src/components/qc-documents/{page,entry-form,report}.tsx`, `helpers.ts`, `print.css`: document list/detail, per-source entry editing, source navigation, pure helpers and printable snapshots.
- Integrate through `kiln-prototype/area.tsx` and `panel.tsx`; keep repair/allocation and historical paths available. Update active entry/policy choices without deleting persisted grade types.
- Tests: `apps/api/tests/qc-documents.test.ts`, `qc-documents-store.test.ts`, affected kiln integration tests and `apps/web/tests/qc-documents.test.ts`.
- `.qa/qc-documents/`: private runtime, compose, test logs and evidence. No generated secrets or DB fixture dumps committed.

### Task 1: Document domain and QA safety

**Consumes:** existing `Model`, `transition`, `rootItem`, `loadById`.
**Produces:** `QcDocument`, `QcEntry`, `QcReport`, functions in File Map; optional state extension preserves old JSON.

- [ ] Verify fresh backup checksum/archive and restored QA database/role; record manifest and baseline row fingerprints before schema/test writes.
- [ ] Write failing pure tests for grouping, different colors, multiple orders, zero-side-effect draft, partial confirm, per-load bounds, retired grades, rework and unchanged historic grades.
- [ ] Run `npx tsx --test apps/api/tests/qc-documents.test.ts` and observe expected missing feature failures.
- [ ] Implement six commands: `qc-document-open`, `qc-draft-save`, `qc-draft-delete`, `qc-draft-confirm`, `qc-document-correct`, `qc-document-issue`. Context supplies `now`, `actor`, and minimal worker identities. Official issue returns same snapshot on unchanged content.
- [ ] Add tests for complete/incomplete official, extra drafts, inactive workers retained on corrections, metadata correction and immutable old report; implement to green.
- [ ] Commit domain and tests.

### Task 2: Production store/API integration

**Consumes:** Task 1 commands and types.
**Produces:** existing `/kiln/state` includes `qcWorkers`; `/kiln/action` supports document commands with existing revision and idempotency contracts.

- [ ] Write failing DB tests in a temporary schema owned by the verified QA role: draft unchanged confirmed/stock, confirm creates per-load Qc once, retry same body replays, stale revision rejected, official snapshot retry, correction rollback after downstream consumption.
- [ ] Add API tests for read/QC/correct permissions, employee projection without private personnel fields, grade/API bypass, and direct QC only for existing historical groups.
- [ ] Extend catalog identities and document context; dispatch document commands before existing model commands; run existing validation, debit/stock projection, mesh checks and audit under the same transaction.
- [ ] Ensure `correct` changes to document-owned Qc require a reason and worker/date edits route through document correction. Invalidate current official on report changes without overwriting prior reports.
- [ ] Update affected existing integration fixtures to enter new QC through documents; retain explicit historical A-/B compatibility assertions.
- [ ] Run targeted API tests against QA; expected zero failed. Commit store/API and tests.

### Task 3: Document-first UI

**Consumes:** Task 2 state and mutation response plus serialization types.
**Produces:** QC area opens document list/detail; confirmed downstream actions remain accessible.

- [ ] Read applicable installed Next.js client/CSS guidance before React code.
- [ ] Write failing helper tests for safe per-load form parsing, defect sums, Thai/Bangkok formatting, search by every reference, draft vs confirmed totals and print status.
- [ ] Implement list with search/date/kiln/status, candidate creation, document summary, per-order/load history and actual worker selection.
- [ ] Implement save/edit/delete draft, review/confirm, correction reason, original request reuse on retry and revision conflict recovery. Show explicit errors and retain user input on ordinary validation errors.
- [ ] Remove A-/B from new result and policy choices while showing old data/allocations explicitly as history. Keep existing repair/allocation operations and source links.
- [ ] Run helper tests and `npm run check`; commit UI.

### Task 4: Official and draft A4 reports

**Consumes:** `QcReport` and official report histories from Task 1.
**Produces:** draft/current/old report rendering and browser print without operational side effects.

- [ ] Write failing report/helper assertions for all four outcomes, total symptom counts, header order references, draft markers, immutable snapshot display and revised-number labels.
- [ ] Implement A4 portrait with form number, stable QC number, header, worker/date ranges, all defects, signatures and per-order/entry appendices; repeat document identity on continued pages.
- [ ] Add no-pending-draft/completeness gate; create official on server, reprint same snapshot, label superseded reports. Browser print merely requests print and never claims printer success.
- [ ] Run web tests and build; commit reports and CSS.

### Task 5: Integrated verification, QA release and review

**Consumes:** Tasks 1–4, isolated QA runtime.
**Produces:** QA URL, meaningful acceptance evidence and reviewer-cleared code ready for user testing.

- [ ] Run complete relevant API/web suites, legacy tests, typecheck and Docker QA builds. Logs outside Git; record skips accurately.
- [ ] Run migration/re-read twice against the copied QA data and compare original table fingerprints, excluding deliberate QA fixtures and event writes. No main database writes.
- [ ] Start only QA API/web on ports 4160/3160 with QA-only credentials; assert runtime target and main 3001 remains healthy.
- [ ] Exercise multi-order partial QC → repair/stock, correction conflict, official/reprint/revised report and long Thai A4 pagination in browser; test writes remain QA.
- [ ] Dispatch one whole-change read-only reviewer against base `e48134b`; fix important issues with regression tests and rerun affected verification.
- [ ] Update CURRENT, approved spec status and QA guide/ledger with evidence and remaining limits; commit. Leave QA for user review. Production cutover waits for user acceptance and selected-data decision, per AGENTS.md.

## Self-review

Progress 25 November 2026: Tasks 1–4 implemented; review fix pass completed with regression tests. Task 5 automated checks and interactive partial/full/correction/concurrent-editor flows passed (API137, web57, legacy14; 9 API skips). Physical PDF/A4 pagination acceptance remains open because native Brave control failed with geometry/window-bounds errors. QA remains available for user acceptance; production cutover is not authorized yet. See `docs/qc-qa-guide.md` for the concrete review state.

The five tasks cover every approved design section: source ownership/grouping (1–2), drafts/partial/legacy (1–3), document-first UI/worker/date (3), numbering and immutable prints (1,4), corrections/dependencies (1–2,3), QA/backups/review (5). Shared types live in one serialization-only file; no document mutation owns a separate inventory ledger. Windows uses private PowerShell setup/test wrappers and existing checkout instead of requiring a new shell/worktree.

Execution ruling: user approved both the design and starting development, so proceed Native without asking for repeated plan approval. This preserves the already authorized scope; production cutover remains a distinct acceptance/data-selection step.
