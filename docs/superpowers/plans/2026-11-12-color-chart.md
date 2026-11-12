# Color Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ตั้งต้นชาร์ตสี 90 รายการจาก Excel แล้วให้ผู้ใช้ค้นหา เพิ่ม ลบ แก้ไข และจัดการภาพตัวอย่างหนึ่งภาพต่อรายการ

**Architecture:** เพิ่มทะเบียนและตารางภาพใน PostgreSQL ผ่านระบบบัญชีและสิทธิ์เดิม API รายการส่งข้อมูลชื่อและสถานะภาพ ส่วน API ภาพส่งเฉพาะภาพที่ผู้ใช้มีสิทธิ์ดู คำสั่งตั้งต้นตรวจและนำเข้าข้อมูลจากไฟล์เตรียมนอก Git ภายในธุรกรรมเดียว

**Tech Stack:** Node ≥26, TypeScript, Next.js/React/Tailwind, Express, PostgreSQL 18, Docker Compose, node:test, Python กับ openpyxl 3.1.5 จาก `requirements-import.txt` สำหรับอ่าน XLSX และ Sharp เวอร์ชัน 0.35.5 ที่มีอยู่ใน package lock สำหรับแปลงภาพฝั่ง API

**Spec:** [แบบระบบชาร์ตสีรุ่นแรก](../specs/2026-11-12-color-chart-design.md) ผู้ใช้ยืนยันแล้ว

## Global Constraints

- ใช้ Docker และระบบบัญชีเดิม ทดสอบบนฐานแยกจากฐานโรงงาน พอร์ตหลัก 3001/5434 และ native 5433 เป็นฐานเดิมคนละชุด
- เก็บชื่อเต็มตาม Excel ภาพเป็นทางเลือกหนึ่งภาพต่อรายการ คงชื่อ ลำดับ และหมายเหตุเมื่อเปลี่ยนหรือลบเฉพาะภาพ
- ชื่อและรูปภาพใช้สิทธิ์ดูชุดเดียวกัน การแก้ไขใช้ทั้งสิทธิ์ดูและสิทธิ์จัดการ ตรวจสิทธิ์ฝั่ง API ทุกครั้ง
- รับ JPEG, PNG หรือ WebP ขนาดไฟล์ต้นทางไม่เกิน 8 MiB ภาพตัวอย่างด้านยาวไม่เกิน 1,024 พิกเซล และขนาดเก็บไม่เกิน 256 KiB
- เก็บ Excel ข้อมูลเตรียมนำเข้า ภาพจริง `.env` และไฟล์สำรองภายนอก Git ใช้ข้อมูลสังเคราะห์ใน tests
- ใช้ตารางปกติใน schema `public` สำหรับฐานใช้งานเพื่อให้ชุดสำรอง Docker เดิมรวมภาพและทะเบียนได้

## Review Focus

1. ชื่อที่ต่างกันแค่ตัวพิมพ์หรือช่องว่างซ้ำถูกปฏิเสธ ชื่อเดิมยังแสดงตามที่กรอก (Task 1)
2. การนำเข้าซ้ำหลังแก้ชื่อหรือลบรายการคงการแก้ไขของผู้ใช้ และไฟล์ต้นทางที่เปลี่ยนไม่เขียนทับทะเบียน (Task 2)
3. ผู้ดูไม่มีสิทธิ์เปลี่ยนภาพ และการอัปโหลดไฟล์ปลอมหรือไฟล์ใหญ่ไม่ลบภาพเดิม (Task 3)
4. แก้หรือลบภาพแล้วหน้าเว็บแสดงข้อมูลปัจจุบัน การสร้างชื่อสำเร็จโดยยังไม่มีภาพ (Task 4)
5. ชุดสำรองที่กู้คืนอ่านภาพได้จริงหลังรีสตาร์ต และเทียบข้อมูลภาพพร้อมชื่อ ลำดับ และหมายเหตุได้ (Task 5)

## File Map

| ไฟล์ | หน้าที่ |
| --- | --- |
| `apps/api/src/color-chart/{schema,catalog,routes}.ts` | ตารางทะเบียน ตรวจชื่อ และ API CRUD |
| `apps/api/src/color-chart/{seed,seed-command}.ts` และ `scripts/extract-color-chart.py` | เตรียม ตรวจ และบันทึก 90 รายการจากแหล่งที่ยืนยัน |
| `apps/api/src/color-chart/images.ts` | ตรวจและแปลงไฟล์ อ่าน เปลี่ยน และลบภาพ |
| `apps/api/src/{app,database,import}.ts` | เชื่อม route, migration, สิทธิ์และตัวตรวจฐานเปล่าที่ใช้ร่วมกัน |
| `apps/api/tests/color-chart.test.ts` | ทดสอบผ่าน HTTP และ PostgreSQL แยก |
| `apps/web/src/components/color-chart/panel.tsx` และ `apps/web/src/lib/color-chart.ts` | หน้าชาร์ตสีและข้อมูลสำหรับแสดงผล |
| `docs/color-chart-startup.md` | คู่มือเตรียมข้อมูล ให้สิทธิ์ และเปิดใช้ |

### Task 1 — ทะเบียนชื่อสีและสิทธิ์

**Files:** เพิ่ม `apps/api/src/color-chart/{schema,catalog,routes}.ts`, `apps/api/tests/color-chart.test.ts` แก้ `apps/api/src/{app,database,import}.ts`

**Interfaces:** `migrateColorChart(db: Db): Promise<void>` และ `handleColorChartRoute(req, res, access): Promise<boolean>` ใช้ขอบเขต read/mutate ของ session เดิม เส้นทาง `GET/POST /api/color-chart`, `PUT/DELETE /api/color-chart/:id` ใช้ `{ name, note? }` กับการสร้าง/แก้ และส่ง `{ id }` เมื่อสำเร็จ รายการอ่านคืน `{ items: { id, display_order, name, note, has_image }[] }`

- [ ] เขียน HTTP tests ที่ตรวจบทบาทเดิมของผู้ดูแลได้รับสิทธิ์ใหม่ ผู้ดูถูกปฏิเสธการเขียน สร้างชื่อโดยไม่มีรูปได้ และชื่อซ้ำที่ต่างเพียง case/ช่องว่างตอบ 409 ตัวอย่าง `assert.equal(duplicate.status, 409)`
- [ ] รัน `npm exec --workspace=@lthai/api -- tsx --test tests/color-chart.test.ts` บนฐานทดสอบ คาดว่าล้มเพราะ route หรือ schema ยังไม่มี
- [ ] สร้าง `color_chart_entries` มี id คงที่ ลำดับและชื่อเปรียบเทียบ unique ชื่อที่แสดงตัดเฉพาะหัวท้าย เปรียบเทียบโดยแปลงเป็นตัวเล็กและยุบช่องว่างซ้ำ จัดลำดับใหม่ต่อท้ายใน transaction เดิม พร้อม audit ทุกการเปลี่ยนรายการ ส่ง `has_image: false` จนกว่า Task 3 จะเพิ่มตารางภาพ
- [ ] เพิ่ม `color_chart.read` และ `color_chart.manage` ในทะเบียนสิทธิ์ ใช้การให้สิทธิ์ role 1 เดิมและตรวจใหม่ในธุรกรรมเขียน รักษาการนำเข้าฐานเดิมโดยใช้ baseline roles ชุดเดียวและนับตารางชาร์ตสีในเงื่อนไขฐานว่าง
- [ ] รันชุดทดสอบงานนี้และ `npm run test --workspace=@lthai/api` คาดว่าผ่าน รวมการอัปเกรดจากฐานเดิม
- [ ] Commit ด้วย `feat: add tile color chart catalog and permissions`

### Task 2 — เตรียมและนำเข้า 90 รายการ

**Files:** เพิ่ม `scripts/extract-color-chart.py`, `apps/api/src/color-chart/{seed,seed-command}.ts` แก้ `apps/api/package.json` และ `apps/api/tests/color-chart.test.ts`

**Interfaces:** `python scripts/extract-color-chart.py <workbook> <prepared-json>` ส่ง JSON `{ sourceSha256, sheet: "Sheet1", items: { display_order, name, note }[] }` ที่ปลายทางนอก Git คำสั่ง `npm run color-chart:seed --workspace=@lthai/api -- --preview <workbook> <prepared-json>` ตรวจและแสดงรายการโดยไม่เชื่อมฐาน ใช้ `--apply` สำหรับบันทึกลงฐานที่กำหนด

- [ ] เขียน tests ด้วยข้อมูลสังเคราะห์ 90 แถว ตรวจ `assert.equal(items.length, 90)` ลำดับครบ หมายเหตุตรง 3 รายการ ไฟล์เปลี่ยน/ชื่อชนต้องไม่เพิ่มแถว และนำเข้าซ้ำหลังแก้ชื่อหรือลบรายการแล้วต้องคงสภาพนั้น
- [ ] รันชุดทดสอบงานสี คาดว่าล้มเพราะยังไม่มีคำสั่งนำเข้าหรือบันทึกประจำชุด
- [ ] อ่าน XLSX แบบ read-only ตามชื่อชีตและพิกัดในแบบ รองรับเลขลำดับข้อความและชื่อ shared strings ตรวจชื่อของรายการที่รับหมายเหตุใน B95/B96 ก่อนผูก ตรวจ SHA-256 ของ Excel เทียบข้อมูลเตรียมในทั้ง preview/apply
- [ ] ใช้ `data_migrations` กับรหัสชุดตั้งต้นคงที่และ SHA-256 ในรายละเอียด ทำซ้ำ hash เดิมคืนผล “เคยนำเข้าแล้ว” hash อื่นแจ้งให้ตรวจ ใช้ธุรกรรมเดิมตรวจชื่อ/ลำดับชนแล้วบันทึกทั้งชุดหรือไม่บันทึกเลย ไม่แนบรูปเริ่มต้น
- [ ] รันชุดทดสอบและสร้าง preview จากไฟล์จริงแบบอ่านอย่างเดียว เทียบ 1–90, “วาดลาย” #64 และหมายเหตุของขาวฟ้า เขียวศิลาดล ศิลาดล การลอง apply ใช้ฐานทดสอบที่แยกไว้และต้องได้ 90 รายการ
- [ ] Commit ด้วย `feat: seed tile color chart from a verified workbook`

### Task 3 — ภาพหนึ่งภาพต่อรายการ

**Files:** เพิ่ม `apps/api/src/color-chart/images.ts` แก้ `schema.ts`, `routes.ts`, `catalog.ts` ในโมดูล แก้ `apps/api/src/app.ts`, `apps/api/package.json`, `package-lock.json` และ `apps/api/tests/color-chart.test.ts`

**Interfaces:** `GET/PUT/DELETE /api/color-chart/:id/image` PUT รับ bytes ของไฟล์โดยใช้ Content-Type JPEG/PNG/WebP และคืน `{ id }` GET คืนภาพ WebP หรือ 404 ถ้ายังไม่มี DELETE ลบภาพและคืน `{ id }` `encodeColorChartImage(input: Buffer, contentType: string): Promise<Buffer>` ตรวจและแปลงภาพก่อนเขียน

- [ ] เขียน HTTP tests ที่ตรวจผู้ดูอ่านภาพได้แต่เปลี่ยนไม่ได้ ปฏิเสธไฟล์ปลอมและเกิน 8 MiB รูปก่อนและหลังคำขอที่ล้มเหลวต้องตรงกันด้วย `assert.deepEqual(after, before)` ลบรูปแล้วชื่อยังอยู่ ลบรายการแล้วภาพหมด และคำขอจาก origin อื่นยังถูกปฏิเสธ
- [ ] รันชุดทดสอบงานสี คาดว่าล้มที่ route ภาพและการแปลงภาพ
- [ ] ประกาศ Sharp ที่ API โดยใช้เวอร์ชันใน lock เดิม แปลงภาพที่ถอดรหัสได้จริงเป็น WebP แบบภาพนิ่ง ปรับตามทิศทางภาพจากกล้องและย่อไม่เกิน 1,024 พิกเซล จำกัดจำนวนพิกเซลต้นทางในตัวถอดรหัส จำกัดภาพผลลัพธ์ 256 KiB เมื่อบันทึก ใช้ MIME ของผลที่แปลงจริง
- [ ] เพิ่มตัวรับ raw bytes เฉพาะ PUT ภาพ ตรวจ session และสิทธิ์ก่อนถอดรหัส ตรวจสิทธิ์อีกครั้งก่อนบันทึกภายใน transaction เดิม คงกติกา Host, Origin และขนาด JSON เดิมของ route อื่น
- [ ] เก็บภาพใน `color_chart_images` ที่มี entry id เป็น primary key และ foreign key พร้อม cascade เมื่อรายการถูกลบ ใช้ `bytea` และ check ขนาด รายการอ่านส่งแค่ `has_image` เขียนภาพและ audit พร้อมกัน GET ตรวจสิทธิ์และส่งด้วย `no-store`
- [ ] รันชุดทดสอบงานสีและ `npm run check` ทดสอบ build และ decode ภาพสังเคราะห์ใน Docker Linux/Alpine ด้วย คาดว่าผ่าน
- [ ] Commit ด้วย `feat: store one authorized tile color photo per entry`

### Task 4 — หน้าชาร์ตสี

**Files:** เพิ่ม `apps/web/src/components/color-chart/panel.tsx`, `apps/web/src/lib/color-chart.ts` และ `apps/web/tests/color-chart.test.ts` แก้ `apps/web/src/components/workspace.tsx` และ CSS เฉพาะส่วนที่ต้องใช้

**Interfaces:** `ColorChartPanel({ api, user })` และ `filterColorChart(items, query)` ใช้ข้อมูลและ routes จาก Tasks 1–3 ให้ตัวเรียก `api` เดิมส่ง File เป็น request body พร้อม MIME สำหรับ PUT ภาพที่เป็น same-origin ส่วน JSON และการจัดการ session 401 ใช้ทางเดิม

- [ ] เขียน tests ของตัวกรองชื่อเต็ม เช่น `TERRA COTTA` เจอสองรายการเรียงลำดับเดิม ค้นไทยได้ และชื่อมีช่องว่างไม่ทำให้ลำดับเปลี่ยน
- [ ] รัน `npm run test --workspace=@lthai/web` คาดว่าล้มเพราะตัวกรองยังไม่มี
- [ ] เพิ่มเมนูตามสิทธิ์ดู ใช้ตารางหรือแถวที่อ่านได้บนมือถือ แสดง “ยังไม่มีภาพ” และป้ายหมายเหตุ เปิดรายละเอียดจากรายการ ใช้การโหลดรูปย่อแบบ lazy
- [ ] ต่อฟอร์มเพิ่ม/แก้ชื่อและหมายเหตุ ลบรายการแบบยืนยัน และปุ่มเพิ่ม เปลี่ยน หรือลบเฉพาะภาพหลังบันทึกชื่อ อัปเดตรายการและรีเฟรชรูปจาก API หลังบันทึก และแสดงข้อผิดพลาดจากการอัปโหลดโดยคงรูปเดิม
- [ ] รันชุดทดสอบเว็บ, `npm run check` และ `npm run build` คาดว่าผ่าน ตรวจว่าเมนูงานปั๊มและพนักงานเดิมยังเปิดได้
- [ ] Commit ด้วย `feat: add tile color chart workspace screens`

### Task 5 — ตรวจรับบน Docker และเขียนคู่มือ

**Files:** เพิ่ม `docs/color-chart-startup.md` อัปเดต `docs/CURRENT.md` หลังตรวจจริง

- [x] เปิด Docker ชุดทดสอบแยก ทดสอบผ่านเบราว์เซอร์เดสก์ท็อปและมือถือด้วยผู้จัดการและผู้ดู ตรวจ 90 รายการ ค้นชื่อ อ่านหมายเหตุ เพิ่มชื่อ เปลี่ยนรูป ลบเฉพาะรูป และปุ่มจัดการตามสิทธิ์
- [x] รัน `npm run check`, `npm run build` และ `npm test` พร้อม opt-in Docker handoff integration บนฐานทดสอบ คาดว่าทุกชุดผ่าน
- [x] สำรองฐานทดสอบที่มีทะเบียนและภาพ กู้คืนไปอีกฐานทดสอบ และเทียบลำดับ ชื่อ หมายเหตุ SHA-256 ของภาพ รวมถึงเปิดภาพผ่าน API หลังคืนข้อมูล
- [x] เขียนคู่มือคำสั่ง preview/apply และการให้สิทธิ์ ระบุฐานและ commit ที่ทดสอบ ผลที่รันจริง และขั้นตอนเปิดใช้ใน `docs/CURRENT.md`
- [x] ตรวจ `git diff --check` แล้ว Commit ด้วย `docs: document color chart import and verification`
