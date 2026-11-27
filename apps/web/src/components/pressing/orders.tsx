import { useState } from "react";
import {
  count,
  destinations,
  filterAndSortOrders,
  formInteger,
  formText,
  orderName,
  orderProgressLabels,
  orderProgressStatus,
  orderPurposes,
  tileName,
  type OrderProgressStatus,
  type PressingData,
  type ProductionOrder,
  type TileType,
} from "../../lib/pressing";
import { catalogOrderSelection, productLabel, productProfiles, profileLabel, readyProductionProfiles, sizeUnits, type CatalogState } from "../../lib/tile-catalog";
import { Field } from "../fields";
import { Choice, Facts, FormDialog, Modal, Section, type PressingActions } from "./shared";
import ProductPicker from "./product-picker";

type Editor = { kind: "order" } | { kind: "target" | "delete" | "prepare"; order: ProductionOrder };

function orderReferences(order: ProductionOrder) {
  return [order.has_entries && "รายการปั๊ม", order.has_issues && "รายการเบิก"].filter(Boolean).join("และ");
}

function orderClayText(order: ProductionOrder, types: readonly TileType[]) {
  return order.production_clay
    ? `${order.clay_name_snapshot ?? `ดิน${order.production_clay}`}${order.clay_color_name_snapshot || order.production_clay_color ? ` · สีที่ผสม ${order.clay_color_name_snapshot ?? order.production_clay_color}` : ""}`
    : tileName(types, order.type_id);
}

function orderGeometryText(order: ProductionOrder) {
  if (!order.product_snapshot) return "";
  return [
    order.product_snapshot.shape,
    order.product_snapshot.size_1 == null
      ? null
      : `${order.product_snapshot.size_1}${order.product_snapshot.size_2 == null ? "" : ` × ${order.product_snapshot.size_2}`} ${sizeUnits[order.product_snapshot.size_unit ?? ""] ?? order.product_snapshot.size_unit ?? ""}`,
    order.product_snapshot.thickness_mm == null ? null : `หนา ${order.product_snapshot.thickness_mm} มม.`,
  ].filter(Boolean).join(" · ");
}

function OrderStatusPill({ order }: { order: ProductionOrder }) {
  const status = orderProgressStatus(order);
  const tone = status === "short" ? "draft" : status === "complete" ? "confirmed" : "neutral";
  return (
    <span className={`status-pill ${tone}`}>
      <i className="status-dot" aria-hidden="true" />
      {orderProgressLabels[status]}
    </span>
  );
}

function formatDiff(order: ProductionOrder) {
  if (order.short_pieces > 0) return `ขาด ${count(order.short_pieces)}`;
  if (order.over_pieces > 0) return `เกิน +${count(order.over_pieces)}`;
  return "0";
}

export default function Orders({
  data,
  actions,
  onQuickRecord,
}: {
  data: PressingData;
  actions: PressingActions;
  onQuickRecord?: (orderId: number) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [purposeFilter, setPurposeFilter] = useState<"" | "customer" | "stock">("");
  const [statusFilter, setStatusFilter] = useState<"" | OrderProgressStatus>("");

  const manage = actions.can("pressing.manage");
  const prepare = actions.can("finishing.read") && actions.can("finishing.prepare");
  const canRecord = actions.can("pressing.record");
  const activeTypes = data.types.filter((tile) => tile.active);
  const activeTypeIds = new Set(activeTypes.map((tile) => tile.id));
  const readyProducts = data.catalog?.products.filter((product) => productProfiles(product, data.catalog!.profiles).length) ?? [];
  const readyProfiles = readyProductionProfiles(data.catalog?.profiles ?? activeTypes);

  const filtered = filterAndSortOrders(data.orders, data.types, {
    search,
    purpose: purposeFilter,
    status: statusFilter,
  });
  const hasFilters = Boolean(search.trim() || purposeFilter || statusFilter);
  const detailOrder = detailId === null ? null : data.orders.find((order) => order.id === detailId) ?? null;

  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: () => setEditor(null) };
  const deleting = editor?.kind === "delete" && editor.order;
  const currentOrder = deleting && data.orders.find((order) => order.id === deleting.id);
  const displayedOrder = currentOrder || deleting;

  const canQuickRecordOrder = (order: ProductionOrder) =>
    Boolean(onQuickRecord && canRecord && data.workers.length > 0 && activeTypeIds.has(order.type_id));

  return (
    <>
      {data.orders.length > 0 && (
        <Section title="ค้นหาและตัวกรอง">
          <div className="clay-filters">
            <div className="clay-filter-search">
              <Field
                label="เลขอ้างอิง / รหัสสินค้า / ชื่อสินค้า"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <label className="field">
              <span>ที่มา</span>
              <select
                value={purposeFilter}
                onChange={(event) => setPurposeFilter(event.target.value as "" | "customer" | "stock")}
              >
                <option value="">ทั้งหมด</option>
                <option value="customer">ตามออเดอร์ลูกค้า</option>
                <option value="stock">ผลิตเก็บสต็อก</option>
              </select>
            </label>
            <label className="field">
              <span>สถานะยอด</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "" | OrderProgressStatus)}
              >
                <option value="">ทั้งหมด</option>
                <option value="short">{orderProgressLabels.short}</option>
                <option value="complete">{orderProgressLabels.complete}</option>
                <option value="over">{orderProgressLabels.over}</option>
              </select>
            </label>
          </div>
        </Section>
      )}

      <Section
        title={data.orders.length ? `ใบสั่งผลิต (${count(filtered.length)} จาก ${count(data.orders.length)} ใบ)` : "ใบสั่งผลิต"}
        action={manage && (
          <button className="button primary" onClick={() => setEditor({ kind: "order" })}>
            ＋ เพิ่มใบสั่งผลิต
          </button>
        )}
      >
        {manage && !readyProducts.length && (
          <p className="helper">
            {readyProfiles.length
              ? "สั่งปั๊มดินพื้นเก็บสต็อกได้จากประเภทผลิตที่พร้อม สำหรับออเดอร์สินค้าให้ยืนยันแบบดินปั๊มและค่าผลิตในทะเบียนก่อน"
              : "ตรวจยืนยันแบบดินปั๊มและค่าผลิตรายดินที่เมนูหมวดหมู่ → ทะเบียนกระเบื้องก่อนเปิดใบสั่งผลิต"}
          </p>
        )}

        {!data.orders.length ? (
          <div className="pressing-empty">
            <p>ยังไม่มีใบสั่งผลิต — เริ่มต้นด้วยการเพิ่มใบสั่งผลิตใบแรกเพื่อเปิดงานปั๊ม</p>
            {manage && (
              <button className="button primary" onClick={() => setEditor({ kind: "order" })}>
                ＋ เพิ่มใบสั่งผลิตใบแรก
              </button>
            )}
          </div>
        ) : !filtered.length ? (
          <div className="pressing-empty">
            <p>ไม่พบใบสั่งผลิตตามตัวกรอง</p>
            {hasFilters && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setPurposeFilter("");
                  setStatusFilter("");
                }}
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ใบสั่งผลิต</th>
                  <th>สินค้า / ประเภทดิน</th>
                  <th className="num-col">สั่งปั๊ม (แผ่น)</th>
                  <th className="num-col">ปั๊มแล้ว (แผ่น)</th>
                  <th className="num-col">ขาด / เกิน (แผ่น)</th>
                  <th>สถานะยอด</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const clayText = orderClayText(order, data.types);
                  return (
                    <tr key={order.id}>
                      <td>
                        <strong>{orderName(order)}</strong>
                        <div className="pressing-badge-row">
                          <span className="badge neutral">{orderPurposes[order.purpose]}</span>
                          {order.requires_mesh && <span className="badge muted-badge">ติดตาข่าย</span>}
                        </div>
                      </td>
                      <td>
                        {order.product_name ? (
                          <>
                            <strong>{order.product_code} · {order.product_name}</strong>
                            <span className="subtext">
                              {clayText}{order.color_name ? ` · สีเคลือบ: ${order.color_name}` : ""}
                            </span>
                          </>
                        ) : (
                          <>
                            <strong>{clayText}</strong>
                            {order.color_name && <span className="subtext">สีเคลือบ: {order.color_name}</span>}
                          </>
                        )}
                      </td>
                      <td className="num-col"><strong>{count(order.target_pieces)}</strong></td>
                      <td className="num-col">{count(order.pressed_pieces)}</td>
                      <td className="num-col">{formatDiff(order)}</td>
                      <td><OrderStatusPill order={order} /></td>
                      <td>
                        <div className="pressing-actions pressing-row-actions">
                          {canQuickRecordOrder(order) && (
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => onQuickRecord!(order.id)}
                            >
                              บันทึกยอด
                            </button>
                          )}
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => setDetailId(order.id)}
                          >
                            เปิด
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {detailOrder && !editor && (
        <Modal title={orderName(detailOrder)} size="lg" onClose={() => setDetailId(null)}>
          <div className="raw-clay-detail-body">
            <div className="pressing-actions">
              <OrderStatusPill order={detailOrder} />
              <span className="badge neutral">{orderPurposes[detailOrder.purpose]}</span>
              {detailOrder.requires_mesh && <span className="badge muted-badge">ต้องติดตาข่ายหลัง QC</span>}
            </div>
            <Facts
              values={{
                ...(detailOrder.product_name ? { "รายการสินค้า": `${detailOrder.product_code} · ${detailOrder.product_name}` } : {}),
                "ประเภทดิน / สีดิน": orderClayText(detailOrder, data.types),
                ...(orderGeometryText(detailOrder) ? { "รูปทรงและขนาด": orderGeometryText(detailOrder) } : {}),
                ...(detailOrder.color_name ? { "สีเคลือบ": detailOrder.color_name } : {}),
                "ยอดสั่งปั๊ม (แผ่น)": count(detailOrder.target_pieces),
                "ยอดปั๊มแล้ว (แผ่น)": count(detailOrder.pressed_pieces),
                "ยอดขาด (แผ่น)": count(detailOrder.short_pieces),
                "ยอดเกิน (แผ่น)": count(detailOrder.over_pieces),
                ...(detailOrder.customer_pieces != null ? {
                  "ยอดลูกค้าสั่ง (แผ่น)": count(detailOrder.customer_pieces),
                  [`ยอดเผื่อ ${detailOrder.allowance_percent}% (แผ่น)`]: count(detailOrder.allowance_pieces ?? 0),
                  "พื้นที่สั่งปั๊ม (ตร.ม.)": detailOrder.target_square_meters == null ? null : count(detailOrder.target_square_meters),
                } : {}),
                ...(detailOrder.product_id ? {
                  "การติดตาข่าย": detailOrder.requires_mesh ? "ต้องติดตาข่ายหลัง QC" : "ไม่ระบุตาข่าย",
                  "แผ่นต่อไม้ ณ เปิดใบ": detailOrder.production_pieces_per_rack == null ? null : count(detailOrder.production_pieces_per_rack),
                  "วันพัก ณ เปิดใบ": detailOrder.production_rest_days == null ? null : count(detailOrder.production_rest_days),
                  "แผ่นต่อ ตร.ม. ณ เปิดใบ": detailOrder.pieces_per_sqm == null ? null : count(detailOrder.pieces_per_sqm),
                  "ปลายทาง ณ เปิดใบ": detailOrder.production_destination ? destinations[detailOrder.production_destination] : null,
                } : {}),
              }}
            />
            {manage && orderReferences(detailOrder) && (
              <p className="helper">ลบไม่ได้ เพราะมี{orderReferences(detailOrder)}อ้างถึงใบนี้แล้ว</p>
            )}
            <div className="raw-clay-detail-actions">
              <div className="pressing-actions">
                {canQuickRecordOrder(detailOrder) && (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => {
                      const id = detailOrder.id;
                      setDetailId(null);
                      onQuickRecord!(id);
                    }}
                  >
                    ＋ บันทึกยอดใบสั่งนี้
                  </button>
                )}
                {manage && detailOrder.customer_pieces == null && (
                  <button
                    type="button"
                    className="button warning"
                    onClick={() => {
                      setDetailId(null);
                      setEditor({ kind: "target", order: detailOrder });
                    }}
                  >
                    แก้ยอดสั่งปั๊ม
                  </button>
                )}
                {prepare && detailOrder.purpose === "customer" && detailOrder.customer_pieces == null && (
                  <button
                    type="button"
                    className="button warning"
                    onClick={() => {
                      setDetailId(null);
                      setEditor({ kind: "prepare", order: detailOrder });
                    }}
                  >
                    เติมข้อมูลใบค้าง
                  </button>
                )}
              </div>
              {manage && !orderReferences(detailOrder) && (
                <button
                  type="button"
                  className="button danger-soft"
                  onClick={() => {
                    setDetailId(null);
                    setEditor({ kind: "delete", order: detailOrder });
                  }}
                >
                  ลบใบสั่งผลิต
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {editor?.kind === "order" && manage && <OrderForm types={activeTypes} colors={data.colors} catalog={data.catalog} {...dialog} />}
      {editor?.kind === "prepare" && prepare && <OrderForm types={data.types} colors={data.colors} legacy={editor.order} {...dialog} />}
      {editor?.kind === "target" && manage && (
        <FormDialog
          {...dialog}
          title="แก้ยอดสั่งปั๊ม"
          path={`/orders/${editor.order.id}`}
          method="PUT"
          submitLabel="บันทึกยอดสั่งปั๊ม"
          build={(form) => ({ target_pieces: formInteger(form, "target_pieces", "ยอดสั่งปั๊ม") })}
        >
          <p>{orderName(editor.order)}</p>
          <Field label="ยอดสั่งปั๊ม (แผ่น)" name="target_pieces" type="number" min={1} step={1} required defaultValue={editor.order.target_pieces} />
        </FormDialog>
      )}
      {displayedOrder && manage && (
        <FormDialog
          {...dialog}
          title="ลบใบสั่งผลิต"
          path={`/orders/${displayedOrder.id}`}
          method="DELETE"
          submitLabel="ยืนยันลบ"
          onSaved={() => actions.onSaved("ลบใบสั่งผลิตแล้ว")}
          onStale={actions.refresh}
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
  const [clayTypeId, setClayTypeId] = useState("");
  const [clayColorId, setClayColorId] = useState("");
  const [purpose, setPurpose] = useState<"customer" | "stock">(legacy?.purpose ?? "customer");
  const [stockKind, setStockKind] = useState("preform");
  const [customer, setCustomer] = useState(0);
  const [percent, setPercent] = useState(10);
  const product = catalog?.products.find((item) => item.id === Number(productId));
  const allProfiles: CatalogState["profiles"] = catalog?.profiles ?? types.map((item) => ({ ...item, body_id: item.body_id ?? null }));
  const bareStock = !legacy && purpose === "stock" && stockKind === "preform";
  const profiles = bareStock ? readyProductionProfiles(allProfiles) : product ? productProfiles(product, allProfiles) : [];
  const clayType = catalog?.clay_types?.find((c) => c.id === Number(clayTypeId));
  const legacyType = legacy ? types.find((tile) => tile.id === legacy.type_id) : undefined;
  const type = legacy
    ? legacyType && { ...legacyType, destination: legacy.production_destination ?? legacyType.destination, pieces_per_sqm: legacy.pieces_per_sqm ?? legacyType.pieces_per_sqm }
    : bareStock
      ? profiles.find((item) => item.id === Number(typeId))
      : profiles.find((item) => item.clay_type_id === Number(clayTypeId) && (item.clay_color_id ?? null) === (clayType?.code === "COLORED" ? Number(clayColorId) : null));
  const mesh = !bareStock && product?.mounting_type === "mesh";
  const products = catalog?.products.filter((item) => item.active && (purpose !== "stock" || item.mounting_type !== "mesh")) ?? [];
  const allowance = Math.ceil(customer * percent / 100);
  const totalTarget = customer + (purpose === "customer" ? allowance : 0);

  return (
    <FormDialog
      {...dialog}
      title={legacy ? "เติมข้อมูลใบสั่งผลิตค้าง" : "เพิ่มใบสั่งผลิต"}
      scope={legacy ? "finishing" : "pressing"}
      path={legacy ? "/prepare-order" : "/orders"}
      intent={legacy ? "warning" : "success"}
      size={legacy ? "md" : "lg"}
      keyField="request_id"
      submitLabel="บันทึกใบสั่งผลิต"
      submitDisabled={!legacy && (!type || (mesh && purpose !== "customer"))}
      build={(form) => ({
        ...(legacy ? { order_id: legacy.id } : {
          ...catalogOrderSelection(
            catalog?.products ?? [],
            allProfiles,
            bareStock ? null : formInteger(form, "product_id", "รายการสินค้า"),
            formInteger(form, "type_id", "ประเภทดินและสีที่ผสม"),
            purpose,
          ),
          purpose,
          expected_clay_type_id: ("clay_type_id" in (type ?? {})) ? (type as CatalogState["profiles"][number]).clay_type_id : undefined,
          expected_clay_color_id: ("clay_color_id" in (type ?? {})) ? (type as CatalogState["profiles"][number]).clay_color_id : undefined,
          customer_reference: formText(form, "customer_reference"),
        }),
        ...(purpose === "customer"
          ? { customer_pieces: formInteger(form, "customer_pieces", "ยอดลูกค้าสั่ง"), allowance_percent: formInteger(form, "allowance_percent", "เปอร์เซ็นต์เผื่อ") }
          : { target_pieces: formInteger(form, "target_pieces", "ยอดสั่งเก็บสต็อก") }),
        color_id: type?.destination === "color" && (!bareStock || formText(form, "color_id")) ? formInteger(form, "color_id", "สีเคลือบ") : null,
      })}
    >
      {legacy ? (
        <section className="form-section">
          <span className="form-section-title">ข้อมูลใบสั่งผลิตค้าง</span>
          <p>{orderName(legacy)} · {tileName(types, legacy.type_id)}</p>
        </section>
      ) : (
        <section className="form-section">
          <span className="form-section-title">1. ที่มาและรายการสินค้า / ประเภทดิน</span>
          <div className="form-grid">
            <Choice
              label="ที่มาของใบสั่งผลิต"
              name="purpose"
              value={purpose}
              onChange={(value) => {
                setPurpose(value as "customer" | "stock");
                setTypeId("");
                if (value === "stock") setStockKind("preform");
              }}
              options={[{ value: "customer", label: "ตามออเดอร์ลูกค้า" }, { value: "stock", label: "ผลิตเก็บสต็อก" }]}
            />
            {purpose === "stock" && (
              <Choice
                label="งานที่สั่งเก็บสต็อก"
                name="stock_kind"
                value={stockKind}
                onChange={(value) => {
                  setStockKind(value);
                  setTypeId("");
                  setProductId("");
                }}
                options={[
                  { value: "preform", label: "ดินพื้นตามประเภทผลิต ไม่ระบุสินค้า" },
                  { value: "product", label: "สินค้ารุ่นไม่ติดตาข่าย" },
                ]}
              />
            )}
            {!bareStock && (
              <ProductPicker
                value={productId}
                onChange={(value) => {
                  setProductId(value);
                  setTypeId("");
                  setClayTypeId("");
                  setClayColorId("");
                  if (catalog?.products.find((item) => item.id === Number(value))?.mounting_type === "mesh") setPurpose("customer");
                }}
                options={products.map((item) => ({
                  value: item.id,
                  label: `${productLabel(item)}${productProfiles(item, catalog?.profiles ?? []).length ? "" : " · รอตั้งค่าผลิต"}`,
                }))}
              />
            )}
            {bareStock ? (
              <Choice
                label="ประเภทดิน / สีที่ผสม"
                name="type_id"
                value={typeId}
                onChange={setTypeId}
                options={profiles.map((item) => ({
                  value: item.id,
                  label: `${tileName(profiles, item.id)} · #${item.id}${item.body_id === null ? " · ประเภทเดิมยังไม่จับคู่" : ""}`,
                }))}
              />
            ) : (
              <>
                <Choice
                  label="ประเภทดิน"
                  name="clay_type_id"
                  value={clayTypeId}
                  onChange={(value) => {
                    setClayTypeId(value);
                    setClayColorId("");
                  }}
                  options={(catalog?.clay_types ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))}
                />
                {clayType?.code === "COLORED" && (
                  <Choice
                    label="สีดินที่ผสมในเนื้อดิน"
                    name="clay_color_id"
                    value={clayColorId}
                    onChange={setClayColorId}
                    options={(catalog?.clay_colors ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
                  />
                )}
                <input type="hidden" name="type_id" value={type?.id ?? ""} />
              </>
            )}
          </div>
          {clayType?.code === "COLORED" && !catalog?.clay_colors?.some((c) => c.active) && (
            <p className="helper">ยังไม่มีสีดินให้เลือก เพิ่มเมื่อข้อมูลพร้อมได้ที่ทะเบียนประเภทดิน</p>
          )}
          {!bareStock && clayType && !type && <p className="helper">รอตั้งค่าผลิตของสินค้าและดินที่เลือก</p>}
          {bareStock && (
            <p className="helper">สั่งปั๊มดินพื้นเก็บตามประเภทผลิตและสีที่ผสม ใช้ประเภทเดิมที่ยังไม่จับคู่สินค้าได้ เมื่อนำไปทำสีหรือลาย ให้กันและเบิกดินไปยังใบสั่งสินค้าปลายทางที่ระบุงานจริงก่อน ใบเก็บดินพื้นนี้ไม่เป็นงานติดตาข่าย</p>
          )}
          {!bareStock && product && !profiles.length && (
            <p className="helper">สินค้านี้ยังไม่มีค่าผลิตครบ กรุณาตั้งค่าที่ทะเบียนกระเบื้องก่อนเปิดใบสั่ง</p>
          )}
          {!bareStock && product && (
            <p className="helper">{mesh ? "รุ่นติดตาข่าย ต้องมีออเดอร์ลูกค้า นับกระเบื้องย่อยเป็นแผ่น และพร้อมส่งหลังยืนยันติดตาข่ายเสร็จ" : "รุ่นนี้ไม่ระบุตาข่าย"}</p>
          )}
        </section>
      )}

      <section className="form-section">
        <span className="form-section-title">{legacy ? "สีเคลือบและจำนวนสั่ง" : "2. เลขอ้างอิง สีเคลือบ และจำนวนสั่ง"}</span>
        <div className="form-grid">
          {!legacy && (
            <Field
              label={purpose === "customer" ? "เลขอ้างอิงออเดอร์" : "เลขอ้างอิงงานสั่งเก็บสต็อก"}
              name="customer_reference"
              required={purpose === "customer"}
            />
          )}
          {type?.destination === "color" && (
            <Choice
              label="สีเคลือบ"
              name="color_id"
              empty={bareStock ? "ยังไม่ระบุสีเคลือบ" : undefined}
              options={colors.map((color) => ({ value: color.id, label: color.name }))}
            />
          )}
          <Field
            label={purpose === "customer" ? "ยอดลูกค้าสั่ง (แผ่น)" : "ยอดสั่งเก็บสต็อก (แผ่น)"}
            name={purpose === "customer" ? "customer_pieces" : "target_pieces"}
            type="number"
            min={1}
            step={1}
            onChange={(event) => setCustomer(Number(event.target.value))}
            required
          />
          {purpose === "customer" && (
            <Field
              label="เปอร์เซ็นต์เผื่อ"
              name="allowance_percent"
              type="number"
              min={5}
              max={20}
              step={1}
              defaultValue={10}
              onChange={(event) => setPercent(Number(event.target.value))}
              required
            />
          )}
        </div>
      </section>

      <section className="form-section">
        <span className="form-section-title">{legacy ? "สรุปยอดสั่งปั๊ม" : "3. สรุปค่ามาตรฐานและยอดสั่งปั๊ม"}</span>
        {type && !legacy && (
          <Facts
            values={{
              "แผ่นต่อไม้": count(type.pieces_per_rack),
              "วันพัก": count(type.rest_days),
              "แผ่นต่อ ตร.ม.": type.pieces_per_sqm == null ? null : count(type.pieces_per_sqm),
              "ปลายทาง": destinations[type.destination],
            }}
          />
        )}
        <Facts
          values={{
            ...(purpose === "customer" ? { "ยอดเผื่อ (แผ่น)": count(allowance) } : {}),
            "ยอดสั่งปั๊ม (แผ่น)": count(totalTarget),
            "พื้นที่สั่งปั๊ม (ตร.ม.)": type?.pieces_per_sqm ? count(totalTarget / type.pieces_per_sqm) : null,
          }}
        />
      </section>
    </FormDialog>
  );
}
