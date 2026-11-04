"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, Database, FileDown, FolderOpen, Settings2 } from "lucide-react";

type Change = (event: React.ChangeEvent<HTMLInputElement>) => void;

/**
 * All import, export and settings actions behind one header button. The file inputs stay
 * mounted outside the dropdown so a picker can still deliver its files after the menu closes.
 */
export default function DataMenu({ importFolder, importHistoryFiles, importPositions, importBackup, openExport, downloadTemplate, openSettings }: {
  importFolder: Change; importHistoryFiles: Change; importPositions: Change; importBackup: Change;
  openExport: () => void; downloadTemplate: () => void; openSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const history = useRef<HTMLInputElement>(null);
  const positions = useRef<HTMLInputElement>(null);
  const backup = useRef<HTMLInputElement>(null);

  useEffect(() => { folder.current?.setAttribute("webkitdirectory", ""); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const run = (action: () => void) => () => { setOpen(false); action(); };
  const item = "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#f2f7fa]";
  const Item = ({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) =>
    <button type="button" role="menuitem" onClick={run(onClick)} className={item}><span className="mt-0.5 text-[#718096]">{icon}</span><span><span className="block text-sm text-[#17212b]">{label}</span>{hint && <span className="block text-xs text-[#a0aab5]">{hint}</span>}</span></button>;

  return <div ref={root} className="relative">
    <button type="button" onClick={() => setOpen(value => !value)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-1.5 rounded-lg border border-[#e7ebef] px-3 py-2 text-sm text-[#3f4a56] hover:bg-[#f7f8fa]"><Database size={15} /><span className="hidden sm:inline">Data</span><ChevronDown size={14} /></button>
    {open && <div role="menu" className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-[#e7ebef] bg-white p-1.5 shadow-lg">
      <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-[#a0aab5]">Import</p>
      <Item icon={<FolderOpen size={16} />} label="Import from data folder" hint="Every Date,Balance,Account CSV in a folder" onClick={() => folder.current?.click()} />
      <Item icon={<ArrowUpFromLine size={16} />} label="Import balance history CSVs" hint="Pick one or more files" onClick={() => history.current?.click()} />
      <Item icon={<ArrowUpFromLine size={16} />} label="Import positions CSV" hint="Accounts, debts and holdings from Export" onClick={() => positions.current?.click()} />
      <Item icon={<ArrowUpFromLine size={16} />} label="Import backup (JSON)" hint="Replaces this device's data" onClick={() => backup.current?.click()} />
      <div className="my-1.5 border-t border-[#eef1f4]" />
      <p className="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wide text-[#a0aab5]">Export</p>
      <Item icon={<ArrowDownToLine size={16} />} label="Export…" hint="History CSV, positions CSV or full backup" onClick={openExport} />
      <Item icon={<FileDown size={16} />} label="Download history template" onClick={downloadTemplate} />
      <div className="my-1.5 border-t border-[#eef1f4]" />
      <Item icon={<Settings2 size={16} />} label="Settings" hint="Price proxy and GitHub sync" onClick={openSettings} />
    </div>}
    <input ref={folder} type="file" multiple onChange={importFolder} className="hidden" />
    <input ref={history} type="file" accept=".csv" multiple onChange={importHistoryFiles} className="hidden" />
    <input ref={positions} type="file" accept=".csv" onChange={importPositions} className="hidden" />
    <input ref={backup} type="file" accept=".json,application/json" onChange={importBackup} className="hidden" />
  </div>;
}
