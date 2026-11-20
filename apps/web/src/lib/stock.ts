const stockTabs = [
  { id: "pressed", label: "ดินปั๊มและเบิก", permission: "pressing.read" },
  { id: "finished", label: "สินค้าสำเร็จ", permission: "finishing.read" },
] as const;

export type StockTab = (typeof stockTabs)[number]["id"];

export function visibleStockTabs(permissions: readonly string[]) {
  return stockTabs.filter(tab => permissions.includes(tab.permission));
}

type FinishedReceipt={type_id:number;product_id?:number|null;clay:string;color_id:number|null;color_name:string|null;grade?:string|null;pieces:number;voided_at?:string|null};
export function finishedStockTotals<T extends FinishedReceipt>(receipts:readonly T[]):T[]{
 const totals=new Map<string,T>();
 for(const receipt of receipts){
  if(receipt.voided_at)continue;
  const key=JSON.stringify([receipt.product_id??null,receipt.type_id,receipt.clay,receipt.color_id,receipt.color_name,receipt.grade??null]);
  const previous=totals.get(key);
  if(previous)previous.pieces+=receipt.pieces;else totals.set(key,{...receipt});
 }
 return [...totals.values()];
}
