import { useState } from "react";
import { count, formInteger, formText, orderName, orderPurposes, tileName, type PressingData, type ProductionOrder, type TileType } from "../../lib/pressing";
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
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: () => setEditor(null) };
  const deleting = editor?.kind === "delete" && editor.order;
  const currentOrder = deleting && data.orders.find((order) => order.id === deleting.id);
  const displayedOrder = currentOrder || deleting;
  return (
    <>
      <Section title="ใบสั่งผลิต" action={manage && (
        <button className="button primary" disabled={!activeTypes.length} onClick={() => setEditor({ kind: "order" })}>
          เพิ่มใบสั่งผลิต
        </button>
      )}>
        {manage && !activeTypes.length && <p>เพิ่มประเภทกระเบื้องที่เมนูหมวดหมู่ → ทะเบียนกระเบื้องก่อนเปิดใบสั่งผลิต</p>}
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
                <p>{tileName(data.types, order.type_id)}</p>
                <Facts values={{
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
      {editor?.kind === "order" && manage && <OrderForm types={activeTypes} colors={data.colors} {...dialog} />}
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

function OrderForm({ types, colors, legacy, ...dialog }: DialogProps & {
  types: TileType[]; colors: PressingData["colors"]; legacy?: ProductionOrder;
}) {
  const [typeId, setTypeId] = useState(legacy ? String(legacy.type_id) : "");
  const [purpose,setPurpose]=useState<'customer'|'stock'>(legacy?.purpose??'customer');
  const [customer, setCustomer] = useState(0);
  const [percent, setPercent] = useState(10);
  const type = types.find((tile) => tile.id === Number(typeId));
  const allowance = Math.ceil(customer * percent / 100);
  return (
    <FormDialog {...dialog} title={legacy ? "เติมข้อมูลใบสั่งผลิตค้าง" : "เพิ่มใบสั่งผลิต"}
      scope={legacy ? "finishing" : "pressing"} path={legacy ? "/prepare-order" : "/orders"}
      intent={legacy ? "warning" : "success"}
      keyField="request_id" submitLabel="บันทึกใบสั่งผลิต"
      build={(form) => ({
        ...(legacy ? { order_id: legacy.id } : {
          type_id: formInteger(form, "type_id", "ประเภทกระเบื้อง"), purpose,
          customer_reference: formText(form, "customer_reference"),
        }),
        ...(purpose==='customer'?{customer_pieces:formInteger(form,'customer_pieces','ยอดลูกค้าสั่ง'),allowance_percent:formInteger(form,'allowance_percent','เปอร์เซ็นต์เผื่อ')}:{target_pieces:formInteger(form,'target_pieces','ยอดสั่งเก็บสต็อก')}),
        color_id: type?.destination === "color" ? formInteger(form, "color_id", "สีเคลือบ") : null,
      })}
    >
      <div className="form-grid">
        {legacy ? <p>{orderName(legacy)} · {tileName(types, legacy.type_id)}</p> : <>
          <Choice label="ที่มาของใบสั่งผลิต" name="purpose" value={purpose} onChange={v=>setPurpose(v as 'customer'|'stock')}
            options={[{value:'customer',label:'ตามออเดอร์ลูกค้า'},{value:'stock',label:'ผลิตเก็บสต็อก'}]} />
          <Choice label="ประเภทกระเบื้อง" name="type_id" value={typeId} onChange={setTypeId}
            options={types.map((tile) => ({ value: tile.id, label: tileName(types, tile.id) }))} />
          <Field label={purpose==='customer'?'เลขอ้างอิงออเดอร์':'เลขอ้างอิงงานสั่งเก็บสต็อก'} name="customer_reference" required={purpose==='customer'} />
        </>}
        {type?.destination === "color" && <Choice label="สีเคลือบ" name="color_id"
          options={colors.map(color => ({ value: color.id, label: color.name }))} />}
        <Field label={purpose==='customer'?'ยอดลูกค้าสั่ง (แผ่น)':'ยอดสั่งเก็บสต็อก (แผ่น)'} name={purpose==='customer'?'customer_pieces':'target_pieces'} type="number" min={1} step={1}
          onChange={event => setCustomer(Number(event.target.value))} required />
        {purpose==='customer'&&<Field label="เปอร์เซ็นต์เผื่อ" name="allowance_percent" type="number" min={5} max={20} step={1} defaultValue={10}
          onChange={event => setPercent(Number(event.target.value))} required />}
      </div>
      <Facts values={{ ...(purpose==='customer'?{'ยอดเผื่อ (แผ่น)':count(allowance)}:{}), "ยอดสั่งปั๊ม (แผ่น)": count(customer + (purpose==='customer'?allowance:0)),
        "พื้นที่สั่งปั๊ม (ตร.ม.)": type?.pieces_per_sqm ? count((customer + (purpose==='customer'?allowance:0)) / type.pieces_per_sqm) : null }} />
    </FormDialog>
  );
}
