"""Read the source workbook without changing it and stage only employee names/phones."""
import argparse
import hashlib
import json
from pathlib import Path

try:
    import xlrd
except ImportError:
    raise SystemExit("Install the import dependency: python -m pip install -r requirements-import.txt")

SHEET = "พนักงาน ปี2569"


def extract(source: Path) -> dict:
    # Hash and parse exactly the same read-only bytes.
    raw = source.read_bytes()
    book = xlrd.open_workbook(file_contents=raw, on_demand=True)
    try:
        sheet = book.sheet_by_name(SHEET)
        if sheet.nrows != 38 or sheet.ncols != 13:
            raise ValueError("Unexpected worksheet dimensions")
        headers = {0: "ลำดับ", 1: "คำนำหน้า", 2: "ชื่อ", 3: "นามสุกล", 10: "เบอร์โทรติดต่อ"}
        if any(str(sheet.cell_value(0, column)).strip() != expected for column, expected in headers.items()):
            raise ValueError("Unexpected employee worksheet headers")
        if any(str(sheet.cell_value(1, column)).strip() for column in (0, 1, 2, 3, 10)):
            raise ValueError("Expected an empty second row")
        employees = []
        serials = set()
        names = set()
        for row_index in range(2, 38):
            serial = sheet.cell_value(row_index, 0)
            if not isinstance(serial, (int, float)) or int(serial) != serial or int(serial) != row_index - 1 or int(serial) in serials:
                raise ValueError(f"Invalid or duplicate serial on row {row_index + 1}")
            serial = int(serial)
            parts = []
            for column in (1, 2, 3):
                cell = sheet.cell(row_index, column)
                if cell.ctype not in (xlrd.XL_CELL_TEXT, xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                    raise ValueError(f"Expected text name component on row {row_index + 1}")
                parts.append(str(cell.value).strip())
            title, given, surname = parts
            if not given:
                raise ValueError(f"Missing given name on row {row_index + 1}")
            name = title + given + (" " + surname if surname else "")
            phone_cell = sheet.cell(row_index, 10)
            if phone_cell.ctype != xlrd.XL_CELL_TEXT:
                raise ValueError(f"Phone must be text to preserve leading zeros on row {row_index + 1}")
            phone = phone_cell.value.strip()
            if len(phone) != 11 or any(character not in "0123456789-" for character in phone):
                raise ValueError(f"Unexpected phone format on row {row_index + 1}")
            if name.casefold() in names:
                raise ValueError(f"Duplicate employee name on row {row_index + 1}")
            serials.add(serial)
            names.add(name.casefold())
            employees.append({"serial": serial, "code": f"EMP69-{serial:03}", "name": name, "phone": phone})
        return {"sourceSha256": hashlib.sha256(raw).hexdigest(), "sheet": SHEET, "employees": employees}
    finally:
        book.release_resources()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        raise ValueError("Output must differ from the read-only workbook")
    payload = extract(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"employees": len(payload["employees"]), "distinctSerials": len({row["serial"] for row in payload["employees"]}), "distinctNames": len({row["name"] for row in payload["employees"]})}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, xlrd.XLRDError):
        # Errors identify structure/row only; never print source cell values.
        raise SystemExit("Employee extraction validation failed; source workbook was not modified")
