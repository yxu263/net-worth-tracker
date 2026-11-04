"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, House as HouseIcon, Landmark, Plus, RefreshCw, Settings2, Trash2, TrendingUp, X } from "lucide-react";
import { accountTypes, demoData, returnLabel, selfCompounding, type Account, type AccountSnapshot, type AccountType, type Holding, type Liability, type TrackerData } from "@/lib/types";
import { acceptsContributions, amortize, expectedBalance, payoffDate, payoffLabel, payoffMonths, projectAccountSeries } from "@/lib/forecast";
import type { SourceHistoryRow } from "@/lib/source-import";
import { buildNetWorthSeries, type RangeKey } from "@/lib/history";
import { fetchQuote, fetchQuotes } from "@/lib/pricing";
import { todayIso } from "@/lib/date";
import { mergeData, normalizeTrackerData, parseEnvelope, toEnvelope } from "@/lib/backup";
import { fetchRemote, uploadRemote } from "@/lib/github-sync";
import { defaultSettings, loadSettings, loadSyncState, saveSettings, saveSyncState, syncConfigured, syncTarget, type AppSettings, type SyncState } from "@/lib/settings";
import { downloadFile } from "@/lib/export";
import NetWorthChart from "@/components/net-worth-chart";
import SettingsForm from "@/components/settings-form";
import ExportPanel from "@/components/export-panel";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const priceText = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const safeNumber = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
/** Plain-English source of a quote so a stale close is never mistaken for a live price. */
const basisLabel = (quote?: { basis?: string; asOf?: string; asOfTime?: string }) => {
  if (!quote) return "price updated";
  const clock = quote.asOfTime ? new Date(quote.asOfTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  if (quote.basis === "live") return `live as of ${clock || "now"}`;
  if (quote.basis === "todayClose") return `today's close (${quote.asOf})`;
  return `previous close (${quote.asOf})`;
};
/** Regular US session, used only to decide how often to poll; the server sets the real basis. */
const marketLikelyOpen = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const read = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  if (["Sat", "Sun"].includes(read("weekday"))) return false;
  const minutes = Number(read("hour")) * 60 + Number(read("minute"));
  return Number.isFinite(minutes) && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
};
/** Normalises a ticker so the same symbol groups together regardless of case or stray spacing. */
const tickerKey = (ticker: string) => (ticker ?? "").trim().toUpperCase();
const id = () => Math.random().toString(36).slice(2, 9);
const parseCsvLine = (line: string) => {
  const cells: string[] = []; const pattern = /("([^"]|"")*"|[^,]*)(,|$)/g; let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) { cells.push((match[1] ?? "").replace(/^"|"$/g, "").replace(/""/g, '"')); if (match[3] === "") break; }
  return cells;
};
const normalizeName = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const parseSourceDate = (value: string) => {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
};
/** An imported account is a debt when its name says so, or when it already exists as a liability. */
const debtPattern = /\b(debt|mortgage|loan|credit)\b/i;
const sourceIsDebt = (name: string, liabilities: Liability[] = []) => {
  const key = normalizeName(name);
  return debtPattern.test(name) || liabilities.some(item => item.id === key || normalizeName(item.name) === key);
};
const sourceIsProperty = (name: string) => name.trim().toLowerCase() === "home";
const accountTotal = (account: Account, holdings: Holding[]) => account.cashConfigured ? safeNumber(account.balance) + holdings.filter(holding => holding.accountId === account.id).reduce((sum, holding) => sum + safeNumber(holding.quantity) * safeNumber(holding.price), 0) : safeNumber(account.balance);
/**
 * Reads saved data. `failed` is true only when stored data existed but could not be read,
 * which must never be persisted over the original: the raw text is copied aside instead.
 */
/**
 * Folds future-dated history back onto today.
 *
 * Builds before the local-date fix stamped entries with the UTC date, so anything saved
 * after ~8pm Eastern was filed under tomorrow and drew a point in the future. Those rows
 * are really "as of now", so they are re-dated to today rather than discarded — and
 * dropped outright when today already has a genuine entry, which wins. A clock set wrong
 * once is healed the same way. No past data is touched.
 */
function healFutureDates(data: TrackerData, today: string): { data: TrackerData; healed: number } {
  const futureAggregate = data.snapshots.filter(item => item.date > today);
  const futureAccounts = data.accountSnapshots.filter(item => item.date > today);
  if (!futureAggregate.length && !futureAccounts.length) return { data, healed: 0 };

  const snapshots = data.snapshots.filter(item => item.date <= today);
  if (!snapshots.some(item => item.date === today)) {
    // Keep the newest of the stranded entries; it reflects the most recent state.
    const newest = futureAggregate.reduce((latest, item) => item.date > latest.date ? item : latest);
    snapshots.push({ ...newest, date: today });
    snapshots.sort((a, b) => a.date.localeCompare(b.date));
  }

  const accountSnapshots = data.accountSnapshots.filter(item => item.date <= today);
  const hasToday = new Set(accountSnapshots.filter(item => item.date === today).map(item => item.accountId));
  const newestByAccount = new Map<string, AccountSnapshot>();
  for (const item of futureAccounts) {
    const current = newestByAccount.get(item.accountId);
    if (!current || item.date > current.date) newestByAccount.set(item.accountId, item);
  }
  for (const [accountId, item] of newestByAccount) {
    if (hasToday.has(accountId)) continue;
    accountSnapshots.push({ ...item, date: today });
  }
  accountSnapshots.sort((a, b) => `${a.date}-${a.accountId}`.localeCompare(`${b.date}-${b.accountId}`));

  return { data: { ...data, snapshots, accountSnapshots }, healed: futureAggregate.length + futureAccounts.length };
}

function loadData(): { data: TrackerData; failed: boolean } {
  if (typeof window === "undefined") return { data: demoData, failed: false };
  const raw = window.localStorage.getItem("nest-egg-data");
  if (!raw) return { data: demoData, failed: false };
  try {
    const parsed = JSON.parse(raw) as Partial<TrackerData>;
    const merged: TrackerData = {
      ...demoData, ...parsed,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : demoData.accounts,
      liabilities: Array.isArray(parsed.liabilities) ? parsed.liabilities : demoData.liabilities,
      holdings: Array.isArray(parsed.holdings) ? parsed.holdings : demoData.holdings,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      accountSnapshots: Array.isArray(parsed.accountSnapshots) ? parsed.accountSnapshots : []
    };
    const { data, healed } = healFutureDates(merged, todayIso());
    if (healed) console.info(`Net Worth Tracker: moved ${healed} future-dated record(s) onto ${todayIso()}.`);
    return { data, failed: false };
  } catch (error) {
    console.error("Unable to read saved tracker data; it has been preserved under nest-egg-data.corrupt", error);
    try { window.localStorage.setItem("nest-egg-data.corrupt", raw); } catch { /* nothing else to do */ }
    return { data: demoData, failed: true };
  }
}
const today = () => todayIso();
/** How often to re-quote while the regular session is running. Kept conservative so
 * Yahoo's public endpoint is not rate-limited or blocked. */
const priceRefreshMs = 60 * 60 * 1000;
/** How often the timer wakes to see whether a refresh is due; no request is sent
 * unless `priceRefreshMs` has elapsed, so this costs nothing extra. */
const priceCheckMs = 5 * 60 * 1000;
const upsertAccountSnapshot = (snapshots: AccountSnapshot[], accountId: string, date: string, balance: number) =>
  [...snapshots.filter(snapshot => !(snapshot.accountId === accountId && snapshot.date === date)), { accountId, date, balance }]
    .sort((a, b) => `${a.date}-${a.accountId}`.localeCompare(`${b.date}-${b.accountId}`));
const totals = (current: TrackerData) => {
  const assets = (current.accounts ?? []).reduce((sum, account) => sum + accountTotal(account, current.holdings ?? []), 0);
  const liabilities = (current.liabilities ?? []).reduce((sum, liability) => sum + safeNumber(liability.balance), 0);
  return { assets, liabilities, netWorth: assets - liabilities };
};
/** Sub-cent tolerance, so recomputing the same figures never looks like a change. */
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** True when today's stored history already matches the live figures. */
function snapshotCurrent(current: TrackerData, date: string) {
  const { assets, liabilities } = totals(current);
  const aggregate = (current.snapshots ?? []).find(item => item.date === date);
  if (!aggregate || !sameMoney(aggregate.assets, assets) || !sameMoney(aggregate.liabilities, liabilities)) return false;
  const saved = new Map((current.accountSnapshots ?? []).filter(item => item.date === date).map(item => [item.accountId, item.balance]));
  return (current.accounts ?? []).every(account => {
    const balance = saved.get(account.id);
    return balance !== undefined && sameMoney(balance, accountTotal(account, current.holdings ?? []));
  });
}
/**
 * Records `date` as an aggregate entry plus one entry per account, at each account's
 * displayed total (cash plus linked holdings) so composed accounts keep their holdings.
 * Idempotent by date: an existing entry for the same day is replaced, never duplicated.
 */
function withSnapshot(current: TrackerData, date: string): TrackerData {
  const { assets, liabilities, netWorth } = totals(current);
  return {
    ...current,
    snapshots: [...(current.snapshots ?? []).filter(item => item.date !== date), { date, assets, liabilities, netWorth }].sort((a, b) => a.date.localeCompare(b.date)),
    accountSnapshots: (current.accounts ?? []).reduce((all, account) => upsertAccountSnapshot(all, account.id, date, accountTotal(account, current.holdings ?? [])), current.accountSnapshots ?? []),
  };
}

/** Existing dated balances an import would replace with a different number. */
function findImportConflicts(rows: SourceHistoryRow[], existing: AccountSnapshot[]) {
  const current = new Map(existing.map(row => [`${row.accountId}-${row.date}`, row.balance]));
  const accounts = new Map<string, number>();
  let changed = 0; let identical = 0; let earliest = ""; let latest = "";
  for (const row of rows) {
    const previous = current.get(`${row.accountId}-${row.date}`);
    if (previous === undefined) continue;
    if (previous === row.balance) { identical += 1; continue; }
    changed += 1;
    accounts.set(row.accountName, (accounts.get(row.accountName) ?? 0) + 1);
    if (!earliest || row.date < earliest) earliest = row.date;
    if (!latest || row.date > latest) latest = row.date;
  }
  return { changed, identical, earliest, latest, accounts: [...accounts.entries()].sort((a, b) => b[1] - a[1]) };
}

export default function Home() {
  const [data, setData] = useState<TrackerData>(demoData);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<"accounts" | "holdings" | "forecast">("accounts");
  const [modal, setModal] = useState<"account" | "liability" | "holding" | null>(null);
  const [editing, setEditing] = useState<Account | Liability | Holding | null>(null);
  const [tickerEdit, setTickerEdit] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [focusAccountId, setFocusAccountId] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<RangeKey>("30d");
  const [pricing, setPricing] = useState(false);
  const autoPricedRef = useRef(false);
  const lastSyncAtRef = useRef(0);
  const [folderPreview, setFolderPreview] = useState<{ rows: SourceHistoryRow[]; names: string[]; files: string[]; institution: string; title: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const hadStoredRef = useRef(false);
  const [panel, setPanel] = useState<"settings" | "export" | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [syncInfo, setSyncInfo] = useState<{ text: string; kind: "ok" | "busy" | "warn" | "err" | null; detail?: string | null; error?: string | null }>({ text: "Local only", kind: null });
  // Until the first pull finishes, today's snapshot and price refresh wait, so a stale
  // device never records old balances as "today" and then pushes them over newer data.
  const [syncReady, setSyncReady] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const loadFailedRef = useRef(loadFailed);
  loadFailedRef.current = loadFailed;
  const settingsRef = useRef<AppSettings>(defaultSettings);
  const syncStateRef = useRef<SyncState>({});
  const syncBusyRef = useRef(false);
  const pushTimerRef = useRef<number | undefined>(undefined);
  const lastPullRef = useRef(0);
  /** The data object last loaded from storage or GitHub; anything else is a local edit. */
  const cleanDataRef = useRef<TrackerData | null>(null);
  useEffect(() => {
    hadStoredRef.current = typeof window !== "undefined" && !!window.localStorage.getItem("nest-egg-data");
    const result = loadData();
    cleanDataRef.current = result.data;
    setData(result.data);
    setLoadFailed(result.failed);
    loadFailedRef.current = result.failed;
    const stored = loadSettings();
    settingsRef.current = stored;
    setSettings(stored);
    syncStateRef.current = loadSyncState();
    setHydrated(true);
    if (syncConfigured(stored.github)) void runSync().finally(() => setSyncReady(true));
    else { refreshSyncInfo(); setSyncReady(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    // Never let the demo fallback overwrite real saved data.
    if (loadFailed) return;
    if (data === demoData && hadStoredRef.current) return;
    if (data !== cleanDataRef.current) markDirty();
    const persist = () => window.localStorage.setItem("nest-egg-data", JSON.stringify(data));
    const idle = window.setTimeout(persist, 0);
    return () => window.clearTimeout(idle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hydrated, loadFailed]);
  // Pick up edits made on another device when this tab comes back into view.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const maybePull = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (Date.now() - lastPullRef.current < 60 * 1000) return;
      void runSync();
    };
    document.addEventListener("visibilitychange", maybePull);
    window.addEventListener("online", maybePull);
    return () => { document.removeEventListener("visibilitychange", maybePull); window.removeEventListener("online", maybePull); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  function persistSyncState() { saveSyncState(syncStateRef.current); refreshSyncInfo(); }
  function refreshSyncInfo() {
    const state = syncStateRef.current;
    const detail = state.lastSyncedAt ? `Last synced ${new Date(state.lastSyncedAt).toLocaleString()}${state.lastMessage ? ` · ${state.lastMessage}` : ""}` : null;
    if (!syncConfigured(settingsRef.current.github)) { setSyncInfo({ text: "Local only", kind: null, detail: "Sync is off; data lives only in this browser." }); return; }
    if (syncBusyRef.current) { setSyncInfo({ text: "Syncing…", kind: "busy", detail }); return; }
    if (state.lastError) { setSyncInfo({ text: "Sync error", kind: "err", detail, error: state.lastError }); return; }
    if (typeof navigator !== "undefined" && !navigator.onLine) { setSyncInfo({ text: "Offline · changes queued", kind: "warn", detail }); return; }
    if (state.pending) { setSyncInfo({ text: "Upload pending", kind: "warn", detail }); return; }
    setSyncInfo({ text: state.lastSyncedAt ? `Synced ${new Date(state.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not synced yet", kind: "ok", detail });
  }
  function markDirty() {
    const state = syncStateRef.current;
    state.pending = true;
    state.localEditedAt = new Date().toISOString();
    persistSyncState();
    if (!syncConfigured(settingsRef.current.github)) return;
    window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(() => void runSync(), 3000);
  }
  /** Replaces local data with a copy from GitHub without counting it as a local edit. */
  function applyRemote(next: TrackerData) {
    cleanDataRef.current = next;
    dataRef.current = next;
    setData(next);
    if (loadFailedRef.current) { loadFailedRef.current = false; setLoadFailed(false); }
  }
  /**
   * Reconciles this device with the GitHub file. Pull when only GitHub changed, push when
   * only this device changed, and merge (newer edit wins per record) when both did. A
   * stale sha means another device wrote in between: re-read, merge and retry once.
   */
  async function runSync(interactive = false) {
    const gh = settingsRef.current.github;
    if (!syncConfigured(gh) || syncBusyRef.current) return;
    syncBusyRef.current = true;
    lastPullRef.current = Date.now();
    refreshSyncInfo();
    const state = syncStateRef.current;
    const editedBefore = state.localEditedAt ?? null;
    const finish = (sha: string | null, remoteStamp: string | null, message: string) => {
      state.sha = sha; state.remoteStamp = remoteStamp; state.target = syncTarget(gh);
      state.pending = (state.localEditedAt ?? null) !== editedBefore;
      state.firstSync = false; state.lastError = null; state.lastMessage = message;
      state.lastSyncedAt = new Date().toISOString();
      if (interactive) flash(message);
    };
    try {
      const remote = await fetchRemote(gh);
      if (!remote.exists) {
        if (loadFailedRef.current) throw new Error("This device's data is unreadable, so nothing was uploaded.");
        const stamp = new Date().toISOString();
        const sha = await uploadRemote(gh, toEnvelope(dataRef.current, stamp), null);
        if (sha === null) throw new Error("The GitHub file appeared during upload. Try again.");
        finish(sha, stamp, "Created the data file on GitHub.");
        return;
      }
      const remoteChanged = remote.updatedAt !== (state.remoteStamp ?? null);
      const localChanged = !!state.pending && !loadFailedRef.current;
      let mode: "none" | "pull" | "push" | "merge";
      if (state.firstSync || state.target !== syncTarget(gh)) {
        mode = loadFailedRef.current || !hadStoredRef.current || window.confirm("A Net Worth Tracker data file already exists on GitHub.\n\nOK: replace this device's data with the GitHub copy.\nCancel: merge this device's data into the GitHub copy.") ? "pull" : "merge";
      } else mode = !localChanged && !remoteChanged ? "none" : !localChanged ? "pull" : !remoteChanged ? "push" : "merge";

      if (mode === "none") { finish(remote.sha, remote.updatedAt, "Already up to date."); return; }
      if (mode === "pull") { applyRemote(normalizeTrackerData(remote.data)); finish(remote.sha, remote.updatedAt, "Loaded the latest data from GitHub."); return; }
      let outgoing = dataRef.current;
      if (mode === "merge") { outgoing = mergeData(dataRef.current, remote.data, (state.localEditedAt ?? "") >= (remote.updatedAt ?? "")); applyRemote(outgoing); }
      const stamp = new Date().toISOString();
      let sha = await uploadRemote(gh, toEnvelope(outgoing, stamp), remote.sha);
      if (sha === null) {
        const again = await fetchRemote(gh);
        if (!again.exists) throw new Error("The GitHub file disappeared during upload. Try again.");
        outgoing = mergeData(outgoing, again.data, true);
        applyRemote(outgoing);
        sha = await uploadRemote(gh, toEnvelope(outgoing, stamp), again.sha);
        if (sha === null) throw new Error("The GitHub file kept changing. Try again.");
      }
      finish(sha, stamp, mode === "merge" ? "Merged this device with GitHub." : "Uploaded changes to GitHub.");
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "Sync failed";
      if (interactive) flash(`Sync failed: ${state.lastError}`);
    } finally {
      syncBusyRef.current = false;
      persistSyncState();
      // Edits made while this sync was running still need to go up.
      if (state.pending && !state.lastError && syncConfigured(gh)) { window.clearTimeout(pushTimerRef.current); pushTimerRef.current = window.setTimeout(() => void runSync(), 3000); }
    }
  }
  function saveAppSettings(next: AppSettings) {
    const targetChanged = syncTarget(next.github) !== syncTarget(settingsRef.current.github);
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
    if (targetChanged) { syncStateRef.current = { pending: syncStateRef.current.pending, localEditedAt: syncStateRef.current.localEditedAt, firstSync: true }; persistSyncState(); }
    setPanel(null);
    if (syncConfigured(next.github)) void runSync(true);
    else { refreshSyncInfo(); flash("Settings saved"); }
  }
  function disconnectSync() {
    const next = { ...settingsRef.current, github: { ...settingsRef.current.github, token: "" } };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
    syncStateRef.current = { pending: syncStateRef.current.pending, localEditedAt: syncStateRef.current.localEditedAt, firstSync: true };
    persistSyncState();
    flash("Sync turned off on this device");
  }
  // Pull the latest quote on open: live during the session, otherwise the most recent close.
  useEffect(() => {
    if (!hydrated || !syncReady || autoPricedRef.current) return;
    if (!settings.priceProxyUrl) return;
    if (!data.holdings.some(holding => holding.ticker.trim())) return;
    const syncedAt = data.lastPriceSyncAt ? Date.parse(data.lastPriceSyncAt) : NaN;
    const staleForSession = marketLikelyOpen() && !(Number.isFinite(syncedAt) && Date.now() - syncedAt < priceRefreshMs);
    if (data.lastPriceSync === today() && !staleForSession) return;
    autoPricedRef.current = true;
    void syncPrices(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, syncReady, settings.priceProxyUrl, data.holdings, data.lastPriceSync, data.lastPriceSyncAt]);
  // While the market is open the last trade keeps moving, so keep it current.
  // The timer only *checks* often; `priceRefreshMs` gates the actual request, so
  // Yahoo is hit at most once an hour while the tab reacts promptly to the open.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    if (!data.holdings.some(holding => holding.ticker.trim())) return;
    const tick = () => {
      if (!marketLikelyOpen() || document.visibilityState !== "visible") return;
      if (Date.now() - lastSyncAtRef.current < priceRefreshMs) return;
      void syncPrices(true);
    };
    const timer = window.setInterval(tick, priceCheckMs);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, data.holdings.length]);
  // Track the calendar day so an app left open overnight still records the new day.
  const [dayStamp, setDayStamp] = useState(today);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => setDayStamp(current => { const now = today(); return now === current ? current : now; });
    const timer = window.setInterval(check, 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, []);
  // Save history automatically: once the app is open it records today's figures, and
  // re-records them whenever the numbers move (prices, edits, imports). Idempotent by
  // date, so this replaces today's entry rather than adding duplicates.
  useEffect(() => {
    if (!hydrated || !syncReady || loadFailed) return;
    if (data === demoData && hadStoredRef.current) return;
    if (!(data.accounts ?? []).length && !(data.liabilities ?? []).length) return;
    if (snapshotCurrent(data, dayStamp)) return;
    setData(current => withSnapshot(current, dayStamp));
  }, [hydrated, syncReady, loadFailed, data, dayStamp]);
  const assets = useMemo(() => data.accounts.reduce((sum, account) => sum + accountTotal(account, data.holdings), 0), [data]);
  const debts = useMemo(() => data.liabilities.reduce((sum, liability) => sum + liability.balance, 0), [data]);
  const netWorth = assets - debts;
  const netWorthSeries = useMemo(() => buildNetWorthSeries(data.accountSnapshots ?? [], data.snapshots ?? []), [data.accountSnapshots, data.snapshots]);
  const focusAccount = focusAccountId ? data.accounts.find(account => account.id === focusAccountId) ?? null : null;
  const accountSeries = useMemo(() => focusAccountId ? buildNetWorthSeries((data.accountSnapshots ?? []).filter(row => row.accountId === focusAccountId)) : [], [data.accountSnapshots, focusAccountId]);
  const importConflicts = useMemo(() => folderPreview ? findImportConflicts(folderPreview.rows, data.accountSnapshots ?? []) : null, [folderPreview, data.accountSnapshots]);
  function focusOnAccount(account: Account) { setFocusAccountId(account.id); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 4000); }
  function closeModal() { setModal(null); setEditing(null); }
  function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const existing = editing as Account | null;
    const cash = Number(form.get("cash"));
    if (!Number.isFinite(cash)) return;
    const account: Account = { id: existing?.id ?? id(), name: String(form.get("name")), institution: String(form.get("institution")), type: String(form.get("type")) as AccountType, balance: cash, color: existing?.color ?? "#8aa9e8", cashConfigured: true, expectedAnnualReturn: Number(form.get("expectedAnnualReturn") ?? 0) || 0, monthlyContribution: Math.max(0, Number(form.get("monthlyContribution") ?? 0) || 0), contributionGrowth: form.get("contributionGrowth") === "on", contributionGrowthRate: Number(form.get("contributionGrowthRate") ?? 0) || 0, contributionTarget: String(form.get("contributionTarget") ?? "pro-rata"), contributionYears: Math.max(0, Number(form.get("contributionYears") ?? 0) || 0) };
    const linked = data.holdings.filter(holding => holding.accountId === account.id);
    const total = cash + linked.reduce((sum, holding) => sum + safeNumber(holding.quantity) * safeNumber(holding.price), 0);
    setData(current => ({ ...current, accounts: existing ? current.accounts.map(item => item.id === account.id ? account : item) : [...current.accounts, account], accountSnapshots: upsertAccountSnapshot(current.accountSnapshots ?? [], account.id, today(), total) }));
    closeModal();
    flash(`${account.name} set to ${money(total)}${linked.length ? ` (${money(cash)} cash + ${linked.length} holding${linked.length === 1 ? "" : "s"})` : ""}`);
    if (linked.length) void syncPrices(true);
  }
  function saveLiability(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const previous = editing as Liability | null;
    const balance = Number(form.get("balance"));
    // Stamp the balance date only when the figure itself changes, so editing a rate or
    // payment does not reset the clock on the catch-up projection.
    const balanceAsOf = previous && safeNumber(previous.balance) === balance ? previous.balanceAsOf ?? today() : today();
    const liability: Liability = { id: previous?.id ?? id(), name: String(form.get("name")), institution: String(form.get("institution")), balance, rate: Number(form.get("rate")), monthlyPayment: Math.max(0, Number(form.get("monthlyPayment") ?? 0) || 0), extraMonthly: Math.max(0, Number(form.get("extraMonthly") ?? 0) || 0), balanceAsOf };
    setData(current => ({ ...current, liabilities: editing ? current.liabilities.map(item => item.id === liability.id ? liability : item) : [...current.liabilities, liability] })); closeModal();
  }
  /** Applies the amortized catch-up a user explicitly accepted, and dates it today. */
  function catchUpLiability(liability: Liability, balance: number) {
    const date = today();
    setData(current => ({ ...current, liabilities: current.liabilities.map(item => item.id === liability.id ? { ...item, balance, balanceAsOf: date } : item), accountSnapshots: upsertAccountSnapshot(current.accountSnapshots ?? [], liability.id, date, -balance) }));
    flash(`${liability.name} updated to ${money(balance)}`);
  }
  function saveHolding(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const existing = editing as Holding | null;
    const ticker = tickerKey(String(form.get("ticker")));
    // Expected return lives at the ticker level, so a new position inherits whatever the symbol already uses.
    const inherited = existing?.expectedAnnualReturn ?? data.holdings.find(item => tickerKey(item.ticker) === ticker)?.expectedAnnualReturn ?? 0;
    const holding: Holding = { id: existing?.id ?? id(), accountId: String(form.get("accountId")), ticker, quantity: Number(form.get("quantity")), costBasis: Number(form.get("costBasis")), price: Number(form.get("price")) || 0, expectedAnnualReturn: safeNumber(inherited), priceUpdatedAt: existing?.priceUpdatedAt };
    setData(current => ({ ...current, holdings: editing ? current.holdings.map(item => item.id === holding.id ? holding : item) : [...current.holdings, holding] })); closeModal();
    void priceHolding(holding.id, holding.ticker);
  }
  /** Expected return is a property of the symbol, so saving it rewrites every position in that ticker. */
  function saveTickerReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ticker = tickerKey(String(form.get("ticker")));
    const rate = Number(form.get("expectedAnnualReturn") ?? 0) || 0;
    const touched = data.holdings.filter(holding => tickerKey(holding.ticker) === ticker).length;
    setData(current => ({ ...current, holdings: current.holdings.map(holding => tickerKey(holding.ticker) === ticker ? { ...holding, expectedAnnualReturn: rate } : holding) }));
    setTickerEdit(null);
    flash(`${ticker} set to ${rate}% across ${touched} account${touched === 1 ? "" : "s"}`);
  }
  /** Deleting an account or liability also drops its dated snapshots, and an account drops its linked holdings, so nothing lingers in history totals. */
  function remove(kind: "accounts" | "liabilities" | "holdings", itemId: string) {
    setData(current => {
      const next: TrackerData = { ...current, [kind]: current[kind].filter(item => item.id !== itemId) };
      if (kind === "accounts" || kind === "liabilities") next.accountSnapshots = (current.accountSnapshots ?? []).filter(snapshot => snapshot.accountId !== itemId);
      if (kind === "accounts") next.holdings = (current.holdings ?? []).filter(holding => holding.accountId !== itemId);
      return next;
    });
  }
  const savedToday = useMemo(() => (data.snapshots ?? []).some(item => item.date === dayStamp), [data.snapshots, dayStamp]);

  async function syncPrices(auto = false) {
    const tickers = [...new Set(data.holdings.map(holding => holding.ticker.trim().toUpperCase()).filter(Boolean))];
    if (!tickers.length) { if (!auto) flash("Add a holding with a ticker first"); return; }
    const proxy = settingsRef.current.priceProxyUrl;
    if (!proxy) { if (!auto) { flash("Set your price proxy URL in Settings to look up prices"); setPanel("settings"); } return; }
    lastSyncAtRef.current = Date.now();
    setPricing(true);
    try {
      const payload = await fetchQuotes(tickers, proxy);
      const quotes = new Map(payload.quotes.map(quote => [quote.ticker, quote]));
      if (!quotes.size) { flash(`Price lookup failed: ${payload.errors[0] ?? "no quotes returned"}`); return; }
      setData(current => ({ ...current, lastPriceSync: today(), lastPriceSyncAt: new Date().toISOString(), holdings: current.holdings.map(holding => { const quote = quotes.get(holding.ticker.trim().toUpperCase()); return quote ? { ...holding, price: quote.price, priceUpdatedAt: quote.asOf, priceUpdatedAtTime: quote.asOfTime, priceBasis: quote.basis, previousClose: quote.previousClose, changePercent: quote.changePercent } : holding; }) }));
      const first = [...quotes.values()][0];
      const failed = payload.errors.length;
      flash(`${quotes.size} price${quotes.size === 1 ? "" : "s"} updated · ${basisLabel(first)}${failed ? ` · ${failed} not found` : ""}`);
    } catch (error) { flash(`Price lookup failed: ${error instanceof Error ? error.message : "unknown error"}`); }
    finally { setPricing(false); }
  }
  /** Looks up one symbol right after it is added or edited so values are never left at zero. */
  async function priceHolding(holdingId: string, ticker: string) {
    const symbol = ticker.trim().toUpperCase();
    if (!symbol) return;
    const proxy = settingsRef.current.priceProxyUrl;
    if (!proxy) { flash(`${symbol} saved. Set your price proxy URL in Settings to look up its price.`); return; }
    setPricing(true);
    try {
      const payload = await fetchQuote(symbol, proxy);
      setData(current => ({ ...current, holdings: current.holdings.map(holding => holding.id === holdingId ? { ...holding, price: payload.price, priceUpdatedAt: payload.asOf, priceUpdatedAtTime: payload.asOfTime, priceBasis: payload.basis, previousClose: payload.previousClose, changePercent: payload.changePercent } : holding) }));
      flash(`${payload.ticker} priced at ${priceText(payload.price)} · ${basisLabel(payload)}`);
    } catch (error) { flash(error instanceof Error ? error.message : `${symbol}: price lookup failed`); }
    finally { setPricing(false); }
  }
  function confirmDataFolderImport() {
    if (!folderPreview) return;
    const preview = folderPreview;
    setImporting(true);
    window.setTimeout(() => {
    const latest = new Map<string, SourceHistoryRow>(); const latestByAccount = new Map<string, SourceHistoryRow>();
    preview.rows.forEach(row => { latest.set(`${row.accountId}-${row.date}`, row); const prior = latestByAccount.get(row.accountId); if (!prior || row.date >= prior.date) latestByAccount.set(row.accountId, row); });
    setData(current => {
      const accounts = [...current.accounts]; const liabilities = [...current.liabilities];
      latestByAccount.forEach(latestRow => { const name = latestRow.accountName; if (latestRow.debt) { const existing = liabilities.find(item => item.id === latestRow.accountId); if (existing) existing.balance = Math.abs(latestRow.balance); else liabilities.push({ id: latestRow.accountId, name, institution: preview.institution, balance: Math.abs(latestRow.balance), rate: 0 }); } else { const existing = accounts.find(item => item.id === latestRow.accountId); if (existing) { if (!existing.cashConfigured) existing.balance = latestRow.balance; } else accounts.push({ id: latestRow.accountId, name, institution: preview.institution, type: sourceIsProperty(name) ? "property" : "other", balance: latestRow.balance, color: sourceIsProperty(name) ? "#d8ae75" : "#8aa9e8", expectedAnnualReturn: 0 }); } });
      const snapshotMap = new Map((current.accountSnapshots ?? []).map(row => [`${row.accountId}-${row.date}`, row]));
      latest.forEach((row, key) => snapshotMap.set(key, { accountId: row.accountId, date: row.date, balance: row.balance }));
      return { ...current, accounts, liabilities, accountSnapshots: [...snapshotMap.values()].sort((a, b) => a.date.localeCompare(b.date)) };
    });
    setFolderPreview(null);
    setImporting(false);
    flash(`Imported ${preview.names.length} accounts from ${preview.files.length} file${preview.files.length === 1 ? "" : "s"}`);
    }, 0);
  }
  function exportCsv() {
    const rows = ["type,id,name,institution,accountType,balance,rate,accountId,ticker,quantity,costBasis,price", ...data.accounts.map(a => `account,${a.id},"${a.name}","${a.institution}",${a.type},${a.balance},,,,,,`), ...data.liabilities.map(l => `liability,${l.id},"${l.name}","${l.institution}",,${l.balance},${l.rate},,,,,`), ...data.holdings.map(h => `holding,${h.id},,,, , ,${h.accountId},${h.ticker},${h.quantity},${h.costBasis},${h.price}`)];
    downloadFile(`net-worth-positions-${today()}.csv`, rows.join("\n"), "text/csv");
  }
  function exportBackup() {
    downloadFile(`net-worth-backup-${today()}.json`, JSON.stringify(toEnvelope(data), null, 1), "application/json");
    flash("Backup downloaded");
  }
  function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: ReturnType<typeof parseEnvelope>;
      try { parsed = parseEnvelope(String(reader.result)); } catch (error) { flash(`Backup not imported: ${error instanceof Error ? error.message : "unreadable file"}`); return; }
      const { data: incoming, updatedAt } = parsed;
      const summary = `${incoming.accounts.length} accounts, ${incoming.liabilities.length} debts, ${incoming.holdings.length} holdings, ${incoming.accountSnapshots.length.toLocaleString()} history rows${updatedAt ? `, saved ${new Date(updatedAt).toLocaleString()}` : ""}`;
      if (!window.confirm(`Replace ALL data on this device with this backup?\n\n${summary}\n\nTip: export a backup of the current data first if you might need it.`)) return;
      setLoadFailed(false);
      setData(incoming);
      flash("Backup imported");
    };
    reader.readAsText(file);
  }
  function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result).split(/\r?\n/).slice(1).filter(Boolean); const imported: Partial<TrackerData> = { accounts: [], liabilities: [], holdings: [] };
      lines.forEach(line => { const cells = parseCsvLine(line).map(cell => cell.trim()); if (cells[0] === "account") imported.accounts?.push({ id: cells[1], name: cells[2], institution: cells[3], type: (cells[4] || "other") as AccountType, balance: Number(cells[5]), color: "#8aa9e8" }); if (cells[0] === "liability") imported.liabilities?.push({ id: cells[1], name: cells[2], institution: cells[3], balance: Number(cells[5]), rate: Number(cells[6]) }); if (cells[0] === "holding") imported.holdings?.push({ id: cells[1], accountId: cells[7], ticker: cells[8], quantity: Number(cells[9]), costBasis: Number(cells[10]), price: Number(cells[11]) }); });
      const accountSnapshots = (imported.accounts ?? []).reduce((all, account) => upsertAccountSnapshot(all, account.id, today(), account.balance), [...(data.accountSnapshots ?? [])]);
      setData(current => {
        const importedAccounts = new Map((imported.accounts ?? []).map(account => [account.id, account]));
        const importedLiabilities = new Map((imported.liabilities ?? []).map(item => [item.id, item]));
        const importedHoldings = new Map((imported.holdings ?? []).map(item => [item.id, item]));
        return { ...current, accounts: [...current.accounts.map(account => importedAccounts.get(account.id) ?? account), ...[...importedAccounts.values()].filter(account => !current.accounts.some(existing => existing.id === account.id))], liabilities: [...current.liabilities.map(item => importedLiabilities.get(item.id) ?? item), ...[...importedLiabilities.values()].filter(item => !current.liabilities.some(existing => existing.id === item.id))], holdings: [...current.holdings.map(item => importedHoldings.get(item.id) ?? item), ...[...importedHoldings.values()].filter(item => !current.holdings.some(existing => existing.id === item.id))], accountSnapshots };
      });
      setNotice("CSV imported; existing records preserved"); setTimeout(() => setNotice(""), 2500);
    }; reader.readAsText(file); event.target.value = "";
  }
  function importAccountHistory(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].filter(file => file.name.toLowerCase().endsWith(".csv"));
    if (!files.length) { if (event.target.files?.length) flash("No .csv files found in that selection"); event.target.value = ""; return; }
    const input = event.target;
    let completed = 0; const allRows: SourceHistoryRow[] = []; const errors: string[] = []; const sourceNames = new Set<string>(); const fileNames: string[] = [];
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const lines = String(reader.result).split(/\r?\n/).filter(Boolean);
        if (lines[0]?.trim().toLowerCase() !== "date,balance,account") { errors.push(`${file.name}: header must be Date,Balance,Account`); }
        lines.slice(1).forEach((line, index) => {
          const [dateText, balanceText, accountName] = parseCsvLine(line).map(cell => cell.trim());
          const date = parseSourceDate(dateText); const parsedBalance = Number(balanceText); const debt = sourceIsDebt(accountName ?? "", data.liabilities);
          if (!date || Number.isNaN(Date.parse(`${date}T12:00:00`))) errors.push(`${file.name} row ${index + 2}: invalid date`);
          if (!Number.isFinite(parsedBalance)) errors.push(`${file.name} row ${index + 2}: invalid balance`);
          if (!accountName) errors.push(`${file.name} row ${index + 2}: missing account`);
          if (date && Number.isFinite(parsedBalance) && accountName) { sourceNames.add(accountName); allRows.push({ accountId: normalizeName(accountName), accountName, date, balance: debt ? -Math.abs(parsedBalance) : parsedBalance, debt }); }
        });
        fileNames.push(file.name);
        completed += 1;
        if (completed !== files.length) return;
        input.value = "";
        if (errors.length) { flash(`${errors.length} import error${errors.length === 1 ? "" : "s"}: ${errors.slice(0, 2).join(" · ")}`); return; }
        // An account recorded only as negative balances is a debt even if its name does not say so.
        const negativeOnly = new Set([...sourceNames].filter(name => { const rows = allRows.filter(row => row.accountName === name); return rows.some(row => row.balance < 0) && rows.every(row => row.balance <= 0); }));
        allRows.forEach(row => { if (!row.debt && negativeOnly.has(row.accountName)) row.debt = true; });
        setFolderPreview({ rows: allRows, names: [...sourceNames], files: fileNames, institution: "Imported history", title: "Review CSV import" });
      };
      reader.readAsText(file);
    });
  }
  return <main className="min-h-screen">
    <header className="border-b border-[#e7ebef] bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#17212b] p-2 text-white"><TrendingUp size={20} /></div><div><div className="text-lg font-bold">Net Worth Tracker</div><div className="text-xs text-[#718096]">Your private wealth dashboard</div></div></div><div className="flex items-center gap-2 text-sm text-[#718096]"><span title={savedToday ? `Today's figures are recorded in your history (${dayStamp})` : "History is recorded automatically once your accounts load"} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"><span className={`h-2 w-2 rounded-full ${savedToday ? "bg-[#66c9a0]" : "bg-[#d7dde3]"}`} />{savedToday ? "History saved today" : "Saving history…"}</span><button onClick={() => setPanel("settings")} title={syncInfo.error ?? syncInfo.detail ?? "Sync settings"} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-[#f7f8fa]"><span className={`h-2 w-2 rounded-full ${syncInfo.kind === "ok" ? "bg-[#66c9a0]" : syncInfo.kind === "err" ? "bg-[#e07a6f]" : syncInfo.kind === "warn" || syncInfo.kind === "busy" ? "bg-[#e8c98f]" : "bg-[#d7dde3]"}`} />{syncInfo.text}</button><button onClick={() => setPanel("settings")} aria-label="Settings" title="Settings" className="rounded-lg p-2 hover:bg-[#f7f8fa]"><Settings2 size={18} /></button></div></div></header>
    <div className="mx-auto max-w-6xl px-6 py-8"><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-sm text-[#718096]">Good evening</p><h1 className="text-3xl font-bold tracking-tight">Your net worth</h1></div><div className="flex flex-wrap gap-2"><label title="Choose a folder of Date,Balance,Account CSV files" className="cursor-pointer rounded-lg bg-[#17212b] px-3 py-2 text-sm text-white">Import from data folder<input type="file" multiple ref={element => { element?.setAttribute("webkitdirectory", ""); }} onChange={importAccountHistory} className="hidden" /></label><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e7ebef] bg-white px-3 py-2 text-sm"><ArrowUpFromLine size={15} /> Import CSV<input type="file" accept=".csv" onChange={importCsv} className="hidden" /></label><label title="Restore a Net Worth Tracker JSON backup from another device" className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e7ebef] bg-white px-3 py-2 text-sm"><ArrowUpFromLine size={15} /> Import backup<input type="file" accept=".json,application/json" onChange={importBackup} className="hidden" /></label><button onClick={() => setPanel("export")} className="flex items-center gap-2 rounded-lg border border-[#e7ebef] bg-white px-3 py-2 text-sm"><ArrowDownToLine size={15} /> Export</button></div></div>
      <div className="mb-7 grid items-start gap-4 md:grid-cols-3"><div className="md:col-span-2 min-w-0">{focusAccount ? <NetWorthChart key={focusAccount.id} series={accountSeries} range={chartRange} onRangeChange={setChartRange} label={focusAccount.name} onBack={() => setFocusAccountId(null)} /> : <NetWorthChart series={netWorthSeries} range={chartRange} onRangeChange={setChartRange} />}</div><div className="card p-6"><p className="text-sm text-[#718096]">Assets minus liabilities</p><div className="mt-5 space-y-4"><Metric label="Total assets" value={money(assets)} color="#66c9a0" /><Metric label="Total liabilities" value={money(debts)} color="#ee9b8c" /></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-[#f0f2f4]"><div className="bar h-full" style={{ width: `${Math.min(100, assets / Math.max(1, assets + debts) * 100)}%` }} /></div></div></div>
      {loadFailed && <div className="mb-6 rounded-xl border border-[#e0a3a0] bg-[#fdecea] p-4 text-sm"><p className="font-semibold text-[#8a2f2a]">Saved data could not be read</p><p className="mt-1 text-[#8a2f2a]">The demo dataset is shown below and <strong>nothing will be saved</strong> until this is resolved, so your stored data is left intact. The unreadable copy was preserved under the <code>nest-egg-data.corrupt</code> browser key. Re-import from your data folder to rebuild.</p></div>}
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm">{([["accounts", "Accounts & debts"], ["holdings", "Holdings"], ["forecast", "Forecast"]] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${tab === value ? "tab-active" : "tab"}`}>{label}</button>)}</nav>
      {tab === "accounts" && <Accounts data={data} assets={assets} open={(kind, item) => { setModal(kind); setEditing(item ?? null); }} remove={remove} importHistory={importAccountHistory} focus={focusOnAccount} focusedId={focusAccountId} catchUp={catchUpLiability} />}
      {tab === "holdings" && <Holdings data={data} refresh={() => void syncPrices()} pricing={pricing} open={(item) => { setModal("holding"); setEditing(item ?? null); }} openTicker={setTickerEdit} remove={remove} />}
      {tab === "forecast" && <Forecast data={data} />}
    </div>
    {notice && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-[#17212b] px-4 py-3 text-sm text-white shadow-lg">{notice}</div>}
    {folderPreview && <Modal title={folderPreview.title} close={() => { if (!importing) setFolderPreview(null); }}><div className="space-y-4"><p className="text-sm text-[#718096]">The following CSV files are ready to merge. Accounts and dates that are not present in the import are left untouched.</p><div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-[#f7f8fa] p-3 text-center"><strong className="block text-xl">{folderPreview.files.length}</strong><span className="text-xs text-[#718096]">files</span></div><div className="rounded-lg bg-[#f7f8fa] p-3 text-center"><strong className="block text-xl">{folderPreview.names.length}</strong><span className="text-xs text-[#718096]">accounts</span></div><div className="rounded-lg bg-[#f7f8fa] p-3 text-center"><strong className="block text-xl">{folderPreview.rows.length.toLocaleString()}</strong><span className="text-xs text-[#718096]">rows</span></div></div>{importConflicts && importConflicts.changed > 0 ? <div className="rounded-lg border border-[#e8c98f] bg-[#fdf6e7] p-3 text-sm"><p className="font-semibold text-[#8a6417]">Warning: {importConflicts.changed.toLocaleString()} existing dated balance{importConflicts.changed === 1 ? "" : "s"} will be overwritten</p><p className="mt-1 text-[#8a6417]">Dates {importConflicts.earliest} to {importConflicts.latest} already hold a different value and will be replaced by the imported numbers. This cannot be undone.</p><ul className="mt-2 space-y-0.5 text-xs text-[#8a6417]">{importConflicts.accounts.slice(0, 5).map(([name, count]) => <li key={name}>{name}: {count.toLocaleString()} date{count === 1 ? "" : "s"}</li>)}{importConflicts.accounts.length > 5 && <li>+{importConflicts.accounts.length - 5} more accounts</li>}</ul></div> : <p className="rounded-lg bg-[#eef6f2] p-3 text-sm text-[#2f8d68]">No existing values will be changed{importConflicts && importConflicts.identical > 0 ? `; ${importConflicts.identical.toLocaleString()} rows already match` : ""}.</p>}<div className="max-h-28 overflow-y-auto rounded-lg border border-[#e7ebef] p-3 text-sm">{folderPreview.files.map(file => <div key={file} className="py-1 text-[#718096]">{file}</div>)}</div>{importing && <p className="rounded-lg bg-[#eef6f2] p-3 text-sm text-[#2f8d68]">Importing and saving {folderPreview.rows.length.toLocaleString()} rows...</p>}<div className="flex justify-end gap-2"><button disabled={importing} onClick={() => setFolderPreview(null)} className="rounded-lg border border-[#e7ebef] px-4 py-2 text-sm disabled:opacity-50">Cancel</button><button disabled={importing} onClick={confirmDataFolderImport} className={`rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50 ${importConflicts && importConflicts.changed > 0 ? "bg-[#b9762f]" : "bg-[#17212b]"}`}>{importing ? "Importing..." : importConflicts && importConflicts.changed > 0 ? "Overwrite and import" : "Confirm import"}</button></div></div></Modal>}
    {tickerEdit && <Modal title={`${tickerEdit} expected return`} close={() => setTickerEdit(null)}><TickerForm ticker={tickerEdit} data={data} save={saveTickerReturn} /></Modal>}
    {panel === "settings" && <Modal wide title="Settings" close={() => setPanel(null)}><SettingsForm settings={settings} status={syncInfo} onSave={saveAppSettings} onSyncNow={() => void runSync(true)} onDisconnect={disconnectSync} /></Modal>}
    {panel === "export" && <Modal wide title="Export data" close={() => setPanel(null)}><ExportPanel data={data} exportPositions={exportCsv} exportBackup={exportBackup} notify={flash} /></Modal>}
    {modal && <Modal title={`${editing ? "Edit" : "Add"} ${modal}`} close={closeModal}>{modal === "account" && <AccountForm item={editing as Account | null} data={data} save={saveAccount} />}{modal === "liability" && <LiabilityForm item={editing as Liability | null} save={saveLiability} />}{modal === "holding" && <HoldingForm item={editing as Holding | null} data={data} save={saveHolding} />}</Modal>}
  </main>;
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) { return <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-[#718096]"><i className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span><strong>{value}</strong></div>; }
type AccountSort = "balance-desc" | "balance-asc" | "name-asc" | "name-desc";
const accountSortOptions: { key: AccountSort; label: string }[] = [
  { key: "balance-desc", label: "Balance: high to low" },
  { key: "balance-asc", label: "Balance: low to high" },
  { key: "name-asc", label: "Name: A to Z" },
  { key: "name-desc", label: "Name: Z to A" }
];
/** Orders accounts by the displayed total (cash plus linked holdings) or by name. Names are coerced so legacy rows with a missing name cannot throw. */
function sortAccounts(list: Account[], sort: AccountSort, holdings: Holding[]) {
  const nameOf = (account: Account) => typeof account?.name === "string" ? account.name : "";
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    if (sort === "name-asc") return nameOf(a).localeCompare(nameOf(b));
    if (sort === "name-desc") return nameOf(b).localeCompare(nameOf(a));
    const diff = accountTotal(a, holdings) - accountTotal(b, holdings);
    return sort === "balance-asc" ? diff : -diff;
  });
}
function Accounts({ data, assets, open, remove, importHistory, focus, focusedId, catchUp }: { data: TrackerData; assets: number; open: (kind: "account" | "liability" | "holding", item?: Account | Liability) => void; remove: (kind: "accounts" | "liabilities", id: string) => void; importHistory: (event: React.ChangeEvent<HTMLInputElement>) => void; focus: (account: Account) => void; focusedId: string | null; catchUp: (liability: Liability, balance: number) => void }) {
  const [sort, setSort] = useState<AccountSort>("balance-desc");
  /** Newest date a balance is known true: the stamped edit date, else its latest imported snapshot. */
  const liabilityDates = useMemo(() => {
    const latest = new Map<string, string>();
    for (const snapshot of data.accountSnapshots ?? []) {
      const current = latest.get(snapshot.accountId);
      if (!current || snapshot.date > current) latest.set(snapshot.accountId, snapshot.date);
    }
    return latest;
  }, [data.accountSnapshots]);
  const liabilityAsOf = (liability: Liability) => liability.balanceAsOf ?? liabilityDates.get(liability.id);
  const debts = data.liabilities.reduce((sum, liability) => sum + safeNumber(liability.balance), 0);
  const largest = [...data.holdings].sort((a, b) => safeNumber(b.quantity) * safeNumber(b.price) - safeNumber(a.quantity) * safeNumber(a.price)).slice(0, 6);
  const property = sortAccounts(data.accounts.filter(account => account.type === "property"), sort, data.holdings);
  const others = sortAccounts(data.accounts.filter(account => account.type !== "property"), sort, data.holdings);
  const propertyTotal = property.reduce((sum, account) => sum + accountTotal(account, data.holdings), 0);
  const accountRow = (a: Account) => { const linked = data.holdings.filter(holding => holding.accountId === a.id); return <Row key={a.id} title={a.name} subtitle={`${a.institution} · ${money(safeNumber(a.balance))} ${a.type === "property" ? "value" : "cash"}${linked.length ? ` + ${linked.length} holding${linked.length === 1 ? "" : "s"}` : ""}`} value={money(accountTotal(a, data.holdings))} edit={() => open("account", a)} trash={() => remove("accounts", a.id)} select={() => focus(a)} selected={focusedId === a.id} />; };
  const sortControl = <label className="flex items-center gap-2 text-xs text-[#718096]"><span>Sort</span><select aria-label="Sort accounts" value={sort} onChange={event => setSort(event.target.value as AccountSort)} className="rounded-lg border border-[#dfe5e9] px-2 py-1 text-xs">{accountSortOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>;
  return <div className="space-y-5">
    <section className="card flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="font-semibold">Balance history import</h2><p className="text-sm text-[#718096]">Select one or more source files, or use the normalized CSV format. Re-importing an account/date updates it.</p></div><div className="flex gap-2"><button onClick={() => { const blob = new Blob(["Date,Balance,Account\n2026-01-31,8420,checking\n"], { type: "text/csv" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "account-history-template.csv"; link.click(); URL.revokeObjectURL(url); }} className="rounded-lg border border-[#e7ebef] px-3 py-2 text-sm">Download template</button><label className="cursor-pointer rounded-lg bg-[#17212b] px-3 py-2 text-sm text-white">Bulk import CSVs<input type="file" accept=".csv" multiple onChange={importHistory} className="hidden" /></label></div></section>
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <ListCard title="Accounts" icon={<Landmark size={18} />} add={() => open("account")}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-[#718096]">Cash plus linked holdings at current prices. Select an account to chart its history above.</p>{sortControl}</div>
        <div className="divide-y divide-[#eef1f4]">{others.length ? others.map(accountRow) : <p className="py-4 text-sm text-[#718096]">No accounts yet.</p>}</div>
      </ListCard>
      <div className="space-y-5">
        <ListCard title="Property" icon={<HouseIcon size={18} />} add={() => open("account")}>
          <div className="mb-1 flex justify-between text-sm"><span className="text-[#718096]">Total value</span><strong>{money(propertyTotal)}</strong></div>
          <div className="divide-y divide-[#eef1f4]">{property.length ? property.map(accountRow) : <p className="py-4 text-sm text-[#718096]">Add an account with the Property type to track a home here.</p>}</div>
        </ListCard>
        <ListCard title="Liabilities" icon={<ArrowDownToLine size={18} />} add={() => open("liability")}>
          <div className="mb-1 flex justify-between text-sm"><span className="text-[#718096]">Total owed</span><strong className="text-[#b95d57]">{money(debts)}</strong></div>
          <div className="divide-y divide-[#eef1f4]">{data.liabilities.map(l => { const asOf = liabilityAsOf(l); const projected = asOf ? expectedBalance(l, asOf, today()) : null; return <div key={l.id}>
            <Row title={l.name} subtitle={`${l.institution} · ${l.rate}% APR`} value={money(safeNumber(l.balance))} edit={() => open("liability", l)} trash={() => remove("liabilities", l.id)} />
            {projected && Math.abs(projected.balance - safeNumber(l.balance)) >= 1 && <div className="flex flex-wrap items-center justify-between gap-2 pb-3 text-xs text-[#718096]"><span>Balance is from {asOf}. After {projected.months} scheduled payment{projected.months === 1 ? "" : "s"} it should be about <strong className="text-[#3f4a56]">{money(projected.balance)}</strong>.</span><button onClick={() => catchUp(l, projected.balance)} className="rounded-lg border border-[#e7ebef] px-2 py-1 font-medium text-[#3f4a56] hover:bg-[#f7f8fa]">Apply</button></div>}
          </div>; })}</div>
        </ListCard>
        <ListCard title="Top holdings" icon={<TrendingUp size={18} />} add={() => open("holding")}>
          <p className="mb-3 text-sm text-[#718096]">By current value, with the change from the prior trading day&apos;s close.</p>
          {largest.length ? largest.map(h => { const value = safeNumber(h.quantity) * safeNumber(h.price); return <div key={h.id} className="mb-4"><div className="mb-1 flex items-baseline justify-between gap-3 text-sm"><span className="font-medium">{h.ticker}</span><span className="flex items-baseline gap-2"><ChangeBadge percent={h.changePercent} /><span>{money(value)}</span></span></div><div className="h-2 rounded-full bg-[#edf1f3]"><div className="bar h-full rounded-full" style={{ width: `${Math.min(100, value / Math.max(1, assets) * 100 * 4)}%` }} /></div></div>; }) : <p className="text-sm text-[#718096]">Add a holding to see your allocation.</p>}
        </ListCard>
      </div>
    </div>
  </div>;
}
/** Renders a holding's one-day move; stays blank until a real quote with a prior close arrives. */
function ChangeBadge({ percent }: { percent?: number }) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return <span className="text-xs text-[#a0aab5]">&mdash;</span>;
  const flat = Math.abs(percent) < 0.005;
  const color = flat ? "#718096" : percent > 0 ? "#2f8d68" : "#b95d57";
  return <span className="text-xs font-medium" style={{ color }} title="Change from the prior trading day's close">{flat ? "" : percent > 0 ? "+" : ""}{percent.toFixed(2)}%</span>;
}
/** One forecast: asset accounts stack above the zero line, debts stack below it, sharing a horizon and axis. */
function Forecast({ data }: { data: TrackerData }) {
  const [years, setYears] = useState(10);
  const accounts = useMemo(() => Array.isArray(data.accounts) ? data.accounts : [], [data.accounts]);
  const holdings = useMemo(() => Array.isArray(data.holdings) ? data.holdings : [], [data.holdings]);
  const liabilities = useMemo(() => Array.isArray(data.liabilities) ? data.liabilities : [], [data.liabilities]);
  const [pickedAccounts, setPickedAccounts] = useState<string[]>(() => accounts.map(account => account.id));
  const [pickedDebts, setPickedDebts] = useState<string[]>(() => liabilities.map(liability => liability.id));
  useEffect(() => setPickedAccounts(current => syncSelection(current, accounts.map(account => account.id))), [accounts]);
  useEffect(() => setPickedDebts(current => syncSelection(current, liabilities.map(liability => liability.id))), [liabilities]);
  const accountColor = new Map(accounts.map((account, index) => [account.id, forecastColor(index)]));
  const liabilityColor = new Map(liabilities.map((liability, index) => [liability.id, debtColor(index)]));

  const assetSeries = useMemo(() => new Map(accounts.map(account => [account.id, projectAccountSeries(account, holdings, years)])), [accounts, holdings, years]);
  const debtSchedules = useMemo(() => new Map(liabilities.map(liability => [liability.id, amortize(liability, years)])), [liabilities, years]);
  const assetAt = (account: Account, year: number) => safeNumber(assetSeries.get(account.id)?.[year], safeNumber(account.balance));
  const debtAt = (liability: Liability, year: number) => safeNumber(debtSchedules.get(liability.id)?.balances[year], safeNumber(liability.balance));
  const onAccount = (account: Account) => pickedAccounts.includes(account.id);
  const onDebt = (liability: Liability) => pickedDebts.includes(liability.id);

  const steps = Array.from({ length: years + 1 }, (_, year) => year);
  const assetTotal = (year: number) => accounts.filter(onAccount).reduce((sum, account) => sum + Math.max(0, assetAt(account, year)), 0);
  const debtTotal = (year: number) => liabilities.filter(onDebt).reduce((sum, liability) => sum + Math.max(0, debtAt(liability, year)), 0);
  const assetMax = Math.max(...steps.map(assetTotal), 0);
  const debtMax = Math.max(...steps.map(debtTotal), 0);
  // The zero line sits wherever the two ranges meet, so both halves share one scale.
  const span = Math.max(assetMax + debtMax, 1);
  const upperPct = assetMax > 0 ? assetMax / span * 100 : debtMax > 0 ? 0 : 100;
  const lowerPct = 100 - upperPct;
  const netAt = (year: number) => assetTotal(year) - debtTotal(year);

  const contributionNote = (account: Account) => {
    const monthly = safeNumber(account.monthlyContribution);
    if (!acceptsContributions(account) || monthly <= 0) return "\u2014";
    const growth = account.contributionGrowth ? safeNumber(account.contributionGrowthRate) : 0;
    const stop = safeNumber(account.contributionYears);
    return `${money(monthly)}/mo${growth ? ` +${growth}%/yr` : ""}${stop > 0 ? ` for ${stop} yr` : ""}`;
  };
  const totalInterest = liabilities.filter(onDebt).reduce((sum, liability) => sum + safeNumber(debtSchedules.get(liability.id)?.totalInterest), 0);
  const shortfall = liabilities.filter(liability => onDebt(liability) && debtSchedules.get(liability.id)?.interestOnlyShortfall);
  const toggleAccount = (key: string) => setPickedAccounts(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  const toggleDebt = (key: string) => setPickedDebts(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  const tickFor = (year: number) => years > 15 ? (year % 5 === 0 ? year : "") : year;

  return <section className="card p-6">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="font-semibold">Forecast</h2>
        <p className="text-sm text-[#718096]">Projected net worth at year {years}: <strong className="text-[#17212b]">{money(netAt(years))}</strong></p>
        <p className="text-xs text-[#718096]">{money(assetTotal(years))} in assets &middot; {money(debtTotal(years))} still owed &middot; {money(totalInterest)} interest paid</p>
      </div>
      <label className="text-sm"><span className="mr-2 text-[#718096]">Horizon</span><select aria-label="Forecast horizon" value={years} onChange={event => setYears(Number(event.target.value))} className="rounded-lg border border-[#dfe5e9] px-3 py-2">{[1, 5, 10, 15, 20, 30].map(value => <option key={value} value={value}>{value} years</option>)}</select></label>
    </div>
    {pickedAccounts.length === 0 && pickedDebts.length === 0 && <p className="mb-4 rounded-lg bg-[#f7f8fa] p-3 text-sm text-[#718096]">Select at least one account or debt below to show a projection.</p>}
    {shortfall.length > 0 && <p className="mb-4 rounded-lg bg-[#fdecea] p-3 text-sm text-[#b95d57]">The payment on {shortfall.map(liability => liability.name).join(", ")} does not cover the first month&apos;s interest, so that balance would never fall.</p>}

    <div className="mb-1 text-[10px] uppercase tracking-wide text-[#718096]">Assets above the line, debts below</div>
    <div className="flex">
      <div className="h-72 w-24 shrink-0 pr-2 text-right text-[10px] text-[#718096]">
        <div className="flex flex-col justify-between" style={{ height: `${upperPct}%` }}><span>{assetMax > 0 ? money(assetMax) : ""}</span><span className="font-medium text-[#17212b]">$0</span></div>
        <div className="flex flex-col justify-end" style={{ height: `${lowerPct}%` }}>{debtMax > 0 && <span>-{money(debtMax)}</span>}</div>
      </div>
      <div className="flex h-72 flex-1 gap-1 border-l border-[#dfe5e9] pl-2">{steps.map(year => <div key={year} className="flex h-full flex-1 flex-col items-center" title={`Year ${year} net worth: ${money(netAt(year))}`}>
        <div className="flex w-full flex-col justify-end border-b border-[#17212b]/40" style={{ height: `${upperPct}%` }}>{accounts.filter(onAccount).map(account => { const value = Math.max(0, assetAt(account, year)); return <div key={account.id} className="w-full max-w-8 self-center border-b border-white/40" title={`${account.name} · year ${year}: ${money(value)}`} style={{ height: assetMax > 0 ? `${value / assetMax * 100}%` : "0%", background: accountColor.get(account.id) }} aria-label={`${account.name}, year ${year}, ${money(value)}`} />; })}</div>
        <div className="flex w-full flex-col justify-start" style={{ height: `${lowerPct}%` }}>{liabilities.filter(onDebt).map(liability => { const value = Math.max(0, debtAt(liability, year)); return <div key={liability.id} className="w-full max-w-8 self-center border-b border-white/40" title={`${liability.name} · year ${year}: ${money(value)} owed`} style={{ height: debtMax > 0 ? `${value / debtMax * 100}%` : "0%", background: liabilityColor.get(liability.id) }} aria-label={`${liability.name} owed, year ${year}, ${money(value)}`} />; })}</div>
      </div>)}</div>
    </div>
    <div className="mb-1 flex"><div className="w-24 shrink-0" /><div className="flex flex-1 gap-1 pl-2">{steps.map(year => <span key={year} className="flex-1 text-center text-[10px] text-[#718096]">{tickFor(year)}</span>)}</div></div>
    <div className="mb-5 flex"><div className="w-24 shrink-0" /><div className="flex-1 pl-2 text-center text-[10px] uppercase tracking-wide text-[#718096]">Year</div></div>

    <div className="mb-6 space-y-3">
      {accounts.length > 0 && <div>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-[#718096]">Accounts</p>
        <div className="flex flex-wrap gap-2">{accounts.map(account => <label key={account.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e7ebef] px-3 py-2 text-sm"><input type="checkbox" aria-label={`Include ${account.name}`} checked={onAccount(account)} onChange={() => toggleAccount(account.id)} /><span className="h-2 w-2 rounded-full" style={{ background: accountColor.get(account.id) }} />{account.name}</label>)}</div>
      </div>}
      {liabilities.length > 0 && <div>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-[#718096]">Debts</p>
        <div className="flex flex-wrap gap-2">{liabilities.map(liability => <label key={liability.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e7ebef] px-3 py-2 text-sm"><input type="checkbox" aria-label={`Include ${liability.name}`} checked={onDebt(liability)} onChange={() => toggleDebt(liability.id)} /><span className="h-2 w-2 rounded-full" style={{ background: liabilityColor.get(liability.id) }} />{liability.name}</label>)}</div>
      </div>}
    </div>

    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] table-fixed text-left text-sm tabular-nums">
        <colgroup><col className="w-[34%]" /><col className="w-[16%]" /><col className="w-[13%]" /><col className="w-[18%]" /><col className="w-[19%]" /></colgroup>
        <thead className="text-xs uppercase text-[#718096]"><tr><th className="pb-2 font-medium">Name</th><th className="pb-2 text-right font-medium">Current</th><th className="pb-2 text-right font-medium">Rate</th><th className="pb-2 text-right font-medium">Monthly</th><th className="pb-2 text-right font-medium">Year {years}</th></tr></thead>
        <tbody>
          <tr><td colSpan={5} className="border-t border-[#dfe5e9] pb-1 pt-4 text-[10px] uppercase tracking-wide text-[#718096]">Assets</td></tr>
          {accounts.length ? accounts.map(account => <tr key={account.id} className={`border-t border-[#eef1f4] ${onAccount(account) ? "" : "opacity-40"}`}>
            <td className="py-3 pr-2 font-medium"><span className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full align-middle" style={{ background: accountColor.get(account.id) }} /><span className="align-middle">{account.name}</span>{!account.cashConfigured && <span className="block text-[10px] font-normal text-[#718096]">imported total</span>}</td>
            <td className="py-3 text-right">{money(accountTotal(account, holdings))}</td>
            <td className="py-3 text-right" title={account.cashConfigured && !selfCompounding.has(account.type) ? "Grows from linked holding returns" : account.type === "property" ? "Expected annual appreciation" : "Expected annual return"}>{account.cashConfigured && !selfCompounding.has(account.type) ? <span className="text-[#718096]">Holdings</span> : `${safeNumber(account.expectedAnnualReturn).toFixed(1)}%`}</td>
            <td className="py-3 text-right">{contributionNote(account)}</td>
            <td className="py-3 text-right font-semibold">{money(assetAt(account, years))}</td>
          </tr>) : <tr className="border-t border-[#eef1f4]"><td colSpan={5} className="py-3 text-[#718096]">No accounts yet.</td></tr>}
          <tr className="border-t border-[#dfe5e9] font-semibold"><td className="py-3">Total assets</td><td className="py-3 text-right">{money(assetTotal(0))}</td><td /><td /><td className="py-3 text-right">{money(assetTotal(years))}</td></tr>

          {liabilities.length > 0 && <>
            <tr><td colSpan={5} className="pb-1 pt-6 text-[10px] uppercase tracking-wide text-[#718096]">Debts</td></tr>
            {liabilities.map(liability => { const months = payoffMonths(liability); const payment = safeNumber(liability.monthlyPayment); const extra = safeNumber(liability.extraMonthly); return <tr key={liability.id} className={`border-t border-[#eef1f4] ${onDebt(liability) ? "" : "opacity-40"}`}>
              <td className="py-3 pr-2 font-medium"><span className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full align-middle" style={{ background: liabilityColor.get(liability.id) }} /><span className="align-middle">{liability.name}</span></td>
              <td className="py-3 text-right">{money(safeNumber(liability.balance))}</td>
              <td className="py-3 text-right">{safeNumber(liability.rate).toFixed(2)}%</td>
              <td className="py-3 text-right">{payment > 0 ? <>{money(payment)}{extra > 0 && <span className="block text-[10px] font-normal text-[#718096]">+{money(extra)} extra</span>}</> : <span className="text-[#718096]">&mdash;</span>}</td>
              <td className="py-3 text-right font-semibold">{money(debtAt(liability, years))}{payment > 0 && <span className="block text-[10px] font-normal text-[#718096]">{months === null ? <span className="text-[#b95d57]">never repaid</span> : `clear in ${payoffLabel(months)}`}</span>}</td>
            </tr>; })}
            <tr className="border-t border-[#dfe5e9] font-semibold"><td className="py-3">Total debts</td><td className="py-3 text-right">{money(debtTotal(0))}</td><td /><td /><td className="py-3 text-right">{money(debtTotal(years))}</td></tr>
          </>}

          <tr className="border-t-2 border-[#17212b]/25 text-base font-semibold"><td className="py-3">Net worth</td><td className="py-3 text-right">{money(netAt(0))}</td><td /><td /><td className={`py-3 text-right ${netAt(years) < 0 ? "text-[#b95d57]" : "text-[#2f8d68]"}`}>{money(netAt(years))}</td></tr>
        </tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-[#718096]">Totals cover the selected rows only; unticked accounts and debts are dimmed and excluded from the chart and every total.</p>
    <p className="mt-5 text-xs text-[#718096]">Assumptions: balances are stepped month by month. Cash and savings compound at the account return; property compounds at its expected annual appreciation, which may be negative; composed investment and retirement accounts use each linked holding&apos;s own return plus their cash. Uncomposed imported totals grow at the account return, which is 0% until you set one. Monthly contributions are added at the end of each month and, when inflation growth is on, step up on every anniversary, and default to today&apos;s holding mix treated as a fixed target allocation. A contribution can be set to stop after a chosen number of years &mdash; for retirement, say &mdash; after which the balance keeps compounding but receives no new money. Debts assume a fixed rate and a payment every month, entered as principal and interest only &mdash; escrowed tax and insurance do not reduce a balance. A debt with no payment set is simply held flat. Property and liabilities take no contributions. Adjustable rates, PMI removal, and recasts are not modelled.</p>
  </section>;
}
/** Keeps a selection in sync with the current ids, adding new ones and dropping deleted ones. */
function syncSelection(current: string[], ids: string[]) { return [...new Set([...current.filter(key => ids.includes(key)), ...ids.filter(key => !current.includes(key))])]; }
const debtPalette = ["#b95d57", "#e08a5f", "#c97b9e", "#8a6d9e", "#d9a05b", "#a86a4a", "#e0929c", "#7d5a8c", "#c26b4f", "#9e6b7d"];
function debtColor(index: number) { return debtPalette[index % debtPalette.length]; }
const forecastPalette = ["#66c9a0", "#8aa9e8", "#b69ce6", "#e6b86a", "#e89a9a", "#78c8d8", "#d8ae75", "#9ad6a6", "#c9a0e0", "#e8c17a", "#7fb2e8", "#e0929c", "#84d2c4", "#b8b0e8"];
function forecastColor(index: number) { return forecastPalette[index % forecastPalette.length]; }
/** One ticker across every account that holds it, with the ticker-level figures rolled up. */
type HoldingGroup = { ticker: string; items: Holding[]; quantity: number; value: number; price: number; mixedPrice: boolean; expectedAnnualReturn: number; mixedReturn: boolean; changePercent?: number; pricedAt: string; basis?: Holding["priceBasis"]; pricedAtTime?: string };
function groupHoldings(holdings: Holding[]): HoldingGroup[] {
  const map = new Map<string, Holding[]>();
  for (const holding of holdings) {
    const key = tickerKey(holding.ticker) || "(no ticker)";
    const list = map.get(key);
    if (list) list.push(holding); else map.set(key, [holding]);
  }
  return [...map.entries()].map(([ticker, items]) => {
    const prices = new Set(items.map(item => safeNumber(item.price)));
    const returns = new Set(items.map(item => safeNumber(item.expectedAnnualReturn)));
    const priced = items.map(item => item.priceUpdatedAt).filter(Boolean).sort();
    return {
      ticker, items,
      quantity: items.reduce((sum, item) => sum + safeNumber(item.quantity), 0),
      value: items.reduce((sum, item) => sum + safeNumber(item.quantity) * safeNumber(item.price), 0),
      price: [...prices][0] ?? 0, mixedPrice: prices.size > 1,
      expectedAnnualReturn: [...returns][0] ?? 0, mixedReturn: returns.size > 1,
      changePercent: items.find(item => item.changePercent !== undefined)?.changePercent,
      pricedAt: priced.length ? String(priced[priced.length - 1]) : "manual",
      basis: items.find(item => item.priceBasis !== undefined)?.priceBasis,
      pricedAtTime: items.find(item => item.priceUpdatedAtTime !== undefined)?.priceUpdatedAtTime
    };
  }).sort((a, b) => b.value - a.value || a.ticker.localeCompare(b.ticker));
}
/** Trims floating-point noise from summed share counts. */const qty = (value: number) => Number(value.toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 6 });
/** Shows whether a price is a live quote or a settled close, with the exact moment on hover. */
function PriceBasisTag({ basis, asOf, asOfTime }: { basis?: Holding["priceBasis"]; asOf: string; asOfTime?: string }) {
  if (asOf === "manual") return <span>manual</span>;
  const when = asOfTime ? new Date(asOfTime).toLocaleString() : asOf;
  if (basis === "live") return <span title={`Live quote at ${when}`} className="inline-flex items-center gap-1 rounded-full bg-[#e6f5ee] px-2 py-0.5 font-medium text-[#2f7d5b]"><span className="h-1.5 w-1.5 rounded-full bg-[#3aa06e]" />Live</span>;
  const label = basis === "todayClose" ? "Close" : basis === "previousClose" ? "Prev close" : "Close";
  return <span title={`${label} recorded ${when}`}>{label} · {asOf}</span>;
}
function Holdings({ data, refresh, pricing, open, openTicker, remove }: { data: TrackerData; refresh: () => void; pricing: boolean; open: (item?: Holding) => void; openTicker: (ticker: string) => void; remove: (kind: "holdings", id: string) => void }) {
  const groups = useMemo(() => groupHoldings(data.holdings), [data.holdings]);
  return <div className="card p-6">
    <div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Manual holdings</h2><p className="text-sm text-[#718096]">Grouped by ticker, then by account. Select a ticker to set its expected return everywhere it is held. Unit prices come from Yahoo Finance: the live last trade while the US market is open (refreshed hourly), that day&apos;s official close after the bell, and the previous session&apos;s close before the open or on weekends and holidays.{data.lastPriceSyncAt ? ` Last checked ${new Date(data.lastPriceSyncAt).toLocaleString()}.` : data.lastPriceSync ? ` Last checked ${data.lastPriceSync}.` : ""}</p></div><div className="flex gap-2"><button onClick={refresh} disabled={pricing} className="flex items-center gap-2 rounded-lg border border-[#e7ebef] px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} className={pricing ? "animate-spin" : ""} /> {pricing ? "Updating..." : "Update prices"}</button><button onClick={() => open()} className="flex items-center gap-2 rounded-lg bg-[#17212b] px-3 py-2 text-sm text-white"><Plus size={15} /> Add holding</button></div></div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-sm tabular-nums">
        <thead className="text-xs uppercase text-[#718096]"><tr><th className="pb-3">Ticker / account</th><th className="pb-3 text-right">Return</th><th className="pb-3 text-right">Quantity</th><th className="pb-3 text-right">Price</th><th className="pb-3 text-right">1-day</th><th className="pb-3">Priced</th><th className="pb-3 text-right">Value</th><th /></tr></thead>
        <tbody>
          {groups.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-sm text-[#718096]">No holdings yet. Add one to track its price automatically.</td></tr>}
          {groups.map(group => <Fragment key={group.ticker}>
            <tr className="border-t border-[#dfe5e9] bg-[#f7f8fa]/70">
              <td className="py-3"><button type="button" onClick={() => openTicker(group.ticker)} title={`Set the expected return for ${group.ticker} across all accounts`} className="font-semibold underline decoration-dotted underline-offset-4 hover:text-[#3b7fbd]">{group.ticker}</button><span className="ml-2 text-xs font-normal text-[#718096]">{group.items.length} account{group.items.length === 1 ? "" : "s"}</span></td>
              <td className="py-3 text-right"><button type="button" onClick={() => openTicker(group.ticker)} className="text-[#3b7fbd] hover:underline">{group.mixedReturn ? "mixed" : `${Number(group.expectedAnnualReturn.toFixed(2))}%`}</button></td>
              <td className="py-3 text-right">{qty(group.quantity)}</td>
              <td className="py-3 text-right">{group.mixedPrice ? <span className="text-xs text-[#718096]">mixed</span> : priceText(group.price)}</td>
              <td className="py-3 text-right"><ChangeBadge percent={group.changePercent} /></td>
              <td className="py-3 text-xs text-[#718096]"><PriceBasisTag basis={group.basis} asOf={group.pricedAt} asOfTime={group.pricedAtTime} /></td>
              <td className="py-3 text-right font-semibold">{money(group.value)}</td>
              <td />
            </tr>
            {group.items.map(holding => <tr key={holding.id} className="border-t border-[#f2f4f6]">
              <td className="py-2 pl-6 text-[#718096]">{data.accounts.find(account => account.id === holding.accountId)?.name ?? "Unknown"}</td>
              <td />
              <td className="py-2 text-right text-[#4a5568]">{qty(safeNumber(holding.quantity))}</td>
              <td className="py-2 text-right text-[#4a5568]">{group.mixedPrice ? priceText(safeNumber(holding.price)) : ""}</td>
              <td /><td />
              <td className="py-2 text-right text-[#4a5568]">{money(safeNumber(holding.quantity) * safeNumber(holding.price))}</td>
              <td className="py-2 text-right whitespace-nowrap"><button onClick={() => open(holding)} className="mr-3 text-[#3b7fbd]">Edit</button><button onClick={() => remove("holdings", holding.id)} aria-label={`Delete ${group.ticker} in this account`} className="text-[#b95d57]"><Trash2 size={15} /></button></td>
            </tr>)}
          </Fragment>)}
        </tbody>
      </table>
    </div>
  </div>;
}
function Row({ title, subtitle, value, edit, trash, select, selected }: { title: string; subtitle: string; value: string; edit: () => void; trash: () => void; select?: () => void; selected?: boolean }) { const heading = <div className="text-left"><p className={`font-medium ${selected ? "text-[#1d9bc4]" : ""}`}>{title}</p><p className="text-xs text-[#718096]">{subtitle}</p></div>; return <div className="flex items-center justify-between py-4">{select ? <button onClick={select} aria-pressed={selected} title={`Show ${title} history`} className="-mx-2 rounded-lg px-2 py-1 hover:bg-[#f2f7fa]">{heading}</button> : heading}<div className="flex items-center gap-4"><strong>{value}</strong><button onClick={edit} className="text-xs text-[#3b7fbd]">Edit</button><button onClick={trash} className="text-[#b95d57]"><Trash2 size={15} /></button></div></div>; }
function ListCard({ title, icon, add, children }: { title: string; icon: React.ReactNode; add: () => void; children: React.ReactNode }) { return <section className="card p-6"><div className="mb-2 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2><button onClick={add} className="rounded-lg bg-[#17212b] p-2 text-white"><Plus size={16} /></button></div>{children}</section>; }
function Modal({ title, close, children, wide = false }: { title: string; close: () => void; children: React.ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  const [hasForm, setHasForm] = useState(false);
  onClose.current = close;
  // Pull focus off whatever opened the dialog so Escape and Enter act on the dialog, not that button.
  useEffect(() => {
    const form = panel.current?.querySelector("form");
    const first = form?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea");
    (first ?? panel.current)?.focus();
    setHasForm(!!form);
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") { event.preventDefault(); onClose.current(); return; }
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLButtonElement && panel.current?.contains(target)) return;
      const form = panel.current?.querySelector("form");
      if (!form) return;
      event.preventDefault();
      form.requestSubmit();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return <div className="fixed inset-0 z-10 flex items-center justify-center bg-[#17212b]/40 p-5"><div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? "max-w-2xl" : "max-w-md"} p-6 outline-none`}><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold capitalize">{title}</h2><button type="button" aria-label="Close" onClick={close}><X size={20} /></button></div>{children}{hasForm && <p className="mt-4 text-center text-[11px] text-[#a0aab5]">Enter to save &middot; Esc to cancel</p>}</div></div>;
}
const Field = ({ label, name, defaultValue, type = "text" }: { label: string; name: string; defaultValue?: string | number; type?: string }) => <label className="mb-4 block text-sm"><span className="mb-1 block text-[#718096]">{label}</span><input name={name} type={type} defaultValue={defaultValue} required step={type === "number" ? "any" : undefined} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2 outline-none focus:border-[#3b7fbd]" /></label>;
function FormActions() { return <div className="flex justify-end gap-2"><button type="submit" className="rounded-lg bg-[#17212b] px-4 py-2 text-sm text-white">Save</button></div>; }
function AccountForm({ item, data, save }: { item: Account | null; data: TrackerData; save: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const linked = item ? data.holdings.filter(holding => holding.accountId === item.id) : [];
  const holdingsValue = linked.reduce((sum, holding) => sum + safeNumber(holding.quantity) * safeNumber(holding.price), 0);
  const [cash, setCash] = useState(() => String(item && !item.cashConfigured && holdingsValue > 0 ? Math.max(0, safeNumber(item.balance) - holdingsValue) : safeNumber(item?.balance)));
  const [type, setType] = useState<AccountType>(item?.type ?? "cash");
  const [contribution, setContribution] = useState(() => String(safeNumber(item?.monthlyContribution)));
  const [growsWithInflation, setGrowsWithInflation] = useState(() => Boolean(item?.contributionGrowth));
  const typedCash = Number(cash);
  const cashValue = Number.isFinite(typedCash) ? typedCash : 0;
  const total = cashValue + holdingsValue;
  const recorded = item ? (data.accountSnapshots ?? []).filter(snapshot => snapshot.accountId === item.id).sort((a, b) => a.date.localeCompare(b.date)).at(-1) : undefined;
  const difference = recorded ? total - safeNumber(recorded.balance) : 0;
  const matchCash = recorded ? Math.max(0, safeNumber(recorded.balance) - holdingsValue) : 0;
  const cashLabel = type === "property" ? "Property value" : type === "other" ? "Account value" : "Cash balance";
  return <form onSubmit={save}>
    <Field label="Account name" name="name" defaultValue={item?.name} />
    <Field label="Institution" name="institution" defaultValue={item?.institution} />
    <label className="mb-4 block text-sm"><span className="mb-1 block text-[#718096]">Type</span><select name="type" value={type} onChange={event => setType(event.target.value as AccountType)} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2">{accountTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
    <label className="mb-2 block text-sm"><span className="mb-1 block text-[#718096]">{cashLabel}</span><input name="cash" type="number" step="any" required value={cash} onChange={event => setCash(event.target.value)} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2 outline-none focus:border-[#3b7fbd]" /></label>
    <p className="mb-4 text-xs text-[#718096]">The account total is not edited directly. It is this {cashLabel.toLowerCase()} plus the market value of any holdings linked to this account, so holdings are counted once.</p>
    <div className="mb-4 rounded-lg bg-[#f7f8fa] p-3 text-sm">
      <div className="flex justify-between py-1"><span className="text-[#718096]">{cashLabel}</span><span>{money(cashValue)}</span></div>
      <div className="flex justify-between py-1"><span className="text-[#718096]">Linked holdings ({linked.length})</span><span>{money(holdingsValue)}</span></div>
      <div className="mt-1 flex justify-between border-t border-[#e1e6ea] pt-2"><span className="font-medium">Account total</span><strong>{money(total)}</strong></div>
    </div>
    {recorded && recorded.date !== today() && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[#e7ebef] p-3 text-sm">
      <div><p className="text-[#718096]">Last recorded total on {recorded.date}</p><p className="font-medium">{money(safeNumber(recorded.balance))}{Math.round(Math.abs(difference)) !== 0 ? ` · ${money(Math.abs(difference))} ${difference > 0 ? "higher" : "lower"} than above` : ""}</p></div>
      <button type="button" onClick={() => setCash(String(Number(matchCash.toFixed(2))))} className="shrink-0 rounded-lg border border-[#dfe5e9] px-3 py-2 text-xs text-[#3b7fbd]">Match cash</button>
    </div>}
    {item && <div className="mb-4"><p className="mb-2 text-xs uppercase text-[#718096]">Linked holdings</p>{linked.length ? linked.map(holding => <div key={holding.id} className="flex justify-between border-t border-[#eef1f4] py-2 text-sm"><span>{holding.ticker} · {holding.quantity} shares{holding.priceUpdatedAt ? ` · ${priceText(safeNumber(holding.price))} on ${holding.priceUpdatedAt}` : ""}</span><strong>{money(safeNumber(holding.quantity) * safeNumber(holding.price))}</strong></div>) : <p className="text-sm text-[#718096]">No holdings linked. Add them from the Holdings tab and select this account.</p>}</div>}
    <Field label={returnLabel(type)} name="expectedAnnualReturn" type="number" defaultValue={item?.expectedAnnualReturn ?? 0} />
    <p className="mb-4 text-xs text-[#718096]">{type === "property" ? "Forecast compounds this property's value at this rate. Enter a negative number to model a declining market." : "Cash and savings accounts compound their balance at this rate in Forecast. Other types stay flat unless their holdings carry their own assumptions."}</p>
    {acceptsContributions({ type } as Account) && <div className="mb-4 rounded-lg border border-[#e7ebef] p-3">
      <p className="mb-3 text-xs uppercase tracking-wide text-[#718096]">Monthly contribution</p>
      <label className="mb-3 block text-sm"><span className="mb-1 block text-[#718096]">Amount added each month ($)</span><input name="monthlyContribution" type="number" step="any" min="0" value={contribution} onChange={event => setContribution(event.target.value)} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2 outline-none focus:border-[#3b7fbd]" /></label>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" name="contributionGrowth" checked={growsWithInflation} onChange={event => setGrowsWithInflation(event.target.checked)} /><span>Grow this contribution each year with inflation</span></label>
      {growsWithInflation && <label className="mb-3 block text-sm"><span className="mb-1 block text-[#718096]">Assumed annual inflation (%)</span><input name="contributionGrowthRate" type="number" step="any" defaultValue={item?.contributionGrowthRate ?? 3} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2 outline-none focus:border-[#3b7fbd]" /></label>}
      <label className="block text-sm"><span className="mb-1 block text-[#718096]">Buy with this money</span><select name="contributionTarget" defaultValue={item?.contributionTarget ?? "pro-rata"} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2">
        <option value="pro-rata">Split across current holdings (default)</option>
        <option value="cash">Hold as cash</option>
        {linked.map(holding => <option key={holding.id} value={holding.id}>All into {holding.ticker}</option>)}
      </select></label>
      <label className="mt-3 block text-sm"><span className="mb-1 block text-[#718096]">Stop contributing after (years)</span><input name="contributionYears" type="number" step="1" min="0" placeholder="Leave blank to contribute for the whole forecast" defaultValue={item?.contributionYears ? String(item.contributionYears) : ""} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2 outline-none focus:border-[#3b7fbd]" /></label>
      <p className="mt-1 text-xs text-[#718096]">Use this to model retiring or otherwise stopping deposits. The balance keeps compounding afterwards; it just stops receiving new money. Blank or 0 contributes for the full horizon.</p>
      <p className="mt-2 text-xs text-[#718096]">{linked.length ? `Default splits each deposit by today's mix: ${linked.map(holding => `${holding.ticker} ${(holdingsValue > 0 ? safeNumber(holding.quantity) * safeNumber(holding.price) / holdingsValue * 100 : 0).toFixed(0)}%`).join(", ")}.` : "With no linked holdings the contribution accumulates as cash and compounds at the expected annual return above."}</p>
    </div>}
    <FormActions />
  </form>;
}
function LiabilityForm({ item, save }: { item: Liability | null; save: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const payoff = item ? payoffMonths({ ...item, monthlyPayment: item.monthlyPayment, extraMonthly: item.extraMonthly }) : null;
  return <form onSubmit={save}>
    <Field label="Liability name" name="name" defaultValue={item?.name} />
    <Field label="Institution" name="institution" defaultValue={item?.institution} />
    <Field label="Balance" name="balance" type="number" defaultValue={item?.balance ?? 0} />
    <Field label="Interest rate (%)" name="rate" type="number" defaultValue={item?.rate ?? 0} />
    <label className="mb-1 block text-sm"><span className="mb-1 block text-[#718096]">Monthly principal &amp; interest ($)</span><input name="monthlyPayment" type="number" step="any" min="0" defaultValue={item?.monthlyPayment ?? 0} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2 outline-none focus:border-[#3b7fbd]" /></label>
    <p className="mb-4 text-xs text-[#718096]">Enter principal and interest only. If your lender bills one amount for taxes and insurance too, subtract the escrow portion &mdash; escrow never reduces the loan balance and including it would predict payoff years too early. Leave this at 0 to hold the balance flat in Forecast.</p>
    <label className="mb-1 block text-sm"><span className="mb-1 block text-[#718096]">Extra principal each month ($)</span><input name="extraMonthly" type="number" step="any" min="0" defaultValue={item?.extraMonthly ?? 0} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2 outline-none focus:border-[#3b7fbd]" /></label>
    <p className="mb-4 text-xs text-[#718096]">Optional. Anything you overpay goes straight against the balance.{payoff !== null ? ` At the saved payment this loan retires in ${payoffLabel(payoff)}.` : safeNumber(item?.monthlyPayment) > 0 ? " The saved payment does not cover the monthly interest, so the balance would never fall." : ""}</p>
    <FormActions />
  </form>;
}
function HoldingForm({ item, data, save }: { item: Holding | null; data: TrackerData; save: (event: React.FormEvent<HTMLFormElement>) => void }) { return <form onSubmit={save}><label className="mb-4 block text-sm"><span className="mb-1 block text-[#718096]">Account</span><select name="accountId" defaultValue={item?.accountId ?? data.accounts[0]?.id} className="w-full rounded-lg border border-[#dfe5e9] px-3 py-2">{data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><Field label="Ticker" name="ticker" defaultValue={item?.ticker} /><Field label="Quantity" name="quantity" type="number" defaultValue={item?.quantity ?? 0} /><Field label="Cost basis" name="costBasis" type="number" defaultValue={item?.costBasis ?? 0} /><Field label="Current price (optional)" name="price" type="number" defaultValue={item?.price ?? 0} /><p className="mb-4 text-xs text-[#718096]">Leave the price alone if you like &mdash; the app looks up the latest Yahoo Finance price when you save: the live quote during market hours, otherwise the most recent close.</p><p className="mb-4 text-xs text-[#718096]">Expected annual return belongs to the ticker, not to one account. Select the ticker in the holdings table to set it everywhere at once; a new position inherits the rate the symbol already uses.</p><FormActions /></form>; }
function TickerForm({ ticker, data, save }: { ticker: string; data: TrackerData; save: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const items = data.holdings.filter(holding => tickerKey(holding.ticker) === ticker);
  const returns = new Set(items.map(item => safeNumber(item.expectedAnnualReturn)));
  // When positions disagree, start from the largest one rather than 0, so a quick save cannot silently wipe a real assumption.
  const largest = [...items].sort((a, b) => safeNumber(b.quantity) * safeNumber(b.price) - safeNumber(a.quantity) * safeNumber(a.price))[0];
  return <form onSubmit={save}>
    <input type="hidden" name="ticker" value={ticker} />
    <Field label="Expected annual return (%)" name="expectedAnnualReturn" type="number" defaultValue={safeNumber(largest?.expectedAnnualReturn)} />
    <p className="mb-4 text-xs text-[#718096]">Saving applies this rate to every {ticker} position, in all {items.length} account{items.length === 1 ? "" : "s"} listed below. Forecasts use it as an assumption only; it is not a guarantee.{returns.size > 1 ? " These positions currently carry different rates, which this will replace." : ""}</p>
    <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-[#e7ebef] text-sm">{items.map(item => <div key={item.id} className="flex items-center justify-between border-b border-[#eef1f4] px-3 py-2 last:border-b-0"><span className="text-[#718096]">{data.accounts.find(account => account.id === item.accountId)?.name ?? "Unknown"}</span><span className="tabular-nums">{money(safeNumber(item.quantity) * safeNumber(item.price))}</span></div>)}</div>
    <FormActions />
  </form>;
}

