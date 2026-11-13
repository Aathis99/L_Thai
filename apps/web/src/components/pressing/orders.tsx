import { useState } from "react";
import { count, formInteger, formText, orderName, orderPurposes, tileName, type PressingData, type ProductionOrder, type TileType } from "../../lib/pressing";
import { Field } from "../fields";
import { Card, Choice, Facts, FormDialog, Section, type PressingActions } from "./shared";

type Editor = { kind: "order" } | { kind: "target"; order: ProductionOrder };

export default function Orders({ data, actions }: { data: PressingData; actions: PressingActions }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const manage = actions.can("pressing.manage");
  const activeTypes = data.types.filter((tile) => tile.active);
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: () => setEditor(null) };
  return (
    <>
      <Section title="ใบสั่งผลิต" action={manage && (
        <button className="button primary" disabled={!activeTypes.length} onClick={() => setEditor({ kind: "order" })}>
          เพิ่มใบสั่งผลิต
        </button>
      )}>
        {manage && !activeTypes.length && <p>เพิ่มประเภทกระเบื้องที่เมนูทะเบียนประเภทกระเบื้องก่อนเปิดใบสั่งผลิต</p>}
        {data.orders.length ? (
          <div className="pressing-cards">
            {data.orders.map((order) => (
              <Card key={order.id} title={orderName(order)} meta={<span className="badge neutral">{orderPurposes[order.purpose]}</span>}
                actions={manage && (
                  <button className="button secondary" onClick={() => setEditor({ kind: "target", order })}>แก้ยอดสั่งปั๊ม</button>
                )}
              >
                <p>{tileName(data.types, order.type_id)}</p>
                <Facts values={{
                  "ยอดสั่งปั๊ม (แผ่น)": count(order.target_pieces),
                  "ยอดปั๊ม (แผ่น)": count(order.pressed_pieces),
                  "ยอดขาด (แผ่น)": count(order.short_pieces),
                  "ยอดเกิน (แผ่น)": count(order.over_pieces),
                }} />
              </Card>
            ))}
          </div>
        ) : <p>ยังไม่มีใบสั่งผลิต</p>}
      </Section>
      {editor?.kind === "order" && manage && <OrderForm types={activeTypes} {...dialog} />}
      {editor?.kind === "target" && manage && (
        <FormDialog {...dialog} title="แก้ยอดสั่งปั๊ม" path={`/orders/${editor.order.id}`} method="PUT" submitLabel="บันทึกยอดสั่งปั๊ม"
          build={(form) => ({ target_pieces: formInteger(form, "target_pieces", "ยอดสั่งปั๊ม") })}
        >
          <p>{orderName(editor.order)}</p>
          <Field label="ยอดสั่งปั๊ม (แผ่น)" name="target_pieces" type="number" min={1} step={1} required defaultValue={editor.order.target_pieces} />
        </FormDialog>
      )}
    </>
  );
}

type DialogProps = Pick<PressingActions, "api" | "onSaved"> & { onClose: () => void };

function OrderForm({ types, ...dialog }: DialogProps & { types: TileType[] }) {
  const [purpose, setPurpose] = useState("customer");
  return (
    <FormDialog {...dialog} title="เพิ่มใบสั่งผลิต" path="/orders" submitLabel="บันทึกใบสั่งผลิต"
      build={(form) => ({
        type_id: formInteger(form, "type_id", "ประเภทกระเบื้อง"),
        purpose: formText(form, "purpose"),
        customer_reference: formText(form, "customer_reference"),
        target_pieces: formInteger(form, "target_pieces", "ยอดสั่งปั๊ม"),
      })}
    >
      <div className="form-grid">
        <Choice label="ประเภทกระเบื้อง" name="type_id"
          options={types.map((tile) => ({ value: tile.id, label: tileName(types, tile.id) }))} />
        <Choice label="ที่มาของใบสั่งผลิต" name="purpose" value={purpose} onChange={setPurpose}
          options={Object.entries(orderPurposes).map(([value, label]) => ({ value, label }))} />
        <Field label="เลขอ้างอิงออเดอร์" name="customer_reference" required={purpose === "customer"} />
        <Field label="ยอดสั่งปั๊ม (แผ่น)" name="target_pieces" type="number" min={1} step={1} required />
      </div>
    </FormDialog>
  );
}
