"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import { goalStatus, projectAll, GOAL_HORIZON_YEARS } from "@/lib/goals";
import { parseIso } from "@/lib/date";
import type { Goal, TrackerData } from "@/lib/types";
import { money, safeNumber } from "@/lib/values";

const monthYear = (date: string) => parseIso(date).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const span = (months: number) => { const years = Math.floor(months / 12); const rest = months % 12; return years ? `${years} yr${rest ? ` ${rest} mo` : ""}` : `${rest} mo`; };
const newId = () => Math.random().toString(36).slice(2, 9);
const kindLabel: Record<Goal["kind"], string> = { netWorth: "Net worth", account: "Account balance", debtFree: "Pay off a debt" };

function GoalForm({ goal, data, save, cancel }: { goal: Goal | null; data: TrackerData; save: (goal: Goal) => void; cancel: () => void }) {
  const [kind, setKind] = useState<Goal["kind"]>(goal?.kind ?? "netWorth");
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [accountId, setAccountId] = useState(goal?.accountId ?? "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const choices = kind === "debtFree" ? data.liabilities : kind === "account" ? data.accounts : [];
  const picked = choices.find(item => item.id === accountId) ?? choices[0];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(target);
    if (kind !== "debtFree" && !(amount > 0)) return;
    if (kind !== "netWorth" && !picked) return;
    const debt = kind === "debtFree" ? data.liabilities.find(item => item.id === picked?.id) : undefined;
    save({
      id: goal?.id ?? newId(), kind,
      name: name.trim() || (kind === "debtFree" ? `Pay off ${picked?.name}` : kind === "account" ? `${picked?.name} reaches ${money(amount)}` : `Net worth ${money(amount)}`),
      target: kind === "debtFree" ? 0 : amount,
      accountId: kind === "netWorth" ? undefined : picked?.id,
      targetDate: targetDate || undefined,
      // Payoff progress is measured from the balance when the goal is set, unless history shows more.
      startValue: kind === "debtFree" ? goal?.kind === "debtFree" && goal.accountId === picked?.id ? goal.startValue : safeNumber(debt?.balance) : undefined
    });
  }

  const input = "w-full rounded-lg border border-[#dfe5e9] px-3 py-2";
  return <form onSubmit={submit} className="grid gap-3 rounded-lg border border-[#e7ebef] p-4 text-sm sm:grid-cols-2">
    <label className="block"><span className="mb-1 block text-[#718096]">Goal type</span><select value={kind} onChange={event => { setKind(event.target.value as Goal["kind"]); setAccountId(""); }} className={input}>{Object.entries(kindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {kind !== "netWorth" && <label className="block"><span className="mb-1 block text-[#718096]">{kind === "debtFree" ? "Debt" : "Account"}</span><select value={picked?.id ?? ""} onChange={event => setAccountId(event.target.value)} className={input}>{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!choices.length && <span className="mt-1 block text-xs text-[#b95d57]">Add {kind === "debtFree" ? "a debt" : "an account"} first.</span>}</label>}
    {kind !== "debtFree" && <label className="block"><span className="mb-1 block text-[#718096]">Target amount ($)</span><input type="number" min="1" step="any" required value={target} onChange={event => setTarget(event.target.value)} className={input} /></label>}
    <label className="block"><span className="mb-1 block text-[#718096]">Target date (optional)</span><input type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} className={input} /></label>
    <label className="block sm:col-span-2"><span className="mb-1 block text-[#718096]">Name (optional)</span><input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Millionaire, Mortgage-free" className={input} /></label>
    <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={cancel} className="rounded-lg border border-[#e7ebef] px-4 py-2">Cancel</button><button type="submit" className="rounded-lg bg-[#17212b] px-4 py-2 text-white">Save goal</button></div>
  </form>;
}

export default function GoalsTab({ data, real, inflation, today, saveGoal, removeGoal }: { data: TrackerData; real: boolean; inflation: number; today: string; saveGoal: (goal: Goal) => void; removeGoal: (goal: Goal) => void }) {
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const goals = data.goals ?? [];
  const projections = useMemo(() => projectAll(data), [data]);
  const statuses = useMemo(() => new Map(goals.map(goal => [goal.id, goalStatus(goal, data, projections, { real, inflation, today })])), [goals, data, projections, real, inflation, today]);

  return <section className="card p-6">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 font-semibold"><Target size={18} />Goals</h2><p className="text-sm text-[#718096]">Estimated dates come from the Forecast assumptions (returns, contributions and loan payments){real ? `, with targets in today's dollars at ${inflation}% inflation` : ""}.</p></div>
      {editing === null && <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-[#17212b] px-3 py-2 text-sm text-white"><Plus size={15} />Add goal</button>}
    </div>
    {editing !== null && <div className="mb-4"><GoalForm goal={editing === "new" ? null : editing} data={data} cancel={() => setEditing(null)} save={goal => { saveGoal(goal); setEditing(null); }} /></div>}
    {!goals.length && editing === null && <p className="text-sm text-[#718096]">No goals yet. Try a net worth milestone, a balance for one account, or paying off the mortgage.</p>}
    <div className="space-y-4">
      {goals.map(goal => {
        const status = statuses.get(goal.id);
        if (!status) return null;
        const debt = goal.kind === "debtFree";
        const eta = status.reached ? "Reached" : status.etaDate ? `${monthYear(status.etaDate)} · in ${span(status.etaMonths ?? 0)}` : `Not within ${GOAL_HORIZON_YEARS} years at current assumptions`;
        return <div key={goal.id} className="rounded-lg border border-[#e7ebef] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-medium">{goal.name}</p><p className="text-xs text-[#718096]">{kindLabel[goal.kind]}{goal.targetDate ? ` · target ${monthYear(goal.targetDate)}` : ""}</p></div>
            <div className="flex items-center gap-3">
              {status.onTrack !== undefined && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.onTrack ? "bg-[#e6f5ee] text-[#2f7d5b]" : "bg-[#fdecea] text-[#b95d57]"}`}>{status.onTrack ? "On track" : "Behind"}</span>}
              <button onClick={() => setEditing(goal)} aria-label={`Edit ${goal.name}`} className="text-[#3b7fbd]"><Pencil size={15} /></button>
              <button onClick={() => removeGoal(goal)} aria-label={`Delete ${goal.name}`} className="text-[#b95d57]"><Trash2 size={15} /></button>
            </div>
          </div>
          {status.missing ? <p className="mt-2 text-sm text-[#b95d57]">{status.missing}</p> : <>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#edf1f3]"><div className="h-full rounded-full" style={{ width: `${status.progress * 100}%`, background: status.reached ? "#66c9a0" : "#4f8fd6" }} /></div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-[#718096]">{debt ? `${money(status.current)} left` : `${money(status.current)} of ${money(status.target)}`} · {(status.progress * 100).toFixed(0)}%{debt ? " paid" : ""}</span>
              <span className={status.reached ? "font-medium text-[#2f8d68]" : status.etaDate ? "font-medium" : "text-[#b95d57]"}>{eta}</span>
            </div>
          </>}
        </div>;
      })}
    </div>
  </section>;
}
