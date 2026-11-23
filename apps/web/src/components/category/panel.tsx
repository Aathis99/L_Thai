"use client";

import { useState } from "react";
import { visibleCategoryTabs, type CategoryTab } from "../../lib/category";
import type { CatalogState } from "../../lib/tile-catalog";
import type { Api, SessionUser } from "../../lib/types";
import ColorChartPanel from "../color-chart/panel";
import Catalog from "../pressing/catalog";
import Clays from './clays';
import type {ClayRegistryState} from '../../lib/clay-registry';
import { CategoryRecords, type CategoryRecordsProps } from "./records";
import TemperatureRanges, { loadRanges } from "./ranges";

async function loadTiles(api: Api) {
  return api<CatalogState>("/catalog/state");
}
async function loadClays(api:Api){return api<ClayRegistryState>('/catalog/clays');}

function TileCatalog({ data, api, user, onSaved }: CategoryRecordsProps<CatalogState>) {
  return <Catalog data={data} actions={{ api, onSaved, can: permission => user.permissions.includes(permission) }} />;
}

export default function CategoryPanel({ api, user }: { api: Api; user: SessionUser }) {
  const tabs = visibleCategoryTabs(user.permissions);
  const [selected, setSelected] = useState<CategoryTab>();
  const current = tabs.find(tab => tab.id === selected) ?? tabs[0];
  if (!current) return null;

  return (
    <div className="pressing-panel">
      <div className="pressing-navigation">
        <nav aria-label="เมนูหมวดหมู่">
          {tabs.map(tab => (
            <button key={tab.id} className={`button ${current.id === tab.id ? "tab-selected" : "secondary"}`}
              aria-pressed={current.id === tab.id} onClick={() => setSelected(tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      {current.id === "tiles" &&
        <CategoryRecords key="tiles" api={api} user={user} load={loadTiles} Component={TileCatalog} />}
      {current.id === "color-chart" && <ColorChartPanel api={api} user={user} />}
      {current.id === "clays" && <CategoryRecords key="clays" api={api} user={user} load={loadClays} Component={Clays}/>}
      {current.id === "ranges" &&
        <CategoryRecords key="ranges" api={api} user={user} load={loadRanges} Component={TemperatureRanges} />}
    </div>
  );
}
