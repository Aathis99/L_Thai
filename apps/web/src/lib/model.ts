import { customEmployeePrefix, normalizeEmployeeNamePart } from "./employee-names.ts";

export type EditableView = "employees" | "positions" | "users" | "roles";

export function editorPayload(
  view: EditableView,
  form: FormData,
  editing: boolean,
): Record<string, unknown> {
  const data: Record<string, unknown> = Object.fromEntries(form);
  if (view === "employees") {
    const selection = String(form.get("prefix_selection") ?? "");
    data.prefix = normalizeEmployeeNamePart(selection === customEmployeePrefix
      ? String(form.get("prefix_custom") ?? "") : selection);
    if (selection === customEmployeePrefix && !data.prefix)
      throw new Error("กรุณาระบุคำนำหน้าอื่น ๆ");
    data.first_name = normalizeEmployeeNamePart(String(form.get("first_name") ?? ""));
    data.last_name = normalizeEmployeeNamePart(String(form.get("last_name") ?? ""));
    delete data.prefix_selection;
    delete data.prefix_custom;
    delete data.name;
    if (!data.first_name) throw new Error("กรุณาระบุชื่อพนักงาน");
    for (const [field, label, limit] of [["prefix", "คำนำหน้า", 40], ["first_name", "ชื่อ", 120], ["last_name", "นามสกุล", 120]] as const) {
      if (String(data[field]).length > limit) throw new Error(`${label}ต้องไม่เกิน ${limit} ตัวอักษร`);
    }
  }
  if (view === "employees" || view === "users")
    data.active = form.has("active");
  for (const key of ["position_id", "role_id", "employee_id"]) {
    if (Object.hasOwn(data, key))
      data[key] = data[key] ? Number(data[key]) : null;
  }
  if (view === "roles") data.permissions = form.getAll("permissions");
  if (view === "users" && editing && !data.password) delete data.password;
  return data;
}

export function matchesEmployeeFilter(
  employee: { active: number; archived: number },
  filter: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "archived") return Boolean(employee.archived);
  if (employee.archived) return false;
  if (filter === "active") return Boolean(employee.active);
  if (filter === "inactive") return !employee.active;
  return true;
}
