import { useState } from "react";
import { count, destinations, formInteger, formText, tileName, type PressingData, type TileType } from "../../lib/pressing";
import { Field } from "../fields";
import { Card, Choice, Facts, FormDialog, Section, type PressingActions } from "./shared";

type Editor = { kind: "type"; tile?: TileType } | { kind: "retire"; tile: TileType };

export default function Catalog({ data, actions }: { data: PressingData; actions: PressingActions }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const manage = actions.can("pressing.manage");
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: () => setEditor(null) };
  return (
    <>
      <Section title="ทะเบียนประเภทกระเบื้อง" action={manage && (
        <button className="button primary" onClick={() => setEditor({ kind: "type" })}>เพิ่มประเภทกระเบื้อง</button>
      )}>
        {data.types.length ? (
          <div className="pressing-cards">
            {data.types.map((tile) => (
              <Card
                key={tile.id}
                title={tileName(data.types, tile.id)}
                meta={<span className={`badge ${tile.active ? "good" : "neutral"}`}>{tile.active ? "ใช้งาน" : "หยุดใช้แล้ว"}</span>}
                actions={manage && tile.active && (
                  <>
                    <button className="button secondary" onClick={() => setEditor({ kind: "type", tile })}>แก้ไขประเภท</button>
                    <button className="button secondary danger" onClick={() => setEditor({ kind: "retire", tile })}>หยุดใช้ประเภท</button>
                  </>
                )}
              >
                <Facts values={{
                  "แผ่นต่อไม้": count(tile.pieces_per_rack),
                  "จำนวนวันพัก": count(tile.rest_days),
                  "ปลายทางเบิก": destinations[tile.destination],
                  "แผ่นต่อ ตร.ม.": tile.pieces_per_sqm === null ? null : count(tile.pieces_per_sqm),
                  ...(tile.clay_color ? { "รายละเอียดดินสี": tile.clay_color } : {}),
                }} />
              </Card>
            ))}
          </div>
        ) : <p>ยังไม่มีประเภทกระเบื้อง</p>}
      </Section>
      {editor?.kind === "type" && manage && <TypeForm tile={editor.tile} {...dialog} />}
      {editor?.kind === "retire" && manage && (
        <FormDialog {...dialog} title="ยืนยันหยุดใช้ประเภทกระเบื้อง" path={`/types/${editor.tile.id}`}
          method="DELETE" submitLabel="ยืนยันหยุดใช้"
        >
          <p>{tileName(data.types, editor.tile.id)}</p>
          <p className="helper">ประเภทที่มีรายการอ้างอิงจะยังอยู่ในประวัติ ประเภทที่ยังไม่มีรายการอ้างอิงจะถูกลบจากทะเบียน</p>
        </FormDialog>
      )}
    </>
  );
}

type DialogProps = Pick<PressingActions, "api" | "onSaved"> & { onClose: () => void };

function positiveNumber(form: FormData, name: string, label: string): number {
  const value = Number(formText(form, name));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`กรุณาระบุ${label}เป็นจำนวนมากกว่า 0`);
  return value;
}

function TypeForm({ tile, ...dialog }: DialogProps & { tile?: TileType }) {
  return (
    <FormDialog
      {...dialog}
      title={tile ? "แก้ไขประเภทกระเบื้อง" : "เพิ่มประเภทกระเบื้อง"}
      path={tile ? `/types/${tile.id}` : "/types"}
      method={tile ? "PUT" : "POST"}
      submitLabel="บันทึกประเภทกระเบื้อง"
      build={(form) => ({
        width: positiveNumber(form, "width", "ความกว้าง"),
        length: positiveNumber(form, "length", "ความยาว"),
        clay: formText(form, "clay"),
        name: formText(form, "name"),
        clay_color: formText(form, "clay_color"),
        pieces_per_rack: formInteger(form, "pieces_per_rack", "จำนวนแผ่นต่อไม้"),
        rest_days: formInteger(form, "rest_days", "จำนวนวันพัก", 0),
        destination: formText(form, "destination"),
        pieces_per_sqm: formText(form, "pieces_per_sqm") ? positiveNumber(form, "pieces_per_sqm", "จำนวนแผ่นต่อ ตร.ม.") : null,
      })}
    >
      <div className="form-grid">
        <Field label="ความกว้าง" name="width" type="number" step="any" required defaultValue={tile?.width} />
        <Field label="ความยาว" name="length" type="number" step="any" required defaultValue={tile?.length} />
        <Choice label="ประเภทดิน" name="clay" defaultValue={tile?.clay ?? ""}
          options={["แดง", "ขาว", "จ้อ", "สี"].map((clay) => ({ value: clay, label: clay }))} />
        <Field label="รายละเอียดดินสี" name="clay_color" defaultValue={tile?.clay_color ?? ""} />
        <Field label="ชื่อเรียก" name="name" defaultValue={tile?.name ?? ""} />
        <Field label="จำนวนแผ่นต่อไม้" name="pieces_per_rack" type="number" min={1} step={1} required defaultValue={tile?.pieces_per_rack} />
        <Field label="จำนวนวันพัก" name="rest_days" type="number" min={0} step={1} required defaultValue={tile?.rest_days} />
        <Choice label="ปลายทางเบิก" name="destination" defaultValue={tile?.destination ?? ""}
          options={Object.entries(destinations).map(([value, label]) => ({ value, label }))} />
        <Field label="จำนวนแผ่นต่อ ตร.ม." name="pieces_per_sqm" type="number" step="any" defaultValue={tile?.pieces_per_sqm ?? ""} />
      </div>
    </FormDialog>
  );
}
