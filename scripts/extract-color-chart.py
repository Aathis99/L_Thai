"""Prepare the approved color chart from an XLSX without changing the workbook."""

import argparse
import hashlib
import json
import sys
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException


SHEET = "Sheet1"


def cell_text(value, address):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{SHEET}!{address} must contain text")
    return value.strip()


def extract(source):
    workbook = load_workbook(BytesIO(source), read_only=True, data_only=True)
    try:
        if SHEET not in workbook.sheetnames:
            raise ValueError(f"Missing worksheet {SHEET}")
        sheet = workbook[SHEET]
        items = []
        rows = sheet.iter_rows(min_row=3, max_row=92, min_col=1, max_col=2, values_only=True)
        for order, (serial, name) in enumerate(rows, start=1):
            if not (
                (type(serial) in (int, float) and serial == order)
                or (isinstance(serial, str) and serial.strip() == str(order))
            ):
                raise ValueError(f"{SHEET}!A{order + 2} must contain order {order}")
            items.append({
                "display_order": order,
                "name": cell_text(name, f"B{order + 2}"),
                "note": None,
            })
        if len(items) != 90:
            raise ValueError(f"{SHEET}!A3:B92 must contain 90 items")

        for address, recipients in (
            ("B95", ((83, "ขาวฟ้า"),)),
            ("B96", ((79, "เขียวศิลาดล"), (80, "ศิลาดล"))),
        ):
            note = cell_text(sheet[address].value, address)
            for order, expected in recipients:
                item = items[order - 1]
                if item["name"].partition("(")[0].rstrip() != expected:
                    raise ValueError(f"{SHEET}!B{order + 2} must identify {expected} before applying {address}")
                item["note"] = note
        return {"sourceSha256": hashlib.sha256(source).hexdigest(), "sheet": SHEET, "items": items}
    finally:
        workbook.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    destination = parser.add_mutually_exclusive_group(required=True)
    destination.add_argument("prepared_json", type=Path, nargs="?")
    destination.add_argument("--stdout", action="store_true")
    args = parser.parse_args()
    try:
        output = args.prepared_json
        if output is not None and (
            output.resolve() == args.workbook.resolve()
            or (output.exists() and output.samefile(args.workbook))
        ):
            raise ValueError("Prepared JSON must be written to a separate file")
        payload = extract(args.workbook.read_bytes())
        data = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        if args.stdout:
            sys.stdout.buffer.write(data.encode("utf-8"))
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(data, encoding="utf-8")
    except (OSError, ValueError, BadZipFile, InvalidFileException) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
