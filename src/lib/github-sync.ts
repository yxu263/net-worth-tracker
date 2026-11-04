import { parseEnvelope, type DataEnvelope } from "./backup";
import type { GitHubSettings } from "./settings";

/** UTF-8 safe base64; btoa/atob alone are byte-oriented. */
function encodeB64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function decodeB64(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

const repoUrl = (gh: GitHubSettings) => `${gh.api.replace(/\/+$/, "")}/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}`;
const contentsUrl = (gh: GitHubSettings) => `${repoUrl(gh)}/contents/${gh.path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;

async function ghFetch(gh: GitHubSettings, method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${gh.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (body) headers["Content-Type"] = "application/json";
  try { return await fetch(url, { method, headers, cache: "no-store", body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error(`Cannot reach ${new URL(url).host}. Check your network connection.`); }
}

async function ghError(response: Response) {
  let detail = "";
  try { detail = ((await response.json()) as { message?: string }).message ?? ""; } catch { /* ignore */ }
  if (response.status === 401) return new Error("Token rejected (401). It may have expired; enter a new one in Settings.");
  if (response.status === 403) return new Error("Access denied (403). The token needs Contents: Read and write on the data repository.");
  if (response.status === 404) return new Error("Repository or branch not found (404). Check owner, repository, branch and token access.");
  return new Error(`GitHub API ${response.status}${detail ? `: ${detail}` : ""}`);
}

export type RemoteFile = { exists: false } | { exists: true; data: DataEnvelope["data"]; updatedAt: string | null; sha: string };

export async function fetchRemote(gh: GitHubSettings): Promise<RemoteFile> {
  const url = `${contentsUrl(gh)}?ref=${encodeURIComponent(gh.branch || "main")}&t=${Date.now()}`;
  const response = await ghFetch(gh, "GET", url);
  if (response.status === 404) {
    // A missing file is normal on first use, but a missing repo or branch is not.
    const repo = await ghFetch(gh, "GET", `${repoUrl(gh)}/branches/${encodeURIComponent(gh.branch || "main")}`);
    if (!repo.ok) throw await ghError(repo);
    return { exists: false };
  }
  if (!response.ok) throw await ghError(response);
  const payload = await response.json() as { content?: string; sha: string };
  let text = payload.content ? decodeB64(payload.content) : "";
  // The contents API omits inline content for files over 1 MB; the blobs API serves up to 100 MB.
  if (!text) {
    const blob = await ghFetch(gh, "GET", `${repoUrl(gh)}/git/blobs/${payload.sha}`);
    if (!blob.ok) throw await ghError(blob);
    text = decodeB64(((await blob.json()) as { content?: string }).content ?? "");
  }
  const parsed = parseEnvelope(text);
  return { exists: true, data: parsed.data, updatedAt: parsed.updatedAt, sha: payload.sha };
}

/** Returns the new sha, or null when the remote changed underneath us (stale sha). */
export async function uploadRemote(gh: GitHubSettings, envelope: DataEnvelope, sha: string | null): Promise<string | null> {
  const response = await ghFetch(gh, "PUT", contentsUrl(gh), {
    message: `Net Worth Tracker update ${envelope.updatedAt}`,
    content: encodeB64(JSON.stringify(envelope)),
    branch: gh.branch || "main",
    sha: sha ?? undefined
  });
  if (response.status === 409 || response.status === 422) return null;
  if (!response.ok) throw await ghError(response);
  const payload = await response.json() as { content?: { sha?: string } };
  return payload.content?.sha ?? null;
}
