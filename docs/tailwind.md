# CSS stack: Tailwind CSS v4 + PostCSS

ย้ายหน้าบ้าน Next.js มาใช้ Tailwind ตามคำขอ โดยคงสีเขียว ภาษาไทย หน้าจอ และพฤติกรรมเดิม ไม่มีการเปลี่ยนฐานข้อมูลหรือ API

## สิ่งที่ใช้

- `tailwindcss`, `@tailwindcss/postcss`, `postcss` ติดตั้งเป็น devDependencies ของ apps/web
- `apps/web/postcss.config.mjs` เชื่อม Tailwind เข้ากับ Next.js
- `apps/web/src/app/globals.css`: import Tailwind, theme tokens และ component layers สำหรับรูปแบบที่ใช้ซ้ำ
- React components ใช้ utilities และชื่อ component classes ที่มี @apply สำหรับรูปแบบร่วม
- CSS เฉพาะทางยังใช้ได้สำหรับรูปกระเบื้อง backdrop และรายละเอียดที่อ่านง่ายกว่าเขียนเป็น utility ยาว ๆ

Tailwind compile เป็น CSS ตอน build ไม่มี CDN หรือ network dependency ขณะใช้งานในโรงงาน และทำงานใน Docker ผ่านขั้นตอน build เดิม

## แนวทางเพิ่มหน้าจอ

ใช้สีและฟอนต์จาก theme tokens, ใช้ Field/SelectField/StatusField เดิมให้ฟอร์มเหมือนกันทั้งระบบ เขียนชื่อ utility ให้ครบคำใน source เพื่อให้ Tailwind ตรวจพบ หลีกเลี่ยงประกอบชื่อ class จากตัวแปร เช่น bg-${color}-500 ให้เลือกจาก map ของ class เต็มแทน

## สิ่งที่ยังไม่ต้องเพิ่ม

- shadcn/ui หรือ component library อื่น: ค่อยเลือกเมื่อต้องการ widget ที่ยังไม่มี เช่น date picker หรือ combobox
- clsx / tailwind-merge: เพิ่มเมื่อการประกอบและทับ utility ใน shared components ซับซ้อนจริง
- Sass, Less หรือ Autoprefixer เพิ่ม: ไม่จำเป็นกับการตั้งค่า Tailwind v4 นี้
- ส่วนเสริม editor Tailwind CSS IntelliSense เป็นตัวเลือกช่วย autocomplete ไม่จำเป็นต่อการรันแอป

ใช้เบราว์เซอร์รุ่นปัจจุบันในโรงงาน Tailwind v4 ระบุฐานรองรับ Chrome111+, Safari16.4+, Firefox128+ หากมีเครื่องเก่ากว่านี้ให้ตรวจรุ่นก่อนเปิดใช้งานจริง

## คำสั่ง

`npm run dev`, `npm run build`, `npm start` เหมือนเดิม ส่วน Docker ใช้ `npm run docker:up` เพื่อ rebuild CSS ลง image โดยเก็บ database volume เดิม

อ้างอิง: https://tailwindcss.com/docs/installation/framework-guides/nextjs และ https://tailwindcss.com/docs/compatibility

## ผลตรวจ 10/11/2569

TypeScript, 30 tests และ Next.js production build ผ่านทั้ง Windows และ Docker Linux ตรวจ compiled CSS พบ theme, utility classes และ responsive rules โดยไม่มี @apply ที่ยังไม่ compile อีก reviewer เทียบ CSS เดิมกับ source/compiled output ไม่พบกฎสำคัญตกหล่น หน้าเว็บและ CSS ผ่าน HTTP 200 และ API PostgreSQL healthy การตรวจภาพผ่าน browser automation ยังทำไม่ได้เพราะเครื่องมือ timeout สองครั้ง จึงยังไม่ยืนยัน visual parity จากภาพจริง
