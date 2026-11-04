/**
 * Device-local settings. These never leave the browser: the GitHub token in particular
 * is stored only in this device's localStorage and is never written to the synced file.
 */
export type GitHubSettings = { api: string; owner: string; repo: string; branch: string; path: string; token: string };
export type AppSettings = { priceProxyUrl: string; github: GitHubSettings };

export const defaultGitHub: GitHubSettings = { api: "https://api.github.com", owner: "", repo: "", branch: "main", path: "net-worth-data.json", token: "" };
export const defaultSettings: AppSettings = { priceProxyUrl: "", github: defaultGitHub };

const SETTINGS_KEY = "nest-egg-settings";
const SYNC_STATE_KEY = "nest-egg-sync-state";

const text = (value: unknown, fallback: string) => typeof value === "string" ? value.trim() : fallback;

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<AppSettings> | null;
    if (!raw || typeof raw !== "object") return defaultSettings;
    const gh = (raw.github ?? {}) as Partial<GitHubSettings>;
    return {
      priceProxyUrl: text(raw.priceProxyUrl, ""),
      github: {
        api: (text(gh.api, defaultGitHub.api) || defaultGitHub.api).replace(/\/+$/, ""),
        owner: text(gh.owner, ""), repo: text(gh.repo, ""),
        branch: text(gh.branch, defaultGitHub.branch) || defaultGitHub.branch,
        path: text(gh.path, defaultGitHub.path) || defaultGitHub.path,
        token: text(gh.token, "")
      }
    };
  } catch { return defaultSettings; }
}

export function saveSettings(settings: AppSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export const syncConfigured = (gh: GitHubSettings) => !!(gh.token && gh.owner && gh.repo && gh.path);

/** Identifies the remote file; a change means a fresh first sync is needed. */
export const syncTarget = (gh: GitHubSettings) => [gh.api, gh.owner, gh.repo, gh.branch, gh.path].join("|").toLowerCase();

/**
 * `remoteStamp` is the `updatedAt` of the remote copy this device last reconciled with.
 * `pending` means local edits have not been uploaded yet. `firstSync` asks the user
 * whether to replace or merge the first time a device meets an existing remote file.
 */
export type SyncState = {
  target?: string;
  sha?: string | null;
  remoteStamp?: string | null;
  pending?: boolean;
  localEditedAt?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  lastMessage?: string | null;
  firstSync?: boolean;
};

export function loadSyncState(): SyncState {
  if (typeof window === "undefined") return {};
  try { return (JSON.parse(window.localStorage.getItem(SYNC_STATE_KEY) ?? "null") as SyncState | null) ?? {}; } catch { return {}; }
}

export function saveSyncState(state: SyncState) {
  window.localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}
