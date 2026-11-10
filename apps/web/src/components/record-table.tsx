"use client";

import type { ReactNode } from "react";
import { Badge } from "./fields";
import { matchesEmployeeFilter } from "../lib/model";
import {
  labels,
  symbols,
  type EditableRecord,
  type Records,
  type SessionUser,
  type View,
} from "../lib/types";

export default function RecordTable({
  view,
  records,
  user,
  permissions,
  query,
  filter,
  onEdit,
  onDelete,
  onCreate,
}: {
  view: View;
  records: Records;
  user: SessionUser;
  permissions: Record<string, string>;
  query: string;
  filter: string;
  onEdit: (item: EditableRecord) => void;
  onDelete: (item: EditableRecord) => void;
  onCreate: () => void;
}) {
  const match = (item: object) =>
    Object.values(item).some((value) =>
      String(value ?? "")
        .toLocaleLowerCase("th")
        .includes(query.toLocaleLowerCase("th")),
    );
  const can = (permission: string) => user.permissions.includes(permission);
  const editable =
    view === "employees" ? can("employees.update") : can(`${view}.manage`);
  const removable =
    view === "employees" ? can("employees.delete") : can(`${view}.manage`);
  const actions = (item: EditableRecord) => {
    if (
      ("archived" in item && item.archived) ||
      (view === "roles" && item.id === 1)
    )
      return <span className="text-factory-muted">—</span>;
    return (
      <div className="flex gap-[9px] whitespace-nowrap">
        {editable && (
          <button className="table-button" onClick={() => onEdit(item)}>
            แก้ไข<span className="sr-only"> {item.name}</span>
          </button>
        )}
        {removable && (
          <button
            className="table-button danger"
            onClick={() => onDelete(item)}
          >
            ลบ<span className="sr-only"> {item.name}</span>
          </button>
        )}
      </div>
    );
  };
  let headers: string[];
  let rows: { id: number; cells: ReactNode[] }[];
  if (view === "employees") {
    headers = [
      "รหัสพนักงาน",
      "ชื่อพนักงาน",
      "แผนก / ตำแหน่ง",
      "เบอร์โทร",
      "เลขประกันสังคม",
      "เลขประจำตัวประชาชนผู้เสียภาษีอากร",
      "สถานะ",
      "จัดการ",
    ];
    rows = records.employees
      .filter(match)
      .filter((item) => matchesEmployeeFilter(item, filter))
      .map((item) => ({
        id: item.id,
        cells: [
          <span className="code" key="code">
            {item.code}
          </span>,
          <div className="person" key="name">
            <span className="avatar small" aria-hidden="true">
              {item.name.slice(0, 1)}
            </span>
            <strong>{item.name}</strong>
          </div>,
          <span key="position">
            {item.department || "ยังไม่ระบุแผนก"}
            <small className="subtext">
              {item.position_name || "ยังไม่ระบุตำแหน่ง"}
            </small>
          </span>,
          item.phone || "—",
          item.social_security_number || "—",
          item.taxpayer_id || "—",
          <Badge active={item.active} archived={item.archived} key="status" />,
          actions(item),
        ],
      }));
  } else if (view === "positions") {
    headers = ["ชื่อตำแหน่ง", "จัดการ"];
    rows = records.positions
      .filter(match)
      .map((item) => ({
        id: item.id,
        cells: [<strong key="name">{item.name}</strong>, actions(item)],
      }));
  } else if (view === "users") {
    headers = [
      "ชื่อผู้ใช้",
      "ชื่อที่แสดง",
      "บทบาท",
      "พนักงานที่เชื่อมโยง",
      "สถานะ",
      "จัดการ",
    ];
    rows = records.users.filter(match).map((item) => ({
      id: item.id,
      cells: [
        <span key="username">
          <span className="code">{item.username}</span>
          {item.id === user.id && <small className="you">คุณ</small>}
        </span>,
        item.name,
        item.role_name,
        item.employee_id
          ? records.employees.find(
              (employee) => employee.id === item.employee_id,
            )?.name || `พนักงาน #${item.employee_id}`
          : "ไม่เชื่อมโยง",
        <Badge active={item.active} key="status" />,
        actions(item),
      ],
    }));
  } else if (view === "roles") {
    headers = ["ชื่อบทบาท", "สิทธิ์ที่ได้รับ", "จัดการ"];
    rows = records.roles.filter(match).map((item) => ({
      id: item.id,
      cells: [
        <span key="name">
          <strong>{item.name}</strong>
          {item.id === 1 && <small className="subtext">บทบาทสงวนของระบบ</small>}
        </span>,
        <div className="permission-tags" key="permissions">
          {item.permissions.length ? (
            item.permissions.map((permission) => (
              <span key={permission}>
                {permissions[permission] || permission}
              </span>
            ))
          ) : (
            <span>ยังไม่มีสิทธิ์</span>
          )}
        </div>,
        actions(item),
      ],
    }));
  } else {
    headers = ["วัน / เวลา", "ผู้ทำรายการ", "การเปลี่ยนแปลง", "รหัสรายการ"];
    rows = records.audit.filter(match).map((item) => ({
      id: item.id,
      cells: [
        new Date(item.created_at).toLocaleString("th-TH"),
        item.actor,
        item.action,
        <span className="code" key="target">
          {item.target}
        </span>,
      ],
    }));
  }
  const filtered = query || (view === "employees" && filter !== "current");
  const creatable =
    view !== "audit" &&
    (view === "employees" ? can("employees.create") : can(`${view}.manage`));
  return (
    <>
      <p className="result-summary" aria-live="polite">
        พบ {rows.length.toLocaleString("th-TH")} รายการ
      </p>
      {rows.length ? (
        <div className="w-full overflow-auto">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th scope="col" key={header}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) => (
                    <td key={index}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <span className="empty-symbol" aria-hidden="true">
            {symbols[view]}
          </span>
          <h3>
            {filtered ? "ไม่พบรายการที่ค้นหา" : `ยังไม่มี${labels[view]}`}
          </h3>
          <p>
            {filtered
              ? "ลองเปลี่ยนคำค้นหาหรือเงื่อนไขการกรอง"
              : view === "employees"
                ? "เริ่มเพิ่มทะเบียนพนักงาน หรือใช้ข้อมูลที่นำเข้าจากไฟล์ของโรงงาน"
                : view === "positions"
                  ? "เพิ่มตำแหน่ง เช่น ธุรการ หรือพนักงานปั๊มขึ้นรูป เพื่อใช้ในทะเบียนพนักงาน"
                  : "รายการจะปรากฏที่นี่เมื่อเริ่มใช้งาน"}
          </p>
          {!filtered && creatable && (
            <button className="button secondary" onClick={onCreate}>
              ＋ เพิ่ม{view === "roles" ? "บทบาท" : labels[view]}
            </button>
          )}
        </div>
      )}
    </>
  );
}
