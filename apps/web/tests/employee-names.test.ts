import assert from "node:assert/strict";
import { test } from "node:test";
import { editorPayload } from "../src/lib/model.ts";

function employeeForm() {
  return new FormData();
}

test("employee payload keeps multiword names together and normalizes whitespace", () => {
  const form = employeeForm();
  form.set("prefix_selection", "นาย");
  form.set("first_name", "  Jean   Pierre  ");
  form.set("last_name", "  de la   Cruz ");
  assert.deepEqual(editorPayload("employees", form, false), {
    prefix: "นาย", first_name: "Jean Pierre", last_name: "de la Cruz", active: false,
  });
});

test("employee payload sends custom prefix text and discards form-only fields", () => {
  const form = employeeForm();
  form.set("prefix_selection", "__custom__");
  form.set("prefix_custom", "  Dr.   Prof. ");
  form.set("first_name", "Maria Ana");
  form.set("last_name", "");
  assert.deepEqual(editorPayload("employees", form, true), {
    prefix: "Dr. Prof.", first_name: "Maria Ana", last_name: "", active: false,
  });
});

test("choosing Other requires custom prefix text before creating or editing an employee", () => {
  for (const editing of [false, true]) {
    for (const prefix of ["", " \t \n "]) {
      const form = employeeForm();
      form.set("prefix_selection", "__custom__");
      form.set("prefix_custom", prefix);
      form.set("first_name", "สมใจ");
      assert.throws(() => editorPayload("employees", form, editing), /กรุณาระบุคำนำหน้าอื่น ๆ/);
    }
  }
});

test("switching to a standard or blank prefix never submits stale custom text", () => {
  const form = employeeForm();
  form.set("prefix_custom", "Dr.");
  form.set("first_name", "สมใจ");
  form.set("last_name", "");
  for (const prefix of ["นาย", "นาง", "นางสาว", ""]) {
    form.set("prefix_selection", prefix);
    assert.deepEqual(editorPayload("employees", form, true), {
      prefix, first_name: "สมใจ", last_name: "", active: false,
    });
  }
});

test("employee payload rejects whitespace-only first name and overlong parts", () => {
  const form = employeeForm();
  form.set("prefix_selection", "");
  form.set("first_name", " \t ");
  form.set("last_name", "");
  assert.throws(() => editorPayload("employees", form, false), /ชื่อ/);
  form.set("first_name", "ก".repeat(120));
  form.set("last_name", "ข".repeat(120));
  form.set("prefix_selection", "__custom__");
  form.set("prefix_custom", "ค".repeat(40));
  assert.equal(editorPayload("employees", form, false).prefix, "ค".repeat(40));
  for (const [key, length] of [["prefix_custom", 41], ["first_name", 121], ["last_name", 121]] as const) {
    const value = form.get(key)!;
    form.set(key, "ก".repeat(length));
    assert.throws(() => editorPayload("employees", form, false), /คำนำหน้า|ชื่อ|นามสกุล/);
    form.set(key, value);
  }
});

test("formatting and employee search use the complete structured name", async () => {
  const names = await import("../src/lib/employee-names.ts");
  const employee = {
    prefix: "  Dr. ", first_name: " Jean   Pierre ", last_name: " de la  Cruz ",
    code: "E007", department: "ปั๊ม",
  };
  assert.equal(names.formatEmployeeName(employee), "Dr. Jean Pierre de la Cruz");
  assert.equal(names.formatEmployeeName({ prefix: "", first_name: "สมใจ", last_name: "" }), "สมใจ");
  for (const query of ["Dr. Jean Pierre de la Cruz", "Pierre de la", "DE LA CRUZ", " E007 ", "ปั๊ม"]) {
    assert.equal(names.matchesEmployeeSearch(employee, query), true, query);
  }
  assert.equal(names.matchesEmployeeSearch(employee, "Jane"), false);
});

test("editing a custom prefix selects Other while standard and blank values remain selected", async () => {
  const names = await import("../src/lib/employee-names.ts");
  assert.equal(names.employeePrefixSelection("Dr."), "__custom__");
  for (const prefix of ["", "นาย", "นาง", "นางสาว"]) {
    assert.equal(names.employeePrefixSelection(prefix), prefix);
  }
});
