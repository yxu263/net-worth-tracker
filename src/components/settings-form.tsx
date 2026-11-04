"use client";

import { useState } from "react";
import { fetchQuote } from "@/lib/pricing";
import { type AppSettings } from "@/lib/settings";

const input = "w-full rounded-lg border border-[#dfe5e9] px-3 py-2 text-sm";

function Text({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="mb-3 block text-sm"><span className="mb-1 block text-[#718096]">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} autoComplete="off" spellCheck={false} className={input} /></label>;
}

export default function SettingsForm({ settings, status, onSave, onSyncNow, onDisconnect }: {
  settings: AppSettings;
  status: { text: string; detail?: string | null; error?: string | null };
  onSave: (next: AppSettings) => void;
  onSyncNow: () => void;
  onDisconnect: () => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [test, setTest] = useState("");
  const gh = draft.github;
  const setGh = (patch: Partial<AppSettings["github"]>) => setDraft(current => ({ ...current, github: { ...current.github, ...patch } }));

  async function testProxy() {
    setTest("Checking…");
    try { const quote = await fetchQuote("SPY", draft.priceProxyUrl); setTest(`Works: SPY ${quote.price.toFixed(2)} (${quote.basis})`); }
    catch (error) { setTest(error instanceof Error ? error.message : "Failed"); }
  }

  return <form onSubmit={event => { event.preventDefault(); onSave(draft); }} className="space-y-5">
    <section>
      <h3 className="mb-1 font-semibold">Price lookup</h3>
      <p className="mb-3 text-xs text-[#718096]">      URL of your price proxy: the Netlify function (<code>https://&lt;site&gt;.netlify.app/quote</code>) or Cloudflare Worker. Prices come from Yahoo Finance through it.</p>
            <Text label="Price proxy URL" value={draft.priceProxyUrl} onChange={value => setDraft(current => ({ ...current, priceProxyUrl: value.trim() }))} placeholder="https://net-worth-prices.netlify.app/quote" />
      <div className="flex items-center gap-3"><button type="button" onClick={() => void testProxy()} disabled={!draft.priceProxyUrl} className="rounded-lg border border-[#e7ebef] px-3 py-1.5 text-xs disabled:opacity-50">Test</button><span className="text-xs text-[#718096]">{test}</span></div>
    </section>
    <section>
      <h3 className="mb-1 font-semibold">GitHub sync</h3>
      <p className="mb-3 text-xs text-[#718096]">Keeps your data in a JSON file in a <strong>private</strong> repository so every device sees the same numbers. Use a fine-grained token limited to that one repository with <em>Contents: Read and write</em>. The token is stored only in this browser.</p>
      <div className="grid grid-cols-2 gap-x-3">
        <Text label="Owner" value={gh.owner} onChange={owner => setGh({ owner: owner.trim() })} placeholder="your-username" />
        <Text label="Private data repository" value={gh.repo} onChange={repo => setGh({ repo: repo.trim() })} placeholder="net-worth-data" />
        <Text label="Branch" value={gh.branch} onChange={branch => setGh({ branch: branch.trim() })} placeholder="main" />
        <Text label="File path" value={gh.path} onChange={path => setGh({ path: path.trim() })} placeholder="net-worth-data.json" />
      </div>
      <Text label="API base URL" value={gh.api} onChange={api => setGh({ api: api.trim() })} placeholder="https://api.github.com" />
      <Text label="Access token" type="password" value={gh.token} onChange={token => setGh({ token: token.trim() })} placeholder="github_pat_…" />
      <div className="rounded-lg bg-[#f7f8fa] p-3 text-xs"><p><strong>Status:</strong> {status.text}</p>{status.detail && <p className="mt-1 text-[#718096]">{status.detail}</p>}{status.error && <p className="mt-1 text-[#b95d57]">{status.error}</p>}</div>
      <div className="mt-3 flex gap-2"><button type="button" onClick={onSyncNow} className="rounded-lg border border-[#e7ebef] px-3 py-1.5 text-xs">Sync now</button><button type="button" onClick={() => { if (window.confirm("Remove the token and stop syncing on this device? Your data on this device stays.")) { setGh({ token: "" }); onDisconnect(); } }} className="rounded-lg border border-[#e7ebef] px-3 py-1.5 text-xs text-[#b95d57]">Disconnect</button></div>
    </section>
    <div className="flex justify-end"><button type="submit" className="rounded-lg bg-[#17212b] px-4 py-2 text-sm text-white">Save settings</button></div>
  </form>;
}
