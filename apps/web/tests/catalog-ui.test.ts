import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transformSync } from "next/dist/build/swc/index.js";
import type { CatalogProduct } from "../src/lib/tile-catalog.ts";
import type { Api, SessionUser } from "../src/lib/types.ts";

// Node strips .ts types but needs JSX compilation for the real screen components.
await loadBindings();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
      for (const suffix of [".tsx", ".ts"]) {
        const url = new URL(`${specifier}${suffix}`, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: transformSync(readFileSync(fileURLToPath(url), "utf8"), {
        filename: fileURLToPath(url),
        jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
        module: { type: "es6" },
      }).code,
    };
    return nextLoad(url, context);
  },
});

const { default: Catalog, ProductForm } = await import("../src/components/pressing/catalog.tsx");
const { default: QcPage } = await import("../src/components/finishing/qc.tsx");
const api: Api = async () => { throw new Error("Rendering must not call the API"); };
const onSaved = async () => {};
const product: CatalogProduct = { id: 41, product_code: "T-01", name: "ศิลาแลง", shape: null,
  size_1: 2, size_2: null, size_unit: "in", thickness_mm: null, mounting_type: null,
  body_id: 7, active: true, description_raw: "รายละเอียดเดิมจากไฟล์", notes: "หมายเหตุจากต้นทาง", source_row: 18 };

test("register shows source details and product status without production setup controls", () => {
  const html = renderToStaticMarkup(createElement(Catalog, {
    data: { products: [product, { ...product, id: 42, active: false }], bodies: [], profiles: [] },
    actions: { api, onSaved, can: () => true },
  }));
  assert.match(html, /รายละเอียดเดิมจากไฟล์/);
  assert.match(html, /หมายเหตุจากต้นทาง/);
  assert.match(html, /แถวต้นทาง<\/dt><dd>18/);
  assert.match(html, /ใช้งาน/);
  assert.match(html, /หยุดใช้/);
  assert.match(html, /#41/);
  assert.match(html, /#42/);
  assert.match(html, /เพิ่มรายการสินค้า/);
  assert.match(html, /แก้ไขสินค้า/);
  assert.match(html, /ตั้งค่าผลิต/);
  assert.doesNotMatch(html, /พร้อมเปิดผลิต|ประเภทผลิตเดิม/);
  assert.equal((html.match(/<section /g) ?? []).length, 1);
});

test("read-only register retains source details without write controls", () => {
  const html = renderToStaticMarkup(createElement(Catalog, {
    data: { products: [product], bodies: [], profiles: [] },
    actions: { api, onSaved, can: () => false },
  }));
  assert.match(html, /รายละเอียดเดิมจากไฟล์/);
  assert.doesNotMatch(html, /เพิ่มรายการสินค้า|แก้ไขสินค้า/);
});

test("product editing saves description and notes without resubmitting a stale body assignment", () => {
  const element = ProductForm({ api, onSaved, onClose() {}, product });
  const html = renderToStaticMarkup(element);
  assert.match(html, /name="description_raw"/);
  assert.match(html, /รายละเอียดเดิมจากไฟล์/);
  assert.match(html, /name="notes"/);
  assert.match(html, /หมายเหตุจากต้นทาง/);
  assert.doesNotMatch(html, /name="size_1"[^>]*required|แบบดินปั๊ม|ค่าผลิต/);
  const form = new FormData();
  for (const [name, value] of Object.entries({ product_code: "T-01", name: "ศิลาแลง", size_unit: "in",
    active: "true", description_raw: "รายละเอียดเพิ่มเติม", notes: "แก้หมายเหตุ" })) form.set(name, value);
  assert.deepEqual(element.props.build!(form, ""), {
    product_code: "T-01", name: "ศิลาแลง", shape: null, size_1: null, size_2: null,
    size_unit: "in", thickness_mm: null, mounting_type: null, active: true,
    description_raw: "รายละเอียดเพิ่มเติม", notes: "แก้หมายเหตุ",
  });
});

test("QC renders its empty production state without mesh completion panels", () => {
  const user: SessionUser = { id: 1, username: "qa", name: "QA", role_id: 1, role_name: "QA", permissions: [] };
  const page = QcPage({ api, user, openFinishedStock() {} });
  const content = page.props.children({ types: [], orders: [], rounds: [], qc: [] }, {
    can: () => false, open() {}, reverse: () => null, orderName: String, tileName: String, refresh: async () => {},
  });
  const html = renderToStaticMarkup(content);
  assert.match(html, /ยังไม่มีรอบเผาที่รอคัด QC/);
  assert.match(html, /ยังไม่มีผลคัด QC/);
  assert.doesNotMatch(html, /งานติดตาข่าย|ประวัติติดตาข่าย/);
});
