import { assetClasses, type Account, type AssetClass, type Holding, type TrackerData } from "./types";
import { holdingValue, safeNumber } from "./values";

export type AllocationKey = AssetClass | "unassigned";
export type AllocationSlice = { key: AllocationKey; label: string; color: string; value: number; share: number };
/** A classifiable item: one ticker across all accounts, or one account's own balance. */
export type AllocationItem = { kind: "ticker" | "account"; id: string; label: string; detail: string; value: number; assetClass?: AssetClass; inferred?: AssetClass };

const tickerKey = (ticker: string) => (ticker ?? "").trim().toUpperCase();

/** The class an account's own balance takes when the user has not chosen one. */
export function inferredAccountClass(account: Account, linkedHoldings: number): AssetClass | undefined {
  if (account.type === "cash" || account.type === "savings") return "cash";
  if (account.type === "property") return "realEstate";
  // In a composed brokerage or retirement account the own balance is its cash sweep.
  if (account.cashConfigured && linkedHoldings > 0) return "cash";
  return undefined;
}

export function allocationItems(data: TrackerData, includeProperty: boolean): AllocationItem[] {
  const accounts = (data.accounts ?? []).filter(account => includeProperty || account.type !== "property");
  // Holdings count only inside composed accounts; an imported total already includes them.
  const composed = new Set(accounts.filter(account => account.cashConfigured).map(account => account.id));
  const holdings = (data.holdings ?? []).filter(holding => composed.has(holding.accountId));
  const items: AllocationItem[] = [];

  const byTicker = new Map<string, Holding[]>();
  for (const holding of holdings) {
    const key = tickerKey(holding.ticker);
    if (!key) continue;
    byTicker.set(key, [...(byTicker.get(key) ?? []), holding]);
  }
  for (const [ticker, list] of byTicker) {
    const classes = new Set(list.map(holding => holding.assetClass).filter(Boolean));
    items.push({ kind: "ticker", id: ticker, label: ticker, detail: `${list.length} account${list.length === 1 ? "" : "s"}`, value: list.reduce((sum, holding) => sum + Math.max(0, holdingValue(holding)), 0), assetClass: classes.size === 1 ? [...classes][0] : list[0].assetClass });
  }

  for (const account of accounts) {
    const linked = holdings.filter(holding => holding.accountId === account.id).length;
    // Composed accounts own only their cash; imported totals own their whole balance.
    const own = Math.max(0, safeNumber(account.balance));
    if (own <= 0) continue;
    items.push({ kind: "account", id: account.id, label: account.name, detail: account.cashConfigured && linked ? "cash in account" : account.cashConfigured ? "account balance" : "imported total", value: own, assetClass: account.assetClass, inferred: inferredAccountClass(account, linked) });
  }
  return items.sort((a, b) => b.value - a.value);
}

export function allocationSlices(items: AllocationItem[]): AllocationSlice[] {
  const totals = new Map<AllocationKey, number>();
  for (const item of items) {
    const key: AllocationKey = item.assetClass ?? item.inferred ?? "unassigned";
    totals.set(key, (totals.get(key) ?? 0) + item.value);
  }
  const sum = [...totals.values()].reduce((total, value) => total + value, 0);
  const meta = [...assetClasses, { value: "unassigned" as const, label: "Unassigned", color: "#e3e7eb" }];
  return meta
    .map(entry => ({ key: entry.value, label: entry.label, color: entry.color, value: totals.get(entry.value) ?? 0, share: sum > 0 ? (totals.get(entry.value) ?? 0) / sum : 0 }))
    .filter(slice => slice.value > 0);
}
