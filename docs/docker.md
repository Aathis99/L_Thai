# ทดสอบทั้งระบบใน Docker

ระบบโรงงานใช้ฐาน `lthai` ในชุด `lthai-docker` เป็นฐานหลัก

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

<a id="docker-backup"></a>

## สำรองและซ้อมกู้ฐาน Docker

เปิด PowerShell ที่โฟลเดอร์โปรเจกต์ขณะ PostgreSQL ใน Docker ทำงาน คำสั่งนี้อ่านฐาน `lthai` ระหว่างที่เว็บเปิดใช้งานได้ แล้วบันทึก PostgreSQL custom dump และค่า SHA-256 ไว้ใน `data/backups/`

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backupDir = "data/backups/docker-$stamp"
$containerDump = "/tmp/lthai-$stamp.dump"
$dump = "$backupDir/lthai.dump"
New-Item -ItemType Directory -Path $backupDir -ErrorAction Stop | Out-Null

try {
    docker compose -f compose.docker.yaml exec -T pg pg_dump -U lthai -d lthai -Fc --no-owner -f $containerDump
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL backup failed' }
    docker compose -f compose.docker.yaml cp "pg:${containerDump}" $dump
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the Docker backup' }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $dump -ErrorAction Stop).Hash
    "$hash  lthai.dump" | Set-Content -LiteralPath "$backupDir/SHA256SUMS.txt" -ErrorAction Stop
} finally {
    docker compose -f compose.docker.yaml exec -T pg rm -f -- $containerDump
}
```

เมื่อต้องการซ้อมกู้ ให้ใช้ `$backupDir` จากขั้นตอนสำรองหรือกำหนดให้เป็นโฟลเดอร์ชุดสำรองที่เลือก คำสั่งตรวจ SHA-256 ก่อนกู้ลงฐานทดสอบชื่อใหม่

```powershell
$dump = "$backupDir/lthai.dump"
$checksums = Get-Content -LiteralPath "$backupDir/SHA256SUMS.txt" -Raw -ErrorAction Stop
$entry = [regex]::Match($checksums.Trim(), '(?im)^([a-f0-9]{64})(?:[ \t]+\*?lthai\.dump)?[ \t]*\r?$')
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $dump -ErrorAction Stop).Hash
if (-not $entry.Success -or $actualHash -ne $entry.Groups[1].Value) {
    throw 'Backup checksum does not match'
}

$tag = [guid]::NewGuid().ToString('N')
$restoreDb = "lthai_restore_$tag"
$restoreDump = "/tmp/$restoreDb.dump"
try {
    docker compose -f compose.docker.yaml cp $dump "pg:${restoreDump}"
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the dump into Docker' }
    docker compose -f compose.docker.yaml exec -T pg createdb -U lthai $restoreDb
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the restore database' }
    docker compose -f compose.docker.yaml exec -T pg pg_restore -U lthai -d $restoreDb --no-owner --single-transaction $restoreDump
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL restore failed' }
    Write-Output $restoreDb
    docker compose -f compose.docker.yaml exec -T pg psql -U lthai -d $restoreDb -c '\dt public.*'
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify the restore database' }
} finally {
    docker compose -f compose.docker.yaml exec -T pg rm -f -- $restoreDump
}
```

ตรวจตารางและข้อมูลที่ต้องการในฐาน `$restoreDb` แล้วลบเฉพาะฐานซ้อมกู้ด้วย `docker compose -f compose.docker.yaml exec -T pg dropdb -U lthai $restoreDb` เก็บไฟล์สำรองและ checksum ไว้นอก Git

ครั้งแรกต้องมีอินเทอร์เน็ตเพื่อดาวน์โหลด images/dependencies และ build หลังจากมี images ครบแล้วสามารถเปิดชุดเดิมด้วย `docker compose -f compose.docker.yaml up -d --wait` โดยไม่ต้อง build ใหม่

การตรวจ: `docker compose -f compose.docker.yaml ps` ต้อง healthy ทุก service และ `/api/health` ผ่านหน้าเว็บต้องคืน database=postgresql

ไฟล์ `.dockerignore` กัน `.env`, ฐานข้อมูล, Excel, screenshots และ binaries บน Windows ออกจาก build context รหัสผ่านส่งเป็น environment ตอนรัน ไม่ฝังลง image
