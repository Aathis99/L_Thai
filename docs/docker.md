# ทดสอบทั้งระบบใน Docker

หลังการทดสอบ ผู้ใช้เลือก Docker เป็นระบบหลักทั้งที่ทำงานและที่บ้าน และยืนยันใช้ข้อมูล Docker เป็นจุดเริ่มต้นแล้ว การส่งต่อข้อมูลทำผ่าน [คู่มือ Git + OneDrive + Docker](cross-machine-guide.md); ไม่มีการซิงก์อัตโนมัติกับ native

ทดสอบสำเร็จ 10/11/2569: เว็บ/API/PostgreSQL ทั้งสาม container healthy, หน้าเว็บตอบ 200, /api/health ยืนยัน PostgreSQL และ API/import integration tests ภายใน Linux container ผ่าน 13/13 ส่วนชุดทดสอบเดิมบน Windows ผ่าน 30 tests และ TypeScript ผ่าน สำเนาข้อมูล ณ เริ่มทดสอบตรงกับ native ทั้งพนักงาน 36 คน บัญชี 2 บทบาท 3 ตำแหน่ง 1 และประวัติ 5 รายการ ตรวจว่า .env/data/.tools ไม่ถูก copy เข้า images แล้ว

```powershell
cd D:\LThai
npm run docker:up
```

ใช้ `.env` เดิมสำหรับรหัสฐานข้อมูล แต่ Docker ใช้ฐานข้อมูลใน named volume แยกจาก native Windows:

| บริการ | จุดเชื่อมต่อ |
|---|---|
| Next.js | http://127.0.0.1:3001 |
| Express | ภายใน Docker ที่ api:4000 ผ่าน /api ของหน้าเว็บ |
| PostgreSQL / DBeaver | 127.0.0.1:5434, database/user lthai, รหัสตามไฟล์ส่วนตัวเดิม |

Docker ชุดนี้เริ่มจากสำเนาทดสอบและปัจจุบันเป็นฐานหลัก ข้อมูลที่แก้ใน Docker ไม่ sync กลับชุด Windows พอร์ต 3000/5433 และกลับกัน ห้ามเข้าใจว่าเป็นฐานข้อมูลเดียวกัน ไม่ได้แก้ `.env` ให้แอป Windows ย้ายปลายทางโดยอัตโนมัติ

`npm run docker:down` หยุด containers แต่เก็บข้อมูลใน volume ไว้ ไม่ใช้ `down -v` หากต้องการเก็บข้อมูล

ครั้งแรกต้องมีอินเทอร์เน็ตเพื่อดาวน์โหลด images/dependencies และ build หลังจากมี images ครบแล้วสามารถเปิดชุดเดิมด้วย `docker compose -f compose.docker.yaml up -d --wait` โดยไม่ต้อง build ใหม่

การตรวจ: `docker compose -f compose.docker.yaml ps` ต้อง healthy ทุก service และ `/api/health` ผ่านหน้าเว็บต้องคืน database=postgresql

ไฟล์ `.dockerignore` กัน `.env`, ฐานข้อมูล, Excel, screenshots และ binaries บน Windows ออกจาก build context รหัสผ่านส่งเป็น environment ตอนรัน ไม่ฝังลง image
