# ทำงานต่อที่บ้านและกลับมาที่ทำงาน

ใช้ Docker เป็นหลักทั้งสองเครื่อง เว็บเปิดที่ http://127.0.0.1:3001 ฐานข้อมูล Docker พอร์ต 5434 ชุด native พอร์ต 5433 เป็นข้อมูลเก่าแยกกัน คำสั่ง `db:backup` เดิมไม่ใช่คำสั่งส่งฐาน Docker

## ก่อนออกจากแต่ละเครื่อง

บอก Codex ว่า **“เตรียมส่งงานไปอีกเครื่อง อัปเดตบริบทแล้วทำตามคู่มือส่งงาน”** ให้ตรวจการเปลี่ยนแปลง อัปเดต `docs/CURRENT.md` แล้ว commit/push โค้ดและเอกสารบน branch ที่จะใช้ทั้งสองเครื่อง จากนั้น:

```powershell
npm run handoff:status
npm run handoff:send -- --context-ready
```

`--context-ready` หมายถึงได้อัปเดตและ commit สรุปงานแล้ว ตัวโปรแกรมตรวจความถูกต้องของไฟล์ได้ แต่สรุปบทสนทนาแทน AI ไม่ได้ คำสั่งส่งงานตรวจว่า Git สะอาดและ commit บน remote branch ตรงกับเครื่องนี้ก่อนส่ง

โฟลเดอร์ปลายทางปกติคือ `%OneDrive%\LThai-handoff\<รหัสชุดงาน>` เปลี่ยนได้ด้วย `--cloud "C:\path\to\OneDrive\LThai-handoff"` ใช้ชื่อโฟลเดอร์เดียวกันทั้งสองเครื่อง แม้ชื่อบัญชี Windows ต่างกัน

**รอจน OneDrive ยืนยันว่าอัปโหลดไฟล์ครบก่อนปิดเครื่อง** ข้อความส่งสำเร็จจาก CLI หมายถึงสร้างและตรวจชุดข้อมูลในโฟลเดอร์ OneDrive ของเครื่องนี้สำเร็จ ไม่ได้พิสูจน์ว่าส่งถึงคลาวด์แล้ว หลังส่งเว็บ/API จะหยุดไว้ ให้ไปทำต่ออีกเครื่อง ห้ามเปิดแก้ข้อมูลต่อทั้งสองเครื่องพร้อมกัน

จดรหัสชุดงานกับ Git commit จาก `manifest.json` และชื่อ branch สำหรับเปิดที่อีกเครื่อง เลือกชุดที่ส่งจริง ไม่เลือกจากเวลาแก้ไขไฟล์เพียงอย่างเดียว

## เตรียมเครื่องที่บ้านครั้งแรก

ต้องมี Git, Node.js 26 ขึ้นไป, Docker Desktop ที่รัน Linux containers ได้, OneDrive บัญชีเดียวกัน และ Codex ที่ลงชื่อเข้าใช้แล้ว เริ่ม Docker Desktop และดาวน์โหลดชุดส่งงานจาก OneDrive ให้ครบ (เลือกเก็บโฟลเดอร์ชุดงานไว้บนอุปกรณ์)

ตัวอย่างใช้ D:\LThai เป็นที่ทำงานปกติ แยกจาก OneDrive:

```powershell
git clone https://github.com/Aathis99/L_Thai.git D:\LThai
cd D:\LThai
git fetch origin
git switch <branch-ที่ใช้ส่งงาน>
npm ci
```

แทน `<branch-ที่ใช้ส่งงาน>` ด้วย branch จริง และตรวจ `git rev-parse HEAD` ให้ตรงกับ `commit` ใน `manifest.json` หาก branch เดินต่อไปแล้ว ให้ Codex ช่วยเลือก commit ที่ตรงก่อนรับงาน หลีกเลี่ยงการ reset งานเดิมทิ้ง

หากยังไม่มี `.env` ให้ใช้:

```powershell
npm run handoff:bootstrap -- --bundle "C:\Users\ชื่อคุณ\OneDrive\LThai-handoff\รหัสชุดงาน"
npm run handoff:receive -- --bundle "C:\Users\ชื่อคุณ\OneDrive\LThai-handoff\รหัสชุดงาน"
```

bootstrap ตรวจชุดงานก่อน คัดลอก `.env` ส่วนตัวจากชุดส่งงานเฉพาะเมื่อยังไม่มีไฟล์ แล้วเปิดเฉพาะ PostgreSQL เพื่อให้เป็นฐานว่างก่อนรับข้อมูล ไม่ต้องเปิดแอปหรือรัน migration ก่อน receive

หากมี `.env` อยู่แล้ว ให้เก็บไฟล์เดิม ตรวจว่า `POSTGRES_PASSWORD` ตรงกับ Docker ที่จะใช้ แล้วเปิดเฉพาะฐานด้วย `docker compose -f compose.docker.yaml up -d --wait pg` จากนั้น receive หากมีข้อมูลเดิมที่ไม่รู้ที่มา คำสั่งจะหยุด ให้ Codex ตรวจเทียบก่อนดำเนินการ ไม่ลบ volume เพื่อข้ามการตรวจ

## รับงานครั้งถัดไป ทั้งบ้านและที่ทำงาน

```powershell
cd D:\LThai
git pull --ff-only
npm ci
npm run handoff:receive -- --bundle "C:\Users\ชื่อคุณ\OneDrive\LThai-handoff\รหัสชุดงาน"
```

ต้องอยู่ branch เดียวกันกับที่ส่งมา หากสลับ branch ระหว่างทำงานให้ตรวจ branch/commit ก่อนรับทุกครั้ง โปรแกรมตรวจ Git commit, checksum และลำดับชุดงาน จากนั้นหยุดเว็บ/API ตรวจข้อมูลที่ยังไม่ได้ส่ง สำรองฐานเดิมและไฟล์ส่วนตัวไว้ที่ `data/handoff-backups/` แล้วจึงนำเข้าข้อมูลและเปิดระบบ

เปิดโปรเจกต์ใน Codex แล้วบอกว่า **“อ่าน AGENTS.md และ docs/CURRENT.md แล้วรับช่วงงานต่อ”** เอกสารช่วยให้เริ่มแชตใหม่ได้ โดยไม่จำเป็นต้องย้ายประวัติแชตทั้งหมด

## สิ่งที่อยู่ในชุดส่งงาน

- `database.dump`: ฐาน Docker ผ่าน PostgreSQL custom dump รวมข้อมูลและ sequence
- `docker.env`: สำเนา `.env` ส่วนตัวที่แอป Docker ใช้ ไม่ขึ้น Git ชุดส่งงานจึงมีรหัสผ่านและข้อมูลส่วนตัว เก็บใน OneDrive ส่วนตัวที่เลือกไว้
- `private/`: Excel ที่ root, ไฟล์ใน `data/staging/` และ SQLite ต้นทาง `data/factory.sqlite` หากมี ไม่รวม raw PostgreSQL, logs หรือไฟล์สำรองสะสม
- `manifest.json`: Git commit, รหัสชุดก่อนหน้า, จำนวนรายการ และ checksum ของไฟล์

ถ้าเพิ่มแหล่งไฟล์ใหม่ที่อยู่นอกรายการนี้ ต้องปรับตัวเลือกไฟล์ใน `scripts/handoff/workflow.mjs` ก่อนส่ง โฟลเดอร์ `data/handoff-staging/` และ `data/handoff-backups/` เป็นสำเนาส่วนตัวในเครื่อง เก็บไว้จนยืนยันรับงานและกู้คืนได้แล้ว

## เมื่อรับงานไม่สำเร็จ

หากพบ checksum ผิด/ไฟล์ขาด ให้รอ OneDrive ดาวน์โหลดครบแล้วลองใหม่ หาก Git ไม่ตรง ให้ตรวจ branch/commit หากมีงานที่ยังไม่ได้ส่ง ให้หยุดและเทียบข้อมูล ไม่กดข้ามหรือแก้ state เพื่อบังคับรับ

ระบบถอด dump ด้วย `pg_restore` ให้ครบก่อนเริ่มเปลี่ยนปลายทาง แล้วแทนที่ schema public และนำเข้าผ่าน `psql` ใน transaction เดียว รวมถึงเอาตารางที่ต้นทางลบแล้วออก หาก restore การตรวจข้อมูล หรือคัดลอกไฟล์ล้มเหลว จะพยายามกู้ฐานและไฟล์เดิมกลับและตรวจเทียบก่อนรายงานผล โดยยังหยุดเว็บ/API ไว้ หาก rollback ไม่สำเร็จ ให้ Codex ใช้ `before.dump`, `before.json` และ `private/` ในรอบสำรองล่าสุดกู้คืนก่อนเปิดระบบอีกครั้ง

หากรับข้อมูลสำเร็จแต่ build/เปิดแอปไม่ผ่าน ให้แก้ปัญหาการเปิดแอปแล้วสั่ง receive ชุดเดิมซ้ำ ระบบตรวจว่าข้อมูลยังไม่เปลี่ยนแล้วลองเปิดแอป โดยไม่ restore ซ้ำ การกด send ซ้ำขณะรอรับช่วงจะตรวจและใช้ชุดเดิม หากแก้ข้อมูลหลังส่งแล้วจะหยุดให้ตรวจสอบ

## Skills และการตรวจสอบ

การส่งฐานรองรับโครงสร้างปัจจุบันใน schema public และตรวจการแก้ตาราง ฟังก์ชัน trigger และการตั้งค่า sequence ด้วย ระบบจะหยุดหากพบ user schema อื่น large objects, materialized views หรือ foreign tables เพื่อให้ตรวจและเพิ่มวิธีรับส่งที่เหมาะสมก่อน ไม่ข้ามข้อมูลเหล่านั้นเงียบ ๆ

เก็บสำเนา skills ที่เกี่ยวข้องไว้ใน `.agents/skills/` ได้แก่ grill-with-docs, grilling, domain-modeling, karpathy-guidelines และ verification-before-completion ซึ่งส่งไปกับ Git ตาม [ตำแหน่ง skills ของ Codex](https://learn.chatgpt.com/docs/build-skills) ลงชื่อเข้าใช้ plugins หรือบริการเสริมแยกบนแต่ละเครื่อง; ไม่คัดลอกโฟลเดอร์บัญชี Codex ทั้งหมด

```powershell
npm run test:handoff
$env:LTHAI_HANDOFF_TEST='1'
node --test tests/handoff.integration.test.mjs
```

integration test สร้างฐาน `handoff_test_*` แยกด้วยข้อมูลสังเคราะห์ ทดสอบ dump/restore และ workflow แล้วลบเฉพาะฐานทดสอบ ไม่ restore ลงฐาน `lthai` การทดสอบในเครื่องเดียวไม่ยืนยันการส่ง OneDrive หรือสภาพเครื่องที่บ้าน ต้องทดลองรับจริงอีกครั้ง
