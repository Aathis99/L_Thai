const categoryTabs = [
  { id: "tiles", label: "ทะเบียนกระเบื้อง", permission: "pressing.read" },
  { id: "color-chart", label: "ชาร์ตสี", permission: "color_chart.read" },
  { id: "ranges", label: "ช่วงอุณหภูมิ", permission: "finishing.read" },
] as const;

export type CategoryTab = (typeof categoryTabs)[number]["id"];

export function visibleCategoryTabs(permissions: readonly string[]) {
  return categoryTabs.filter(tab => permissions.includes(tab.permission));
}
