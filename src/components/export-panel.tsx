"use client";

import { useMemo, useState } from "react";
import { downloadFile, historyCsv, historySeries, type HistoryLayout } from "@/lib/export";
import type { TrackerData } from "@/lib/types";
import { todayIso } from "@/lib/date";

const kindLabel = { account: "Account", liability: "Debt", other: "Removed / unmatched" } as const;

export default function ExportPanel({ data, exportPositions, exportBackup, notify }: { data: TrackerData; exportPositions: () => void; exportBackup: () => void; notify: (message: string) => void }) {
  const series = useMemo(() => historySeries(data), [data]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(series.filter(item => item.kind !== "other").map(item => item.id)));
  const [layout, setLayout] = useState<HistoryLayout>("wide");
  const [fillDaily, setFillDaily] = useState(true);
  const [includeTotal, setIncludeTotal] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const toggle = (itemId: string) => setPicked(current => { const next = new Set(current); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next; });
  function exportHistory() {
    if (!picked.size) { notify("Select at least one account"); return; }
    const { csv, rows } = historyCsv(data, { ids: [...picked], layout, fillDaily, includeTotal, from: from || undefined, to: to || undefined });
    downloadFile(`net-worth-history-${layout}-${todayIso()}.csv`, csv, "text/csv");
    notify(`Exported ${rows.toLocaleString()} row${rows === 1 ? "" : "s"} for ${picked.size} account${picked.size === 1 ? "" : "s"}`);
  }

  return <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1 text-sm">
    <section>
      <h3 className="mb-1 font-semibold">Daily balance history (CSV)</h3>
      <p className="mb-3 text-xs text-[#718096]">For spreadsheets and other apps. Debts are exported as negative balances.</p>
      <div className="mb-2 flex gap-3 text-xs"><button type="button" className="text-[#3b7fbd]" onClick={() => setPicked(new Set(series.map(item => item.id)))}>Select all</button><button type="button" className="text-[#3b7fbd]" onClick={() => setPicked(new Set())}>Select none</button></div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-[#e7ebef] p-2">
        {!series.length && <p className="p-2 text-xs text-[#718096]">No dated history yet.</p>}
        {series.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[#f7f8fa]"><input type="checkbox" checked={picked.has(item.id)} onChange={() => toggle(item.id)} /><span className="flex-1">{item.name}</span><span className="text-[11px] text-[#a0aab5]">{kindLabel[item.kind]} · {item.first} → {item.last}</span></label>)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1 block text-xs text-[#718096]">Layout</span><select value={layout} onChange={event => setLayout(event.target.value as HistoryLayout)} className="w-full rounded-lg border border-[#dfe5e9] px-2 py-1.5"><option value="wide">One column per account</option><option value="long">Date,Balance,Account rows (re-importable)</option></select></label>
        <div className="space-y-1 pt-5 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={fillDaily} onChange={event => setFillDaily(event.target.checked)} />Every calendar day (carry balances forward)</label>
          {layout === "wide" && <label className="flex items-center gap-2"><input type="checkbox" checked={includeTotal} onChange={event => setIncludeTotal(event.target.checked)} />Total column</label>}
        </div>
        <label className="block"><span className="mb-1 block text-xs text-[#718096]">From (optional)</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} className="w-full rounded-lg border border-[#dfe5e9] px-2 py-1.5" /></label>
        <label className="block"><span className="mb-1 block text-xs text-[#718096]">To (optional)</span><input type="date" value={to} onChange={event => setTo(event.target.value)} className="w-full rounded-lg border border-[#dfe5e9] px-2 py-1.5" /></label>
      </div>
      <div className="mt-3 flex justify-end"><button type="button" onClick={exportHistory} className="rounded-lg bg-[#17212b] px-4 py-2 text-white">Export history CSV</button></div>
    </section>
    <section className="border-t border-[#e7ebef] pt-4">
      <h3 className="mb-1 font-semibold">Current positions (CSV)</h3>
      <p className="mb-2 text-xs text-[#718096]">Today&apos;s accounts, debts and holdings. Can be re-imported with Import CSV.</p>
      <button type="button" onClick={exportPositions} className="rounded-lg border border-[#e7ebef] px-3 py-2">Export positions CSV</button>
    </section>
    <section className="border-t border-[#e7ebef] pt-4">
      <h3 className="mb-1 font-semibold">Full backup (JSON)</h3>
      <p className="mb-2 text-xs text-[#718096]">Everything: accounts, debts, holdings, forecast settings and all history. Open it on another device with Import backup.</p>
      <button type="button" onClick={exportBackup} className="rounded-lg border border-[#e7ebef] px-3 py-2">Download backup JSON</button>
    </section>
  </div>;
}
