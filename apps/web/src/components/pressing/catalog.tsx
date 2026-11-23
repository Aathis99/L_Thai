import { useState } from "react";
import { count, formText } from "../../lib/pressing";
import { sizeUnits, geometryLabel, productLabel,
  type CatalogGeometry, type CatalogProduct, type CatalogState } from "../../lib/tile-catalog";
import { Field } from "../fields";
import { Card, Choice, Facts, FormDialog, Section, type PressingActions } from "./shared";
import ProductionSettings from './production-settings';

type DialogProps = Pick<PressingActions, "api" | "onSaved"> & { onClose: () => void };

export default function Catalog({ data, actions }: {
  data: CatalogState; actions: Pick<PressingActions, "can" | "api" | "onSaved">;
}) {
  const [editor, setEditor] = useState<{ product?: CatalogProduct } | null>(null);
  const [search, setSearch] = useState("");
  const [production,setProduction]=useState<CatalogProduct|null>(null);
  const manage = actions.can("pressing.manage");
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: () => setEditor(null) };
  const query = search.trim().toLocaleLowerCase("th");
  const products = data.products.filter(product =>
    [productLabel(product), product.description_raw, product.notes, product.source_row].join(" ").toLocaleLowerCase("th").includes(query));
  return <>
    <Section title="ทะเบียนกระเบื้อง" action={manage &&
      <button className="button primary" onClick={() => setEditor({})}>เพิ่มรายการสินค้า</button>}>
      <Field label="ค้นรหัส ชื่อ ขนาด รายละเอียด หรือหมายเหตุ" name="catalog_search" type="search" value={search}
        onChange={event => setSearch(event.target.value)} />
      <p className="helper">แสดง {count(products.length)} จาก {count(data.products.length)} รายการ · รายการรหัสเดียวกันแยกตามรายละเอียดและเลขรายการ</p>
      {!products.length && <p>{query ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการสินค้า"}</p>}
      <div className="pressing-cards">{products.map(product => <Card key={product.id}
        title={`${product.product_code} · ${product.name} · #${product.id}`}
        meta={<span className={`badge ${product.active ? "good" : "neutral"}`}>{product.active ? "ใช้งาน" : "หยุดใช้"}</span>}
        actions={manage && <><button className="button warning" onClick={() => setEditor({ product })}>แก้ไขสินค้า</button><button className="button secondary" onClick={()=>setProduction(product)}>ตั้งค่าผลิต</button></>}>
        <p>{geometryLabel(product) || "ยังไม่ระบุขนาด"}</p>
        <Facts values={{ "รายละเอียดต้นฉบับ": product.description_raw || null,
          "หมายเหตุ": product.notes || null, "แถวต้นทาง": product.source_row ?? null,
          "การติดตาข่าย": product.mounting_type === "mesh" ? "ติดตาข่ายตามออเดอร์ลูกค้า" : "ไม่ระบุตาข่าย" }} />
      </Card>)}</div>
    </Section>
    {manage && editor && <ProductForm {...dialog} product={editor.product} />}
    {manage&&production&&<ProductionSettings product={production} data={data} actions={actions} onClose={()=>setProduction(null)}/>}
  </>;
}

function positiveNumber(form: FormData, name: string, label: string): number | null {
  const text = formText(form, name);
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`กรุณาระบุ${label}เป็นจำนวนมากกว่า 0`);
  return value;
}

function geometryValues(form: FormData) {
  return { shape: formText(form, "shape") || null, size_1: positiveNumber(form, "size_1", "ขนาดมิติแรก"),
    size_2: positiveNumber(form, "size_2", "ขนาดมิติที่สอง"), size_unit: formText(form, "size_unit"),
    thickness_mm: positiveNumber(form, "thickness_mm", "ความหนา") };
}

function GeometryFields({ item }: { item?: CatalogGeometry }) {
  return <>
    <Field label="รูปทรง (เมื่อทราบ)" name="shape" defaultValue={item?.shape ?? ""} />
    <Field label="ขนาดมิติแรก (เมื่อทราบ)" name="size_1" type="number" min={0.001} step="any" defaultValue={item?.size_1 ?? ""} />
    <Field label="ขนาดมิติที่สอง (เมื่อระบุ)" name="size_2" type="number" min={0.001} step="any" defaultValue={item?.size_2 ?? ""} />
    <Choice label="หน่วยขนาด" name="size_unit" defaultValue={item?.size_unit ?? "in"}
      options={Object.entries(sizeUnits).map(([value, label]) => ({ value, label }))} />
    <Field label="ความหนา (มม. เมื่อระบุ)" name="thickness_mm" type="number" min={0.001} step="any" defaultValue={item?.thickness_mm ?? ""} />
  </>;
}

export function ProductForm({ product, ...dialog }: DialogProps & { product?: CatalogProduct }) {
  return <FormDialog {...dialog} scope="catalog" title={product ? "แก้ไขรายการสินค้า" : "เพิ่มรายการสินค้า"}
    path={product ? `/products/${product.id}` : "/products"} method={product ? "PUT" : "POST"} submitLabel="บันทึกรายการสินค้า"
    build={form => ({ ...geometryValues(form), product_code: formText(form, "product_code"), name: formText(form, "name"),
      description_raw: formText(form, "description_raw"), notes: formText(form, "notes") || null,
      mounting_type: formText(form, "mounting_type") || null, active: formText(form, "active") === "true" })}>
    <div className="form-grid">
      <Field label="รหัสสินค้า" name="product_code" required defaultValue={product?.product_code ?? ""} />
      <Field label="ชื่อสินค้า / รายละเอียดลาย" name="name" required defaultValue={product?.name ?? ""} />
      <GeometryFields item={product} />
      <Choice label="การติดตาข่ายของรุ่นนี้" name="mounting_type" empty="ไม่ระบุตาข่าย" defaultValue={product?.mounting_type ?? ""}
        options={[{ value: "mesh", label: "ติดตาข่ายตามออเดอร์ลูกค้า" }]} />
      <Choice label="สถานะรายการ" name="active" defaultValue={product?.active === false ? "false" : "true"}
        options={[{ value: "true", label: "ใช้งาน" }, { value: "false", label: "หยุดใช้" }]} />
      <label className="field"><span>รายละเอียดต้นฉบับ</span>
        <textarea name="description_raw" rows={3} defaultValue={product?.description_raw ?? ""} />
      </label>
      <label className="field"><span>หมายเหตุ</span>
        <textarea name="notes" rows={3} defaultValue={product?.notes ?? ""} />
      </label>
    </div>
    <p className="helper">ข้อมูลที่ยังไม่ทราบให้เว้นว่าง รายการที่ใช้รหัสเดียวกันเก็บแยกตามรายละเอียดสินค้า</p>
  </FormDialog>;
}
