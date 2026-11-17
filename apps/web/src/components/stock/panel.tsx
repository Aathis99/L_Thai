"use client";

import { useState } from "react";
import { visibleStockTabs, type StockTab } from "../../lib/stock";
import type { Api, SessionUser } from "../../lib/types";
import PressingPanel from "../pressing/panel";
import FinishedStock from "./finished";

export default function StockPanel({ api, user, initialTab }: {
  api: Api; user: SessionUser; initialTab?: StockTab;
}) {
  const [selected, setSelected] = useState(initialTab);
  const tabs = visibleStockTabs(user.permissions);
  const active = tabs.find(tab => tab.id === selected) ?? tabs[0];
  if (!active) return null;

  return <div className="pressing-panel">
    <div className="pressing-navigation">
      <nav aria-label="เมนูสต็อก">
        {tabs.map(tab => <button key={tab.id}
          className={`button ${tab.id === active.id ? "primary" : "secondary"}`}
          aria-pressed={tab.id === active.id} onClick={() => setSelected(tab.id)}>{tab.label}</button>)}
      </nav>
    </div>
    {active.id === "pressed" ? <PressingPanel api={api} user={user} stockOnly /> :
      <FinishedStock api={api} canManage={user.permissions.includes("finishing.stock")} />}
  </div>;
}
