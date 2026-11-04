import type { TrackerData } from "./types";
import { isoDate, parseIso } from "./date";

export type HistorySeries = { id: string; name: string; kind: "account" | "liability" | "other"; first: string; last: string; count: number };
export type HistoryLayout = "long" | "wide";
export type HistoryExportOptions = { ids: string[]; layout: HistoryLayout; fillDaily: boolean; from?: string; to?: string; includeTotal: boolean };

/** Every series with dated history, labelled with its current account or liability name. */
export function historySeries(data: TrackerData): HistorySeries[] {
  const names = new Map<string, { name: string; kind: HistorySeries["kind"] }>();
  for (const account of data.accounts ?? []) names.set(account.id, { name: account.name, kind: "account" });
  for (const liability of data.liabilities ?? []) names.set(liability.id, { name: liability.name, kind: "liability" });
  const stats = new Map<string, { first: string; last: string; count: number }>();
  for (const row of data.accountSnapshots ?? []) {
    const current = stats.get(row.accountId);
    if (!current) stats.set(row.accountId, { first: row.date, last: row.date, count: 1 });
    else { current.count += 1; if (row.date < current.first) current.first = row.date; if (row.date > current.last) current.last = row.date; }
  }
  const order = { account: 0, liability: 1, other: 2 };
  return [...stats.entries()]
    .map(([id, stat]) => ({ id, ...(names.get(id) ?? { name: id, kind: "other" as const }), ...stat }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

const cell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const amount = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

function nextDay(date: string) {
  const value = parseIso(date);
  value.setDate(value.getDate() + 1);
  return isoDate(value);
}

/**
 * History is stored only on the days a balance changed. Each balance is carried forward
 * until the next change, so a "fill daily" export has a value for every calendar day from
 * the account's first record onward (blank before it). Debts are negative, matching import.
 *
 * - long: `Date,Balance,Account`, the same format the history importer reads.
 * - wide: one row per date, one column per account, plus an optional Total.
 */
export function historyCsv(data: TrackerData, options: HistoryExportOptions): { csv: string; rows: number } {
  const selected = new Set(options.ids);
  const series = historySeries(data).filter(item => selected.has(item.id));
  const names = new Map(series.map(item => [item.id, item.name]));
  const byDate = new Map<string, Map<string, number>>();
  for (const row of data.accountSnapshots ?? []) {
    if (!selected.has(row.accountId) || !Number.isFinite(row.balance)) continue;
    const bucket = byDate.get(row.date) ?? new Map<string, number>();
    bucket.set(row.accountId, row.balance);
    byDate.set(row.date, bucket);
  }
  const recorded = [...byDate.keys()].sort();
  if (!recorded.length) return { csv: options.layout === "long" ? "Date,Balance,Account\n" : "Date\n", rows: 0 };

  const end = options.to && options.to < recorded[recorded.length - 1] ? options.to : recorded[recorded.length - 1];
  const dates: string[] = [];
  if (options.fillDaily) for (let date = recorded[0]; date <= end; date = nextDay(date)) dates.push(date);
  else dates.push(...recorded.filter(date => date <= end));

  const running = new Map<string, number>();
  const lines: string[] = [];
  const ids = series.map(item => item.id);
  if (options.layout === "long") lines.push("Date,Balance,Account");
  else lines.push(["Date", ...ids.map(itemId => cell(names.get(itemId) ?? itemId)), ...(options.includeTotal ? ["Total"] : [])].join(","));

  for (const date of dates) {
    const changes = byDate.get(date);
    if (changes) for (const [itemId, value] of changes) running.set(itemId, value);
    if (options.from && date < options.from) continue;
    if (options.layout === "long") {
      // Without daily fill, only the days a balance was actually recorded are written.
      for (const itemId of ids) {
        if (!running.has(itemId) || (!options.fillDaily && !changes?.has(itemId))) continue;
        lines.push(`${date},${amount(running.get(itemId)!)},${cell(names.get(itemId) ?? itemId)}`);
      }
    } else {
      const values = ids.map(itemId => running.get(itemId));
      const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      lines.push([date, ...values.map(value => value === undefined ? "" : amount(value)), ...(options.includeTotal ? [amount(total)] : [])].join(","));
    }
  }
  return { csv: `${lines.join("\n")}\n`, rows: lines.length - 1 };
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
