# ผลตรวจการเรียงคอลัมน์ employees แบบถาวร

วันที่ตรวจ: 19 พฤศจิกายน 2026
สถานะ: ผู้ใช้ตรวจรับ QA และอนุมัตินำขึ้นฐานหลักเมื่อ19พฤศจิกายน2026 ดำเนินการบนlthai-dockerแล้ว

ผลซ้อม: ย้าย lthai_column_order_qa ครบ37คนตามลำดับเป้าหมายใน90ms ตรวจข้อมูล33ตาราง/constraints/FKs/serial stateและownershipตรงเดิม รันซ้ำ skipped; integration8รายการและชุดทดสอบรวม112รายการผ่าน ข้าม5รายการเดิม ต่อมานำขึ้นฐานหลักแล้วหลังสำรองใหม่ ตรวจข้อมูล33ตารางตรงก่อนย้ายและปิด/ลบQAแล้ว ดูสถานะและหลักฐานใน docs/CURRENT.md

## ข้อสรุป

ทำได้โดยย้ายโครงสร้างตาราง ไม่ใช่การลากลำดับใน DBeaver งานหลักคือ migration และการตรวจรักษาข้อมูล/ความสัมพันธ์ ไม่พบเหตุให้แก้ฟอร์มหรือ business logic ของ API เพียงเพื่อเปลี่ยนลำดับคอลัมน์

ถ้า “ถาวร” หมายถึงจำลำดับเมื่อเปิด DBeaver อีกครั้ง ให้พิจารณาการบันทึกการแสดงผลของ DBeaver ก่อน เพราะต่างจากการเปลี่ยนลำดับ PostgreSQL ที่ทุกโปรแกรมจะเห็นผ่าน SELECT *

## หลักฐานที่ตรวจ

- Docker หลัก lthai เป็น PostgreSQL 18.6 ตาราง public.employees มี 37 คน 14 คอลัมน์ที่ยังใช้งาน
- ลำดับปัจจุบัน: id, code, department, position_id, phone, active, archived, created_at, updated_at, social_security_number, taxpayer_id, prefix, first_name, last_name
- prefix/first_name/last_name อยู่ท้ายเพราะ migration เดิม ADD COLUMN แล้ว DROP COLUMN name ส่วนสร้างฐานใหม่ใน apps/api/src/database.ts เรียงสามช่องต่อจาก code อยู่แล้ว
- ตารางที่อ้าง employees.id: users, pressing_entries, pressing_sort_results, glazing_batch_workers รวม 4 foreign keys; employees.position_id อ้าง positions.id อีกหนึ่ง foreign key ทั้งหมด NO ACTION, ไม่ deferrable และ validated
- มี primary key(id), unique index lower(code), sequence แบบ owned SERIAL ต้องรักษาทั้ง ownership/default และความคืบหน้าของเลข ไม่ใช่ reset โดยคาดจากจำนวนแถว
- ไม่พบ dependent views/rules, custom triggers, RLS/policies, partition/inheritance, publication, extended statistics, explicit ACL หรือ comments/security labels ที่เพิ่มขอบเขตในผลตรวจครั้งนี้ ต้องตรวจซ้ำก่อนย้ายจริง
- จุดอ่าน/เขียนหลักใช้ชื่อคอลัมน์ ไม่พบ rowMode array, INSERT employees แบบไม่ระบุชื่อคอลัมน์ หรือ employee COPY/export ที่ผูกกับลำดับ
- scripts/verify-docker.mjs ใช้ SELECT * แล้ว hash JSON.stringify ซึ่งขึ้นกับลำดับ key ทดสอบด้วยข้อมูลสมมติที่ค่าตรงกันแต่ key สลับกัน ได้ sameNamedValues=true แต่ hashesEqual=false จึงต้องเปรียบเทียบแบบไม่ขึ้นกับลำดับคอลัมน์หากจะใช้สคริปต์นี้ยืนยันข้อมูล การเทียบ Docker กับ native legacy ยังอาจต่างกันจริงเพราะเป็นข้อมูลคนละชุด ไม่ควรคาดว่าจะตรงกันโดยอัตโนมัติ

## ขอบเขตงานหากเลือกเปลี่ยน PostgreSQL จริง

1. เพิ่ม migration เฉพาะกิจที่ตรวจเป้าหมายและ schema ปัจจุบัน รองรับ dry-run/การรันซ้ำ และสร้างตารางตามลำดับที่ตกลง ใช้ชื่อคอลัมน์ชัดเจนระหว่างคัดลอก
2. เก็บข้อมูลทุกช่องรวม id/code/timestamps/เลขประจำตัว/สถานะ และรักษา sequence/default/checks/indexes/owner/สิทธิ์เดิม ย้ายใน transaction พร้อมป้องกันการเขียนระหว่างสลับ
3. จัดการ foreign keys ทั้งเข้า4/ออก1อย่างชัดเจน การ rename ตารางอย่างเดียวไม่ได้ทำให้ foreign key เปลี่ยนไปอ้างตารางใหม่อัตโนมัติ ห้ามใช้ DROP CASCADE แบบเหมา
4. ปรับเครื่องมือตรวจ hash ให้เทียบค่าตามชื่อคอลัมน์ และเพิ่ม integration tests ของการย้าย ความสัมพันธ์ รหัสถัดไป rollback และรันซ้ำ ไม่มีความจำเป็นต้องเปลี่ยน payload หรือหน้าจอพนักงาน
5. สำรองหลักใหม่ กู้ฐาน QA แยก ซ้อมและตรวจ fingerprints ข้อมูล/FKs/schema/sequence รวมถึงเพิ่มและแก้ไขพนักงานผ่าน API ก่อนให้ผู้ใช้ตรวจรับ
6. หลังอนุมัติ QA สำรองหลักใหม่อีกครั้ง แล้วนำเฉพาะ migration ขึ้นกับข้อมูลหลักปัจจุบันในช่วงหยุดเขียนสั้น ๆ ตรวจเวลาจริงจากการซ้อม ไม่รับรองระยะเวลาหยุดล่วงหน้า ไม่ restore QA ทั้งฐานทับหลัก และล้าง QA หลังตรวจหลักผ่านตาม AGENTS.md

ลำดับเป้าหมายที่เสนอ: id, code, prefix, first_name, last_name, department, position_id, phone, active, archived, created_at, updated_at, social_security_number, taxpayer_id

เอกสารนี้เป็นผลตรวจและขอบเขตเบื้องต้น ไม่ใช่แบบหรือแผนที่อนุมัติให้เปลี่ยนฐานหลัก

## แหล่งอ้างอิง

- PostgreSQL column position: https://wiki.postgresql.org/wiki/Alter_column_position
- PostgreSQL 18 ALTER TABLE และระดับ lock: https://www.postgresql.org/docs/18/sql-altertable.html
- DBeaver column display ordering: https://dbeaver.com/docs/dbeaver/Data-Filters/#sorting-columns-in-data-table
