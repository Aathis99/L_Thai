# ส่งมอบงานเตา QA — 20 พฤศจิกายน 2026

ผู้ใช้ขอต่องานแล้ว เก็บงานส่งมอบครบ เปิด QA รอผู้ใช้ลอง ยังไม่ตรวจรับหรือนำขึ้นหลัก

## กลับมาทำต่อ

1. อ่าน docs/CURRENT.md, เอกสารนี้ และ .qa/kiln-workflow/progress.md
2. ตรวจ QA และเว็บหลักยังตอบ health แล้วอ่านสถานะ Git ก่อนแก้ต่อ
3. ใช้ [คู่มือลองงาน](kiln-qa-guide.md) ให้ผู้ใช้ลอง และรับข้อเสนอแนะ/รายการข้อมูลที่จะเก็บ
4. ผู้ใช้ยังไม่ได้ขอ merge/นำขึ้นหลัก ห้าม restore QA ทับหลัก

## ที่อยู่และสิ่งที่ทำแล้ว

- Worktree: C:/Users/athis/.codex/worktrees/kiln-workflow-qa/LThai
- Branch: codex/kiln-workflow-qa; โค้ดและเอกสารยังไม่ commit
- เว็บ QA http://127.0.0.1:3141; API 4141; เปิดด้วยรุ่นที่ build แล้ว
- ใช้ฐาน lthai_kiln_workflow_qa ใน PostgreSQL ของ lthai-docker พอร์ต 5434
- บัญชีฐาน QA lthai_kiln_qa เป็นเจ้าของเฉพาะ QA ไม่มีสิทธิ์ UPDATE employees บนหลัก
- สำรองก่อนเริ่ม: D:/LThai/data/backups/kiln-qa-25691119-162939-609/lthai.dump พร้อม SHA-256 ตรวจแล้ว
- สำรองหลักรอบกลับมาทำต่อ: D:/LThai/data/backups/kiln-qa-resume-25691120-081430-792/lthai.dump ตรวจ SHA-256 แล้ว เก็บข้อมูลQAเดิม ไม่ restore ทับ
- สำเนาเริ่มต้นมีพนักงาน 38 คน ใบสั่งผลิต 2 ใบ; ฐานหลักยังไม่มีตาราง kiln_prototype_state
- Runner PID ล่าสุดเก็บใน .qa/kiln-workflow/server.pid; log qa-running.log/qa-running-error.log
- คำสั่งเริ่มใหม่จาก worktree: node scripts/run-apps.mjs start (โหลด .env ของ QA)
- ข้อมูลล็อกอินทดลองอยู่ในสคริปต์ส่วนตัว .qa/kiln-workflow/seed.mjs ห้ามรัน seed ซ้ำหรือคัด credentials ลง Git
- ผู้ใช้ดูข้อมูลเข้าได้ที่ .qa/kiln-workflow/access.md ซึ่งอยู่นอก Git; runner เปิดรุ่น build ล่าสุดหลังแก้รีวิวแล้ว

## ขอบเขตที่ต้องเข้าใจ

- ผู้ใช้อนุญาตทำแบบจำลอง QA ตามคำตอบ Q1–Q22 และแนวทาง A แล้ว
- นี่เป็น prototype ที่เก็บการทดลองใน versioned JSON aggregate บน QA ไม่ใช่ migration พร้อมขึ้นหลัก
- อ่านอ้างอิงทะเบียน/ใบสั่ง/ของพร้อมจากสำเนาฐานได้ แต่ยอดทดลองไม่ตัดโมดูลสต็อกเดิม
- ค่าอุณหภูมิ/นโยบายเกรดของชุด demo เป็นข้อมูลสังเคราะห์ ไม่ใช่ค่าที่โรงงานยืนยัน
- รายละเอียดครบใน docs/superpowers/specs/2026-11-19-kiln-workflow-design.md และแผน .../plans/2026-11-19-kiln-workflow-qa.md

## หลักฐานตรวจแล้ว

- TypeScript check และ production build ผ่าน
- รอบใหม่ API 74 ผ่าน/5 ข้ามเดิม (Python extraction), regression column-order 8 ผ่าน, web 30 ผ่าน, legacy 14 ผ่าน: รวม126ผ่าน
- ชุด column-order ใช้ฐาน QA ชั่วคราวชื่อเฉพาะ ทดสอบแล้วลบฐานชั่วคราวนั้นแล้ว
- Model ใหม่10 และ store/APIใหม่4 อยู่ในยอดAPIข้างต้น รวมregressionประวัติอาการเสียลำดับที่สอง
- API walkthrough 49 คำสั่งรวมการปฏิเสธที่คาดหมาย; หลักฐาน .qa/kiln-workflow/e2e-api-results.json
- Browser: แผน 14 ตร.ม.=700 แผ่น, กันของ 700, สองเซสชันชนกันไม่เขียนทับ, QC 200/300 เหลือรอคัด100
- ทดสอบมือถือ 390px ไม่ล้นแนวนอน และเห็นประวัติก่อน/หลัง; คืน viewport เดิมแล้ว
- Trial revision ล่าสุด50: เข้าเผาใหม่1500 ผ่านเตารวม1506 รอQC100 รอซ่อม29 เสีย20 พร้อมส่ง656 รับสต็อก480
- ผู้ตรวจพบ4ประเด็น (ซ่อมนับซ้ำ/ฟอร์มเก่าทับ/เวลารอบทับ/ปิดไฟก่อนlog) แก้และผู้ตรวจยืนยันแล้ว
- ตรวจส่วนเพิ่มท้าย (cookie QA, แก้/ยกเลิกแผน, history diff, rate ขาด) เสร็จ ผู้ตรวจพบการเทียบประวัติอาการเสียใช้keyชนกัน แก้ใช้ชื่ออาการที่ไม่ซ้ำ พร้อมทดสอบผ่านเส้นทางstore/ฐานจริงทั้งแก้ยอดและเปลี่ยนชื่อ RED→GREEN ไม่มีประเด็นสำคัญอื่น
- เปิดรุ่นbuildล่าสุด ตรวจQA/main HTTP200และฐานหลักไม่มีตารางprototype สิทธิ์QAเขียนemployeesบนหลักไม่ได้ หลักฐาน .qa/kiln-workflow/resume-live-results.json และ resume-*.log
- ตรวจbrowserรุ่นbuildล่าสุด QCค้าง100 ประวัติก่อน–หลัง รายงาน และจอ390px/เดสก์ท็อป ไม่มีล้นแนวนอน ภาพอยู่ .qa/kiln-workflow/screenshots/

## ขั้นถัดไป

- ให้ผู้ใช้ลองตาม docs/kiln-qa-guide.md แล้วบันทึกข้อเสนอแนะ ยังไม่เปลี่ยนข้อมูลทดลองฉบับ50ในรอบส่งมอบนี้
- ตรวจ apps/web/AGENTS.md กับ node_modules/next/dist/server/lib/generate-agent-files.js แล้ว เป็นคำแนะนำที่Nextสร้างเอง เก็บไว้ตามเดิม ไม่มีการเพิ่มกฎเฉพาะโปรเจกต์
- ตรวจdiffและชุดทดสอบแล้ว โค้ดยังไม่commit/push/merge เพื่อรอข้อเสนอแนะQA
- เก็บ QA ไว้ให้ผู้ใช้ลอง ไม่ถอด QA ตอนพัก; เมื่อจะนำขึ้นจริงทำตาม AGENTS.md เรื่องสำรองใหม่/เลือกข้อมูล
