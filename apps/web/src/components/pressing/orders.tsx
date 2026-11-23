import { useState } from "react";
import { count, destinations, formInteger, formText, orderName, orderPurposes, tileName, type PressingData, type ProductionOrder, type TileType } from "../../lib/pressing";
import { catalogOrderSelection, productLabel, productProfiles, profileLabel, readyProductionProfiles, sizeUnits, type CatalogState } from "../../lib/tile-catalog";
import { Field } from "../fields";
import { Card, Choice, Facts, FormDialog, Section, type PressingActions } from "./shared";

type Editor = { kind: "order" } | { kind: "target" | "delete" | "prepare"; order: ProductionOrder };

function orderReferences(order: ProductionOrder) {
  return [order.has_entries && "รายการปั๊ม", order.has_issues && "รายการเบิก"].filter(Boolean).join("และ");
}

export default function Orders({ data, actions }: { data: PressingData; actions: PressingActions }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const manage = actions.can("pressing.manage");
  const prepare = actions.can("finishing.read") && actions.can("finishing.prepare");
  const activeTypes = data.types.filter((tile) => tile.active);
  const readyProducts = data.catalog?.products.filter(product => productProfiles(product, data.catalog!.profiles).length) ?? [];
  const readyProfiles = readyProductionProfiles(data.catalog?.profiles??activeTypes);
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: () => setEditor(null) };
  const deleting = editor?.kind === "delete" && editor.order;
  const currentOrder = deleting && data.orders.find((order) => order.id === deleting.id);
  const displayedOrder = currentOrder || deleting;
  return (
    <>
      <Section title="ใบสั่งผลิต" action={manage && (
        <button className="button primary" onClick={() => setEditor({ kind: "order" })}>
          เพิ่มใบสั่งผลิต
        </button>
      )}>
        {manage && !readyProducts.length && <p>{readyProfiles.length ? "สั่งปั๊มดินพื้นเก็บสต็อกได้จากประเภทผลิตที่พร้อม สำหรับออเดอร์สินค้าให้ยืนยันแบบดินปั๊มและค่าผลิตในทะเบียนก่อน" : "ตรวจยืนยันแบบดินปั๊มและค่าผลิตรายดินที่เมนูหมวดหมู่ → ทะเบียนกระเบื้องก่อนเปิดใบสั่งผลิต"}</p>}
        {data.orders.length ? (
          <div className="pressing-cards">
            {data.orders.map((order) => (
              <Card key={order.id} title={orderName(order)} meta={<span className="badge neutral">{orderPurposes[order.purpose]}</span>}
                actions={(manage || prepare) && (
                  <>
                    {manage && order.customer_pieces == null && <button className="button warning" onClick={() => setEditor({ kind: "target", order })}>แก้ยอดสั่งปั๊ม</button>}
                    {prepare && order.purpose === "customer" && order.customer_pieces == null && <button className="button warning" onClick={() => setEditor({ kind: "prepare", order })}>เติมข้อมูลใบค้าง</button>}
                    {manage && !orderReferences(order) && (
                      <button className="button destructive" onClick={() => setEditor({ kind: "delete", order })}>ลบใบสั่งผลิต</button>
                    )}
                  </>
                )}
              >
                {order.product_name && <p>{order.product_code} · {order.product_name}</p>}
                <p>{order.production_clay ? `${order.clay_name_snapshot??`ดิน${order.production_clay}`}${order.clay_color_name_snapshot||order.production_clay_color ? ` · สีที่ผสม ${order.clay_color_name_snapshot??order.production_clay_color}` : ""}` : tileName(data.types, order.type_id)}</p>
                {order.product_snapshot && <p>{[order.product_snapshot.shape,
                  order.product_snapshot.size_1 == null ? null : `${order.product_snapshot.size_1}${order.product_snapshot.size_2 == null ? "" : ` × ${order.product_snapshot.size_2}`} ${sizeUnits[order.product_snapshot.size_unit ?? ""] ?? order.product_snapshot.size_unit ?? ""}`,
                  order.product_snapshot.thickness_mm == null ? null : `หนา ${order.product_snapshot.thickness_mm} มม.`].filter(Boolean).join(" · ")}</p>}
                <Facts values={{
                  ...(order.product_id ? { "การติดตาข่าย": order.requires_mesh ? "ต้องติดตาข่ายหลัง QC" : "ไม่ระบุตาข่าย",
                    "แผ่นต่อไม้ ณ เปิดใบ": order.production_pieces_per_rack == null ? null : count(order.production_pieces_per_rack),
                    "วันพัก ณ เปิดใบ": order.production_rest_days == null ? null : count(order.production_rest_days),
                    "แผ่นต่อ ตร.ม. ณ เปิดใบ": order.pieces_per_sqm == null ? null : count(order.pieces_per_sqm),
                    "ปลายทาง ณ เปิดใบ": order.production_destination ? destinations[order.production_destination] : null } : {}),
                  ...(order.customer_pieces != null ? {
                    "ยอดลูกค้าสั่ง (แผ่น)": count(order.customer_pieces),
                    [`ยอดเผื่อ ${order.allowance_percent}% (แผ่น)`]: count(order.allowance_pieces ?? 0),
                    "สีเคลือบ": order.color_name,
                    "พื้นที่สั่งปั๊ม (ตร.ม.)": order.target_square_meters == null ? null : count(order.target_square_meters),
                  } : {}),
                  "ยอดสั่งปั๊ม (แผ่น)": count(order.target_pieces),
                  "ยอดปั๊ม (แผ่น)": count(order.pressed_pieces),
                  "ยอดขาด (แผ่น)": count(order.short_pieces),
                  "ยอดเกิน (แผ่น)": count(order.over_pieces),
                }} />
                {manage && orderReferences(order) && <p className="helper">ลบไม่ได้ เพราะมี{orderReferences(order)}อ้างถึงใบนี้แล้ว</p>}
              </Card>
            ))}
          </div>
        ) : <p>ยังไม่มีใบสั่งผลิต</p>}
      </Section>
      {editor?.kind === "order" && manage && <OrderForm types={activeTypes} colors={data.colors} catalog={data.catalog} {...dialog} />}
      {editor?.kind === "prepare" && prepare && <OrderForm types={data.types} colors={data.colors} legacy={editor.order} {...dialog} />}
      {editor?.kind === "target" && manage && (
        <FormDialog {...dialog} title="แก้ยอดสั่งปั๊ม" path={`/orders/${editor.order.id}`} method="PUT" submitLabel="บันทึกยอดสั่งปั๊ม"
          build={(form) => ({ target_pieces: formInteger(form, "target_pieces", "ยอดสั่งปั๊ม") })}
        >
          <p>{orderName(editor.order)}</p>
          <Field label="ยอดสั่งปั๊ม (แผ่น)" name="target_pieces" type="number" min={1} step={1} required defaultValue={editor.order.target_pieces} />
        </FormDialog>
      )}
      {displayedOrder && manage && (
        <FormDialog {...dialog} title="ลบใบสั่งผลิต" path={`/orders/${displayedOrder.id}`} method="DELETE" submitLabel="ยืนยันลบ"
          onSaved={() => actions.onSaved("ลบใบสั่งผลิตแล้ว")} onStale={actions.refresh}
          submitDisabled={!currentOrder || Boolean(orderReferences(currentOrder))}
        >
          <p>{orderName(displayedOrder)}</p>
          <Facts values={{ "ประเภทกระเบื้อง": tileName(data.types, displayedOrder.type_id), "ยอดสั่งปั๊ม (แผ่น)": count(displayedOrder.target_pieces) }} />
          {!currentOrder && <p className="helper">ไม่พบใบสั่งผลิตนี้ในรายการล่าสุด</p>}
        </FormDialog>
      )}
    </>
  );
}

type DialogProps = Pick<PressingActions, "api" | "onSaved"> & { onClose: () => void };

function OrderForm({ types, colors, legacy, catalog, ...dialog }: DialogProps & {
  types: TileType[]; colors: PressingData["colors"]; legacy?: ProductionOrder; catalog?: CatalogState;
}) {
  const [typeId, setTypeId] = useState(legacy ? String(legacy.type_id) : "");
  const [productId, setProductId] = useState("");
  const [clayTypeId,setClayTypeId]=useState(''),[clayColorId,setClayColorId]=useState('');
  const [search, setSearch] = useState("");
  const [purpose,setPurpose]=useState<'customer'|'stock'>(legacy?.purpose ?? 'customer');
  const [stockKind, setStockKind] = useState("preform");
  const [customer, setCustomer] = useState(0);
  const [percent, setPercent] = useState(10);
  const product = catalog?.products.find(item => item.id === Number(productId));
  const allProfiles:CatalogState['profiles'] = catalog?.profiles ?? types.map(item => ({ ...item, body_id: item.body_id ?? null }));
  const bareStock = !legacy && purpose === "stock" && stockKind === "preform";
  const profiles = bareStock ? readyProductionProfiles(allProfiles) : product ? productProfiles(product, allProfiles) : [];
  const clayType=catalog?.clay_types?.find(c=>c.id===Number(clayTypeId));
  const legacyType=legacy?types.find(tile=>tile.id===legacy.type_id):undefined;
  const type = legacy ? legacyType&&{...legacyType,destination:legacy.production_destination??legacyType.destination,pieces_per_sqm:legacy.pieces_per_sqm??legacyType.pieces_per_sqm} : bareStock?profiles.find(item => item.id === Number(typeId)):
    profiles.find(item=>item.clay_type_id===Number(clayTypeId)&&(item.clay_color_id??null)===(clayType?.code==='COLORED'?Number(clayColorId):null));
  const mesh = !bareStock && product?.mounting_type === "mesh";
  const products = catalog?.products.filter(item => item.active && (purpose !== "stock" || item.mounting_type !== "mesh") && (String(item.id) === productId ||
    productLabel(item).toLocaleLowerCase("th").includes(search.trim().toLocaleLowerCase("th")))) ?? [];
  const allowance = Math.ceil(customer * percent / 100);
  return (
    <FormDialog {...dialog} title={legacy ? "เติมข้อมูลใบสั่งผลิตค้าง" : "เพิ่มใบสั่งผลิต"}
      scope={legacy ? "finishing" : "pressing"} path={legacy ? "/prepare-order" : "/orders"}
      intent={legacy ? "warning" : "success"}
      keyField="request_id" submitLabel="บันทึกใบสั่งผลิต"
      submitDisabled={!legacy && (!type || (mesh && purpose !== "customer"))}
      build={(form) => ({
        ...(legacy ? { order_id: legacy.id } : {
          ...catalogOrderSelection(catalog?.products ?? [], allProfiles,
            bareStock ? null : formInteger(form, "product_id", "รายการสินค้า"), formInteger(form, "type_id", "ประเภทดินและสีที่ผสม"), purpose), purpose,
          expected_clay_type_id:('clay_type_id' in (type??{}))?(type as CatalogState['profiles'][number]).clay_type_id:undefined,
          expected_clay_color_id:('clay_color_id' in (type??{}))?(type as CatalogState['profiles'][number]).clay_color_id:undefined,
          customer_reference: formText(form, "customer_reference"),
        }),
        ...(purpose==='customer'?{customer_pieces:formInteger(form,'customer_pieces','ยอดลูกค้าสั่ง'),allowance_percent:formInteger(form,'allowance_percent','เปอร์เซ็นต์เผื่อ')}:{target_pieces:formInteger(form,'target_pieces','ยอดสั่งเก็บสต็อก')}),
        color_id: type?.destination === "color" && (!bareStock || formText(form, "color_id")) ? formInteger(form, "color_id", "สีเคลือบ") : null,
      })}
    >
      <div className="form-grid">
        {legacy ? <p>{orderName(legacy)} · {tileName(types, legacy.type_id)}</p> : <>
          <Choice label="ที่มาของใบสั่งผลิต" name="purpose" value={purpose} onChange={value => {
            setPurpose(value as "customer" | "stock"); setTypeId("");
            if (value === "stock") setStockKind("preform");
          }} options={[{value:'customer',label:'ตามออเดอร์ลูกค้า'},{value:'stock',label:'ผลิตเก็บสต็อก'}]} />
          {purpose === "stock" && <Choice label="งานที่สั่งเก็บสต็อก" name="stock_kind" value={stockKind} onChange={value => {
            setStockKind(value); setTypeId(""); setProductId("");
          }} options={[{ value: "preform", label: "ดินพื้นตามประเภทผลิต ไม่ระบุสินค้า" }, { value: "product", label: "สินค้ารุ่นไม่ติดตาข่าย" }]} />}
          {!bareStock && <>
          <Field label="ค้นหารหัสหรือชื่อสินค้า" name="product_search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
          <Choice label="รายการสินค้าและรุ่น" name="product_id" value={productId} onChange={value => {
            setProductId(value); setTypeId("");setClayTypeId('');setClayColorId('');
            if (catalog?.products.find(item => item.id === Number(value))?.mounting_type === "mesh") setPurpose("customer");
          }} options={products.map(item => ({ value: item.id,
            label: `${productLabel(item)}${productProfiles(item, catalog?.profiles ?? []).length ? "" : " · รอตั้งค่าผลิต"}` }))} />
          </>}
          {bareStock?<Choice label="ประเภทดิน / สีที่ผสม" name="type_id" value={typeId} onChange={setTypeId}
            options={profiles.map(item => ({ value: item.id, label: bareStock ? `${tileName(profiles, item.id)} · #${item.id}${item.body_id === null ? " · ประเภทเดิมยังไม่จับคู่" : ""}` : profileLabel(item) }))} />
           :<>
            <Choice label="ประเภทดิน" name="clay_type_id" value={clayTypeId} onChange={v=>{setClayTypeId(v);setClayColorId('');}} options={(catalog?.clay_types??[]).filter(c=>c.active).map(c=>({value:c.id,label:c.name}))}/>
            {clayType?.code==='COLORED'&&<Choice label="สีดินที่ผสมในเนื้อดิน" name="clay_color_id" value={clayColorId} onChange={setClayColorId} options={(catalog?.clay_colors??[]).filter(c=>c.active).map(c=>({value:c.id,label:`${c.code} · ${c.name}`}))}/>}
            <input type="hidden" name="type_id" value={type?.id??''}/>
            {clayType?.code==='COLORED'&&!catalog?.clay_colors?.some(c=>c.active)&&<p>ยังไม่มีสีดินให้เลือก เพิ่มเมื่อข้อมูลพร้อมได้ที่ทะเบียนประเภทดิน</p>}
            {clayType&&!type&&<p>รอตั้งค่าผลิตของสินค้าและดินที่เลือก</p>}
           </>}
          {bareStock && <p className="helper">สั่งปั๊มดินพื้นเก็บตามประเภทผลิตและสีที่ผสม ใช้ประเภทเดิมที่ยังไม่จับคู่สินค้าได้ เมื่อนำไปทำสีหรือลาย ให้กันและเบิกดินไปยังใบสั่งสินค้าปลายทางที่ระบุงานจริงก่อน ใบเก็บดินพื้นนี้ไม่เป็นงานติดตาข่าย</p>}
          {!bareStock && product && !profiles.length && <p className="helper">สินค้านี้ยังไม่มีค่าผลิตครบ กรุณาตั้งค่าที่ทะเบียนกระเบื้องก่อนเปิดใบสั่ง</p>}
          {!bareStock && product && <p className="helper">{mesh ? "รุ่นติดตาข่าย ต้องมีออเดอร์ลูกค้า นับกระเบื้องย่อยเป็นแผ่น และพร้อมส่งหลังยืนยันติดตาข่ายเสร็จ" : "รุ่นนี้ไม่ระบุตาข่าย"}</p>}
          <Field label={purpose==='customer'?'เลขอ้างอิงออเดอร์':'เลขอ้างอิงงานสั่งเก็บสต็อก'} name="customer_reference" required={purpose==='customer'} />
        </>}
        {type?.destination === "color" && <Choice label="สีเคลือบ" name="color_id"
          empty={bareStock ? "ยังไม่ระบุสีเคลือบ" : undefined}
          options={colors.map(color => ({ value: color.id, label: color.name }))} />}
        <Field label={purpose==='customer'?'ยอดลูกค้าสั่ง (แผ่น)':'ยอดสั่งเก็บสต็อก (แผ่น)'} name={purpose==='customer'?'customer_pieces':'target_pieces'} type="number" min={1} step={1}
          onChange={event => setCustomer(Number(event.target.value))} required />
        {purpose==='customer'&&<Field label="เปอร์เซ็นต์เผื่อ" name="allowance_percent" type="number" min={5} max={20} step={1} defaultValue={10}
          onChange={event => setPercent(Number(event.target.value))} required />}
      </div>
      {type && !legacy && <Facts values={{ "แผ่นต่อไม้": count(type.pieces_per_rack), "วันพัก": count(type.rest_days),
        "แผ่นต่อ ตร.ม.": type.pieces_per_sqm == null ? null : count(type.pieces_per_sqm), "ปลายทาง": destinations[type.destination] }} />}
      <Facts values={{ ...(purpose==='customer'?{'ยอดเผื่อ (แผ่น)':count(allowance)}:{}), "ยอดสั่งปั๊ม (แผ่น)": count(customer + (purpose==='customer'?allowance:0)),
        "พื้นที่สั่งปั๊ม (ตร.ม.)": type?.pieces_per_sqm ? count((customer + (purpose==='customer'?allowance:0)) / type.pieces_per_sqm) : null }} />
    </FormDialog>
  );
}
