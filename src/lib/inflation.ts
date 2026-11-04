import { CPI_START, CPI_VALUES } from "./cpi-data";

const startYear = Number(CPI_START.slice(0, 4));
const startMonth = Number(CPI_START.slice(5, 7));
const monthIndex = (date: string) => (Number(date.slice(0, 4)) - startYear) * 12 + (Number(date.slice(5, 7)) - startMonth);

/** Last month covered by published CPI data, as YYYY-MM. */
export function cpiLastMonth() {
  const total = startMonth - 1 + CPI_VALUES.length - 1;
  return `${startYear + Math.floor(total / 12)}-${String(total % 12 + 1).padStart(2, "0")}`;
}

/**
 * Price level for a date. Published monthly CPI-U where available; after the last
 * published month it is extrapolated at `assumedAnnual` %, and before the series starts
 * the first value is used.
 */
export function cpiAt(date: string, assumedAnnual: number) {
  const index = monthIndex(date);
  const last = CPI_VALUES.length - 1;
  if (!Number.isFinite(index) || index <= 0) return CPI_VALUES[0];
  if (index <= last) return CPI_VALUES[index];
  return CPI_VALUES[last] * Math.pow(1 + assumedAnnual / 100, (index - last) / 12);
}

/** Restates a past amount in today's purchasing power. */
export const inTodaysDollars = (value: number, date: string, today: string, assumedAnnual: number) =>
  value * cpiAt(today, assumedAnnual) / cpiAt(date, assumedAnnual);

/** Discounts a future amount `months` ahead back to today's dollars at the assumed rate. */
export const deflate = (value: number, months: number, assumedAnnual: number) =>
  value / Math.pow(1 + assumedAnnual / 100, months / 12);
