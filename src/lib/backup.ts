import type { AccountSnapshot, DeletionMarker, Goal, Snapshot, TrackerData } from "./types";

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
    snapshots: list(raw.snapshots), accountSnapshots: list(raw.accountSnapshots), goals: list(raw.goals),
    deleted: raw.deleted && typeof raw.deleted === "object" && !Array.isArray(raw.deleted) ? raw.deleted : {}
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

/** Combines two sets of deletion markers; for each id the newest marker wins. */
export function mergeMarkers(a: Record<string, DeletionMarker> = {}, b: Record<string, DeletionMarker> = {}) {
  const merged: Record<string, DeletionMarker> = { ...a };
  for (const [id, marker] of Object.entries(b)) if (!merged[id] || marker.at > merged[id].at) merged[id] = marker;
  return merged;
}

/** Records that `ids` were deleted now. */
export const markDeleted = (markers: Record<string, DeletionMarker> | undefined, ids: string[], at = new Date().toISOString()) =>
  ids.reduce((all, id) => ({ ...all, [id]: { at, gone: true } }), { ...(markers ?? {}) });

/** Records that previously deleted `ids` were created again (e.g. by an import), so merges keep them. */
export function markRevived(markers: Record<string, DeletionMarker> | undefined, ids: string[], at = new Date().toISOString()) {
  const next = { ...(markers ?? {}) };
  for (const id of ids) if (next[id]?.gone) next[id] = { at, gone: false };
  return next;
}

/**
 * Union of two datasets. Where both sides hold the same record (same id, or same
 * account and date for history), the `localWins` side is kept. Deletion markers from
 * both sides are combined, so a record deleted on either device stays deleted, along
 * with its history and (for accounts) its holdings.
 */
export function mergeData(local: TrackerData, remote: TrackerData, localWins: boolean): TrackerData {
  const [winner, loser] = localWins ? [local, remote] : [remote, local];
  const byId = <T extends { id: string }>(item: T) => item.id;
  const deleted = mergeMarkers(loser.deleted, winner.deleted);
  const alive = (id: string) => !deleted[id]?.gone;
  const accounts = unionBy(loser.accounts ?? [], winner.accounts ?? [], byId).filter(item => alive(item.id));
  const accountSnapshots = unionBy<AccountSnapshot>(loser.accountSnapshots ?? [], winner.accountSnapshots ?? [], row => `${row.accountId}|${row.date}`)
    .filter(row => alive(row.accountId))
    .sort((a, b) => `${a.date}-${a.accountId}`.localeCompare(`${b.date}-${b.accountId}`));
  const snapshots = unionBy<Snapshot>(loser.snapshots ?? [], winner.snapshots ?? [], row => row.date).sort((a, b) => a.date.localeCompare(b.date));
  const latest = (a?: string, b?: string) => (a ?? "") >= (b ?? "") ? a : b;
  return {
    ...loser, ...winner,
    accounts,
    liabilities: unionBy(loser.liabilities ?? [], winner.liabilities ?? [], byId).filter(item => alive(item.id)),
    holdings: unionBy(loser.holdings ?? [], winner.holdings ?? [], byId).filter(item => alive(item.id) && alive(item.accountId)),
    goals: unionBy<Goal>(loser.goals ?? [], winner.goals ?? [], byId).filter(item => alive(item.id)),
    snapshots, accountSnapshots, deleted,
    lastPriceSync: latest(local.lastPriceSync, remote.lastPriceSync),
    lastPriceSyncAt: latest(local.lastPriceSyncAt, remote.lastPriceSyncAt)
  };
}
