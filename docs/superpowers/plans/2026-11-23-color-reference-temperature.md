# Color Reference Temperature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แสดงและแก้อุณหภูมิอ้างอิงหนึ่งค่าต่อสีในชาร์ตสี ตามสิทธิ์ตั้งอุณหภูมิเดิม

**Architecture:** เพิ่มตารางอ้างอิงสีแบบ0หรือ1รายการ แยกจากตารางช่วงเผา อ่านผ่าน API ชาร์ตสีเดิมและเขียนผ่าน endpoint เฉพาะ หน้ารายละเอียดสีแยกการบันทึกอุณหภูมิจากชื่อ/หมายเหตุ/รูป โดยไม่เปลี่ยนกติกาเข้าเตา

**Tech Stack:** TypeScript, Express, PostgreSQL18, React/Next.js รุ่นที่ติดตั้งใน repo, node:test/tsx, Docker Compose บน Windows/PowerShell ไม่เพิ่ม dependency

**Spec:** `docs/superpowers/specs/2026-11-23-color-reference-temperature-design.md` ผู้ใช้ยืนยันแบบ23พฤศจิกายน2026

## Global Constraints

- เริ่มหนึ่งค่าอุณหภูมิต่อหนึ่งสี ไม่แยกตามประเภทดินในรุ่นนี้
- ชื่อช่อง “อุณหภูมิอ้างอิง (°C)” เว้นว่างได้ สีที่ยังไม่มีข้อมูลแสดง “ยังไม่ระบุ”
- ค่าใหม่นี้ใช้แสดงข้อมูลเท่านั้น ไม่ใช้ค่าอ้างอิงแทนช่วงเดิม ไม่ตั้ง minimum=maximum และไม่เติมค่าเริ่มต้นที่เดาขึ้นมา
- เบอร์โคนเป็นข้อมูลประจำการเผาแต่ละครั้ง ไม่ผูกกับทะเบียนสีหรือประเภทดิน ไม่แก้สีดิน
- อ่านด้วย `color_chart.read`; เขียนต้องมีทั้ง `color_chart.read` และ `finishing.temperature` ไม่ต้องมี `color_chart.manage`; ชื่อ/หมายเหตุ/รูปใช้สิทธิ์เดิม
- สำรองหลักใหม่และกู้แยก QA ก่อน migration/tests ตรวจฐานและ role ทุกครั้งก่อนเขียน ห้ามใช้ legacy native5433 หรือหลัก5434/lthai เป็น test target
- ใช้ checkout ที่เหมาะสมตามข้อกำหนดงานจริง ไม่รวมไฟล์ทักษะส่วนตัวที่ค้างอยู่ ไม่เก็บ credentials/logs/Excel/backups ใน Git
- อ่าน `apps/web/AGENTS.md` และคู่มือ Next ที่ bundle ใน `node_modules/next/dist/docs/` ก่อนแก้เว็บ
- แผนนี้ยังไม่อนุญาตนำขึ้นหลัก: ต้องให้ผู้ใช้ตรวจ QA และระบุข้อมูลที่จะเก็บก่อน cutover

## Review Focus

1. ผู้มีสิทธิ์ตั้งอุณหภูมิแต่แก้ชื่อสีไม่ได้ ต้องบันทึกอุณหภูมิได้โดยไม่เปิดสิทธิ์ชื่อ/รูป (Task2/3)
2. บันทึกอุณหภูมิสำเร็จแต่ reload ล้ม ต้องคงค่าที่บันทึกและ retry เฉพาะการอ่าน ไม่ส่งคำขอเขียนซ้ำ (Task3/4)
3. สีถูกลบขณะเปิดรายละเอียดหรือขณะส่งคำขอ ต้องแจ้งไม่พบ/โหลดใหม่ ไม่ทิ้งอุณหภูมิกำพร้าหรือสร้างสีใหม่ (Task1/2/4)
4. ข้อมูลเก่าบางช่วงอ้างถึงสีที่มีเฉพาะในใบสั่ง ต้องไม่ถูกบังคับ FK ใหม่หรือเปลี่ยนกติกาเข้าเตา (Task2/4)
5. ทศนิยม/ช่องว่าง/JSON ผิดชนิด/ตัวเลขไม่จำกัด ต้องไม่ถูกปัดเป็นศูนย์หรือใช้เป็นคำสั่งล้างโดยไม่ตั้งใจ (Task1/2/3)

## File Map และสัญญาร่วม

- `apps/api/src/color-chart/schema.ts`: เพิ่มตารางหลังสร้าง color_chart_entries ใน migration เดิม
- Create `apps/api/src/color-chart/reference-temperature.ts`: validation และบันทึกค่าอ้างอิงอย่างเดียว
- `apps/api/src/color-chart/catalog.ts`: LEFT JOIN ค่าใหม่ใน listColorChart ไม่เปลี่ยน sorting
- `apps/api/src/color-chart/routes.ts`: endpointเฉพาะ ก่อน route ทั่วไป ไม่เปลี่ยน app router/สิทธิ์ของส่วนอื่น
- `apps/web/src/lib/color-chart.ts`: type/helper ของค่า/ข้อความ/สิทธิ์/payload
- `apps/web/src/components/color-chart/panel.tsx`: แสดงค่าในรายการและรายละเอียด; แยก editor ของอุณหภูมิ
- Create `apps/web/src/components/color-chart/reference-temperature.tsx`: ส่วนแสดง/แก้ค่าเพื่อไม่ขยาย dialog เดิมด้วย state ที่ไม่เกี่ยวกัน
- Tests: Create `apps/api/tests/color-reference-temperature.test.ts`, `apps/web/tests/color-reference-temperature.test.ts`; ปรับ fixtures ที่ใช้ `ColorChartItem` ใน tests เดิมให้มีค่าใหม่
- Create `docs/color-reference-temperature-qa-guide.md`; update `docs/CURRENT.md`
- Private: `.qa/color-reference-temperature/` สำหรับ env/compose/ledger/baseline/logs; `data/backups/` สำหรับ dump/checksum

สัญญา API: GET `/api/color-chart` เพิ่ม `reference_temperature_c: number|null` ทุก item; PUT `/api/color-chart/:id/reference-temperature` รับเฉพาะ `{temperature_c:number|null}` คืน `{id:number,reference_temperature_c:number|null}`; nullล้างค่า, ห้าม omit key/ส่งstring/ส่งfieldอื่น 400; สีไม่พบ404; ไม่มีสิทธิ์403

### Task 1: เตรียม QA และ migration ที่รักษาข้อมูลเดิม

**Files:** Modify `apps/api/src/color-chart/schema.ts`; Create `apps/api/tests/color-reference-temperature.test.ts`; private evidence/compose/env

**Interfaces:** ตาราง `color_reference_temperatures(color_id integer PRIMARY KEY REFERENCES color_chart_entries(id) ON DELETE CASCADE, temperature_c double precision NOT NULL CHECK(temperature_c>0 AND temperature_c<'Infinity'::double precision))`. การเลือก double precision รองรับตัวเลข JSON/ทศนิยมและไม่ต้องแปลง pg numeric string; CHECK ปฏิเสธNaN/Infinity/ค่าติดลบด้วย

- [ ] สำรอง Dockerหลักใหม่ตาม `docs/docker.md#docker-backup` ตรวจarchive/checksum กู้เป็นฐาน/role `lthai_color_reference_qa` ตรวจ current_database/current_user และบันทึกข้อมูลเดิมทุกตาราง+ภาพ+sequence ก่อนทดสอบ ไม่เริ่ม containers แอปหลักรุ่นใหม่
- [ ] เตรียม QA compose project `lthai-color-reference-qa` imagesแยก เว็บ3160/API4160 (ตรวจว่างก่อน) ใช้เครือข่าย Dockerหลักเพื่อเข้าฐานQAเฉพาะ เก็บcredentialsนอกGit ตั้ง DATABASE_URL ใน test process ด้วย QA env อย่างชัดเจน ไม่อาศัย .env ที่ชี้หลัก
- [ ] ใช้ `tileFixture` เดิมสำหรับ schemaทดสอบ ซึ่งตรวจชื่อฐาน QA ก่อนเขียน เขียน test `migration starts empty and rerun preserves temperature`: หลังmigrate tableมี0แถว; ใส่สีsynthetic/ค่า1234.5; migrateซ้ำแล้วยังมี1234.5 และตารางเดิมไม่เปลี่ยน (ตัวเลขนี้เป็น fixture เท่านั้น)
- [ ] เขียน test DB CHECK/PK/FK: 0,-1,NaN,+Infinity,-Infinity ถูกปฏิเสธ; สีเดียวซ้ำถูกปฏิเสธ; color_idไม่พบถูกปฏิเสธ; ลบสีทดสอบแล้วอุณหภูมิและภาพของสีนั้นหายตามกติกา cascade แต่ข้อมูลการเผาอื่นไม่เปลี่ยน
- [ ] Run จาก `apps/api`: `npx tsx --test tests/color-reference-temperature.test.ts`; Expected: FAIL เพราะยังไม่มีตารางใหม่
- [ ] เพิ่ม CREATE TABLE IF NOT EXISTS ใน migrationชาร์ตสีเดิม ไม่ seed ค่าและไม่แก้ตารางช่วงเผา
- [ ] Run คำสั่งเดิม Expected: PASS; รัน migrationกับ public QAสองครั้ง เทียบข้อมูลคอลัมน์เดิมทั้งหมดกับbaselineตรงกัน ตารางใหม่ว่าง
- [ ] Commitเฉพาะโค้ด/testsของtask: `feat: add separate color reference temperature storage`

### Task 2: API อ่าน/เขียนพร้อมสิทธิ์และ audit

**Files:** Create `apps/api/src/color-chart/reference-temperature.ts`; Modify `apps/api/src/color-chart/{catalog,routes}.ts`; Extend `apps/api/tests/color-reference-temperature.test.ts`

**Interfaces:** `parseReferenceTemperature(body:Record<string,unknown>):number|null`; `saveReferenceTemperature(db:Db,id:number,value:number|null):Promise<{before:number|null;after:number|null}>` เรียกใน transactionของ routeAccess.mutate; สัญญา HTTP ตาม File Map

- [ ] เพิ่ม HTTP tests: GETทุกสีคืนfieldเป็นnullเริ่มต้นและไม่ต้องมี finishing.read; PUT1234.5อ่านกลับเป็นnumber; nullล้างและGETnull; updateไม่เพิ่มแถวซ้ำ; สีไม่พบ404 รวมเมื่อสีถูกลบไปแล้วก่อนส่งPUT
- [ ] เพิ่มตารางสิทธิ์ assertions: readอย่างเดียวPUT403; read+managePUT403; finishing.temperatureไม่มีreadPUT403; read+finishing.temperaturePUT200แต่แก้ชื่อ/รูป403; read+manageแก้ชื่อ/รูปได้แต่ยัดtemperatureในpayloadชื่อไม่เปลี่ยนค่าอ้างอิง
- [ ] เพิ่ม invalid payload tests `{}`, `{temperature_c:''}`, `{temperature_c:'1234.5'}`, boolean,array,0,-1,unknownfield รวมทดสอบhelperด้วยNaN/Infinity: ทุกกรณี400และค่าเดิมยังอยู่
- [ ] เพิ่ม assertions audit actor/ก่อน/หลังครบสำหรับตั้ง/แก้/ล้าง; transactionล้มไม่เปลี่ยนแถวหรือสร้างauditบางส่วน; การแก้ชื่อ/หมายเหตุ/รูปไม่เปลี่ยนค่าอ้างอิง
- [ ] เพิ่ม regression: บันทึก/ล้างค่าอ้างอิงแล้ว firing_color_ranges/firing_clay_ranges/ช่วงประเภทผลิตและsnapshotโหลดเตายังเหมือนเดิม; ช่วงสีlegacyที่ไม่มีในชาร์ตยังอยู่ ห้ามเพิ่มFKจากตารางเดิม
- [ ] Run testsเฉพาะไฟล์ Expected: FAIL เมื่อendpoint/type/helperยังไม่มี
- [ ] ทำ validationแบบstrict own keysตามcontract รับเฉพาะ finite number>0/null; ตรวจสีด้วยSELECT FOR UPDATE ก่อนอ่านค่าเดิมและupsert/delete ใช้ transaction/advisory lockเดิม; route requireทั้งสองสิทธิ์และmutateด้วย finishing.temperature, audit JSON `{color_id,before,after}` ใช้ชื่อกิจกรรมไทยสำหรับอุณหภูมิอ้างอิงโดยเฉพาะ
- [ ] เพิ่ม LEFT JOIN ใน listColorChart คืนnumber|nullและลำดับ/รูป/หมายเหตุเดิม เพิ่มrouteก่อนregexทั่วไป ไม่อนุญาต payloadชื่อ/รูปเขียนค่าอ้างอิง
- [ ] Run จาก `apps/api`: `npx tsx --test tests/color-reference-temperature.test.ts tests/color-chart.test.ts tests/color-chart-images.test.ts tests/finishing.test.ts tests/kiln-workflow.test.ts`; Expected: 0fail (ระบุskipไฟล์ส่วนตัวตามจริง)
- [ ] Commitเฉพาะtask: `feat: expose permission-scoped color reference temperatures`

### Task 3: รวมอุณหภูมิในชาร์ตสีและรายละเอียด

**Files:** Modify `apps/web/src/lib/color-chart.ts`, `apps/web/src/components/color-chart/panel.tsx`; Create `apps/web/src/components/color-chart/reference-temperature.tsx`, `apps/web/tests/color-reference-temperature.test.ts`; Update fixturesใน `apps/web/tests/color-chart.test.ts` และผู้ใช้typeที่typecheckชี้; CSSเดิมแก้เฉพาะเมื่อจำเป็น

**Interfaces:** เพิ่ม required `reference_temperature_c:number|null` ใน `ColorChartItem`; `canSetColorReferenceTemperature(permissions:string[]):boolean`; `referenceTemperatureLabel(value:number|null):string`; `referenceTemperaturePayload(text:string):{temperature_c:number|null}`. Componentใหม่รับ `{item:ColorChartItem,canSet:boolean,api:Api,onChanged:(value:number|null)=>Promise<void>}` จากdialogเดิม; `Change`เพิ่ม `{kind:'temperature';fields:Pick<ColorChartItem,'reference_temperature_c'>}`

- [ ] อ่าน AGENTS/Next guide ตามGlobal Constraints ก่อนเขียน เขียนtestshelperสิทธิ์ตารางเดียวกับTask2, label null=`ยังไม่ระบุ`, value1234.5ยังแสดงทศนิยมพร้อม°C, textว่าง/ช่องว่างเป็นnull, textผิด/0/ติดลบ/InfinityโยนErrorไม่ส่งค่า
- [ ] เขียน SSR component tests สำหรับผู้ดู/ผู้ตั้งอุณหภูมิ/ผู้แก้สี: labelตรงสเปก, ค่าและหมายเหตุอ่านได้, editorเฉพาะสิทธิ์อ่าน+ตั้งอุณหภูมิ; ส่วนแสดงค่าในรายการใช้ helperเดียวกับรายละเอียด ไม่เพิ่มปุ่มโคนหรือmin/maxใหม่
- [ ] Run จาก `apps/web`: `node --test tests/color-reference-temperature.test.ts tests/color-chart.test.ts`; Expected: FAILเมื่อhelper/componentยังไม่มี
- [ ] ทำ helperและeditorตามcontract ช่องnumber step=any ไม่บังคับ required แยก form/busy/error/save actionจากชื่อ/รูป ไม่เกิดnested formในChartDialog ไม่ให้การกดEnterส่งฟอร์มชื่อแทน endpointอุณหภูมิ ใช้ป้าย/ข้อความตามSpec
- [ ] แสดงอุณหภูมิใต้ชื่อในเซลล์เดิมเพื่อไม่เพิ่มตารางกว้างบนมือถือ; หน้ารายละเอียดแสดงช่องในส่วนเฉพาะ เฉพาะสีที่บันทึกแล้วจึงแก้อุณหภูมิได้ ค่าใหม่ไม่ถูกส่งตอนเพิ่มชื่อสี
- [ ] ต่อ onChanged temperatureอัปเดตค่าที่serverยืนยันในitemsก่อนrefresh; refreshล้มคงค่าใหม่และใช้ปุ่มลองโหลดเดิมที่อ่านอย่างเดียว เมื่อเลือกสีอื่นหรือเริ่มแก้ใหม่ใช้ค่าปัจจุบัน ไม่ทำให้ชื่อ/หมายเหตุที่กำลังแก้หายเพราะการบันทึกอุณหภูมิ
- [ ] Run `npm run test --workspace=@lthai/web` และ `npm run check` จากrepo; Expected: exit0/0fail
- [ ] Commitเฉพาะtask: `feat: show editable reference temperatures in the color chart`

### Task 4: ตรวจรวมและส่ง QA ให้ผู้ใช้ตรวจรับ

**Files:** Create `docs/color-reference-temperature-qa-guide.md`; Modify `docs/CURRENT.md`; private logs/QA credentials/evidence

**Interfaces:** ใช้ schema/API/UI Tasks1–3 ไม่เพิ่มความสามารถใหม่; ค่า synthetic ต้องทำเครื่องหมาย QA และไม่ย้ายหลักโดยปริยาย

- [ ] ตรวจtarget QAใหม่แล้วรัน `npm run test:legacy`, `npm run test --workspace=@lthai/api`, `npm run test --workspace=@lthai/web`, `npm run check` ในprocessที่อ่านQA env; Expected: exit0/ไม่มีfail รายงานจำนวนskipและเหตุผลจริง ไม่เปิด importer QAเก่าหรือส่งtestsไปหลักเพื่อให้ครบ
- [ ] Build QA API/webด้วยcomposeเฉพาะ ตรวจhealthและหน้า3160; Expected: buildexit0/healthPostgreSQL ใช้localhostสำหรับQAเพื่อแยกcookieจาก127.0.0.1:3001หลัก
- [ ] Browser QAตรวจread-only/read+manage/read+temperature โดยใช้บัญชีเฉพาะQA: ตั้งทศนิยม แก้ ล้าง เปลี่ยนชื่อ/หมายเหตุ/รูป ยืนยันแต่ละสิทธิ์ อ่านค่าในรายการ/รายละเอียดตรงกัน จอ390pxไม่มีล้น ชื่อ/รูป/หมายเหตุเดิมใช้งานได้
- [ ] Browser QAจำลองPUTสำเร็จแล้วGETreloadล้ม: ค่าใหม่ยังอยู่ ลองโหลดส่งเฉพาะGET; อีกหน้าลบสีที่กำลังเปิดแล้วrefresh/submit: แจ้งไม่พบและปิดรายละเอียดตามpatternเดิม ไม่มีแถวกำพร้า; เปลี่ยนค่าในอีกหน้าขณะeditorไม่ได้แก้ต้องเห็นค่าล่าสุดเมื่อเริ่มแก้ใหม่
- [ ] ยืนยัน regressionของTask2สำหรับช่วงlegacy/บันทึกโคน/snapshot/กติกาเข้าเตา และเทียบข้อมูลเดิมกับbaselineหลังupgrade ไม่ทดสอบด้วยการสร้างงานจริงในหลัก
- [ ] ตรวจหลัก3001และhealthแบบอ่านอย่างเดียว; Expected: รุ่นเดิมยังhealthy ไม่มีตารางใหม่ในหลัก
- [ ] ทบทวนทั้งbranchกับSpecตามวิธีexecutionที่เลือก แก้material findingsแล้วรันchecksที่เกี่ยวข้อง; `git diff --check` Expected: exit0
- [ ] เขียนคู่มือURL/สิทธิ์/จุดตรวจ/ค่าsynthetic/ข้อมูลจริงที่ยังรอ อัปเดตCURRENTว่าQAพร้อมและยังไม่deploy; ส่งให้ผู้ใช้ตรวจรับและระบุข้อมูลที่จะเก็บ
- [ ] Commitเฉพาะdocs/task: `docs: prepare color reference temperature QA acceptance`

### Task 5: นำขึ้นหลักหลังผู้ใช้อนุมัติโมดูลและข้อมูล

**Files:** Modify `docs/CURRENT.md`, `docs/color-reference-temperature-qa-guide.md`; private manifests/backups

- [ ] รอผู้ใช้อนุมัติโมดูลพร้อมข้อมูลที่จะเก็บ ตรวจQAและหลักใหม่ ไม่ย้ายค่าตัวอย่างหรือบัญชีQA ถ้ายังไม่มีข้อมูลจริงที่ยืนยัน ตารางอ้างอิงหลักเริ่มว่าง
- [ ] ป้องกันการเขียนระหว่างcutover ตรวจtarget lthai/lthaiและสำรองหลักใหม่ตามdocker.md ตรวจarchive/checksum เก็บbaselineสดทุกตาราง/ภาพ/sequence ห้ามใช้สำรองเริ่มQAแทน
- [ ] Build/deployโค้ดที่ตรวจแล้วและเพิ่มเฉพาะmigration/ข้อมูลที่อนุมัติในtransaction ห้ามrestoreQAทับหลัก; ถ้ามีข้อมูลย้ายต้องจับคู่กับรหัสสีจริงที่ยืนยัน ไม่copyIDหรือจับชื่อคล้ายโดยเดา
- [ ] ตรวจหลักhealth/HTTP3001 การแสดงค่า/สิทธิ์ด้วยบัญชีเดิมแบบอ่าน ไม่มีข้อมูลสมมติ ตารางเก่า/ช่วงเผา/ประวัติและการเปลี่ยนแปลงหลังสำเนาQAยังครบ migrationซ้ำรักษาค่าที่ตั้งไว้ ไม่สร้างรายการทดสอบในหลัก
- [ ] หลังตรวจหลักผ่าน สำรองQAสุดท้ายและตรวจarchive/checksum หยุดและลบเฉพาะproject `lthai-color-reference-qa` กับฐาน/role `lthai_color_reference_qa` ตรวจชื่อก่อนลบ เก็บbackupsและยืนยันเหลือLThai stackหลักชุดเดียว
- [ ] อัปเดตCURRENT/คู่มือพร้อมข้อมูลจริงที่ยังรอและผลตรวจจริง ไม่มีการเปลี่ยนกติกาเข้าเตาโดยปริยาย

## Self-review และ Handoff

ตรวจSpecครบ: แยกตาราง/ค่าว่าง/ทศนิยม/ตัวตนสี(Task1–2); หนึ่งค่าต่อสี/ชื่อช่อง/อ่านร่วม/สิทธิ์แยก(Task2–3); ไม่ผูกโคน/ไม่แก้สีดิน/ไม่เปลี่ยนช่วงและประวัติ(Task2/4); ไม่เดาข้อมูลจริงและQA→อนุมัติ→สำรองใหม่→นำขึ้น→ลบQA(Task1/4/5) สัญญา `reference_temperature_c` สำหรับอ่าน/responseกับ `temperature_c` สำหรับPUT แยกชื่ออย่างตั้งใจ และฝั่งเว็บใช้helperตามcontractเดียวกัน

การตัดสินใจเทคนิคในแผน: double precisionพร้อมCHECKค่าจำกัด, PUT nullเพื่อล้าง, แยกeditor/formและaudit, แสดงค่าใต้ชื่อในเซลล์เดิม ไม่เพิ่มสิทธิ์ใหม่ ทั้งหมดใช้ทำให้Specเป็นงานที่ทดสอบได้ ไม่ขยายไปแก้กติกาเตา

แนะนำ **Native**: ผู้ช่วยหลักทำทีละtask เพราะงาน schema/API/UIมีสัญญาร่วมเล็กและชัด แล้วให้ผู้รีวิวอิสระตรวจภาพรวมก่อนส่งQA หากต้องการรีวิวทุกtaskเลือกSubagent-drivenได้ ต้องให้ผู้ใช้ตรวจแผนและเลือกวิธีลงมือก่อนTask1
