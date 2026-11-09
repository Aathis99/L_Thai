# Next/Express/PostgreSQL migration implementation plan

> Execute independent frontend/runtime tasks with subagent-driven-development; root implements backend and data conversion. The user explicitly selected this stack and authorized migration and employee import.

## Contract
- Next.js/React/TypeScript in apps/web, Express/TypeScript + node-postgres in apps/api.
- Preserve legacy /api resource JSON contracts and permission rules; integer status flags and numeric ids retained.
- PostgreSQL on local port 5433, app API loopback4000, Next loopback3000 by default. LAN bind/origins configurable; actual host provisioning remains explicit.
- Preserve SQLite copy and source Excel. Import only names and phones from exact sheet พนักงาน ปี2569, serials1–36 -> EMP69-001..036; blank departments/positions, no automatic accounts. Reimport idempotent and never overwrite edits.
- No API keys, real employees, database passwords or raw Excel in source control or public screenshots.

## Tasks
- [x] PostgreSQL runtime: installed Docker or existing server, persistent storage, local-only database port, DBeaver connection notes.
- [x] API: schema migrations, async transactions and permissions, sessions, Express routing/error validation, parity regression suite against real PostgreSQL.
- [x] Frontend: actual React components, current Thai functionality and responsive design, local assets, API proxy, typecheck/build.
- [x] Data: consistent SQLite backup, all existing tables and hashes migrate preserving ids, minimal XLS extraction, one-transaction validated import, source/count reconciliation and repeated-run tests.
- [x] Integrate startup/build scripts, README/offline LAN instructions, independent review, UI smoke test with separate test data, final application opened with real records protected by login.

## Decisions
- User selected separate Express rather than the initially proposed Next-only backend; backend also uses TypeScript for consistent types.
- Existing checkout has no Git metadata; operate in this supplied workspace and retain old server/tests as a rollback reference until migration validated.
- Do not change actual Excel workbook; use it as read-only employee source as requested.

