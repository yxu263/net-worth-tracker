import { todayIso } from "./date";

export type AccountType = "cash" | "savings" | "investment" | "retirement" | "property" | "other";
/** `contributionTarget` is a holding id, "cash", or "pro-rata" (default: split by current holding weights).
 * `contributionYears` stops deposits after N years (undefined or 0 means they run for the whole horizon). */
export type Account = { id: string; name: string; institution: string; type: AccountType; balance: number; color: string; cashConfigured?: boolean; expectedAnnualReturn?: number; monthlyContribution?: number; contributionGrowth?: boolean; contributionGrowthRate?: number; contributionTarget?: string; contributionYears?: number };
/** `monthlyPayment` is principal and interest only — escrowed tax and insurance never reduce the balance.
 * `balanceAsOf` is the date the balance was last stated, used only to offer a catch-up projection. */
export type Liability = { id: string; name: string; institution: string; balance: number; rate: number; monthlyPayment?: number; extraMonthly?: number; balanceAsOf?: string };
export type Holding = { id: string; accountId: string; ticker: string; quantity: number; costBasis: number; price: number; expectedAnnualReturn?: number; priceUpdatedAt?: string; priceUpdatedAtTime?: string; priceBasis?: "live" | "todayClose" | "previousClose"; previousClose?: number; changePercent?: number };
export type Snapshot = { date: string; assets: number; liabilities: number; netWorth: number };
export type AccountSnapshot = { accountId: string; date: string; balance: number };
export type TrackerData = { accounts: Account[]; liabilities: Liability[]; holdings: Holding[]; snapshots: Snapshot[]; accountSnapshots: AccountSnapshot[]; lastPriceSync?: string; lastPriceSyncAt?: string };

export const accountTypes: { value: AccountType; label: string }[] = [
  { value: "cash", label: "Cash / checking" }, { value: "savings", label: "Savings" }, { value: "investment", label: "Investment" },
  { value: "retirement", label: "Retirement" }, { value: "property", label: "Property" }, { value: "other", label: "Other" }
];
/** Account types whose cash balance compounds at the account's own expected return. */
export const interestBearing = new Set<AccountType>(["cash", "savings"]);
/** Account types whose own balance compounds at the account's expected annual rate. Property appreciates (or depreciates) rather than earning interest. */
export const selfCompounding = new Set<AccountType>(["cash", "savings", "property"]);
/** Property uses appreciation wording because the value moves with the market, not an interest rate. */
export const returnLabel = (type: AccountType) => type === "property" ? "Expected annual appreciation (%)" : "Expected annual return (%)";

export const demoData: TrackerData = {
  accounts: [
    { id: "checking", name: "Everyday checking", institution: "Mercury Bank", type: "cash", balance: 8420, color: "#66c9a0" },
    { id: "brokerage", name: "Long-term brokerage", institution: "Fidelity", type: "investment", balance: 0, color: "#8aa9e8" },
    { id: "retirement", name: "Rollover IRA", institution: "Vanguard", type: "retirement", balance: 0, color: "#b69ce6" },
  ],
  liabilities: [{ id: "mortgage", name: "Home mortgage", institution: "Lender", balance: 186500, rate: 6.25 }],
  holdings: [
    { id: "vti", accountId: "brokerage", ticker: "VTI", quantity: 42, costBasis: 8200, price: 292.18 },
    { id: "bnd", accountId: "retirement", ticker: "BND", quantity: 105, costBasis: 7600, price: 72.4 },
  ],
  snapshots: [],
  accountSnapshots: [
    { accountId: "checking", date: todayIso(), balance: 8420 },
    { accountId: "brokerage", date: todayIso(), balance: 0 },
    { accountId: "retirement", date: todayIso(), balance: 0 }
  ]
};
