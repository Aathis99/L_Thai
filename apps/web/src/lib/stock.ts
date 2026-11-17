const stockTabs = [
  { id: "pressed", label: "ดินปั๊มและเบิก", permission: "pressing.read" },
  { id: "finished", label: "สินค้าสำเร็จ", permission: "finishing.read" },
] as const;

export type StockTab = (typeof stockTabs)[number]["id"];

export function visibleStockTabs(permissions: readonly string[]) {
  return stockTabs.filter(tab => permissions.includes(tab.permission));
}
