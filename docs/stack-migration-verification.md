# ผลตรวจย้าย stack · 2026-11-09

## ผลที่ส่งมอบ

- Next.js 16.4.5 / React 19.3.1 / TypeScript แทนหน้าจอ vanilla เดิม
- Express 5 / TypeScript / node-postgres แทน native HTTP และ synchronous SQLite API
- PostgreSQL 18.6 รันจริงบน Windows ที่ 127.0.0.1:5433 ฐานข้อมูล lthai
- npm start เปิด PostgreSQL หากจำเป็น พร้อม Express 4000 และ Next.js 3000 ได้จริง
- ทะเบียนเดิมและบัญชีจริงย้ายผ่าน consistent SQLite online backup รวม WAL โดยคง IDs และ password hash; session เดิมไม่นำข้าม
- ย้าย legacy roles 3, users 1, audit 1; legacy positions/employees 0
- พนักงานจากชีต พนักงาน ปี2569 แถว 3–38 จำนวน 36 คน เข้า PostgreSQL จริงแล้ว
- นำเข้าซ้ำ source เดิมผล skipped จำนวนพนักงานไม่เพิ่ม ไม่มีบัญชีพนักงานที่สร้างอัตโนมัติ
- reconcile ตรวจชื่อ/โทรศัพท์ครบ 36, แผนกว่าง, ตำแหน่ง null, password hash บัญชีเดิมตรงทุกบัญชี และ hash ของ Excel ต้นฉบับไม่เปลี่ยน

## Automated verification

`npm test` ผ่าน 30 tests, 0 failures, 0 skipped:

- Legacy behavior baseline 13
- Express/PostgreSQL access และ data migration/import 13
- React form model/filter 4

การทดสอบ PostgreSQL ใช้ schemas แยกและข้อมูลสังเคราะห์ ไม่แก้ทะเบียนหรือบัญชีจริง ตรวจสิทธิ์ฝั่ง API, บทบาทมีผลทันที, ผู้ดูแลคนสุดท้าย, concurrent create/archive, password/session invalidation, import atomicity/idempotency/concurrent rerun, snapshot รวม uncheckpointed WAL, rollback และ sequence reset

`npm run check` TypeScript ทั้งสองแอปผ่าน; `npm run build` compile API และ production Next.js ผ่าน

## UI integration

ทดสอบ Next.js production ผ่าน proxy -> Express -> PostgreSQL ด้วย schema QA แยก:

- login ได้ cookie/session และโหลดทะเบียนตามสิทธิ์
- เพิ่มพนักงานภาษาไทยผ่าน React form สำเร็จ ตารางและยอดรวมเพิ่ม
- แก้สถานะจากเปิดเป็นปิดผ่าน checkbox สำเร็จ ยอดผู้เปิดใช้งานลดถูกต้อง
- viewport 390×844 ยังมีปุ่ม logout และกดกลับหน้า login สำเร็จ
- คืน viewport เดิม หยุด QA แล้วเปิด actual application/actual database ด้วย launcher
- actual /api/health ผ่าน Next.js ยืนยัน database=postgresql และ /api/setup required=false ตามบัญชีเดิม
- เปิดหน้าล็อกอินจริงไว้ให้เจ้าของใช้บัญชีเดิม ไม่เปลี่ยนหรือเปิดเผยรหัสผ่านจริง

ภาพ next-express-test.png ใช้ข้อมูลทดสอบสองคนเท่านั้น จึงไม่ใช่ภาพทะเบียน 36 คนจริง

## Independent review

Reviewer พบ React ส่ง active เป็นตัวเลขทั้งที่ API รับ boolean ทำให้ฟอร์มพนักงาน/บัญชีบันทึกไม่ได้ แก้หลังเขียน regression ให้ fail ก่อน แล้ว tests ผ่าน ตรวจจากเบราว์เซอร์กับ API จริงเพิ่มยืนยันแล้ว ผู้ตรวจไม่พบ material auth/migration/data-loss blocker เพิ่ม

## Runtime

Docker Desktop เริ่มไม่ได้จาก virtualization ที่ไม่พร้อม จึงดาวน์โหลด native PostgreSQL จากลิงก์ official EDB ที่ PostgreSQL Windows page ระบุ ตรวจ SHA256 ตาม vendor และติดตั้งแยกใน .tools ไม่ปรับ BIOS/Windows features หรือ restart เครื่อง ทดสอบ authenticated SQL, UTF8 Thai roundtrip, ปฏิเสธรหัสผ่านผิด, stop/start และ custom dump ด้วย pg_restore -l ผ่าน

## ข้อจำกัดที่คงไว้

- ยัง bind loopback เป็นค่าเริ่มต้น การเปิดจริงจากหลายเครื่องต้องกำหนด WEB_HOST, APP_ORIGINS, IP/firewall/HTTPS ตาม README บนเครื่องเซิร์ฟเวอร์ที่จะใช้
- Offline ในที่นี้คืออินเทอร์เน็ตล่มแต่ LAN/เซิร์ฟเวอร์ยังทำงาน ไม่ใช่ offline editing/sync เมื่อเครื่องลูกติดต่อเซิร์ฟเวอร์ไม่ได้
- ยังไม่มี autostart แอปหลัง reboot หรือตาราง backup อัตโนมัติ
- กระบวนการผลิตและกติกาเบิก/หักยอดยังรอข้อมูล ไม่รวมใน migration นี้
