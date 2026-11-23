# Clay Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มทะเบียนประเภทดินสี่ประเภทและสีดิน พร้อมตั้งค่าผลิตและเลือกในใบสั่ง โดยรักษาประวัติและการแยกสต็อกตลอดงานผลิต

**Architecture:** เพิ่ม clay_types/clay_colors และ FK ควบคู่ข้อความเดิม เชื่อม pressing_types เดิมแทนสร้างระบบผลิตอีกชุด ใช้รหัสถาวรตัดสินพฤติกรรม ชื่อทะเบียนสำหรับงานใหม่ และ snapshot สำหรับประวัติ; อุณหภูมิยังจับคู่ผ่านรหัสดินเดิมจนได้รับข้อมูลใหม่

**Tech Stack:** Node.js >=26, TypeScript, Express 5, pg/PostgreSQL 18, Next.js 16.4.5, React 19.3.1, node:test/tsx, Docker Compose; ใช้ dependencies เดิม

**Spec:** [แบบที่อนุมัติเพื่อวางแผน](../specs/2026-11-23-clay-registry-design.md), Q4 วันที่ 23 พฤศจิกายน 2026

**Execution:** ผู้ใช้เลือก Native แล้ว งาน1–7พร้อมตรวจรับQAวันที่23พฤศจิกายน2026 หลักยังไม่deploy รายละเอียดผลจริง/ข้อปรับแผนอยู่ `.qa/clay-registry/progress.md` และ `docs/clay-registry-qa-guide.md`; งาน8รออนุมัติโมดูลและข้อมูลที่จะเก็บ

## Global Constraints

- เริ่มต้นสี่ประเภทตามคำสั่งผู้ใช้ ไม่เปิดเพิ่มประเภทที่ห้าในรุ่นนี้
- รหัสถาวร WHITE / COLORED / RED / LATERITE; ชื่อเริ่มต้น ดินขาว / ดินสี / ดินแดง / ศิลาแลง; COLORED มี WHITE เป็นดินตั้งต้น
- เริ่มทะเบียนสีดินว่าง ไม่สร้างสีตัวอย่างในข้อมูลที่จะนำขึ้นหลัก
- ยังไม่ทำสูตรผสม เปอร์เซ็นต์สี การบันทึกผสมจริง และสต็อกวัตถุดิบ
- พักการตั้งค่าอุณหภูมิใหม่ แต่คงการตรวจเข้าเตาเดิมและข้อมูลเดิม ไม่เดาหรือข้ามช่วงที่ขาด
- จำนวนแผ่นต่อไม้ >0, วันพัก >=0, จำนวนแผ่นต่อ ตร.ม. >0 และเส้นทางผลิตต้องยืนยันจริงก่อนเปิดใบสั่ง
- ไม่เปลี่ยน ID สินค้า/ประเภทผลิต ไม่รวมแบบ/ดิน/สีดินหรือสต็อกโดยเดาจากขนาด ไม่ลบประวัติเดิม
- ทดสอบเขียนเฉพาะ QA หลังสำรอง Docker lthai ใหม่และตรวจ target; หลักอยู่ lthai-docker พอร์ต3001/5434, native5433 เป็นคนละฐาน
- การอนุมัตินี้ครอบคลุมการวางแผน ไม่ใช่สั่ง deploy; ต้องยืนยันโมดูลและข้อมูลที่จะเก็บก่อนนำขึ้นหลัก ห้าม restore QA ทับหลัก
- เก็บ credentials, Excel, private mapping, logs และ backups ใน .qa/ หรือ data/ ที่ Git ignore; เก็บการแก้ skills เดิมของผู้ใช้ไว้

## Review Focus

1. รัน migration/startup ซ้ำหลังเปลี่ยนชื่อหรือหยุดใช้ดิน: ต้องไม่ reset ชื่อ/active หรือเพิ่มสี่ประเภทซ้ำ — Task 1
2. ใบเก่ามีชื่อสีดินสะกดคล้ายกัน/ยังไม่จับคู่: ประวัติยังอ่านได้ ห้ามรวมสีหรือเปิดใบใหม่ด้วยสีที่ไม่ได้ยืนยัน — Tasks 1, 3
3. ผู้ใช้เปิดฟอร์มค้างแล้วอีกคนหยุดใช้ดิน/สี: API ต้องตรวจใหม่ใน transaction และปฏิเสธงานใหม่ — Tasks 2, 3
4. สินค้าหลายรหัสใช้แบบเดียวกัน: แก้ค่าผลิตต้องเห็นรายการที่จะได้รับผล ไม่เปลี่ยนตัวตนแบบ/ดินที่มีประวัติ — Tasks 2, 5
5. เปลี่ยนชื่อดินแล้วจัดเข้าเตา/QC/เบิกสต็อกเดิม: ใช้ ID/รหัสถาวร ไม่ทำให้ช่วงอุณหภูมิหลุดหรือรวมกอง — Task 4

## File Map และสัญญาระหว่างงาน

สร้างโมดูล `apps/api/src/clay-registry/` แยกจากตัวนำเข้าสินค้า:

- `schema.ts`: migrateClayRegistry(db: Db): Promise<void> — seed/เพิ่ม FK/backfill แบบเพิ่มข้อมูล
- `identity.ts`: ClayCode, ClayIdentity; legacyClay(code: ClayCode): string; resolveClayIdentity(db: Db, typeId: number, colorId: number | null, requireActive: boolean): Promise<ClayIdentity> — ตรวจตัวตนและแปลค่าข้อความเดิม
- `catalog.ts`: clayRegistryState(db: Db), updateClayType(db: Db, id: number, input: unknown), saveClayColor(db: Db, input: unknown, id?: number) — คืน state หรือ id ตามส่วน API ด้านล่าง
- `routes.ts`: handleClayRegistryRoute(req: Request, res: Response, access: SessionRouteAccess): Promise<boolean> — ใช้ require/mutate ของระบบเดิม

`ClayCode = 'WHITE' | 'COLORED' | 'RED' | 'LATERITE'`; `ClayIdentity = {clay_type_id:number; clay_color_id:number|null; clay_code:ClayCode; clay_name:string; clay_color_name:string|null; legacy_clay:string}`. `legacyClay` คืน ขาว/สี/แดง/ศิลาแลง ตาม code ไม่อ่านชื่อแสดง

Web สร้าง `apps/web/src/lib/clay-registry.ts` สำหรับ types/helpers; `components/category/clays.tsx` สำหรับทะเบียน; `components/pressing/production-settings.tsx` สำหรับตั้งค่าจากสินค้า ใช้ FormDialog/Choice เดิม ไม่เปลี่ยนโครงสร้างหน้าทั้งระบบ

แก้ไฟล์เดิมตาม task ด้านล่าง ทดสอบใหม่ใน `apps/api/tests/clay-*.test.ts`, `apps/web/tests/clay-registry.test.ts` และขยาย regression เดิมตามเจ้าของพฤติกรรม ไม่มี dependencies ใหม่

## Verification Commands

คำสั่งใน task API ให้รันจาก `D:/LThai/apps/api` หลังโหลด DATABASE_URL ของ QA อย่างชัดเจน; เว็บจาก `D:/LThai/apps/web`; คำสั่ง npm รวมจาก `D:/LThai` ใช้ PowerShell ตั้ง environment โดยไม่พิมพ์ credentials ออก log

API tests ใช้ tileFixture ที่ตรวจชื่อ `lthai_*_qa` และสร้าง schema แยกแล้วลบทิ้ง ทดสอบ migration ที่ต้องมีข้อมูลก่อนอัปเกรดใช้ schema แยกในฐาน QA เช่นกัน ห้ามใช้ public ของสำเนาให้ test runner ล้างเอง

### Task 1: QA isolation และ migration ทะเบียนกลาง

**Files:** Create `apps/api/src/clay-registry/schema.ts`, `identity.ts`, `apps/api/tests/clay-registry-migration.test.ts`; Modify `apps/api/src/database.ts`; private QA files `.qa/clay-registry/{qa.env,compose.qa.yaml,progress.md}` ไม่เข้า Git

**Interfaces:** Produces migrateClayRegistry และ identity types ตาม File Map; เรียก migration หลัง migrateTileCatalog ภายใน transaction เดิม สร้างตาราง/FK ก่อน API tasks ใช้งาน

- [ ] ตรวจ git branch/worktree/status และอ่าน AGENTS/docs ปัจจุบัน; ใช้ checkout ปัจจุบันที่เหมาะสมตามคำสั่งโครงการ ไม่เปลี่ยนงานผู้ใช้อื่น หากต้องแยก worktree ให้ใช้ native create_worktree
- [ ] สำรองใหม่ตาม `docs/docker.md#docker-backup` ไป `data/backups/clay-registry-<stamp>/lthai.dump`; ตรวจ SHA256 และ `pg_restore --list` ผ่าน เก็บค่า checksum/รายการสำรองใน progress ส่วนตัว
- [ ] กู้ลง `lthai_clay_registry_qa` และ role ชื่อเดียวกัน สิทธิ์เฉพาะฐาน QA ไม่ใช้ role หลักกับ API/tests; ก่อน restore/migrate/test บันทึก current_database/current_user และตรวจว่าเป็น QA ยกเว้น read-only backup source
- [ ] ตั้ง compose project แยก `lthai-clay-qa` มี services `clay-qa-api`/`clay-qa-web`, images ชื่อเฉพาะ, web3150/API4150; ใช้ external network ของ lthai-docker เพื่อเข้าถึง pg5432 ด้วย QA role ตั้ง API_INTERNAL_URL=`http://clay-qa-api:4000` ตอน build เว็บ ป้องกันใช้ hostname `api` ซึ่งอาจชน stack หลัก ไม่ restart/build ทับบริการหลัก
- [ ] เขียน migration tests ชื่อ `seeds only four types and no pigments`, `rerun preserves names activity IDs and quantities`, `unknown legacy clay aborts atomically`, `unmapped legacy pigments retain history without invented mappings`. Assertions ใช้สี่ code ตรงสเปก, COLORED.base_clay_type_id=WHITE.id, สี0รายการในฐานใหม่, ID/count/snapshot เดิมไม่เปลี่ยน; unknown clay ต้อง rollback ทั้งชุด

ตัวอย่าง assertions หลัง migrate ใน schema ทดสอบใหม่:
```ts
assert.deepEqual(types.map(t => t.code).sort(), ['COLORED', 'LATERITE', 'RED', 'WHITE']);
assert.equal(colors.length, 0);
assert.equal(types.find(t => t.code === 'COLORED').base_clay_type_id,
  types.find(t => t.code === 'WHITE').id);
```
- [ ] รัน `npx tsx --test tests/clay-registry-migration.test.ts` คาด FAIL เพราะ migrateClayRegistry/ตารางยังไม่มี เก็บ output RED
- [ ] ทำ schema และ utility ขั้นต่ำ: unique code, name ไม่ว่าง, boolean active, self-FK base, FK RESTRICT; seed ON CONFLICT DO NOTHING และเชื่อม base เฉพาะตอน seed ไม่ reset การแก้ชื่อ/active; code/base immutable ผ่าน API ภายหลัง เพิ่ม clay_type_id/clay_color_id ให้ pressing_types และ pressing_orders โดยชื่อคอลัมน์เหมือนกัน รักษาข้อความ production_clay/production_clay_color เดิม และเพิ่ม clay_name_snapshot/clay_color_name_snapshot ให้ใบสั่ง
- [ ] Backfill type IDs จากข้อความที่รู้จัก รวม alias จ้อ→LATERITE เฉพาะการแปลประวัติ; กรณีสีเก่าให้ทิ้ง color ID ว่างพร้อมรายงาน ไม่สร้างรหัสสีเอง รักษา index เอกลักษณ์ข้อความเดิมสำหรับ legacy แล้วเพิ่ม unique body_id/clay_type_id/clay_color_id สำหรับรายการที่จับคู่ครบ ใช้ index แบบแยกสี/ไม่ใช่สีเพื่อรองรับ null ไม่รวมแถวชนกันเงียบ ๆ
- [ ] ทำ migration แบบรันซ้ำไม่เปลี่ยน snapshot ที่มีค่า ตรวจ FK/type constraints ใน QA ไม่เพิ่ม CHECK บังคับสีจนทำลาย legacy ที่รอจับคู่; รายงาน unmapped profiles/orders เป็น JSON ส่วนตัว
- [ ] รันคำสั่ง test เดิม คาด PASS ทั้งหมด; ตรวจ baseline บน public QA ก่อน/หลัง migration: สินค้า/พนักงาน/บัญชี/งาน/อุณหภูมิจำนวนและค่าธุรกิจเดิมตรงกัน ยกเว้น ID/snapshot ใหม่ที่วางแผนเพิ่ม
- [ ] ทบทวน diff และ commit เฉพาะไฟล์ schema/identity/tests/database เมื่อเลือกวิธีลงมือและได้รับอนุญาตตาม workflow ไม่ stage .qa หรือไฟล์ผู้ใช้

### Task 2: API ทะเบียนและค่าผลิตที่มีตัวตนดิน

**Files:** Create `apps/api/src/clay-registry/catalog.ts`, `routes.ts`, `apps/api/tests/clay-registry.test.ts`; Modify `apps/api/src/app.ts`, `tile-catalog/{catalog.ts,routes.ts}`, `pressing/catalog.ts`

**Interfaces:** Consumes Task 1. GET `/api/catalog/clays` → `{clay_types,clay_colors}`; PUT `/api/catalog/clays/:id` รับ `{name,description,active}`; POST `/api/catalog/clay-colors`, PUT `/api/catalog/clay-colors/:id` รับ `{code,name,notes,active}` และคืน `{id}`. GET `/api/catalog/state` เพิ่ม clay_types/clay_colors โดยคง products/bodies/profiles เดิม Profile input ใหม่รับ clay_type_id/clay_color_id และค่าผลิตเดิม; state เพิ่ม ID/code/name ใน profile

- [ ] เขียน tests: `readers cannot mutate`, `immutable clay code and base rejected`, `pigment cannot attach to noncolored clay`, `deactivation rejects new profile selection`, `used profile identity cannot be reassigned`, `empty pigment registry is valid`, `invalid IDs and duplicate codes rejected`. Assertions อ่าน200, ไม่มีสิทธิ์403, payload ผิด400/409, ไม่พบ404; ไม่รับ code/base ใน PUT ดิน, ไม่เปิด POST/DELETE ประเภทดิน

ตัวอย่างหลังเตรียม authenticated fixture และ whiteId จาก seed:
```ts
const r = await f.call(`/catalog/clays/${whiteId}`, 'PUT', {code: 'RED'});
assert.equal(r.status, 400);
assert.equal((await f.call('/catalog/clays')).body.clay_colors.length, 0);
```
- [ ] รัน `npx tsx --test tests/clay-registry.test.ts` คาด FAIL เพราะ routes ยังไม่มี
- [ ] implement API ใช้ pressing.read/pressing.manage เดิม + transaction/audit; validation safe positive integer, trim ชื่อ, case-insensitive code uniqueness, null สีเฉพาะ noncolored; COLORED ต้องมีสี active เพื่อทำ profile ใหม่ ไม่รับชื่อแสดงมาจับคู่ ID
- [ ] รองรับ legacy callers ใน pressing/catalog และ profile API โดยแปล clay string เป็น immutable code เท่านั้น; สีข้อความเก่าที่ไม่มี ID ไม่ถือว่าพร้อมงานใหม่ ห้ามใช้การแปลชื่อปัจจุบันที่ผู้ใช้แก้แล้ว; เขียน legacy fields จาก canonical code ไม่ใช่ name
- [ ] คง endpoint body/profile เดิมเพื่อให้ UI ตั้งค่าจากสินค้า และคืน affected product IDs จาก body_id ใน catalog state/การอ่านก่อนแก้ ไม่ย้ายสินค้าไปใช้แบบอื่นอัตโนมัติ; audit แยกการแก้ดิน สี และ profile พร้อม ID
- [ ] รัน test เดิมคาด PASS และ `npx tsx --test tests/tile-catalog.test.ts tests/tile-catalog-q13.test.ts tests/tile-catalog-regressions.test.ts` ต้องผ่าน โดยแก้ expectations เฉพาะสัญญา ID/การรอจับคู่ที่สเปกเปลี่ยน ไม่ลบ coverage ประวัติ
- [ ] ตรวจ diff และ commit เฉพาะ API ของ task นี้

### Task 3: ใบสั่งผลิตและ snapshot ที่ไม่เปลี่ยนตามทะเบียน

**Files:** Create `apps/api/tests/clay-orders.test.ts`; Modify `apps/api/src/tile-catalog/catalog.ts`, `pressing/catalog.ts`; Test helpers `apps/api/tests/tile-test-helpers.ts` เพิ่ม fixture ที่ resolve seed ID จาก code ไม่ hardcode serial

**Interfaces:** Consumes resolveClayIdentity/state ของ Tasks 1–2. validateProductOrder และ snapshotOrder เดิมต้องตรวจ/บันทึก identity ใหม่; order API ยังคง product_id/type_id ไม่ให้ client ส่งดินทับ profile

- [ ] เขียน tests `empty pigments block colored orders only`, `missing profile cannot fabricate defaults`, `stale form after deactivate rejected`, `rename preserves existing order snapshots`, `legacy unmapped colored orders readable but unavailable for new orders`, `untouched order correction follows current policy`. Assert required rack/rest/sqm/destination, colored color ID, code และ snapshot ตรงกับ profile; เปลี่ยนชื่อ/active แล้วใบเดิมไม่เปลี่ยน

ตัวอย่างเปรียบเทียบ order row เดิมหลังแก้ทะเบียน:
```ts
assert.equal(after.clay_type_id, before.clay_type_id);
assert.equal(after.clay_name_snapshot, before.clay_name_snapshot);
assert.equal(after.production_pieces_per_rack, before.production_pieces_per_rack);
```
- [ ] รัน `npx tsx --test tests/clay-orders.test.ts` คาด FAIL ด้วย snapshot/ความพร้อมใหม่
- [ ] ตรวจ active ของ product/profile/clay/color ใหม่ใน transaction ก่อน insert/update; snapshot identity/name/ค่าผลิตเมื่อสร้างหรือแก้ใบที่กติกาเดิมอนุญาต ไม่ refresh ขณะอ่านและไม่ mutate ใบที่มีงานแล้ว
- [ ] จับคู่ fallback legacy แบบอ่านอย่างเดียว ไม่ห้ามงานเดิมดำเนินต่อเพียงเพราะทะเบียนหยุดใช้ ไม่เปิด colored order ใหม่ด้วยข้อความสีที่ยังไม่ได้ยืนยัน; stock order ไม่มี product ยังใช้ profile ที่พร้อมจริงตามกติกาเดิม
- [ ] รัน test เดิมและ `npx tsx --test tests/tile-catalog.test.ts tests/tile-catalog-regressions.test.ts tests/pressing.test.ts` คาด PASS; commit เฉพาะ task

### Task 4: ส่งตัวตนดินผ่านสต็อกและงานต่อเนื่อง

**Files:** Create `apps/api/tests/clay-production.test.ts`; Modify `apps/api/src/pressing/{stock.ts,catalog.ts}`, `finishing/{glazing.ts,firing.ts,qc.ts,routes.ts}`, `kiln-workflow/store.ts`, `kiln-prototype/store.ts`, `tile-catalog/mesh.ts`; Modify web labels only in `apps/web/src/lib/{pressing.ts,finishing.ts,stock.ts}` เมื่อจำเป็น

**Interfaces:** ใช้ profile/order IDs จาก Tasks 1–3 เป็น authority; เพิ่ม identity ที่ response งานเมื่อมีข้อมูล ห้ามใช้ display name จัดกลุ่ม; legacyClay(code) เป็นสะพานสู่ firing_clay_ranges.clay และข้อความเดิม ไม่ต้องเพิ่ม FK ซ้ำทุก transaction table เมื่อ derive ได้จาก type_id/order_id ที่ล็อกตัวตนแล้ว

- [ ] เขียน tests `white cannot replace colored stock`, `two pigments cannot pool`, `renaming does not break temperature lookup`, `inactive clay lets existing jobs continue`, `missing firing range still blocks kiln`, `legacy JSON and mesh source signatures preserved`. สร้างข้อมูล synthetic เฉพาะ test schema และ assert reject409 สำหรับดิน/สีผิด, quantities/groups เหมือนเดิม, firing checks ไม่ถูก bypass

ตัวอย่างหลังส่งคำขอเบิกสต็อกผิดสี/ตรวจข้อมูลคงเดิม:
```ts
assert.equal(wrongPigmentIssue.status, 409);
assert.deepEqual(stockAfterRejectedIssue, stockBeforeRejectedIssue);
assert.equal(legacyClay('LATERITE'), 'ศิลาแลง');
```
- [ ] รัน `npx tsx --test tests/clay-production.test.ts` คาด FAIL สำหรับการแสดง/ตรวจ ID ใหม่
- [ ] ปรับ joins/validation/labels ให้ใช้ ID และ snapshot ที่ authoritative รักษา type/product/glaze/grade grouping; snapshot ข้อความเดิมใน receipts/issues ไม่ถูกเขียนย้อนหลัง ไม่รวมกองเมื่อชื่อดินหรือชื่อสีเหมือนกัน
- [ ] ปรับ workflow catalog version ให้รวม registry identity/activity ที่มีผลกับคำสั่งใหม่ตามรูปแบบเดิม แต่ไม่ rewrite state/event เก่า; response items ใช้ identity จาก order ไม่เปลี่ยน mesh signature ที่ผูก product ID
- [ ] ตรวจจุดใช้ clays hardcoded ใน API/เว็บด้วย `rg -n 'clay_color|production_clay|finishing_clay|source_clay|ศิลาแลง|clays' apps/api/src apps/web/src`; แต่ละจุดเป็น registry selection, canonical legacy adapter หรือ historical snapshot อย่างชัดเจน ไม่ลบ enum สำหรับแปล legacy เพียงเพื่อให้ไม่มีข้อความซ้ำ
- [ ] รัน tests ใหม่ + `npx tsx --test tests/finishing.test.ts tests/kiln-workflow.test.ts tests/kiln-prototype.test.ts tests/tile-mesh.test.ts`; `node --test tests/stock.test.ts tests/finishing.test.ts` จาก web คาด PASS; commit เฉพาะ task

### Task 5: หน้าทะเบียนดิน/สีดินและตั้งค่าผลิตจากสินค้า

**Files:** Create `apps/web/src/lib/clay-registry.ts`, `components/category/clays.tsx`, `components/pressing/production-settings.tsx`, `apps/web/tests/clay-registry.test.ts`; Modify `apps/web/src/lib/{category.ts,tile-catalog.ts}`, `components/category/panel.tsx`, `components/pressing/catalog.tsx`, `apps/web/tests/category.test.ts`

**Interfaces:** Web types ClayType/ClayColor/ClayIdentity ตรง Task 1/2; `ClayRegistryState = {clay_types:ClayType[];clay_colors:ClayColor[]}`. `availableClays(registry:ClayRegistryState, profiles:readonly CatalogProfile[], product:CatalogProduct): {clay:ClayType;ready:boolean;reason:string|null}[]` คืนทุกประเภทพร้อม readiness (ดินสีพร้อมเมื่อมี profile/สี active อย่างน้อยหนึ่งคู่). `affectedProducts(bodyId:number, products:readonly CatalogProduct[]):CatalogProduct[]` คืนสินค้าใช้แบบเดียวกัน ไม่ตัดสิทธิ์อ่านเพราะไม่มี profile

- [ ] อ่าน `apps/web/AGENTS.md` และคู่มือ Next ที่ bundle ใน node_modules ก่อนเขียน code ตามคำสั่ง repo
- [ ] เขียน tests `four clay choices remain visible with no profiles`, `empty pigments show waiting state`, `noncolored ignores pigment field`, `shared body edit lists all affected product IDs`, `category permission filters clay registry`. Assertions ชื่อเมนู “ทะเบียนประเภทดิน”, สถานะ “รอตั้งค่าผลิต”, ไม่มีสีสมมติ, เลือกดินจาก IDs/code ไม่ชื่อ

ตัวอย่าง registry สี่ประเภทตาม fixture และไม่มี profiles:
```ts
const options = availableClays(registry, [], product);
assert.equal(options.length, 4);
assert.equal(options.some(option => option.ready), false);
assert.equal(registry.clay_colors.length, 0);
```
- [ ] รัน `node --test tests/clay-registry.test.ts tests/category.test.ts` คาด FAIL เมื่อ helper/tab ยังไม่มี
- [ ] เพิ่ม tab หมวดหมู่ ทะเบียนประเภทดิน (pressing.read); แสดงสี่ประเภท แก้ชื่อ/คำอธิบาย/สถานะได้เฉพาะ manage; ส่วนสีดินแสดงว่างพร้อมเพิ่มภายหลังได้ ไม่เพิ่มปุ่มลบ ไม่เปิดประเภทที่ห้า
- [ ] เพิ่ม action ตั้งค่าผลิตจาก card สินค้า แยก ProductForm เดิม; เลือกใช้แบบที่ผู้ใช้ยืนยันหรือสร้างแบบจริง แล้วเลือกดิน/สีและกรอก rack/rest/sqm/route แสดงสินค้าที่ใช้แบบร่วมก่อนบันทึกแก้ profile ไม่ auto-link จากขนาด
- [ ] ค่าไม่ครบยังอ่านทะเบียนได้ แต่ไม่ POST profile ด้วย default 0/1; สถานะพร้อม derive จากข้อมูลครบ ไม่เพิ่ม draft rows/table โดยไม่จำเป็น ไม่มีฟอร์มสูตรผสมหรือช่วงอุณหภูมิรายสีในงานนี้
- [ ] รันคำสั่ง test เดิมคาด PASS; ตรวจ browser ใน QA ทั้ง desktop/390px, read-only/manage, ทะเบียนสีว่าง และ shared body warning ที่อ่านเข้าใจได้; commit เฉพาะ task

### Task 6: ใบสั่งผลิตเลือกสินค้า → ดิน → สีดิน

**Files:** Modify `apps/web/src/components/pressing/orders.tsx`, `apps/web/src/lib/{tile-catalog.ts,pressing.ts}`, `components/category/ranges.tsx`; Test `apps/web/tests/{clay-registry.test.ts,tile-catalog.test.ts}`

**Interfaces:** ใช้ catalog state ที่มี registry และ availableClays จาก Task 5; `selectProductionProfile(productId:number, clayTypeId:number, clayColorId:number|null, catalog:CatalogState):CatalogProfile` ตรวจคู่พร้อมและคืน profile เพื่อ submit product_id/type_id ตาม Task 3 (โยน Error ที่อ่านเข้าใจได้เมื่อไม่พร้อม)

- [ ] เขียน tests `white red laterite selectable without pigments`, `colored waits for real active pigment`, `changing product or clay clears incompatible selection`, `selected profile matches submitted order`, `renamed clay still selects canonical temperature entry`. Assert ไม่ fallback profile ตัวแรกของสินค้าอื่น ไม่ส่ง stale IDs เมื่อเปลี่ยนดิน และ color_id เคลือบยังแยกจาก clay_color_id

ตัวอย่าง catalog มี white profile ครบแต่ทะเบียนสีดินว่าง:
```ts
assert.equal(selectProductionProfile(product.id, whiteId, null, catalog).id, whiteProfile.id);
assert.throws(() => selectProductionProfile(product.id, coloredId, null, catalog));
```
- [ ] รัน `node --test tests/clay-registry.test.ts tests/tile-catalog.test.ts` คาด FAIL สำหรับ flow/helpers ใหม่
- [ ] ทำตัวเลือกตามลำดับและแสดงค่าผลิตก่อนส่ง ถ้าขาดแสดงเหตุผล/ทางไปตั้งค่า; disabled submit ป้องกันความผิดพลาดแต่ API ยังคงตรวจซ้ำ; ส่ง type_id ที่ resolve ได้ ไม่ให้เลือกดินทับ profile
- [ ] ประวัติใบสั่งใช้ snapshot; legacy/bare-stock order ใช้เส้นทางเดิมที่พร้อม ไม่บังคับเลือกรหัสสินค้าให้สต็อกดินพื้นตามกติกาเดิม
- [ ] หน้า ranges ใช้ registry name สำหรับ label แต่ส่ง canonical legacy clay key ของระบบอุณหภูมิ ไม่เพิ่มการตั้งค่ารายสี ไม่ reset ช่วงเดิมเมื่อเปลี่ยนชื่อ
- [ ] รัน test เดิมคาด PASS และตรวจ browser: ขาว/แดง/ศิลาแลงที่ตั้งค่าครบ, ดินสีว่าง, ใส่สี QA แล้วเลือกได้, เปลี่ยนสินค้าแล้วล้างค่าที่ไม่ตรง; commit เฉพาะ task

### Task 7: ตรวจครบและเปิด QA ให้ผู้ใช้ตรวจรับ

**Files:** Create `docs/clay-registry-qa-guide.md`; Modify `docs/CURRENT.md`; private evidence `.qa/clay-registry/` และ backups `data/backups/` เท่านั้น

- [ ] ตรวจ target QA/role อีกครั้ง แล้วรัน `npm run test:legacy`, `npm run test --workspace=@lthai/api`, `npm run test --workspace=@lthai/web`, `npm run check`, `npm run build` ตามลำดับที่เหมาะสมหลังตั้ง API_INTERNAL_URL ของ QA; ทุกคำสั่ง exit0 และไม่มี test ล้ม ระบุ skip กับเหตุผลส่วนไฟล์ส่วนตัวให้ครบ ไม่รายงาน skip เป็น pass
- [ ] ทดสอบ upgrade rehearsal บน schema/ฐาน QA จากสำรองล่าสุดอีกชุด รัน migration ซ้ำและเทียบ baseline พนักงาน/บัญชี/สินค้า/อุณหภูมิ/ประวัติเดิม; ชื่อและ active ที่แก้หลัง migration รอบแรกต้องไม่ reset ในรอบสอง
- [ ] เปิด QA3150/API4150 ด้วย project/images เฉพาะ ตรวจ health และ browser flow ปั๊ม→เบิก→ชุบหรือบรีส→เผา→QC→รับสต็อกด้วย synthetic data ที่ติดป้าย QA ใน QA เท่านั้น; กรณีขาดอุณหภูมิต้องถูกบล็อกตามเดิม ใช้ช่วงทดสอบเฉพาะ QA เมื่อจำเป็นและบันทึกว่าไม่ย้ายขึ้นหลัก
- [ ] ตรวจหลัก3001/health เป็นการอ่านอย่างเดียวและ healthy ทุก service; บันทึกว่าไม่มี migration/tests เขียนหลัก ไม่ถือจำนวนเดิมจาก CURRENT เป็น baseline ถ้าข้อมูลสดเปลี่ยนแล้ว
- [ ] เขียนคู่มือ URL/หน้าที่ตรวจ/รายการที่ยังรอข้อมูล/ข้อมูลทดสอบที่ไม่ย้ายขึ้นหลัก; อัปเดต CURRENT ว่า QA พร้อมตรวจและยังไม่ deploy
- [ ] ทบทวน branch กับสเปกและแก้ material findings ตามวิธี execution ที่ผู้ใช้เลือก; `git diff --check` ผ่าน แล้วส่ง QA ให้ผู้ใช้พร้อมระบุผลจริง/จำนวน tests ไม่เดาล่วงหน้า

### Task 8: นำขึ้นหลักและเก็บ QA — หลังผู้ใช้อนุมัติโมดูลและข้อมูลเท่านั้น

**Files:** Modify `docs/CURRENT.md`, `docs/clay-registry-qa-guide.md`; private deployment manifest/snapshots/backups นอก Git

- [ ] รอคำยืนยันโมดูลพร้อมรายการสี/ค่าผลิตที่จะเก็บ ไม่มีข้อมูลที่ยืนยันให้เก็บแปลว่าไม่ย้าย synthetic data; ทะเบียนสี่ประเภทและสีดินว่างเป็นค่าเริ่มต้นที่ตั้งใจไว้
- [ ] ตรวจ main target แล้วสำรองหลักใหม่ตาม docker.md ขณะป้องกันการเขียนระหว่าง cutover; ตรวจ archive/checksum เก็บ snapshot ของข้อมูลล่าสุด ไม่ใช้ backup เริ่ม QA แทน
- [ ] ใช้ code/migrations ที่ตรวจแล้วและ manifest ข้อมูลที่อนุมัติ รันเพิ่ม/จับคู่ใน transaction แบบ idempotent ไม่ copy ID จาก QA ตามอำเภอใจและไม่ restore ทั้งฐาน; เก็บหลักฐานรักษาทุก record/การเปลี่ยนแปลงหลังสำเนา
- [ ] build/deploy lthai-docker รุ่นที่อนุมัติ ตรวจ migration ซ้ำไม่ reset, HTTP3001/health, สิทธิ์, ทะเบียน, ใบสั่ง และข้อมูลจริงที่เลือก โดยไม่สร้างใบสั่งทดสอบในหลักถ้าไม่ได้รับอนุญาต
- [ ] หลังตรวจหลักผ่าน สำรอง QA สุดท้ายพร้อม checksum แล้วหยุดและลบเฉพาะ QA project/ฐาน/role ที่ยืนยันชื่อแล้ว เก็บ backups ไม่ใช้ down -v กับ lthai-docker; ยืนยันเหลือ stack LThai หลักชุดเดียว
- [ ] อัปเดต CURRENT/คู่มือเป็นใช้งานจริงพร้อมสิ่งที่ยังรอ: สีดินและอุณหภูมิที่ผู้ใช้จะส่งภายหลัง

## Self-review และ Handoff

ตรวจแผนกับทุกหัวข้อในสเปก: ทะเบียนและสีว่าง (Tasks1–2/5), ค่าผลิต/ใบสั่ง (2–3/5–6), ประวัติและงานต่อเนื่อง/อุณหภูมิที่พัก (3–4/6), legacy migration (1/4), สิทธิ์/audit (2/5), QA/approval/deploy/cleanup (1/7–8) ไม่มีส่วนสูตรผสมหรือวัตถุดิบเพิ่มขึ้นมา

ตรวจ names/signatures/เส้นทาง API ข้าม task ให้ตรง File Map; ขั้น RED/GREEN ในแผนเป็นผลที่คาดหวัง ยังไม่ได้รันจริงในขั้นวางแผน Commit เป็นขั้นของการลงมือ ไม่ใช่คำสั่งให้ commit เอกสารหรือไฟล์ผู้ใช้ตอนนี้

แนะนำ **Native**: ผู้ช่วยหลักทำตาม task ทีละงาน แล้วมี reviewer อิสระตรวจภาพรวมก่อนส่ง QA เพราะ schema/order/stock ใช้สัญญาร่วมกันแน่นและการเปลี่ยนตัวตนดินกระทบหลายจุด ลดการส่งต่องานระหว่างผู้พัฒนา ผู้ใช้เลือก **Subagent-driven** ได้หากต้องการผู้พัฒนา/ผู้รีวิวแยกทุก task

จุดหยุด: ส่งแผนให้ผู้ใช้ตรวจและเลือกวิธีลงมือก่อนเริ่ม Task1 ไม่สร้าง QA/สำรองหรือเปลี่ยนข้อมูลเพียงเพราะแผนเขียนเสร็จ เมื่อเลือก Native ใช้ executing-plans; เมื่อเลือก Subagent-driven ใช้ subagent-driven-development ตามข้อกำหนดปัจจุบัน
