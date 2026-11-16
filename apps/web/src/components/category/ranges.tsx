import { useState } from "react";
import { formInteger, formText } from "../../lib/pressing";
import type { Api } from "../../lib/types";
import { Field } from "../fields";
import { Card, Choice, FormDialog, Section } from "../pressing/shared";
import type { CategoryRecordsProps } from "./records";

type Range = { clay: string | null; color_id: number | null; minimum: number; maximum: number };
type Color = { id: number; name: string };

export async function loadRanges(api: Api) {
  const [ranges, colors] = await Promise.all([
    api<{ items: Range[] }>("/finishing/ranges"),
    api<{ items: Color[] }>("/finishing/colors"),
  ]);
  return { ranges: ranges.items, colors: colors.items };
}

export default function TemperatureRanges({ data, api, user, onSaved }: CategoryRecordsProps<Awaited<ReturnType<typeof loadRanges>>>) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState("clay");
  const canSetRange = user.permissions.includes("finishing.temperature");
  return <>
    <Section title="ช่วงอุณหภูมิเผา" action={canSetRange && (
      <button className="button secondary" onClick={() => {
        setKind("clay");
        setEditing(true);
      }}>ตั้งช่วงอุณหภูมิ</button>
    )}>
      {!data.ranges.length && <p>ยังไม่ได้ตั้งช่วงอุณหภูมิ</p>}
      <div className="pressing-cards">{data.ranges.map(range => <Card key={range.clay ?? range.color_id}
        title={range.clay ? `ดิน${range.clay}` : (data.colors.find(color => color.id === range.color_id)?.name ?? `สี #${range.color_id}`)}>
        <p>{range.minimum}–{range.maximum} °C</p>
      </Card>)}</div>
    </Section>
    {editing && canSetRange && <FormDialog api={api} scope="finishing" path="/ranges" title="ตั้งช่วงอุณหภูมิ"
      submitLabel="ยืนยันบันทึก" onClose={() => setEditing(false)} onSaved={onSaved} build={form => ({
        ...(formText(form, "kind") === "color"
          ? { color_id: formInteger(form, "color_id", "สีเคลือบ") }
          : { clay: formText(form, "clay") }),
        minimum: formInteger(form, "minimum", "อุณหภูมิต่ำสุด"),
        maximum: formInteger(form, "maximum", "อุณหภูมิสูงสุด"),
      })}>
      <Choice label="ตั้งช่วงสำหรับ" name="kind" value={kind} onChange={setKind}
        options={[{ value: "clay", label: "ประเภทดิน" }, { value: "color", label: "สีเคลือบ" }]} />
      {kind === "clay" ? <Choice label="ประเภทดิน" name="clay"
        options={["แดง", "ขาว", "จ้อ", "สี"].map(value => ({ value, label: value }))} /> :
        <Choice label="สีเคลือบ" name="color_id" options={data.colors.map(color => ({ value: color.id, label: color.name }))} />}
      <Field name="minimum" label="ต่ำสุด (°C)" type="number" step={1} min={1} required />
      <Field name="maximum" label="สูงสุด (°C)" type="number" step={1} min={1} required />
    </FormDialog>}
  </>;
}
