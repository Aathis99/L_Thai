import { fail, text } from './auth.js';

export interface EmployeeNameParts {
  prefix: string;
  first_name: string;
  last_name: string;
}

export function formatEmployeeName(parts: EmployeeNameParts): string {
  return [parts.prefix, parts.first_name, parts.last_name].filter(Boolean).join(' ');
}

export function normalizeEmployeeNameParts(
  body: { prefix?: unknown; first_name?: unknown; last_name?: unknown; name?: unknown },
  existing?: EmployeeNameParts,
): EmployeeNameParts {
  if (Object.hasOwn(body, 'name'))
    fail('employees.name is no longer supported; use prefix, first_name and last_name');
  const part = (value: unknown, label: string, required: boolean, max: number) =>
    text(typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value, label, required, max);
  return {
    prefix: part(body.prefix === undefined ? existing?.prefix : body.prefix, 'คำนำหน้า', false, 40),
    first_name: part(body.first_name, 'ชื่อพนักงาน (first_name)', true, 120),
    last_name: part(body.last_name === undefined ? existing?.last_name : body.last_name, 'นามสกุล', false, 120),
  };
}
