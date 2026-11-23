import type {CatalogProduct,CatalogProfile} from './tile-catalog.ts';
export type ClayType={id:number;code:string;name:string;description:string|null;active:boolean;base_clay_type_id:number|null};
export type ClayColor={id:number;code:string;name:string;notes:string|null;active:boolean};
export type ClayRegistryState={clay_types:ClayType[];clay_colors:ClayColor[]};
export function legacyClayKey(code:string):string{return ({WHITE:'ขาว',COLORED:'สี',RED:'แดง',LATERITE:'ศิลาแลง'} as Record<string,string>)[code]??'';}
export function availableClays(registry:ClayRegistryState,profiles:readonly CatalogProfile[],product:CatalogProduct){
 return registry.clay_types.map(clay=>({clay,ready:clay.active&&product.active&&product.body_id!==null&&profiles.some(p=>p.body_id===product.body_id&&p.clay_type_id===clay.id&&p.active&&(p.pieces_per_sqm??0)>0&&(clay.code!=='COLORED'||registry.clay_colors.some(c=>c.id===p.clay_color_id&&c.active))),reason:clay.code==='COLORED'&&!registry.clay_colors.some(c=>c.active)?'ยังไม่มีสีดินให้เลือก':'รอตั้งค่าผลิต'}));
}
export function affectedProducts(bodyId:number,products:readonly CatalogProduct[]){return products.filter(p=>p.body_id===bodyId);}
