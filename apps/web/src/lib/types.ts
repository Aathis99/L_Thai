export type View = "employees" | "positions" | "users" | "roles" | "audit";
export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
}
export interface Employee {
  id: number;
  code: string;
  name: string;
  department: string;
  position_id: number | null;
  position_name: string | null;
  phone: string;
  social_security_number?: string;
  taxpayer_id?: string;
  active: number;
  archived: number;
}
export interface Position {
  id: number;
  name: string;
}
export interface Account {
  id: number;
  username: string;
  name: string;
  role_id: number;
  role_name: string;
  employee_id: number | null;
  active: number;
}
export interface Role {
  id: number;
  name: string;
  permissions: string[];
}
export interface Audit {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  target: string;
}
export interface Records {
  employees: Employee[];
  positions: Position[];
  users: Account[];
  roles: Role[];
  audit: Audit[];
}
export type Api = <T>(
  path: string,
  method?: string,
  data?: unknown,
) => Promise<T>;
export type EditableRecord = Employee | Position | Account | Role;
export const labels: Record<View, string> = {
  employees: "พนักงาน",
  positions: "ตำแหน่งงาน",
  users: "บัญชีผู้ใช้",
  roles: "บทบาทและสิทธิ์",
  audit: "ประวัติการเปลี่ยนแปลง",
};
export const subtitles: Record<View, string> = {
  employees: "ข้อมูลคนทำงาน จุดเริ่มต้นของระบบโรงงาน",
  positions: "จัดระเบียบตำแหน่งของคนในโรงงาน",
  users: "กำหนดว่าใครเข้าสู่ระบบได้ และใช้สิทธิ์ใด",
  roles: "แยกสิทธิ์ในระบบออกจากตำแหน่งงาน",
  audit: "ตรวจสอบว่าใครเปลี่ยนข้อมูลอะไร เมื่อไร",
};
export const symbols: Record<View, string> = {
  employees: "♙",
  positions: "▤",
  users: "⊞",
  roles: "◇",
  audit: "◷",
};
export const views = Object.keys(labels) as View[];
export function allowed(user: SessionUser, view: View): boolean {
  return user.permissions.includes(
    view === "employees"
      ? "employees.read"
      : view === "audit"
        ? "audit.read"
        : `${view}.manage`,
  );
}
export function emptyRecords(): Records {
  return { employees: [], positions: [], users: [], roles: [], audit: [] };
}
