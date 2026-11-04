import { amortize, projectAccountSeries } from "./forecast";
import { deflate } from "./inflation";
import { isoDate, parseIso } from "./date";
import type { Goal, TrackerData } from "./types";
import { accountTotal, safeNumber, totalAssets, totalDebts } from "./values";

export const GOAL_HORIZON_YEARS = 50;

export type Projections = { months: number; assets: Map<string, number[]>; debts: Map<string, number[]> };

/** Month-by-month projection of every account and debt, shared by all goals. */
export function projectAll(data: TrackerData, years = GOAL_HORIZON_YEARS): Projections {
  return {
    months: years * 12,
    assets: new Map((data.accounts ?? []).map(account => [account.id, projectAccountSeries(account, data.holdings ?? [], years, true)])),
    debts: new Map((data.liabilities ?? []).map(liability => [liability.id, amortize(liability, years, true).balances]))
  };
}

export type GoalStatus = {
  current: number;
  target: number;
  progress: number;
  reached: boolean;
  /** Months from today until the goal is projected to be met; null when not within the horizon. */
  etaMonths: number | null;
  etaDate: string | null;
  /** Only set when the goal has a target date. */
  onTrack?: boolean;
  missing?: string;
};

const addMonths = (today: string, months: number) => {
  const date = parseIso(today);
  date.setMonth(date.getMonth() + months);
  return isoDate(date);
};

/** Highest balance a debt has been at (when the goal was set, or in recorded history), the starting point for payoff progress. */
const debtStart = (goal: Goal, data: TrackerData, balance: number) => {
  const recorded = (data.accountSnapshots ?? []).filter(row => row.accountId === goal.accountId).map(row => Math.abs(safeNumber(row.balance)));
  return Math.max(balance, safeNumber(goal.startValue), ...recorded, 0);
};

/**
 * Where a goal stands today and when the forecast says it will be met. With `real` on,
 * the target is read in today's dollars and projected values are deflated before comparing,
 * so a goal reached only through inflation is not counted. Debt payoff is unaffected.
 */
export function goalStatus(goal: Goal, data: TrackerData, projections: Projections, options: { real: boolean; inflation: number; today: string }): GoalStatus {
  const { real, inflation, today } = options;
  const finish = (current: number, target: number, progress: number, met: (month: number) => boolean): GoalStatus => {
    const reached = met(0);
    let etaMonths: number | null = reached ? 0 : null;
    for (let month = 1; etaMonths === null && month <= projections.months; month += 1) if (met(month)) etaMonths = month;
    const etaDate = etaMonths === null ? null : addMonths(today, etaMonths);
    const onTrack = goal.targetDate ? reached || (etaDate !== null && etaDate <= goal.targetDate) : undefined;
    return { current, target, progress: Math.min(1, Math.max(0, progress)), reached, etaMonths, etaDate, onTrack };
  };
  const adjust = (value: number, month: number) => real ? deflate(value, month, inflation) : value;
  const target = safeNumber(goal.target);

  if (goal.kind === "debtFree") {
    const liability = (data.liabilities ?? []).find(item => item.id === goal.accountId);
    if (!liability) return { current: 0, target: 0, progress: 0, reached: false, etaMonths: null, etaDate: null, missing: "This debt no longer exists." };
    const balance = Math.max(0, safeNumber(liability.balance));
    const start = debtStart(goal, data, balance);
    const series = projections.debts.get(liability.id) ?? [balance];
    return finish(balance, 0, start > 0 ? 1 - balance / start : 1, month => (series[month] ?? series[series.length - 1]) <= 0.5);
  }

  if (goal.kind === "account") {
    const account = (data.accounts ?? []).find(item => item.id === goal.accountId);
    if (!account) return { current: 0, target, progress: 0, reached: false, etaMonths: null, etaDate: null, missing: "This account no longer exists." };
    const current = accountTotal(account, data.holdings ?? []);
    const series = projections.assets.get(account.id) ?? [current];
    return finish(current, target, target > 0 ? current / target : 1, month => adjust(month === 0 ? current : series[month] ?? series[series.length - 1], month) >= target);
  }

  const current = totalAssets(data) - totalDebts(data.liabilities ?? []);
  const netAt = (month: number) => {
    if (month === 0) return current;
    let total = 0;
    for (const series of projections.assets.values()) total += Math.max(0, series[month] ?? series[series.length - 1]);
    for (const series of projections.debts.values()) total -= Math.max(0, series[month] ?? series[series.length - 1]);
    return total;
  };
  return finish(current, target, target > 0 ? Math.max(0, current) / target : 1, month => adjust(netAt(month), month) >= target);
}
