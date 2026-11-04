import type { Account, Holding, Liability, TrackerData } from "./types";

export const safeNumber = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
export const holdingValue = (holding: Holding) => safeNumber(holding.quantity) * safeNumber(holding.price);

/** Cash plus linked holdings for a composed account; the stored balance for an imported total. */
export const accountTotal = (account: Account, holdings: Holding[]) => account.cashConfigured
  ? safeNumber(account.balance) + holdings.filter(holding => holding.accountId === account.id).reduce((sum, holding) => sum + holdingValue(holding), 0)
  : safeNumber(account.balance);

export const totalAssets = (data: TrackerData) => (data.accounts ?? []).reduce((sum, account) => sum + accountTotal(account, data.holdings ?? []), 0);
export const totalDebts = (liabilities: Liability[]) => (liabilities ?? []).reduce((sum, liability) => sum + safeNumber(liability.balance), 0);
