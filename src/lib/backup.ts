import type { AccountSnapshot, Snapshot, TrackerData } from "./types";

/** File format shared by the JSON backup and the GitHub-synced data file. */
export type DataEnvelope = { app: "nest-egg"; version: 1; updatedAt: string; data: TrackerData };

export const toEnvelope = (data: TrackerData, updatedAt = new Date().toISOString()): DataEnvelope => ({ app: "nest-egg", version: 1, updatedAt, data });

const list = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

/** Coerces parsed JSON into a complete TrackerData, throwing when it clearly is not one. */
export function normalizeTrackerData(value: unknown): TrackerData {
  if (!value || typeof value !== "object") throw new Error("File does not contain Net Worth Tracker data.");
  const raw = value as Partial<TrackerData>;
  if (!Array.isArray(raw.accounts) && !Array.isArray(raw.liabilities) && !Array.isArray(raw.accountSnapshots)) throw new Error("File does not contain Net Worth Tracker data.");
  return {
    ...raw,
    accounts: list(raw.accounts), liabilities: list(raw.liabilities), holdings: list(raw.holdings),
    snapshots: list(raw.snapshots), accountSnapshots: list(raw.accountSnapshots)
  };
}

/** Accepts either the envelope or a bare TrackerData object (older exports). */
export function parseEnvelope(text: string): { data: TrackerData; updatedAt: string | null } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("File is not valid JSON."); }
  const envelope = parsed as Partial<DataEnvelope> | null;
  if (envelope && typeof envelope === "object" && envelope.app === "nest-egg" && envelope.data) {
    return { data: normalizeTrackerData(envelope.data), updatedAt: typeof envelope.updatedAt === "string" ? envelope.updatedAt : null };
  }
  return { data: normalizeTrackerData(parsed), updatedAt: null };
}

function unionBy<T>(loser: T[], winner: T[], key: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of loser) map.set(key(item), item);
  for (const item of winner) map.set(key(item), item);
  return [...map.values()];
}

/**
 * Union of two datasets. Where both sides hold the same record (same id, or same
 * account and date for history), the `localWins` side is kept. Records deleted on
 * one side only survive a merge, so a deletion may need repeating after a conflict.
 */
export function mergeData(local: TrackerData, remote: TrackerData, localWins: boolean): TrackerData {
  const [winner, loser] = localWins ? [local, remote] : [remote, local];
  const byId = <T extends { id: string }>(item: T) => item.id;
  const accountSnapshots = unionBy<AccountSnapshot>(loser.accountSnapshots ?? [], winner.accountSnapshots ?? [], row => `${row.accountId}|${row.date}`)
    .sort((a, b) => `${a.date}-${a.accountId}`.localeCompare(`${b.date}-${b.accountId}`));
  const snapshots = unionBy<Snapshot>(loser.snapshots ?? [], winner.snapshots ?? [], row => row.date).sort((a, b) => a.date.localeCompare(b.date));
  const latest = (a?: string, b?: string) => (a ?? "") >= (b ?? "") ? a : b;
  return {
    ...loser, ...winner,
    accounts: unionBy(loser.accounts ?? [], winner.accounts ?? [], byId),
    liabilities: unionBy(loser.liabilities ?? [], winner.liabilities ?? [], byId),
    holdings: unionBy(loser.holdings ?? [], winner.holdings ?? [], byId),
    snapshots, accountSnapshots,
    lastPriceSync: latest(local.lastPriceSync, remote.lastPriceSync),
    lastPriceSyncAt: latest(local.lastPriceSyncAt, remote.lastPriceSyncAt)
  };
}
