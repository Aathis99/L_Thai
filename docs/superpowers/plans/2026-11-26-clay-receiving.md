# Clay receiving implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver receiving, raw clay stock, mill issues and counted-stock adjustments in isolated Docker QA.
**Architecture:** Add a raw-clay module using existing database transactions, sessions, employees and clay identities. Keep receipt names as history; calculate stock by type/color with count anchors. Existing pressing stock is unchanged.
**Tech Stack:** TypeScript, Express, PostgreSQL, React/Next, sharp, Docker.
**Spec:** ../specs/2026-11-26-clay-receiving-design.md

## Global Constraints
- QA only; fresh main backup restored to separate database before writes. Main port 3001 unchanged.
- Images 1–3 on confirmed receipts; WebP <=1 MiB, <=2560px; input <=8 MiB.
- No costs/VAT, no lot tracing, no waiting-opening mode. Preserve counted quantities when older documents change.
- Respect existing unrelated skill edits. Use current checkout on codex/clay-receiving-qa.

## Review Focus
- Concurrent issues and repeated commands: no overdraft or duplicated movements.
- Multiple count anchors and backdated corrections: recompute deltas, preserve counts.
- Missing weigh fields: explicit missing-data note, validate complete pairs only.
- Image revisions and failed commands: no lost evidence or partially applied documents.
- Permissions and browser errors: unauthorized access rejected; failed forms retain values.

## Boundaries and contract
- Backend implementer owns apps/api/src/raw-clay/, apps/api/tests/raw-clay*, and integration in apps/api/src/app.ts/database.ts.
- Frontend implementer owns apps/web/ only; read its AGENTS.md and bundled Next docs first.
- Root owns QA scripts/config, data/backups, docs and integration verification; no other agent edits those.
- API/UI coordinate exact payload contract in .qa/clay-receiving/contract.md before UI calls. No cross-boundary edits; send changes to owner.
- Root reviews completed changes against spec, runs full checks and Docker QA, and performs independent review before delivery.

### Task 1: Safety and QA restore
- [x] Fresh main pg_dump/custom archive and SHA256 recorded privately.
- [x] Restore into lthai_clay_receiving_qa with restricted role and verify current_database/current_user before writes.
- [x] Prepare QA-only compose, ports 3170/4170 and credentials outside Git.

### Task 2: Domain, persistence, API and evidence
**Files:** apps/api/src/raw-clay/{model,schema,store,routes,images}.ts; apps/api/src/{app,database}.ts; apps/api/tests/raw-clay*.test.ts.
**Interfaces:** authenticated /raw-clay/state, /raw-clay/action, private image upload/read; exact shared contract in private contract.md.
- [x] Write tests first: receipt draft has no stock; confirm two names produces one WHITE stock; issue reduces kg; second concurrent overdraft fails.
- [x] Observe RED via API test runner, implement exact decimal quantities and count-anchor replay.
- [x] Assert receive100/issue20/count50/correct receive120 =>50, delta -50; subsequent issue10=>40; multiple anchors retain their targets.
- [x] Add idempotent additive migration, revision/idempotency, atomic evidence/history/audit, permissions and app routes.
- [x] Test missing fields, image limits/history, conflicts, permission failures, correction/cancellation and unchanged pressing stock. Observe GREEN.

### Task 3: Product UI
**Files:** apps/web/src/components/raw-clay/, apps/web/src/lib/raw-clay.ts, apps/web/src/components/workspace.tsx; apps/web/tests/raw-clay.test.ts.
**Interfaces:** API contract from Task 2; existing Api and SessionUser props.
- [x] Write focused validation/weight/time/permission tests first, observe RED.
- [x] Implement receiving forms, stock, issues, adjustments and history; names remain receipt history, issue by type/color; 24-hour local times.
- [x] Add 0–3 draft photos/1–3 confirmed, protected image viewing, reasoned correction/cancel and stale-form errors retaining inputs.
- [x] Run web tests and typecheck GREEN, inspect pages in QA.

### Task 4: QA seed and verification
**Files:** .qa/clay-receiving/ scripts and compose (private); docs/clay-receiving-qa-guide.md; docs/CURRENT.md.
- [x] Run migration twice only on verified QA; compare original table data before/after except intentional permissions/audit.
- [x] Seed six private Markdown source rows, explicit simulated missing fields and marked sample images; omit sand/prices and never seed main.
- [x] Run repository tests/typechecks and Docker QA builds; inspect live receive/issue/adjust/correct flow, image loading, errors, main health.
- [x] Independent whole-change review, fix substantive findings, document usable QA URL and private login location.
- [x] Keep QA for user acceptance. Main promotion and QA cleanup occur only after later user acceptance/data selection per AGENTS.md.

Execution authorized by user: start development in QA. Proceed continuously without another plan-approval question.
