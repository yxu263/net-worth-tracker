/**
 * Net Worth Tracker price proxy for Cloudflare Workers (free plan: 100,000 requests/day).
 *
 * Browsers block web pages from calling Yahoo Finance directly, so the app calls this
 * Worker instead: GET https://<your-worker>.workers.dev/?symbol=VTI
 * The Worker fetches Yahoo's chart data and returns it with CORS headers.
 * It only proxies Yahoo's chart endpoint for a single, validated symbol.
 *
 * Deploy: Cloudflare dashboard -> Workers & Pages -> Create -> Worker -> paste this file.
 */

// Only these sites may use the proxy from a browser. Leave the array empty to allow any site.
const ALLOWED_ORIGINS = [
  "https://yxu263.github.io",
  "http://localhost:3000"
];

const SYMBOL = /^[A-Za-z0-9.\-^=]{1,20}$/;

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
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

    const upstream = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, cf: { cacheTtl: 60, cacheEverything: true } }
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }
    });
  }
};
