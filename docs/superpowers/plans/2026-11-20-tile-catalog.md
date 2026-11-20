# Tile Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปิดรุ่น QA ที่มีทะเบียนครบ 161 รายการ เลือกดินในใบสั่ง ใช้แบบดินปั๊มร่วมอย่างมีการยืนยัน และบันทึกติดตาข่ายเป็นแผ่นย่อยบางส่วนได้

**Architecture:** แยกสินค้า/แบบดินปั๊มออกจาก pressing_types ซึ่งเป็นประเภทผลิตรายดิน รักษา primary key เดิมและเก็บ snapshot ใบสั่งใหม่ งานติดตาข่ายอ้างเอกลักษณ์การจัดสรร QC และแยกยอดพร้อมส่งออกจากยอดผ่าน QC ที่กันให้ออเดอร์

**Tech Stack:** PostgreSQL 18, Express/TypeScript, Next.js 16.4.5/React 19.3.1, node:test/tsx

**Spec:** [แบบที่ผู้ใช้ยืนยัน](../specs/2026-11-20-tile-catalog-design.md)

## Global Constraints

- ใช้ดินแดง ขาว ศิลาแลง และสี ดินสีแยกชื่อสีที่ผสม; เก็บครบ 161 รายการ / 152 รหัส ไม่รวมจากชื่อหรือขนาด
- ขนาดนิ้ว ความหนามิลลิเมตร มิติที่สองว่างได้ ไม่เติมค่าผลิตสมมติ; เปิดผลิตเฉพาะค่าที่พร้อม
- งานติดตาข่ายต้องมีออเดอร์ลูกค้า เลือกจากรุ่นที่รองรับ นับเป็นแผ่นย่อย บันทึกบางส่วน และพร้อมส่งเฉพาะยอดติดเสร็จ
- รักษา id/FK/ยอดเดิม ไม่เดาจับคู่ประเภท 2×8 เดิมกับรหัสสินค้า; raw input/staging/backups อยู่นอก Git
- ก่อน migration/test สำรอง Docker หลักและกู้ QA ใหม่ ตรวจ current_database; ห้าม test write ลง lthai หรือ restore QA ทับหลัก
- รุ่นนี้เป็น QA เท่านั้น ไม่มี merge/deploy หลักจนผู้ใช้ตรวจรับและเลือกข้อมูล

## Review Focus

- รหัสซ้ำ/ชื่อซ้ำและมิติเดียวต้องคงตัวตน; ทดสอบ import รันซ้ำไม่เพิ่มและช่องว่างไม่ล้างค่าที่แก้แล้ว (Task 1/5)
- เปลี่ยนทะเบียนหลังเปิดใบต้องไม่เปลี่ยนไม้/วันพัก/อัตรา/ดิน/สินค้าในใบเดิม (Task 2)
- สินค้าลายต่างกันใช้ดินพื้นร่วมได้แต่ QC/สินค้าสำเร็จไม่รวมต่างรหัส (Task 2/3)
- projection QC ที่ลบเขียนใหม่และการย้อน QC ต้องไม่ทำประวัติติดตาข่ายหายหรือเปิดใช้ยอดซ้ำ (Task 3)
- QA cookie/URL/credentials แยกจาก main; browser จอมือถือและบัญชีอ่านอย่างเดียวไม่เขียนข้อมูล (Task 5/6)

## Task 1: Catalog schema and API

**Files:** Create apps/api/src/tile-catalog/{schema,catalog,routes}.ts; modify database.ts/app.ts; test apps/api/tests/tile-catalog.test.ts.

**Interfaces:** GET /catalog/state -> {products,bodies,profiles}; products have id,product_code,name,shape,size_1,size_2,size_unit,thickness_mm,mounting_type,body_id,active. Bodies have id,name and dimensional fields. Profiles retain TileType fields plus body_id; nullable width/length for nonrectangles. POST/PUT /catalog/products[/id], /catalog/bodies[/id], /catalog/profiles[/id] -> {id}. Read pressing.read, write pressing.manage. Profiles only exist when rack/rest/destination/rate are complete. Legacy profile IDs survive and may be explicitly linked to a verified body.

- [ ] Write integration tests for independent duplicate codes, null second dimension, draft products, four clays, separate color mixtures, referenced-identity preservation and permissions; run targeted tests RED on restored QA.
- [ ] Add idempotent additive migration: tile_products, tile_bodies, pressing_types.body_id and nullable geometry, order snapshot columns; rename current operational จ้อ values/constraints to ศิลาแลง without rewriting historical request payloads.
- [ ] Implement catalog CRUD/validation and canonical clay enum; retain legacy API compatibility while preventing identity changes to used profiles.
- [ ] Run targeted tests GREEN and check; commit Task 1.

## Task 2: Orders, shared preforms and downstream identity

**Files:** modify pressing/catalog.ts, pressing/stock.ts, finishing/schema.ts/routes.ts/qc.ts, kiln-workflow/store.ts/model types; extend catalog tests.

**Interfaces:** POST /pressing/orders accepts product_id plus existing type_id and fields. Validate profile belongs to verified product body and product active; requires_mesh derived from mounting_type. Store product_snapshot, requires_mesh, production_clay_color, production_pieces_per_rack, production_rest_days and existing rate/destination/clay. listOrders adds product_name/product_code/requires_mesh. Legacy orders remain usable. Profile identity is body+clay+color mixture, not sales product.

- [ ] Write RED tests: unconfigured product cannot order, mismatched profile rejected, mesh stock-purpose rejected, completed order snapshot survives changed profile; legacy IDs unchanged.
- [ ] Enforce product/profile selection and immutable snapshots; pressing entries take rack/rest/rate from order snapshots, with legacy fallback only where snapshot absent.
- [ ] Carry product identity through glazing/kiln items and finished allocations/receipts. Guard mixed-product QC grouping and finished stock totals; raw preforms may share only identical verified type_id and existing allocation rules.
- [ ] Run integration regressions GREEN; commit Task 2.

## Task 3: Mesh completion and reversal invariants

**Files:** create apps/api/src/tile-catalog/mesh.ts; modify catalog schema/routes, finishing/qc.ts/routes.ts and kiln-workflow/store.ts; test apps/api/tests/tile-mesh.test.ts.

**Interfaces:** GET /finishing/mesh -> {orders,entries}; orders include id,product_name,customer_reference,customer_pieces,allocated_pieces,completed_pieces,waiting_pieces,ready_pieces,lines[{key,source,allocation_id,qc_id,grade,available_pieces}]. Entries include id,order_id,pieces,recorded_at,voided_at. POST /finishing/mesh {request_id,order_id,lines:[{key,pieces}]} -> {id}; POST /finishing/mesh/:id/void {request_id,reason} -> {id}. Record finishing.allocate, reverse finishing.correct, read finishing.read. assertMeshSources(db) validates all active consumed logical allocation keys, invoked after every legacy/new allocation/QC write before commit.

- [ ] RED tests: allocated1000 -> complete400 -> waiting600/ready400; replay does not add; overrun/mixed-order/concurrency denied; void restores600+400 to1000/0; consumed QC cannot shrink or change identity; projection rewrite retains valid mesh history; no-mesh behavior unchanged.
- [ ] Add immutable completion entries with logical source references and idempotent requests. Use transaction/advisory lock shared with existing writes. Preserve production allocation totals separately from shipping-ready totals so mesh waiting never triggers extra production or blocks lawful surplus stock.
- [ ] Add source guard to legacy QC/void/correction and workflow projection; expose mesh totals and shipping-ready in reads without changing internal allocation-shortfall meaning.
- [ ] Run targeted/regression tests GREEN; commit Task 3.

## Task 4: Registry, order and QC UI

**Files:** modify apps/web/src/components/pressing/catalog.tsx/orders.tsx, category and finishing/QC components, lib/pressing.ts/stock.ts; add lib/tile-catalog.ts and focused components/tests.

**Interfaces:** use Tasks 1–3 HTTP/JSON contracts; ordinary pressing data stays backward compatible. Registry search all161 products, show duplicate-code distinctions and draft state; editor configures/link body and per-clay profiles. Order product -> clay/mixture -> existing quantity/color fields. Mesh section displays order/allocated/waiting/completed/ready and records partial completion or reversal.

- [ ] Write failing behavior tests for profile choice, draft rejection, duplicate product labels and product-aware finished-stock grouping, then implement helpers/components.
- [ ] Read installed Next docs before edits; reuse existing dialogs/fields/buttons, retain permissions and mobile widths, show legacy profiles separately rather than fabricate product mapping.
- [ ] Verify web tests/typecheck and build, then commit Task 4.

## Task 5: Source import and persistent QA runtime

**Files:** create apps/api/src/tile-catalog/import.ts and seed command; private scripts/env/evidence under .qa/tile-catalog; docs/tile-catalog-qa-guide.md.

**Interfaces:** importProducts(db,rows,sourceIdentity) inserts or maps stable source-row IDs, preserves edits on repeat, reports conflicts; command requires explicit separate QA target during rehearsal. Seed raw rows only, no production settings or stock. QA DATABASE_URL must name lthai_tile_catalog_qa using its own restricted role, web3150/API4150, separate session cookie.

- [ ] RED import tests for161/152 including nine duplicate-code pairs and six mesh variants, replay, blank preservation and changed-source conflict; implement parser/seed and verify GREEN.
- [ ] On fresh restored QA import all source products; retain legacy records unmapped. Use clearly labeled QA synthetic fixtures for full workflow/mesh verification, keep raw mapping/evidence outside Git.
- [ ] Start persistent QA API/web with hidden helpers and private env, verify selected database and session isolation. Provide browser guide and test-only fixture identifiers without exposing secrets.

## Task 6: Final verification and review

- [ ] Run npm run check, npm test with verified QA environment, production builds and meaningful integration regression. Record skipped legacy Python tests accurately.
- [ ] Browser verify catalog/import counts, editing/profile configuration/order creation/mesh partial completion+reverse/read-only permissions, desktop and390px; main3001 remains healthy.
- [ ] Dispatch fresh whole-change review using spec/plan and ledger; fix substantive findings with RED->GREEN regressions, rerun relevant suite.
- [ ] Record actual QA URLs/backup/checksum/schema/data boundaries in CURRENT and guide. Leave QA running for user review; no main merge/deploy/QA cleanup until user confirms module/data.
