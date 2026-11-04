/**
 * Net Worth Tracker price proxy as a Netlify Function (free plan).
 * Same job as cloudflare-worker/worker.js, for networks that block *.workers.dev.
 *
 *   GET https://<your-site>.netlify.app/quote?symbol=FDGRX
 *
 * Fetches Yahoo Finance's chart data for one validated symbol and returns it with
 * CORS headers so the app (a static page on GitHub Pages) may read it.
 */

// Only these sites may use the proxy from a browser. Leave the array empty to allow any site.
const ALLOWED_ORIGINS = [
  "https://yxu263.github.io",
  "http://localhost:3000"
];

const SYMBOL = /^[A-Za-z0-9.\-^=]{1,20}$/;
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

export default async (request) => {
  const origin = request.headers.get("origin") || "";
  const restricted = ALLOWED_ORIGINS.length > 0;
  const allowed = !restricted || ALLOWED_ORIGINS.includes(origin);
  const cors = {
    "Access-Control-Allow-Origin": restricted ? (allowed ? origin : ALLOWED_ORIGINS[0]) : "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Vary": "Origin"
  };
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return json({ error: "GET only" }, 405);
  if (origin && !allowed) return json({ error: "origin not allowed" }, 403);

  const symbol = new URL(request.url).searchParams.get("symbol") || "";
  if (!SYMBOL.test(symbol)) return json({ error: "symbol is required" }, 400);

  // Yahoo occasionally rate-limits one host; the second serves the same data.
  let upstream;
  for (const host of HOSTS) {
    try {
      upstream = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
      });
    } catch {
      continue;
    }
    if (upstream.status !== 429 && upstream.status < 500) break;
  }
  if (!upstream) return json({ error: "price source unreachable" }, 502);
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }
  });
};

export const config = { path: "/quote" };
