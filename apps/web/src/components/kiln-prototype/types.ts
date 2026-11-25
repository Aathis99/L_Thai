import type { Model, Item, Command, Qc } from '../../../../api/src/kiln-prototype/model';
import type {QcCandidate,QcReport,QcWorker} from '../../../../api/src/qc-documents/types';
export type { Model, Item, Command, Qc };
export const grades = ['A+', 'A-', 'B'] as const;
export const outcomeNames = { 'A+': 'A+', 'A-': 'A-', B: 'B', waste: 'เสีย', underfired: 'ไม่สุก', touchup: 'แต้ม' };
export type Source = Item & { sourceId: string; available: number; sourceReady: number; sourceUsed: number; code: string };
export interface Data {
  qcWorkers?:QcWorker[];qcCandidates?:QcCandidate[];qcReports?:Record<number,QcReport>;
  catalogVersion?:string;
  revision: number; state: Model; sources: Source[]; copiedItems: Item[];
  summary: { planned: number; reserved: number; throughput: number; freshFired: number; waitingQc: number; repairWaiting: number; waste: number; orderReady: number; stock: number };
  history: { id: number; revision: number; actor: string; recorded_at: string; command: Command; changes: { field: string; before: string; after: string }[] }[];
}
export const qty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
export const dateTime = (at?: string) => at ? new Date(at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—';
export const nowLocal = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16);
export const day = () => nowLocal().slice(0, 10);
export const fieldText = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
export const fieldNumber = (f: FormData, key: string) => Number(fieldText(f, key));
export const atField = (f: FormData, key = 'at') => fieldText(f, key) + ':00+07:00';
export function fireAtField(f: FormData): string {
  const date = fieldText(f, 'at_date'), hour = fieldText(f, 'at_hour'), minute = fieldText(f, 'at_minute');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error('กรุณาระบุวันที่ให้ถูกต้อง');
  if (!/^\d{1,2}$/.test(hour) || Number(hour) > 23 || !/^\d{1,2}$/.test(minute) || Number(minute) > 59)
    throw new Error('กรุณาระบุเวลา 24 ชั่วโมง: ชั่วโมง 00–23 และนาที 00–59');
  return `${date}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00+07:00`;
}
export const selectedGrades = (f: FormData, prefix: string) => grades.filter(g => f.has(prefix + g));
export const operationNames: Record<string, string> = {
  demo: 'เริ่มชุดตัวอย่างใหม่', import: 'เพิ่มงานจากสำเนา', plan: 'วางแผน', reserve: 'เตรียมลงเบอร์', move: 'แบ่ง/ย้ายเบอร์', cancel: 'ยกเลิกเตรียม',
  'rail-ready': 'ยืนยันเบอร์พร้อมเข้า', start: 'เข้าเผา/จุดไฟ', stop: 'ปิดไฟ', withdraw: 'นำเบอร์ออก', unload: 'เอาของลงเสร็จ', log: 'บันทึกไฟ', qc: 'คัดคุณภาพ',
  'repair-ready': 'ยืนยันซ่อมพร้อมเผา', allocate: 'จัดสรร/รับสต็อก', policy: 'กำหนดเกรด', settings: 'ตั้งค่าทดลอง', correct: 'แก้ไขข้อมูล',
  'plan-edit': 'แก้แผน', 'plan-cancel': 'ยกเลิกแผน',
};
