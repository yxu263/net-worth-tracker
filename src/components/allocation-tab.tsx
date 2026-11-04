"use client";

import { useMemo, useState } from "react";
import { allocationItems, allocationSlices, type AllocationItem } from "@/lib/allocation";
import { assetClasses, type AssetClass, type TrackerData } from "@/lib/types";
import { money } from "@/lib/values";

const percent = (share: number) => `${(share * 100).toFixed(share > 0 && share < 0.01 ? 1 : 0)}%`;

/**
 * Overall asset allocation. Each ticker (across all accounts) and each account's own
 * balance takes one class; cash/savings default to Cash and property to Real estate.
 */
export default function AllocationTab({ data, setClass }: { data: TrackerData; setClass: (item: AllocationItem, assetClass: AssetClass | undefined) => void }) {
  const [includeProperty, setIncludeProperty] = useState(true);
  const items = useMemo(() => allocationItems(data, includeProperty), [data, includeProperty]);
  const slices = useMemo(() => allocationSlices(items), [items]);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const unassigned = items.filter(item => !item.assetClass && !item.inferred);

  return <div className="space-y-5">
    <section className="card p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">Asset allocation</h2><p className="text-sm text-[#718096]">{money(total)} of assets{includeProperty ? "" : " excluding property"}. Debts are not subtracted.</p></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeProperty} onChange={event => setIncludeProperty(event.target.checked)} />Include property</label>
      </div>
      {total > 0 ? <>
        <div className="flex h-5 overflow-hidden rounded-full bg-[#f0f2f4]" role="img" aria-label={slices.map(slice => `${slice.label} ${percent(slice.share)}`).join(", ")}>
          {slices.map(slice => <div key={slice.key} title={`${slice.label}: ${money(slice.value)} (${percent(slice.share)})`} style={{ width: `${slice.share * 100}%`, background: slice.color }} />)}
        </div>
        <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {slices.map(slice => <div key={slice.key} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ background: slice.color }} />{slice.label}</span><span className="tabular-nums"><strong>{percent(slice.share)}</strong><span className="ml-2 text-[#718096]">{money(slice.value)}</span></span></div>)}
        </div>
      </> : <p className="text-sm text-[#718096]">Add accounts or holdings to see your allocation.</p>}
      {unassigned.length > 0 && <p className="mt-4 rounded-lg bg-[#fdf6e7] p-3 text-sm text-[#8a6417]">{unassigned.length} item{unassigned.length === 1 ? " is" : "s are"} unassigned ({money(unassigned.reduce((sum, item) => sum + item.value, 0))}). Choose a class below.</p>}
    </section>

    <section className="card p-6">
      <h2 className="font-semibold">Classify</h2>
      <p className="mb-3 text-sm text-[#718096]">A ticker&apos;s class applies in every account that holds it. An account row covers its own balance: the cash in a brokerage account, or the whole value of an imported total such as a 401(k).</p>
      <div className="divide-y divide-[#eef1f4]">
        {items.map(item => {
          const chosen = item.assetClass ?? "";
          return <div key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-0"><p className="font-medium">{item.label}</p><p className="text-xs text-[#718096]">{item.kind === "ticker" ? "Holding" : "Account"} · {item.detail} · {money(item.value)}{total > 0 ? ` · ${percent(item.value / total)}` : ""}</p></div>
            <select aria-label={`Asset class for ${item.label}`} value={chosen} onChange={event => setClass(item, (event.target.value || undefined) as AssetClass | undefined)} className={`rounded-lg border px-2 py-1.5 ${!item.assetClass && !item.inferred ? "border-[#e8c98f] bg-[#fdf6e7]" : "border-[#dfe5e9]"}`}>
              <option value="">{item.inferred ? `Automatic (${assetClasses.find(entry => entry.value === item.inferred)?.label})` : "Unassigned"}</option>
              {assetClasses.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </div>;
        })}
        {!items.length && <p className="py-3 text-sm text-[#718096]">Nothing to classify yet.</p>}
      </div>
    </section>
  </div>;
}
