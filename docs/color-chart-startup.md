# เปิดใช้งานชาร์ตสีและนำเข้าทะเบียนตั้งต้น

ระบบใช้งานหลักเปิดด้วย `compose.docker.yaml` เว็บอยู่ที่ `http://127.0.0.1:3001` และ PostgreSQL ฐาน `lthai` อยู่ที่ `127.0.0.1:5434` ส่วน PostgreSQL แบบ native พอร์ต `5433` เป็นฐานเดิมแยกกัน `npm run db:backup` สำรองฐานเดิมชุดนั้น

## เตรียมและตรวจรายการจาก Excel

รันจากโฟลเดอร์หลักของโครงการใน PowerShell ที่มี Node.js 26 ขึ้นไปและ Python 3 ติดตั้งแล้ว ใช้ไฟล์ `ชาร์ตสี.xlsx` ที่หน้างานยืนยัน เปลี่ยน `$workbook` ให้ตรงกับไฟล์ของเครื่องนี้ เก็บ Excel, JSON, ภาพจริง, `.env` และไฟล์สำรองในพื้นที่ส่วนตัวภายนอก Git เช่น `data/staging/` สำหรับไฟล์เตรียมนำเข้า

```powershell
$workbook = 'C:\LThai-private\ชาร์ตสี.xlsx'
$prepared = '.\data\staging\color-chart.json'
npm ci
python -m venv .\data\color-chart-venv
$importPython = (Resolve-Path '.\data\color-chart-venv\Scripts\python.exe').Path
& $importPython -m pip install -r .\requirements-import.txt
& $importPython .\scripts\extract-color-chart.py $workbook $prepared
$env:LTHAI_COLOR_CHART_PYTHON = $importPython
npm run color-chart:seed --workspace=@lthai/api -- --preview $workbook $prepared
```

`requirements-import.txt` ระบุ `openpyxl==3.1.5` สำหรับอ่าน XLSX ตัวเตรียมข้อมูลอ่าน Excel แบบอ่านอย่างเดียว เขียน JSON แยก และบันทึก SHA-256 ของ Excel ทั้ง `--preview` และ `--apply` อ่าน Excel อีกครั้งและเทียบกับ JSON เพื่อตรวจจับการเปลี่ยนทั้งไฟล์ต้นทางและข้อมูลที่เตรียม คำสั่ง `--preview` แสดงรายการโดยไม่เชื่อมฐานข้อมูล ค่า `LTHAI_COLOR_CHART_PYTHON` เป็นพาธไปยัง `python.exe` ที่ติดตั้ง dependency ไว้ หากเว้นไว้ CLI จะใช้ `python` จาก `PATH`

ให้หน้างานตรวจชื่อเต็มไทยและอังกฤษกับ `Sheet1!A3:B92` ลำดับ 1–90 รวม **วาดลาย** ลำดับ 64 และยืนยันหมายเหตุ **เขียวศิลาดล** ลำดับ 79 กับ **ศิลาดล** ลำดับ 80 จาก `B96` และ **ขาวฟ้า** ลำดับ 83 จาก `B95` ภาพเริ่มต้นว่างทุกแถว หาก Excel หรือ JSON ที่ตรวจเปลี่ยน ให้เตรียมและยืนยันรายการใหม่ก่อนนำเข้า

## ซ้อมบนฐานทดสอบและเปิดใช้ใน Docker

ซ้อม `--apply` บน Docker PostgreSQL ที่แยกจากฐานใช้งาน โดยใช้ข้อมูลสังเคราะห์สำหรับการตรวจรับ ตั้ง `DATABASE_URL` ให้ชี้พอร์ตและชื่อฐานของชุดทดสอบโดยเฉพาะ รัน `npm run db:migrate` แล้วจึงใช้ `--apply` และตรวจรายการในแอปที่เชื่อมกับฐานเดียวกัน ผลตรวจจากฐานทดสอบใช้ยืนยันขั้นตอน ส่วนชุด Excel จริงให้ยืนยันจาก preview ก่อนเปิดใช้

สำหรับการเปิดใช้จริง ให้ผู้รับผิดชอบยืนยันชุด Excel และอนุมัติการนำเข้าฐาน `lthai` ก่อน ใช้ checkout ที่จะเปิดให้โรงงานใช้งาน ตรวจว่า `.env` ของเครื่องมี `POSTGRES_PASSWORD` สำหรับ Docker แล้วรันคำสั่งต่อไปนี้ `docker:up` สร้างและเปิดแอปจาก checkout ปัจจุบัน API ทำ migration อัตโนมัติก่อนรายงานว่าพร้อม ตรวจใน `ps` ว่าเว็บอยู่ที่พอร์ต `3001` และ `pg` เผยแพร่พอร์ต `5434` ก่อนทำขั้นต่อไป

```powershell
npm run docker:up
docker compose -f compose.docker.yaml ps
```

จาก PowerShell เดิม ใช้ `$workbook` และ `$prepared` คู่ที่ตรวจแล้ว พร้อม `LTHAI_COLOR_CHART_PYTHON` จากขั้นเตรียมไฟล์ `--apply` ต้องได้รับ `DATABASE_URL` จากตัวแปรของ PowerShell โดยตรง คำสั่งนี้อ่านรหัสผ่าน Docker จาก `.env` และกำหนดปลายทาง `127.0.0.1:5434/lthai` เฉพาะตอนรันนำเข้า เมื่อจบจะคืนค่า `DATABASE_URL` เดิมของ PowerShell

```powershell
$previousDatabaseUrl = $env:DATABASE_URL
try {
    $env:DATABASE_URL = node --input-type=module -e "import { readFileSync } from 'node:fs'; import { parse } from 'dotenv'; const { POSTGRES_PASSWORD } = parse(readFileSync('.env')); if (!POSTGRES_PASSWORD) throw new Error('Missing POSTGRES_PASSWORD in .env'); console.log('postgresql://lthai:' + encodeURIComponent(POSTGRES_PASSWORD) + '@127.0.0.1:5434/lthai');"
    if ($LASTEXITCODE -ne 0 -or -not $env:DATABASE_URL) {
        throw 'กำหนดการเชื่อมต่อ PostgreSQL ของ Docker ไม่สำเร็จ'
    }
    npm run color-chart:seed --workspace=@lthai/api -- --apply $workbook $prepared
    if ($LASTEXITCODE -ne 0) {
        throw 'นำเข้าชาร์ตสีไม่สำเร็จ ให้ตรวจข้อความจากคำสั่ง'
    }
} finally {
    $env:DATABASE_URL = $previousDatabaseUrl
}
```

ครั้งแรกที่สำเร็จจะแจ้ง `{"status":"imported","items":90}` การรันซ้ำด้วย Excel ชุดเดิมจะแจ้ง `skipped` และ **เคยนำเข้าแล้ว** โดยคงงานแก้ไขหลังนำเข้าไว้ หากพบชื่อหรือลำดับชนกับทะเบียน หรือฐานเคยรับ Excel คนละชุด ให้ตรวจข้อความที่แจ้งกับผู้รับผิดชอบ การนำเข้าบันทึกทั้งชุดในธุรกรรมเดียว

## ให้สิทธิ์และตรวจในเว็บ

หลัง migration บทบาทผู้ดูแลระบบเริ่มต้นมีสิทธิ์ทั้งสองรายการ ผู้ดูแลเปิดเมนู **บทบาท** และเพิ่มสิทธิ์ให้บทบาทตามหน้าที่

| หน้าที่ | สิทธิ์ |
| --- | --- |
| ค้นชื่อ เปิดภาพ และอ่านหมายเหตุ | **ดูชาร์ตสี** (`color_chart.read`) |
| เพิ่ม แก้ ลบรายการ และจัดการภาพ | **ดูชาร์ตสี** (`color_chart.read`) และ **จัดการชาร์ตสี** (`color_chart.manage`) |

1. เปิด **ชาร์ตสี** ตรวจว่ามี 90 รายการตามลำดับ ลองค้น `TERRA COTTA` แล้วเทียบชื่อดินแดงกับดินแดงเคลือบใส ตรวจหมายเหตุทั้งสามรายการในหน้ารายละเอียด
2. เปิดด้วยบัญชีผู้ดูและบัญชีผู้จัดการ ผู้ดูเปิดรายละเอียดและรูปที่มีได้ บัญชีผู้จัดการใช้ **เพิ่มรายการ** เพื่อบันทึกชื่อและหมายเหตุก่อนแนบภาพ จากรายการที่บันทึกแล้วใช้ **เพิ่มภาพ**, **เปลี่ยนภาพ** หรือ **ลบภาพ** การลบเฉพาะภาพจะแสดง **ยังไม่มีภาพ** และเก็บรายการเดิมไว้
3. ภาพต้นทางใช้ JPEG, PNG หรือ WebP ขนาดไม่เกิน 8 MiB ระบบเก็บภาพตัวอย่าง WebP ด้านยาวไม่เกิน 1,024 พิกเซลและขนาดไม่เกิน 256 KiB ภาพติดไปกับชุดสำรองฐาน Docker ดู [คู่มือส่งงานและกู้คืนฐาน Docker](cross-machine-guide.md)
