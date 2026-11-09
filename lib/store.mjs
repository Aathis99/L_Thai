import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const PERMISSIONS = {
  'employees.read': 'ดูข้อมูลพนักงาน', 'employees.create': 'เพิ่มพนักงาน',
  'employees.update': 'แก้ไขพนักงาน', 'employees.delete': 'ลบพนักงาน',
  'positions.manage': 'จัดการตำแหน่งงาน', 'users.manage': 'จัดการบัญชีผู้ใช้',
  'roles.manage': 'จัดการบทบาทและสิทธิ์', 'audit.read': 'ดูประวัติการเปลี่ยนแปลง'
};
export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function text(value, label, required = true, max = 120) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new InputError(`กรุณาระบุ${label}ให้ถูกต้อง (ไม่เกิน ${max} ตัวอักษร)`);
  return value.trim();
}
export function username(value) {
  const name = text(value, 'ชื่อผู้ใช้', true, 50).toLowerCase();
  if (!/^[a-z0-9._-]{3,50}$/.test(name)) throw new InputError('ชื่อผู้ใช้ต้องเป็น a-z, 0-9, จุด, ขีด หรือขีดล่าง อย่างน้อย 3 ตัว');
  return name;
}
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new InputError('รหัสผ่านต้องมี 12–128 ตัวอักษร');
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, hash] = encoded.split(':');
  const candidate = await derive(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}
export function openStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, permissions TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS positions(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS employees(id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', position_id INTEGER REFERENCES positions(id),
      phone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, password_hash TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id),
      employee_id INTEGER UNIQUE REFERENCES employees(id), active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    PRAGMA user_version=1;`);
  if (!db.prepare('SELECT id FROM roles LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO roles(id,name,permissions) VALUES(?,?,?)');
    insert.run(1, 'ผู้ดูแลระบบ', JSON.stringify(Object.keys(PERMISSIONS)));
    insert.run(2, 'ผู้บันทึกข้อมูล', JSON.stringify(['employees.read', 'employees.create', 'employees.update']));
    insert.run(3, 'ดูข้อมูล', JSON.stringify(['employees.read']));
  }
  return db;
}
