import type { AccountSnapshot, Snapshot } from "./types";
import { isoDate, parseIso } from "./date";

export type NetWorthPoint = { date: string; value: number };
export type RangeKey = "mtd" | "30d" | "90d" | "ytd" | "1y" | "5y" | "all";

export const rangeOptions: { key: RangeKey; label: string }[] = [
  { key: "mtd", label: "This month" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "1y", label: "1 year" },
  { key: "5y", label: "5 years" },
  { key: "all", label: "All time" }
];

const isIsoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const numeric = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Each account snapshot only records the days that account changed, so a running
 * balance per account is carried forward to value every date on the timeline.
 */
export function buildNetWorthSeries(accountSnapshots: AccountSnapshot[], snapshots: Snapshot[] = []): NetWorthPoint[] {
  const rows = (Array.isArray(accountSnapshots) ? accountSnapshots : []).filter(row => row && isIsoDate(row.date) && typeof row.accountId === "string");
  const saved = new Map((Array.isArray(snapshots) ? snapshots : []).filter(row => row && isIsoDate(row.date)).map(row => [row.date, numeric(row.netWorth)]));
  if (!rows.length) return [...saved.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));

  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const bucket = byDate.get(row.date) ?? new Map<string, number>();
    bucket.set(row.accountId, numeric(row.balance));
    byDate.set(row.date, bucket);
  }

  const running = new Map<string, number>();
  let total = 0;
  return [...byDate.keys()].sort().map(date => {
    for (const [accountId, value] of byDate.get(date)!) {
      total += value - (running.get(accountId) ?? 0);
      running.set(accountId, value);
    }
    return { date, value: saved.get(date) ?? total };
  });
}

function shiftDate(date: string, mutate: (value: Date) => void) {
  const parsed = parseIso(date);
  mutate(parsed);
  return isoDate(parsed);
}

export function rangeStartDate(range: RangeKey, anchor: string): string | null {
  switch (range) {
    case "mtd": return `${anchor.slice(0, 7)}-01`;
    case "30d": return shiftDate(anchor, value => value.setDate(value.getDate() - 29));
    case "90d": return shiftDate(anchor, value => value.setDate(value.getDate() - 89));
    case "ytd": return `${anchor.slice(0, 4)}-01-01`;
    case "1y": return shiftDate(anchor, value => value.setFullYear(value.getFullYear() - 1));
    case "5y": return shiftDate(anchor, value => value.setFullYear(value.getFullYear() - 5));
    default: return null;
  }
}

export function downsample(series: NetWorthPoint[], max = 720): NetWorthPoint[] {
  if (series.length <= max) return series;
  const step = (series.length - 1) / (max - 1);
  const picked: NetWorthPoint[] = [];
  for (let index = 0; index < max; index += 1) picked.push(series[Math.round(index * step)]);
  picked[picked.length - 1] = series[series.length - 1];
  return picked;
}

export function sliceSeries(series: NetWorthPoint[], range: RangeKey): NetWorthPoint[] {
  if (!series.length) return series;
  const start = rangeStartDate(range, series[series.length - 1].date);
  if (!start) return downsample(series);
  const windowed = series.filter(point => point.date >= start);
  return downsample(windowed.length > 1 ? windowed : series.slice(-2));
}
