import { selfCompounding, type Account, type Holding, type Liability } from "./types";
import { parseIso } from "./date";

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
/** Converts an annual percentage into the equivalent compounding monthly rate. Negative rates model depreciation; a drop of 100% or worse is treated as a total loss over the year. */
const monthlyRate = (annualPercent: number) => {
  const growth = 1 + num(annualPercent) / 100;
  if (growth <= 0) return -1;
  return Math.pow(growth, 1 / 12) - 1;
};

/** Property is a valuation, not a funded account, so it never takes contributions. */
export const acceptsContributions = (account: Account) => account.type !== "property";

export type ContributionSplit = { cash: number; holdings: number[] };

/**
 * Splits each monthly contribution. A specific holding takes everything, "cash" takes
 * everything, and the default spreads across linked holdings by their current weight.
 * Weights are fixed at today's mix so the projection behaves like a target allocation.
 */
export function contributionSplit(account: Account, linked: Holding[], values: number[]): ContributionSplit {
  const empty = new Array(linked.length).fill(0) as number[];
  const target = account.contributionTarget ?? "pro-rata";
  if (target === "cash") return { cash: 1, holdings: empty };
  const index = linked.findIndex(holding => holding.id === target);
  if (index >= 0) { const holdings = [...empty]; holdings[index] = 1; return { cash: 0, holdings }; }
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return { cash: 1, holdings: empty };
  return { cash: 0, holdings: values.map(value => Math.max(0, value) / total) };
}

/**
 * Account value at each year 0..years, stepped monthly so contributions compound
 * realistically rather than being applied as one lump at year end.
 */
export function projectAccountSeries(account: Account, holdings: Holding[], years: number): number[] {
  const months = Math.max(0, Math.round(years * 12));
  const base = acceptsContributions(account) ? Math.max(0, num(account.monthlyContribution)) : 0;
  const growth = account.contributionGrowth ? num(account.contributionGrowthRate) : 0;
  // Deposits can stop early, e.g. at retirement; 0 or unset means they run the whole horizon.
  const fundedMonths = num(account.contributionYears) > 0 ? Math.round(num(account.contributionYears) * 12) : Infinity;
  // Contributions step up on each anniversary when inflation growth is enabled.
  const contributionAt = (month: number) => month >= fundedMonths ? 0 : base * Math.pow(1 + growth / 100, Math.floor(month / 12));

  const linked = holdings.filter(holding => holding.accountId === account.id);

  // Imported totals that were never composed are a single lump; they still accept contributions.
  if (!account.cashConfigured) {
    let value = num(account.balance);
    const rate = monthlyRate(num(account.expectedAnnualReturn));
    const series = [value];
    for (let month = 0; month < months; month += 1) {
      value = value * (1 + rate) + contributionAt(month);
      if ((month + 1) % 12 === 0) series.push(value);
    }
    return series;
  }

  let cash = num(account.balance);
  const cashRate = selfCompounding.has(account.type) ? monthlyRate(num(account.expectedAnnualReturn)) : 0;
  const values = linked.map(holding => num(holding.quantity) * num(holding.price));
  const rates = linked.map(holding => monthlyRate(num(holding.expectedAnnualReturn)));
  const split = contributionSplit(account, linked, values);
  const sum = () => cash + values.reduce((total, value) => total + value, 0);

  const series = [sum()];
  for (let month = 0; month < months; month += 1) {
    const contribution = contributionAt(month);
    cash = cash * (1 + cashRate) + contribution * split.cash;
    for (let index = 0; index < values.length; index += 1) values[index] = values[index] * (1 + rates[index]) + contribution * split.holdings[index];
    if ((month + 1) % 12 === 0) series.push(sum());
  }
  return series;
}

export type Amortization = {
  balances: number[];
  payoffMonths: number | null;
  interestOnlyShortfall: boolean;
  firstMonthInterest: number;
  totalInterest: number;
};

/**
 * Standard monthly amortization. `monthlyPayment` must be principal and interest only:
 * escrowed tax and insurance never touch the balance.
 */
export function amortize(liability: Liability, years: number): Amortization {
  const months = Math.max(0, Math.round(years * 12));
  const rate = num(liability.rate) / 100 / 12;
  const payment = Math.max(0, num(liability.monthlyPayment)) + Math.max(0, num(liability.extraMonthly));
  let balance = Math.max(0, num(liability.balance));
  const firstMonthInterest = balance * rate;
  const balances = [balance];
  let payoffMonths: number | null = balance <= 0 ? 0 : null;
  let totalInterest = 0;

  for (let month = 0; month < months; month += 1) {
    if (balance > 0 && payment > 0) {
      const interest = balance * rate;
      const principal = payment - interest;
      if (principal > 0) {
        totalInterest += interest;
        balance = Math.max(0, balance - principal);
        if (balance <= 0 && payoffMonths === null) payoffMonths = month + 1;
      }
    }
    if ((month + 1) % 12 === 0) balances.push(balance);
  }

  return {
    balances,
    payoffMonths,
    // A payment that cannot cover the first month's interest never retires the loan.
    interestOnlyShortfall: payment > 0 && rate > 0 && payment <= firstMonthInterest,
    firstMonthInterest,
    totalInterest
  };
}

/** Closed-form payoff length, so a payoff date can be shown even beyond the chart horizon. */
export function payoffMonths(liability: Liability): number | null {
  const rate = num(liability.rate) / 100 / 12;
  const payment = Math.max(0, num(liability.monthlyPayment)) + Math.max(0, num(liability.extraMonthly));
  const balance = Math.max(0, num(liability.balance));
  if (balance <= 0) return 0;
  if (payment <= 0) return null;
  if (rate <= 0) return Math.ceil(balance / payment);
  if (payment <= balance * rate) return null;
  return Math.ceil(-Math.log(1 - (balance * rate) / payment) / Math.log(1 + rate));
}

/** Formats a month count as a human payoff horizon, e.g. "12 yr 4 mo". */
export function payoffLabel(months: number | null): string {
  if (months === null) return "never at this payment";
  if (months <= 0) return "paid off";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return `${rest} mo`;
  return rest ? `${years} yr ${rest} mo` : `${years} yr`;
}

/** Calendar date a loan retires, for display next to the horizon. */
export function payoffDate(months: number | null, from = new Date()): string | null {
  if (months === null || months < 0) return null;
  const date = new Date(from.getFullYear(), from.getMonth() + months, 1);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

/** Whole months between two ISO dates, floored; negative spans count as 0. */
export function monthsBetween(from: string, to: string): number {
  const start = parseIso(from);
  const end = parseIso(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Where a loan's balance should stand today if every scheduled payment was made since
 * `asOf`. This is a *projection offered for review*, never written automatically: a real
 * balance can diverge through extra payments, escrow changes, or a rate reset, and
 * imported history is the authority.
 */
export function expectedBalance(liability: Liability, asOf: string, today: string): { balance: number; months: number } | null {
  const months = monthsBetween(asOf, today);
  const payment = Math.max(0, num(liability.monthlyPayment)) + Math.max(0, num(liability.extraMonthly));
  let balance = Math.max(0, num(liability.balance));
  if (!months || payment <= 0 || balance <= 0) return null;
  const rate = num(liability.rate) / 100 / 12;
  for (let month = 0; month < months; month += 1) {
    if (balance <= 0) break;
    const principal = payment - balance * rate;
    if (principal <= 0) return null;
    balance = Math.max(0, balance - principal);
  }
  return { balance, months };
}
