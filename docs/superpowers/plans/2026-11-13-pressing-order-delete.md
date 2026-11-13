# Pressing Order Deletion Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task by task.

**Goal:** Let pressing managers remove unused production orders and retain an audit record.

**Architecture:** Use the existing pressing write transaction and foreign keys. Return reference status in the order list and reuse the pressing form dialog.

**Tech Stack:** Express, PostgreSQL, React, TypeScript.

**Spec:** [Delete unused production orders](../specs/2026-11-13-pressing-order-delete-design.md)

## Global Constraints

Test writes go to a separate QA database restored from a fresh main Docker backup. A pressing entry or issue reference blocks deletion regardless of its net quantity. Use existing permissions and audit storage. Confirmation requires no reason field.

## Steps

- [x] Add API tests for deletion, permissions, audit, and rejection once pressing or issuing references an order. Run against QA and verify the tests fail on the old endpoint.
- [x] In `catalog.ts` return `has_entries` and `has_issues` on each order and implement guarded removal. In `routes.ts` route DELETE through the existing manage transaction and write audit details.
- [x] In `pressing.ts` type the reference flags. In `orders.tsx` show the delete confirmation or the reason the order cannot be deleted. Reuse the shared dialog and refresh pressing data after success or a stale reference conflict.
- [x] Run the API tests against QA, the web tests, and type checks. Exercise the confirmation in the QA web app before reporting.
