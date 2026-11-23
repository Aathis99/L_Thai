import assert from "node:assert/strict";
import { test } from "node:test";
import { productLabel, productProfiles, catalogOrderSelection, meshCompletionLines, type CatalogProduct, type CatalogProfile } from "../src/lib/tile-catalog.ts";

const product: CatalogProduct = { id: 1, product_code: "QA-1", name: "แบบทดสอบ", shape: null,
 size_1: 2, size_2: null, size_unit: "in", thickness_mm: null, mounting_type: null, body_id: 7, active: true };
const profile: CatalogProfile = { id: 10, body_id: 7, width: 2, length: null, clay: "ขาว", clay_color: null,
 name: null, pieces_per_rack: 40, rest_days: 0, destination: "kiln", pieces_per_sqm: 90, active: true };

test("product labels distinguish duplicate codes by size, thickness, mesh and internal id", () => {
 const plain = productLabel(product);
 const mesh = productLabel({ ...product, id: 2, thickness_mm: 8, mounting_type: "mesh" });
 assert.notEqual(plain, mesh);
 assert.match(plain, /QA-1/);
 assert.match(plain, /2 นิ้ว/);
 assert.doesNotMatch(plain, /null|× 2/);
 assert.match(mesh, /8 มม\./);
 assert.match(mesh, /ติดตาข่าย/);
 assert.notEqual(plain, productLabel({ ...product, id: 3 }));
});

test("profile choices require the verified body and complete settings while retaining separate mixtures", () => {
 const profiles = [profile, { ...profile, id: 11, clay: "สี", clay_color: "น้ำเงิน" },
  { ...profile, id: 12, clay: "สี", clay_color: "เขียว" }, { ...profile, id: 13, body_id: null },
  { ...profile, id: 14, body_id: 8 }, { ...profile, id: 15, pieces_per_sqm: null },
  { ...profile, id: 16, clay: "สี", clay_color: "" }, { ...profile, id: 17, active: false }];
 assert.deepEqual(productProfiles(product, profiles).map(item => item.id), [10, 11, 12]);
 assert.deepEqual(productProfiles({ ...product, body_id: null }, profiles), []);
 assert.deepEqual(productProfiles({ ...product, active: false }, profiles), []);
});

test("order selection rejects drafts, mismatched profiles and mesh stock orders", () => {
 assert.deepEqual(catalogOrderSelection([product], [profile], 1, 10, "customer"), { product_id: 1, type_id: 10 });
 assert.throws(() => catalogOrderSelection([{ ...product, body_id: null }], [profile], 1, 10, "customer"), /ข้อมูลผลิต/);
 assert.throws(() => catalogOrderSelection([product], [{ ...profile, body_id: 8 }], 1, 10, "customer"), /ข้อมูลผลิต/);
 assert.throws(() => catalogOrderSelection([{ ...product, mounting_type: "mesh" }], [profile], 1, 10, "stock"), /ออเดอร์ลูกค้า/);
});

test("bare preform stock orders choose a ready physical profile without requiring a sales product", () => {
 const legacy = { ...profile, id: 6, body_id: null };
 const meshOnlyBody = { ...profile, id: 12, body_id: 20 };
 const profiles = [legacy, meshOnlyBody, { ...profile, id: 13, active: false },
  { ...profile, id: 14, pieces_per_sqm: null }, { ...profile, id: 15, clay: "สี", clay_color: "" }];
 assert.deepEqual(catalogOrderSelection([], profiles, null, 6, "stock"), { type_id: 6 });
 assert.deepEqual(catalogOrderSelection([{ ...product, body_id: 20, mounting_type: "mesh" }], profiles, null, 12, "stock"), { type_id: 12 });
 for (const id of [13, 14, 15, 999]) assert.throws(() => catalogOrderSelection([], profiles, null, id, "stock"), /ข้อมูลผลิต/);
 assert.throws(() => catalogOrderSelection([], profiles, null, 6, "customer"), /ข้อมูลผลิต/);
 assert.deepEqual(catalogOrderSelection([product], [profile], product.id, profile.id, "stock"), { product_id: product.id, type_id: profile.id });
 assert.throws(() => catalogOrderSelection([{ ...product, mounting_type: "mesh" }], [profile], product.id, profile.id, "stock"), /ออเดอร์ลูกค้า/);
});

test("mesh completion sends only selected positive source quantities and retains grade keys", () => {
 const lines = [{ key: "workflow:15:A+", available_pieces: 600 }, { key: "legacy:10:A-", available_pieces: 400 }];
 const form = new FormData();
 form.set("line_0", "400");
 form.set("line_1", "0");
 assert.deepEqual(meshCompletionLines(form, lines), [{ key: "workflow:15:A+", pieces: 400 }]);
 form.set("line_0", "601");
 assert.throws(() => meshCompletionLines(form, lines), /เกิน/);
 for (const value of ["", "0", "-1", "2.5"]) {
  form.set("line_0", value);
  assert.throws(() => meshCompletionLines(form, lines));
 }
});
