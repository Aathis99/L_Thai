# LThai ERP · ระบบ ERP สำหรับโรงงานกระเบื้อง

ให้ Codex อ่าน [สถานะงานล่าสุด](docs/CURRENT.md) ก่อนเริ่มงาน

LThai คือระบบ ERP (Enterprise Resource Planning) สำหรับโรงงานกระเบื้อง พัฒนาเพิ่มทีละโมดูล เริ่มจากการบันทึกข้อมูลหน้างานและกระบวนการผลิต แล้วเชื่อมโยงงานของแผนกอื่นตามความต้องการจริง ดู [กรอบ ERP และกติกาการเพิ่มโมดูล](docs/erp.md) สำหรับข้อมูลร่วม ผู้รับผิดชอบข้อมูลต้นทาง และการส่งต่องาน

หน้าบ้านใช้ Tailwind CSS v4 + PostCSS แล้ว: [แนวทาง CSS และการเพิ่มหน้าจอ](docs/tailwind.md) รวม theme สี/ฟอนต์และ reusable components ไว้ในโปรเจกต์ ไม่มี CSS CDN ระหว่างใช้งาน

รันทั้งระบบผ่าน Docker เป็นวิธีหลัก: ดู [คู่มือ Docker](docs/docker.md) ชุด `lthai-docker` เปิด http://127.0.0.1:3001 และใช้ฐานข้อมูลหลัก `lthai` พอร์ต 5434 ส่วนชุด Windows ด้านล่างเป็นฐาน legacy แยก

ปัจจุบันมีทะเบียนพนักงาน บัญชี/สิทธิ์ ทะเบียนสินค้า ดิน สี และกระบวนการผลิตตั้งแต่ใบสั่ง/งานปั๊ม การเบิก ชุบเคลือบ เตาเผา QC งานซ่อม จนถึงยอดพร้อมส่งและสต็อกสินค้าสำเร็จตามขอบเขตที่พัฒนาแล้ว ใช้ Next.js + React + TypeScript (หน้าบ้าน), Node.js + Express + TypeScript (API) และ PostgreSQL งานขาย จัดซื้อ ค่าแรง ต้นทุน หรือบัญชีเป็นส่วนที่ขยายได้ในอนาคตตามความต้องการ การเรียกว่า ERP ยังไม่ได้หมายถึงมีทุกส่วนครบแล้ว

## เปิดใช้งานด้วย Docker (วิธีหลัก)

```powershell
cd D:\LThai
npm run docker:up
```

เปิด http://127.0.0.1:3001 ใช้ฐานข้อมูลหลักใน Docker พอร์ต 5434

## วิธีเดิมบน Windows (อ้างอิงฐาน native แยก)

เครื่องนี้ติดตั้ง dependencies, build, PostgreSQL และนำเข้าข้อมูลแล้ว:

```powershell
cd D:\LThai
npm start
```

เปิด http://127.0.0.1:3000 แล้วเข้าสู่ระบบด้วยบัญชีเดิม รหัสผ่านเดิมยังใช้ได้ การย้ายฐานข้อมูลยกเลิก session เดิมจึงต้อง login ใหม่ ตัว launcher เริ่ม PostgreSQL cluster ของโปรเจกต์หากยังไม่ทำงาน แล้วเปิด Express และ Next.js ใช้ Ctrl+C เพื่อหยุดแอป (PostgreSQL คงทำงานอยู่)

โหมดพัฒนาใช้ `npm run dev` หลังแก้โค้ด production ให้ `npm run build` แล้ว `npm start` ไม่ต้องใช้อินเทอร์เน็ตระหว่างใช้งานปกติหลังติดตั้งและ build แล้ว ไม่มี CDN หรือบริการ cloud สำหรับ login/อ่านเขียนข้อมูล

## DBeaver

สร้าง connection ชนิด PostgreSQL:

| ค่า | การตั้งค่าบนเครื่องนี้ |
|---|---|
| Host | 127.0.0.1 |
| Port | 5434 (Docker หลัก) |
| Database | lthai |
| Username | lthai |
| Password | ดู POSTGRES_PASSWORD ในไฟล์ส่วนตัว `.env` |

รหัสผ่านฐานข้อมูลแยกจากรหัสผ่านเข้าเว็บ เก็บใน `.env` และไฟล์ส่วนตัวดังกล่าว ไม่แสดงในเอกสารนี้ หาก DBeaver ยังไม่มี PostgreSQL driver ต้องดาวน์โหลด driver ครั้งแรกขณะมีอินเทอร์เน็ต

ฐาน native เดิมเป็น PostgreSQL 18.6 รันตรงบน Windows โดยใช้ binaries ที่ `.tools/postgresql/pgsql/bin` และ cluster ที่ `data/postgres` พอร์ต 5433 รหัสดูใน `data/connection-info.txt` เป็นข้อมูลแยกจาก Docker หลัก ส่วน `compose.yaml` เป็นทางเลือกฐานอย่างเดียวที่ใช้พอร์ต 5433 เช่นกัน ห้ามเปิดชนกับ native ระบบหลักปัจจุบันใช้ `compose.docker.yaml` พอร์ต 5434

## ข้อมูลที่ย้ายและนำเข้า

อัปเดตล่าสุด: เปลี่ยนรหัสพนักงานที่นำเข้า 36 คนเป็น `emp001`–`emp036` แล้ว เพิ่มช่องเลขประกันสังคมและเลขประจำตัวประชาชนผู้เสียภาษีอากรในตาราง/แบบฟอร์ม เลขผู้เสียภาษีจาก Excel ที่มีรูปแบบ 13 หลักเติมแล้ว 29 คน อีก 7 คนเว้นว่าง ส่วนเลขประกันสังคมไม่มีคอลัมน์ระบุใน source จึงเว้นว่างทั้งหมดให้กรอกเอง เลขทั้งสองเก็บเป็นข้อความเพื่อรักษาศูนย์นำหน้า

- ย้ายบัญชีเดิม 1 บัญชี บทบาทเดิม 3 บทบาท และประวัติเดิม โดยคง IDs และ scrypt password hash เดิม
- พนักงาน 36 คน จากชีต “พนักงาน ปี2569” แถว 3–38 ใน Excel ที่ผู้ใช้ให้
- สร้างรหัสชั่วคราว EMP69-001 ถึง EMP69-036 ตามลำดับในชีต
- นำเฉพาะคำนำหน้า/ชื่อ/นามสกุลมารวมเป็นชื่อที่แสดง และเบอร์โทร เก็บเลขศูนย์นำหน้าและขีดตามต้นฉบับ
- 12 รายการไม่มีนามสกุล ไม่แต่งเติมชื่อ แผนกและตำแหน่งยังว่าง ไม่มีข้อมูลจริงให้จับคู่
- ไม่ดึงวันเกิด อายุ เลขบัตร ที่อยู่ หรือเลขผู้เสียภาษี และไม่สร้างบัญชี login ให้พนักงานจาก Excel
- import ซ้ำด้วย source เดิมจะ skip ไม่เพิ่มซ้ำหรือเขียนทับข้อมูลที่แก้ในโปรแกรมภายหลัง หาก source เปลี่ยนหรือพบรหัส/ชื่อชนกับข้อมูลที่มี จะหยุดทั้งชุดเพื่อให้ตรวจสอบ
- Excel ต้นฉบับและ SQLite เดิมไม่ถูกแก้ไข SQLite snapshot ก่อนย้ายอยู่ใน `data/backups`

## การใช้งาน

ตำแหน่งงานบอกหน้าที่พนักงาน ส่วนบทบาทกำหนดสิทธิ์เข้าโปรแกรม แยกกันเสมอ พนักงานไม่จำเป็นต้องมีบัญชี

| บทบาทเริ่มต้น | สิทธิ์ |
|---|---|
| ผู้ดูแลระบบ | จัดการพนักงาน ตำแหน่ง บัญชี บทบาท และดูประวัติ |
| ผู้บันทึกข้อมูล | ดู เพิ่ม แก้ไขพนักงาน |
| ดูข้อมูล | ดูพนักงาน |

ตรวจสิทธิ์ที่ API ทุกครั้ง เปลี่ยนสิทธิ์มีผลกับ session ที่มีอยู่ ปิดบัญชี/ลบบัญชี/เปลี่ยนรหัสผ่านเพิกถอน session เดิม session อายุ 8 ชั่วโมง และห้ามปิด/ลดสิทธิ์ผู้ดูแลคนสุดท้าย รวมถึงผ่านการลบพนักงานที่ผูกกับบัญชีนั้น

ลบพนักงานเป็นการเก็บทะเบียนใน “รายการที่ลบแล้ว” พร้อมปิดบัญชีที่เชื่อมโยง ไม่มีปุ่มกู้คืนในรุ่นนี้ ลบบัญชีแล้วชื่อผู้ใช้เดิมยังสงวนไว้แต่สร้างชื่อใหม่ผูกพนักงานเดิมได้ ตำแหน่ง/บทบาทที่มีข้อมูลอ้างอิงจะลบไม่ได้ ประวัติแสดงล่าสุด 300 รายการ มีผู้ทำ เวลา การกระทำและรหัสรายการ ยังไม่เก็บสำเนาค่าก่อน–หลัง

## เตรียมใช้ใน LAN โรงงาน

ตอนส่งมอบยังเปิดเฉพาะเครื่องนี้ ค่าเริ่มต้นไม่เปิดฐานข้อมูลหรือเว็บออกเครือข่ายโดยอัตโนมัติ เมื่อเลือกเครื่องเซิร์ฟเวอร์และ IP ภายในคงที่แล้ว:

1. ให้ทุกเครื่องอยู่ใน LAN/Wi-Fi ที่เข้าถึงเซิร์ฟเวอร์ได้
2. ใน `.env` ตั้ง `WEB_HOST=0.0.0.0` และเพิ่ม URL จริง เช่น `http://192.168.1.50:3000` ใน `APP_ORIGINS` โดยคง URL local เดิมไว้ได้
3. เปิด firewall เฉพาะพอร์ตหน้าเว็บบนเครือข่ายโรงงานที่อนุญาต API ยัง bind `127.0.0.1:4000` และ PostgreSQL ยัง bind `127.0.0.1:5433` เครื่องลูกใช้ผ่าน Next.js proxy ไม่ต้องเชื่อมฐานข้อมูลตรง
4. เริ่ม `npm start` ใหม่ แล้วเครื่องลูกเปิด `http://<IP-เซิร์ฟเวอร์>:3000`
5. จัด HTTPS และตั้ง `COOKIE_SECURE=true` เมื่อเปิดใช้ TLS พร้อมกำหนด `APP_ORIGINS` เป็น URL https จริง จัดการสำรองและการเริ่มแอปเมื่อเปิดเครื่องก่อนใช้งานประจำ

เมื่ออินเทอร์เน็ตล่มแต่ LAN และเครื่องเซิร์ฟเวอร์ยังทำงาน จะใช้งานฐานข้อมูลและแอปภายในต่อได้ ไม่ได้หมายความว่าเครื่องลูกบันทึกงานได้เมื่อ Wi-Fi/LAN หรือเซิร์ฟเวอร์ล่ม รุ่นนี้ยังไม่มี offline queue/sync บนเครื่องลูก

Next.js API_INTERNAL_URL ถูกใช้ตอน build หากเปลี่ยน host/port API ให้แก้ `.env` แล้ว build ใหม่ก่อนเริ่มแอป

## ฐานข้อมูลและสำรอง

ใช้ [วิธีสำรองและซ้อมกู้ฐาน Docker หลัก](docs/docker.md#docker-backup) สำหรับฐาน `lthai` พอร์ต 5434

คำสั่งต่อไปนี้ใช้กับ PostgreSQL native เดิมพอร์ต 5433

```powershell
npm run db:up
npm run db:backup
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/database/status.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/database/stop.ps1
```

Backup เป็น PostgreSQL custom dump ใน `data/backups` ทำขณะระบบทำงานได้ สำรองโฟลเดอร์นี้ไว้อีกเครื่อง/สื่อแยก ยังไม่มีตารางสำรองอัตโนมัติ ควรทดสอบกู้คืนลงฐานข้อมูลใหม่ก่อนกู้ทับฐานข้อมูลใช้งานจริง ใช้ pg_restore ใน native bin หรือ DBeaver Restore (ต้องตั้ง PostgreSQL local client path ให้ตรง)

อย่าลบ `data/postgres`, `.env`, `data/connection-info.txt` หรือสำเนาสำรอง `.tools`, `data`, `.env`, Excel และ build outputs ถูก ignore เพื่อไม่ให้ข้อมูลส่วนตัวหรือ credentials เข้าซอร์ส

## คำสั่งข้อมูลสำหรับผู้ดูแลโปรเจกต์

```powershell
npm run db:migrate
npm run data:migrate --workspace=@lthai/api -- ../../data/staging/legacy-name-mapping.json
npm run employees:import
node scripts/reconcile-data.mjs
```

การนำเข้า source ใหม่ให้ติดตั้ง reader ตาม `requirements-import.txt` ใน Python environment ของตนก่อน แล้วรัน:

```powershell
python scripts/extract-employees.py --input "ประวัติพนักงานบจ.กระเบื้องปี2569.xls" --output data/staging/employees-2569.json
```

ตัว extractor อ่านเฉพาะชีต/คอลัมน์ที่ตกลง และสร้าง JSON ส่วนตัวใน data/staging ตัว importer ตรวจ hash ว่าตรงกับ source ก่อน import อย่านำ Excel/JSON/ฐานข้อมูลส่วนตัวขึ้น Git

ชื่อพนักงานใช้ `prefix`, `first_name`, `last_name` แยกกัน ชื่อจำเป็น คำนำหน้าและนามสกุลเว้นว่างได้ รองรับหลายคำ ไม่มี `employees.name` หรือ payload ชื่อรวมใน API พนักงาน ตัว extractor ส่งสามช่องโดยตรงจาก B/C/D ต้องสกัด staging เก่าใหม่ก่อนนำเข้า

การย้าย SQLite เก่าต้องมีไฟล์ mapping ที่ตรวจแล้ว รูปแบบ `{ "19": { "expectedName": "ชื่อเดิมตรงตามต้นทาง", "prefix": "", "first_name": "ชื่อ", "last_name": "นามสกุล" } }` ตาม source employee id ทุกคน หากไม่มี mapping หรือชื่อเดิมไม่ตรง ระบบยกเลิกทั้ง transaction ไม่เดาแบ่งคำ

ฐาน PostgreSQL เก่าที่มี `employees.name` ต้องอัปเกรดอย่างชัดเจนก่อนเปิด API ใหม่ ใช้คำสั่ง `node --import tsx apps/api/src/commands.ts employee-names <mapping.json> <expected-database> <source.xls> <source.md> --dry-run` เพื่อตรวจรายการก่อนทำจริง รูปแบบ mapping และขั้นตอนสำรอง/QA อยู่ใน [แบบแยกส่วนชื่อพนักงาน](docs/superpowers/specs/2026-11-19-employee-name-parts-design.md) ห้ามรัน migration/test กับฐานหลักระหว่างพัฒนา

## ตรวจสอบและโครงสร้าง

```powershell
npm test
npm run check
npm run build
```

- `apps/web`: Next.js App Router, React components, TypeScript และ CSS ที่เก็บในโปรเจกต์
- `apps/api/src`: Express, validation/password hashing, PostgreSQL schema และ transactional access rules
- `scripts/database`: native PostgreSQL setup/start/stop/status/backup
- `scripts/run-apps.mjs`: เปิด API และเว็บพร้อมกัน
- `scripts/extract-employees.py`: XLS reader (xlrd) สำหรับ source นี้
- `data`: ข้อมูลจริงและสำรอง (ส่วนตัว)
- `server.mjs`, `lib`, `public`: ต้นฉบับเดิมเก็บเป็น reference/rollback ไม่ใช่แอปที่ npm start ใช้อีกแล้ว

ประวัติผลตรวจการย้าย stack อยู่ที่ `docs/stack-migration-verification.md` และประวัติความต้องการอยู่ที่ `docs/discovery.md` สำหรับขอบเขตที่เปิดใช้จริงและงานถัดไปให้อ่าน [สถานะล่าสุด](docs/CURRENT.md) และใช้ [กรอบ ERP](docs/erp.md) เมื่อต่อยอดส่วนงานใหม่
