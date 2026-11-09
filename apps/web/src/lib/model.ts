export type EditableView = 'employees' | 'positions' | 'users' | 'roles';

export function editorPayload(view: EditableView, form: FormData, editing: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = Object.fromEntries(form);
  if (view === 'employees' || view === 'users') data.active = form.has('active');
  for (const key of ['position_id', 'role_id', 'employee_id']) {
    if (Object.hasOwn(data, key)) data[key] = data[key] ? Number(data[key]) : null;
  }
  if (view === 'roles') data.permissions = form.getAll('permissions');
  if (view === 'users' && editing && !data.password) delete data.password;
  return data;
}

export function matchesEmployeeFilter(employee: { active: number; archived: number }, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'archived') return Boolean(employee.archived);
  if (employee.archived) return false;
  if (filter === 'active') return Boolean(employee.active);
  if (filter === 'inactive') return !employee.active;
  return true;
}
