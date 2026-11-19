export interface EmployeeNameParts {
  prefix: string;
  first_name: string;
  last_name: string;
}

export const standardEmployeePrefixes = ["นาย", "นาง", "นางสาว"];
export const customEmployeePrefix = "__custom__";

export function normalizeEmployeeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function formatEmployeeName(employee: EmployeeNameParts): string {
  return [employee.prefix, employee.first_name, employee.last_name]
    .map(normalizeEmployeeNamePart).filter(Boolean).join(" ");
}

export function matchesEmployeeSearch(employee: EmployeeNameParts, query: string): boolean {
  const search = normalizeEmployeeNamePart(query).toLocaleLowerCase("th");
  return [formatEmployeeName(employee), ...Object.values(employee)]
    .some(value => String(value ?? "").toLocaleLowerCase("th").includes(search));
}

export function employeePrefixSelection(prefix: string): string {
  return !prefix || standardEmployeePrefixes.includes(prefix) ? prefix : customEmployeePrefix;
}
