"use client";

import { useEffect, useState } from "react";

const storageKey = "lthai-display-mode";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    function sync(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      const next = event.newValue === "dark";
      document.documentElement.dataset.theme = next ? "dark" : "light";
      setDark(next);
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(next === "dark");
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // The current page can still switch when browser storage is unavailable.
    }
  }

  const label = dark ? "โหมดมืด · เปลี่ยนเป็นโหมดสว่าง" : "โหมดสว่าง · เปลี่ยนเป็นโหมดมืด";
  return (
    <button type="button" className="theme-toggle" aria-label={label} title={label} aria-pressed={dark} onClick={toggle}>
      <svg className="theme-sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </svg>
      <svg className="theme-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
      </svg>
    </button>
  );
}
