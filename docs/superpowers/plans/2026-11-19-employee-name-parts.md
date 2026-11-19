# Employee Name Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace employees.name with prefix/first_name/last_name and rehearse the approved 2569 import on QA.

**Architecture:** Three canonical text fields; computed full names at rendering/query boundaries. Explicit guarded transaction upgrades existing data; app startup refuses an unmapped old schema. Foreign keys remain unchanged.

**Tech Stack:** PostgreSQL 18, Express/TypeScript, Next.js/React, Node test runner, Docker.

**Spec:** docs/superpowers/specs/2026-11-19-employee-name-parts-design.md

## Global Constraints

- prefix optional max40; first_name required max120; last_name optional max120; trim/collapse whitespace; join nonempty parts with one space.
- No employees.name stored or returned by employee CRUD; name-only payload rejected; unrelated name fields unchanged.
- Preserve employee IDs/codes/relationships and users.name. Source36 plus extra employee37 preserved. Source blanks preserve existing values.
- Fresh Docker backup + verified separate QA database before migrations/tests. No production data writes or production deployment in this authorization.
- Private source/mapping/backup outside Git. No blind international-name splitting.

## Review Focus

- Multiword international first names remain one field: API/import/web test.
- Custom prefix is cleared when switching to standard/blank: web payload test and browser.
- Concurrent source-row changes abort whole upgrade: guarded upgrade integration test.
- Existing legacy name-only schema refuses startup without changing records: migration test.
- A legacy SQLite source cannot supply three new columns: legacy importer mapping test and missing-map rollback.

## Execution contract and ownership

Use current codex/pressing-menu checkout per desktop instruction to reuse suitable current checkout. Existing documentation changes belong to this task. No automatic commits/push. Native Windows commands replace Bash-only skill bookkeeping. Ledger: .qa/employee-name-parts/progress.md.

Agent API owns apps/api/src except import.ts/commands.ts and employee-upgrade.ts; API tests except import.test.ts and employee-upgrade.test.ts. Agent Web owns apps/web. Root owns import.ts/commands.ts/employee-upgrade.ts, import/upgrade tests, scripts, docs and private QA artifacts. Do not edit another owner's files; send interface changes to root. Independent API/web tasks may run together. All DB tests explicitly receive QA DATABASE_URL.

### Task 1: Fresh backup and QA target

**Files:** Private .qa/employee-name-parts and data/backups; compose.docker.yaml read-only.
**Interfaces:** Produce verified QA URL/database name and source mapping with expected old values/hash.
- [x] Back up Docker lthai following docs/docker.md; verify SHA256; restore separate lthai_employee_names_qa.
- [x] Verify current_database and employee count37; expose no credentials in output.
- [x] Generate corrected Markdown/staging from XLS C/D directly, masks for approved eight zero restorations, approved typo/conflict corrections, explicit extra-person mapping.

### Task 2: Structured API and production readers

**Files:** apps/api/src/database.ts, app.ts, employee-names.ts, pressing/catalog.ts, pressing/stock.ts, finishing/glazing.ts; affected API tests.
**Interfaces:** EmployeeNameParts {prefix:string;first_name:string;last_name:string}; SQL projection uses concat_ws/nullif; CRUD returns parts, no name. Export migrate(pool) unchanged; old name column causes descriptive refusal before mutation.
- [x] Add failing tests for structured create/edit/read, required/length/whitespace/multiword inputs, rejected legacy payload, unchanged identifiers and production labels.
- [x] Run targeted API tests on QA; observe missing behavior fail.
- [x] Implement minimal validation, schema/readers, convert affected test fixtures; do not change imports/commands owned by root.
- [x] Verify API tests and typecheck; report evidence to root.

### Task 3: Employee UI and every web consumer

**Files:** apps/web/src/lib/types.ts, model.ts, employee-names.ts; components/dialog.tsx, record-table.tsx, pressing/production.tsx and dependent types/tests.
**Interfaces:** Employee parts replace name; formatEmployeeName(parts) computes nonempty one-space join. API submit prefix text (not Other sentinel).
- [x] Add failing tests for formatting, payload custom/standard/blank prefix, multiword names and search.
- [x] Run node tests to observe missing behavior fail.
- [x] Implement create/edit fields, custom prefix lifecycle, display/search/account choices/worker options; preserve users.name and unrelated fields.
- [x] Verify web tests and typecheck; report evidence to root.

### Task 4: Explicit upgrade, importers and QA data

**Files:** apps/api/src/employee-upgrade.ts, import.ts, commands.ts; apps/api/tests/employee-upgrade.test.ts, import.test.ts; scripts/qa-server.mjs, enrich-employees.mjs, reconcile-data.mjs.
**Interfaces:** upgradeEmployeeNames(pool,payload,{dryRun?,expectedDatabase}) performs guarded transaction; mapping includes id/code/expected name+identifiers, new parts/identifiers and source hashes. Legacy migration accepts reviewed name-parts mapping; SQLite SELECT list stays old.
- [x] Write failing integration tests: target mismatch, guard conflict rollback, valid upgrade removes column/preserves IDs, second run unchanged, missing-map legacy rollback.
- [x] Run tests against QA, observe missing implementation fail.
- [x] Implement dry-run + upgrade + explicit CLI before normal migrate; run proposed changes on QA only after verification.
- [x] Update structured import payload/validation/duplicate checks and supported scripts; reject unmapped legacy names.
- [x] Run import/upgrade suites; compare all 37 QA rows and unaffected table fingerprints.

### Task 5: Integrate, review and offer QA

**Files:** docs/CURRENT.md, private QA verification logs; optional QA compose config outside Git.
- [x] Run npm run check, API/web/import/legacy tests on QA and production build; record failures/limits honestly.
- [x] Start isolated QA API+web on 4133/3133; verify health and browser create/edit/read, custom prefix, blank surname, search, account labels, production names and mobile.
- [x] Fresh reviewer checks whole change against spec and ownership; fix important findings with regression tests.
- [x] Update CURRENT with exact QA state, backup paths, URL and remaining production approval. Keep QA available for user review; do not deploy main or drop review database yet.

## Self-review

Spec sections mapped to tasks1–5; shared interfaces fixed above. User explicitly authorized planning and starting QA, so no second plan-approval gate. Root coordinates cross-owner changes. No commit is needed for reviewable QA; do not stage private artifacts.
