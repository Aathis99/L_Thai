import { useState } from "react";
import { count, destinations, formInteger, formText, tileName } from "../../lib/pressing";
import { clays, sizeUnits, geometryLabel, productLabel, productProfiles, profileLabel,
  type CatalogBody, type CatalogGeometry, type CatalogProduct, type CatalogProfile, type CatalogState } from "../../lib/tile-catalog";
import { Field } from "../fields";
import { Card, Check, Choice, Facts, FormDialog, Section, type PressingActions } from "./shared";

type Editor = { kind: "product"; product?: CatalogProduct } | { kind: "body"; body?: CatalogBody } |
  { kind: "link"; product: CatalogProduct } | { kind: "profile"; profile?: CatalogProfile; bodyId?: number };
type DialogProps = Pick<PressingActions, "api" | "onSaved"> & { onClose: () => void };

export default function Catalog({ data, actions }: {
  data: CatalogState; actions: Pick<PressingActions, "can" | "api" | "onSaved">;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [search, setSearch] = useState("");
  const manage = actions.can("pressing.manage");
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: () => setEditor(null) };
  const query = search.trim().toLocaleLowerCase("th");
  const products = data.products.filter(product => productLabel(product).toLocaleLowerCase("th").includes(query));
  const legacy = data.profiles.filter(profile => profile.body_id === null);
  return <>
    <Section title="ทะเบียนกระเบื้อง" action={manage && <div className="pressing-actions">
      <button className="button primary" onClick={() => setEditor({ kind: "product" })}>เพิ่มรายการสินค้า</button>
      <button className="button primary" onClick={() => setEditor({ kind: "body" })}>สร้างแบบดินปั๊ม</button>
    </div>}>
      <Field label="ค้นรหัส ชื่อ ขนาด หรือรุ่นติดตาข่าย" name="catalog_search" type="search" value={search}
        onChange={event => setSearch(event.target.value)} />
      <p className="helper">แสดง {count(products.length)} จาก {count(data.products.length)} รายการ · รายการรหัสเดียวกันแยกตามรายละเอียดและเลขรายการ</p>
      {!products.length && <p>{query ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการสินค้า"}</p>}
      <div className="pressing-cards">{products.map(product => {
        const body = data.bodies.find(item => item.id === product.body_id);
        const profiles = productProfiles(product, data.profiles);
        return <Card key={product.id} title={`${product.product_code} · ${product.name} · #${product.id}`}
          meta={<span className={`badge ${profiles.length ? "good" : "neutral"}`}>
            {!product.active ? "หยุดใช้" : profiles.length ? "พร้อมเปิดผลิต" : "รอตั้งค่าผลิต"}</span>}
          actions={manage && <>
            <button className="button warning" onClick={() => setEditor({ kind: "product", product })}>แก้ไขสินค้า</button>
            <button className="button warning" onClick={() => setEditor({ kind: "link", product })}>ตรวจยืนยันแบบดินปั๊ม</button>
            {body && <button className="button primary" onClick={() => setEditor({ kind: "profile", bodyId: body.id })}>เพิ่มค่าผลิตรายดิน</button>}
          </>}>
          <p>{geometryLabel(product)}</p>
          <Facts values={{ "การติดตาข่าย": product.mounting_type === "mesh" ? "ติดตาข่ายตามออเดอร์ลูกค้า" : "ไม่ระบุตาข่าย",
            "แบบดินปั๊มที่ยืนยัน": body ? `${body.name} · #${body.id}` : "ยังไม่ยืนยัน",
            "ดินที่พร้อมผลิต": profiles.length ? profiles.map(profileLabel).join(" / ") : "ยังไม่มีข้อมูลผลิตครบ" }} />
        </Card>;
      })}</div>
    </Section>
    <Section title="แบบดินปั๊มและค่าผลิตรายดิน" action={manage &&
      <button className="button primary" onClick={() => setEditor({ kind: "body" })}>สร้างแบบดินปั๊ม</button>}>
      <p className="helper">จับคู่สินค้าเมื่อหน้างานยืนยันว่าเป็นแผ่นพื้นเดียวกัน ขนาดเท่ากันอย่างเดียวใช้ยืนยันไม่ได้</p>
      {!data.bodies.length && <p>ยังไม่มีแบบดินปั๊มที่ยืนยัน</p>}
      <div className="pressing-cards">{data.bodies.map(body => <Card key={body.id} title={`${body.name} · #${body.id}`}
        actions={manage && <>
          <button className="button warning" onClick={() => setEditor({ kind: "body", body })}>แก้ไขแบบดินปั๊ม</button>
          <button className="button primary" onClick={() => setEditor({ kind: "profile", bodyId: body.id })}>เพิ่มค่าผลิตรายดิน</button>
        </>}>
        <p>{geometryLabel(body)}</p>
        {data.profiles.filter(profile => profile.body_id === body.id).map(profile => <div key={profile.id}>
          <h4>{profileLabel(profile)}{!profile.active && " · หยุดใช้"}</h4>
          <ProfileFacts profile={profile} />
          {manage && <div className="pressing-actions"><button className="button warning"
            onClick={() => setEditor({ kind: "profile", profile, bodyId: body.id })}>แก้ไขค่าผลิต</button></div>}
        </div>)}
      </Card>)}</div>
    </Section>
    <Section title="ประเภทผลิตเดิมที่ยังไม่จับคู่">
      <p className="helper">รักษาเลขประเภทและประวัติเดิม ตรวจชิ้นงานจริงก่อนเชื่อมกับแบบดินปั๊ม</p>
      {!legacy.length && <p>ไม่มีประเภทผลิตเดิมที่รอจับคู่</p>}
      <div className="pressing-cards">{legacy.map(profile => <Card key={profile.id}
        title={`${tileName(data.profiles, profile.id)} · #${profile.id}`} actions={manage &&
          <button className="button warning" disabled={!data.bodies.length}
            onClick={() => setEditor({ kind: "profile", profile })}>ตรวจยืนยันและเชื่อมแบบดินปั๊ม</button>}>
        <ProfileFacts profile={profile} />
      </Card>)}</div>
    </Section>
    {manage && editor?.kind === "product" && <ProductForm {...dialog} product={editor.product} />}
    {manage && editor?.kind === "body" && <BodyForm {...dialog} body={editor.body} />}
    {manage && editor?.kind === "link" && <FormDialog {...dialog} scope="catalog" title="ตรวจยืนยันแบบดินปั๊ม"
      path={`/products/${editor.product.id}`} method="PUT" submitLabel="ยืนยันเชื่อมแบบดินปั๊ม"
      submitDisabled={!data.bodies.length} build={form => ({ ...editor.product,
        body_id: formInteger(form, "body_id", "แบบดินปั๊ม") })}>
      <p>{productLabel(editor.product)}</p>
      {!data.bodies.length && <p>สร้างแบบดินปั๊มในทะเบียนก่อน แล้วกลับมาเลือกจับคู่</p>}
      <Choice name="body_id" label="แบบดินปั๊มที่หน้างานยืนยัน" defaultValue={editor.product.body_id ?? ""}
        options={data.bodies.map(body => ({ value: body.id, label: `${body.name} · ${geometryLabel(body)} · #${body.id}` }))} />
      <Check name="verified" label="ตรวจยืนยันรูปทรง ขนาด ความหนา และรายละเอียดขึ้นรูปแล้วว่าใช้แบบดินปั๊มนี้" required />
    </FormDialog>}
    {manage && editor?.kind === "profile" && <ProfileForm {...dialog} bodies={data.bodies} profile={editor.profile} bodyId={editor.bodyId} />}
  </>;
}

function ProfileFacts({ profile }: { profile: CatalogProfile }) {
  return <Facts values={{ "แผ่นต่อไม้": count(profile.pieces_per_rack), "จำนวนวันพัก": count(profile.rest_days),
    "ปลายทางเบิก": destinations[profile.destination], "แผ่นต่อ ตร.ม.": profile.pieces_per_sqm === null ? "ยังไม่ยืนยัน" : count(profile.pieces_per_sqm) }} />;
}

function positiveNumber(form: FormData, name: string, label: string, optional = false): number | null {
  const text = formText(form, name);
  if (!text && optional) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`กรุณาระบุ${label}เป็นจำนวนมากกว่า 0`);
  return value;
}

function geometryValues(form: FormData) {
  return { shape: formText(form, "shape") || null, size_1: positiveNumber(form, "size_1", "ขนาดมิติแรก"),
    size_2: positiveNumber(form, "size_2", "ขนาดมิติที่สอง", true), size_unit: formText(form, "size_unit"),
    thickness_mm: positiveNumber(form, "thickness_mm", "ความหนา", true) };
}

function GeometryFields({ item }: { item?: CatalogGeometry }) {
  return <>
    <Field label="รูปทรง (เมื่อทราบ)" name="shape" defaultValue={item?.shape ?? ""} />
    <Field label="ขนาดมิติแรก" name="size_1" type="number" min={0.001} step="any" required defaultValue={item?.size_1 ?? ""} />
    <Field label="ขนาดมิติที่สอง (เมื่อระบุ)" name="size_2" type="number" min={0.001} step="any" defaultValue={item?.size_2 ?? ""} />
    <Choice label="หน่วยขนาด" name="size_unit" defaultValue={item?.size_unit ?? ""}
      options={Object.entries(sizeUnits).map(([value, label]) => ({ value, label }))} />
    <Field label="ความหนา (มม. เมื่อระบุ)" name="thickness_mm" type="number" min={0.001} step="any" defaultValue={item?.thickness_mm ?? ""} />
  </>;
}

function ProductForm({ product, ...dialog }: DialogProps & { product?: CatalogProduct }) {
  return <FormDialog {...dialog} scope="catalog" title={product ? "แก้ไขรายการสินค้า" : "เพิ่มรายการสินค้า"}
    path={product ? `/products/${product.id}` : "/products"} method={product ? "PUT" : "POST"} submitLabel="บันทึกรายการสินค้า"
    build={form => ({ ...geometryValues(form), product_code: formText(form, "product_code"), name: formText(form, "name"),
      mounting_type: formText(form, "mounting_type") || null, body_id: product?.body_id ?? null, active: formText(form, "active") === "true" })}>
    <div className="form-grid">
      <Field label="รหัสสินค้า" name="product_code" required defaultValue={product?.product_code ?? ""} />
      <Field label="ชื่อสินค้า / รายละเอียดลาย" name="name" required defaultValue={product?.name ?? ""} />
      <GeometryFields item={product} />
      <Choice label="การติดตาข่ายของรุ่นนี้" name="mounting_type" empty="ไม่ระบุตาข่าย" defaultValue={product?.mounting_type ?? ""}
        options={[{ value: "mesh", label: "ติดตาข่ายตามออเดอร์ลูกค้า" }]} />
      <Choice label="สถานะรายการ" name="active" defaultValue={product?.active === false ? "false" : "true"}
        options={[{ value: "true", label: "ใช้งาน" }, { value: "false", label: "หยุดใช้" }]} />
    </div>
    <p className="helper">ช่องที่ไม่ระบุให้เว้นว่าง หลังบันทึกให้ตรวจยืนยันแบบดินปั๊มและตั้งค่าผลิตรายดินก่อนเปิดใบสั่ง</p>
  </FormDialog>;
}

function BodyForm({ body, ...dialog }: DialogProps & { body?: CatalogBody }) {
  return <FormDialog {...dialog} scope="catalog" title={body ? "แก้ไขแบบดินปั๊ม" : "สร้างแบบดินปั๊ม"}
    path={body ? `/bodies/${body.id}` : "/bodies"} method={body ? "PUT" : "POST"} submitLabel="บันทึกแบบดินปั๊ม"
    build={form => ({ ...geometryValues(form), name: formText(form, "name") })}>
    <div className="form-grid"><Field label="ชื่อแบบดินปั๊ม" name="name" required defaultValue={body?.name ?? ""} />
      <GeometryFields item={body} /></div>
    <p className="helper">หลังสร้างแล้ว เลือกสินค้าที่ใช้แบบนี้และตรวจยืนยันการจับคู่ทีละรายการ</p>
  </FormDialog>;
}

function ProfileForm({ bodies, profile, bodyId, ...dialog }: DialogProps & {
  bodies: CatalogBody[]; profile?: CatalogProfile; bodyId?: number;
}) {
  const [clay, setClay] = useState(profile?.clay ?? "");
  const linkingLegacy = Boolean(profile && profile.body_id === null);
  return <FormDialog {...dialog} scope="catalog" title={linkingLegacy ? "ตรวจยืนยันประเภทผลิตเดิม" : profile ? "แก้ไขค่าผลิตรายดิน" : "เพิ่มค่าผลิตรายดิน"}
    path={profile ? `/profiles/${profile.id}` : "/profiles"} method={profile ? "PUT" : "POST"} submitLabel="บันทึกค่าผลิตรายดิน"
    build={form => ({ body_id: formInteger(form, "body_id", "แบบดินปั๊ม"), clay, clay_color: clay === "สี" ? formText(form, "clay_color") : null,
      pieces_per_rack: formInteger(form, "pieces_per_rack", "จำนวนแผ่นต่อไม้"), rest_days: formInteger(form, "rest_days", "จำนวนวันพัก", 0),
      destination: formText(form, "destination"), pieces_per_sqm: positiveNumber(form, "pieces_per_sqm", "จำนวนแผ่นต่อ ตร.ม.") })}>
    <div className="form-grid">
      {linkingLegacy || !bodyId ? <Choice label="แบบดินปั๊มที่ตรวจยืนยัน" name="body_id" defaultValue={profile?.body_id ?? ""}
        options={bodies.map(body => ({ value: body.id, label: `${body.name} · ${geometryLabel(body)} · #${body.id}` }))} /> : <>
        <input type="hidden" name="body_id" value={bodyId} /><p>แบบดินปั๊ม {bodies.find(body => body.id === bodyId)?.name} · #{bodyId}</p>
      </>}
      <Choice label="ประเภทดิน" name="clay" value={clay} onChange={setClay} options={clays.map(value => ({ value, label: value }))} />
      {clay === "สี" && <Field label="ชื่อสีที่ผสมในเนื้อดิน" name="clay_color" required defaultValue={profile?.clay_color ?? ""} />}
      <Field label="จำนวนแผ่นต่อไม้" name="pieces_per_rack" type="number" min={1} step={1} required defaultValue={profile?.pieces_per_rack ?? ""} />
      <Field label="จำนวนวันพักที่ยืนยัน" name="rest_days" type="number" min={0} step={1} required defaultValue={profile?.rest_days ?? ""} />
      <Choice label="ปลายทางเบิก" name="destination" defaultValue={profile?.destination ?? ""}
        options={Object.entries(destinations).map(([value, label]) => ({ value, label }))} />
      <Field label="จำนวนแผ่นต่อ ตร.ม. ที่ยืนยัน" name="pieces_per_sqm" type="number" min={0.001} step="any" required defaultValue={profile?.pieces_per_sqm ?? ""} />
    </div>
    {linkingLegacy && <Check name="verified" label="ตรวจชิ้นงานจริงแล้วว่าประเภทผลิตเดิมนี้ใช้แบบดินปั๊มที่เลือก รักษาเลขประเภทและประวัติเดิม" required />}
    <p className="helper">ดินสีแต่ละสีใช้ค่าผลิตและสต็อกแยกกัน กรอกค่าที่หน้างานยืนยันครบทุกช่อง</p>
  </FormDialog>;
}
