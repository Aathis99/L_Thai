import { useEffect, useId, useRef, useState } from "react";

export default function ProductPicker({ value, options, onChange }: {
  value: string;
  options: { value: number; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const query = search.trim().toLocaleLowerCase("th");
  const matches = options.filter(option => option.label.toLocaleLowerCase("th").includes(query));
  const selected = options.find(option => String(option.value) === value);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(next: number) {
    onChange(String(next));
    close();
  }

  return (
    <div className="field pressing-product-picker" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={event => {
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }}>
      <span id={`${id}-label`}>รายการสินค้าและรุ่น</span>
      <input type="hidden" name="product_id" value={value} />
      <button ref={trigger} type="button" className="product-picker-trigger"
        aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open}
        aria-controls={`${id}-popup`} onClick={() => {
          setSearch(""); setActive(0); setOpen(!open);
        }}>
        <span id={`${id}-value`}>{selected?.label ?? "กรุณาเลือกสินค้า"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && <div id={`${id}-popup`} className="product-picker-popup">
        <input ref={input} type="search" placeholder="พิมพ์รหัส ชื่อ หรือขนาดกระเบื้อง"
          aria-label="ค้นหารายการสินค้าและรุ่น" role="combobox" aria-expanded="true"
          aria-autocomplete="list" aria-controls={`${id}-list`}
          aria-activedescendant={matches[active] ? `${id}-option-${matches[active].value}` : undefined}
          autoComplete="off" value={search} onChange={event => { setSearch(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next = Math.max(0, Math.min(matches.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
              setActive(next);
              document.getElementById(`${id}-option-${matches[next]?.value}`)?.scrollIntoView({ block: "nearest" });
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (matches[active]) choose(matches[active].value);
            }
          }} />
        <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="product-picker-options">
          {matches.map((option, index) => <button type="button" role="option"
            id={`${id}-option-${option.value}`} key={option.value} tabIndex={-1}
            aria-selected={String(option.value) === value}
            className={index === active ? "is-active" : undefined}
            onMouseEnter={() => setActive(index)} onClick={() => choose(option.value)}>{option.label}</button>)}
        </div>
        {!matches.length && <p className="helper" role="status">ไม่พบสินค้าที่ค้นหา</p>}
      </div>}
    </div>
  );
}
