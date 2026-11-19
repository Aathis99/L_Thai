# Employee Column Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rehearse permanent employees column order on a separate restored QA database, preserving all data and dependencies.
**Architecture:** Explicit guarded transactional table rebuild; preserve owned serial sequence/state and recreate inbound/outbound constraints and indexes. No startup automation or production changes.
**Spec:** docs/employee-column-order-impact.md
**Tech Stack:** PostgreSQL18, pg, TypeScript, Docker.

## Constraints and interfaces

Order: id,code,prefix,first_name,last_name,department,position_id,phone,active,archived,created_at,updated_at,social_security_number,taxpayer_id. Reuse current codex checkout per desktop instruction. User authorized QA execution; no second approval before QA. Preserve all values, sequence state, constraints/index names, owner/defaults and foreign keys. Refuse unexpected dependency/metadata. Private data/backups/env in ignored folders only.

Root owns docs, scripts/verify-docker.mjs and private QA artifacts. Implementer owns new apps/api/src/employee-column-order.ts and apps/api/tests/employee-column-order.test.ts only; no shared edits or commits. Export reorderEmployeeColumns(pool,{expectedDatabase,dryRun?}) returning {status,employees}; caller must verify exact database. Independent reviewer read-only after implementation.

## Tasks

- [x] 1. Fresh Docker backup with verified SHA256, restore lthai_column_order_qa, verify target/count and save schema/data fingerprints privately.
- [x] 2. TDD integration: wrong target, full row/FK/sequence preservation, requested ordinal order, no-op repeat, dry-run and rollback on dependencies. Implement guarded rebuild and verify on QA synthetic schemas first.
- [x] 3. Make verification hash independent of object-key order with synthetic regression RED/GREEN. Do not use legacy native data as authoritative Docker snapshot.
- [x] 4. Run migration on restored QA; compare data and metadata, all five FK definitions and sequence ownership/state. Test API create/edit against synthetic isolated schema, then build/typecheck and affected suites. Measure migration duration without promising production downtime.
- [x] 5. Independent review, fix significant findings, update CURRENT and report QA evidence. Keep restored QA for inspection; no main deployment or deletion before acceptance.

## Review focus

FKs bind object IDs, not renamed names; serial sequence must survive old table drop; schema-wide index names collide during rebuild; DDL errors must roll back; repeated run must preserve later data. Every condition belongs to integration verification in task2/4.
