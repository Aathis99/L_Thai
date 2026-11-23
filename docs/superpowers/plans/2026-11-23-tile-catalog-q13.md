# Simplify tile register QA implementation plan

> **For agentic workers:** Use subagent-driven-development for the web task; parent owns API, QA data and documentation.

**Goal:** Apply approved Q13: a simple product register with all 161 imported rows, without separate preform setup or mesh-completion UI.

**Architecture:** Keep imported product storage and compatible internal schema. Present one register for search/view/add/edit. Defer advanced production setup UI and mesh completion; retain existing production modules with empty QA transactional data.

**Spec:** User Q13 approval on 23 November supersedes the earlier requirement to expose preform and mesh workflows in this QA iteration. Preserve four clay categories and laterite naming, source blanks and duplicate-code variants.

## Tasks

- [x] Web: single register, original description/notes/source row visible, edit notes, no preform/profile management or mesh completion panel. Tests and check.
- [x] API: preserve/edit optional description and notes, meaningful regression test for partial update preservation.
- [x] Data: verify QA target, backup QA with checksum and valid archive, transactionally clear production/finishing/stock/old types/demo products while retaining imported rows and unrelated master records. Inspect every dependent table before deletion.
- [x] Verify source parity, empty transactional tables, tests/build, restart only QA, inspect browser; update guide and CURRENT.

## Ownership

Web implementer owns apps/web only. Parent owns apps/api, QA scripts/data, docs. Reviewer is read-only. No agent may commit, touch main database or deploy main. Private scripts, backups and logs stay outside Git.

