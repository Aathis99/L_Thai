export interface ColorChartItem {
  id: number;
  display_order: number;
  name: string;
  note: string | null;
  has_image: boolean;
}

export function canOpenColorChart(permissions: string[]) {
  return permissions.includes("color_chart.read");
}

export function canManageColorChart(permissions: string[]) {
  return canOpenColorChart(permissions) && permissions.includes("color_chart.manage");
}

function searchKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function filterColorChart(items: ColorChartItem[], query: string) {
  const search = searchKey(query);
  return items.filter((item) => searchKey(item.name).includes(search));
}
