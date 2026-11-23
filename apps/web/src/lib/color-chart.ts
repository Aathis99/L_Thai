export interface ColorChartItem {
  id: number;
  display_order: number;
  name: string;
  note: string | null;
  has_image: boolean;
  reference_temperature_c: number | null;
}

export function canSetColorReferenceTemperature(permissions: string[]) {
  return canOpenColorChart(permissions) && permissions.includes('finishing.temperature');
}
export function referenceTemperatureLabel(value: number | null) {
  return value == null ? 'ยังไม่ระบุ' : `${value} °C`;
}
export function referenceTemperaturePayload(text: string): {temperature_c:number|null} {
  if (!text.trim()) return {temperature_c:null};
  const value=Number(text);
  if (!Number.isFinite(value)||value<=0) throw new Error('อุณหภูมิอ้างอิงต้องมากกว่า 0 หรือเว้นว่าง');
  return {temperature_c:value};
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
