export type MarketState = "open" | "preOpen" | "closed";
/** Which trading moment the price represents, so the UI can label it honestly. */
export type PriceBasis = "live" | "todayClose" | "previousClose";
export type Quote = {
  ticker: string;
  price: number;
  asOf: string;
  asOfTime?: string;
  provider: string;
  previousClose?: number;
  changePercent?: number;
  marketState: MarketState;
  basis: PriceBasis;
};
export type PriceProvider = { name: string; getPrice: (ticker: string) => Promise<number> };

/**
 * Browsers cannot call Yahoo directly (it sends no CORS headers), so quotes go through a
 * small proxy, normally the Cloudflare Worker in `cloudflare-worker/worker.js`. The proxy
 * is called as `<proxyUrl>?symbol=VTI` and returns Yahoo's chart JSON unchanged.
 */
const chartUrl = (proxyUrl: string, symbol: string) => {
  const url = new URL(proxyUrl.trim());
  url.searchParams.set("symbol", symbol);
  return url.toString();
};

/** Market dates are evaluated in New York so "previous close" matches the US trading calendar. */
export const marketDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        currentTradingPeriod?: { regular?: { start?: number; end?: number } };
      };
    }>;
    error?: { description?: string } | null;
  };
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Yahoo's regular-session window tells us whether the last trade is still moving.
 * Outside a session the window describes the session that just finished, so
 * "now past the end" means closed and "now before the start" means pre-open.
 */
function readMarketState(period: { start?: number; end?: number } | undefined, nowSeconds: number): MarketState {
  const start = period?.start;
  const end = period?.end;
  if (!finite(start) || !finite(end)) return "closed";
  if (nowSeconds < start) return "preOpen";
  return nowSeconds < end ? "open" : "closed";
}

/**
 * Returns the latest trade price Yahoo will give us:
 *   - during the session, the live (exchange-delayed) last trade;
 *   - after the bell, that session's official close;
 *   - before the bell, the previous session's close.
 * `basis` says which of the three you got, so nothing is presented as live when it is not.
 */
export async function fetchQuote(ticker: string, proxyUrl: string): Promise<Quote> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) throw new Error("ticker is required");
  if (!proxyUrl.trim()) throw new Error("No price proxy URL is set. Add your Cloudflare Worker URL in Settings.");
  let response: Response;
  try { response = await fetch(chartUrl(proxyUrl, symbol), { headers: { Accept: "application/json" }, cache: "no-store" }); }
  catch { throw new Error(`${symbol}: cannot reach the price proxy. Check the Worker URL in Settings and your connection.`); }
  if (response.status === 404) throw new Error(`${symbol}: symbol not found`);
  if (!response.ok) throw new Error(`${symbol}: lookup failed (${response.status})`);

  const payload = await response.json() as YahooChart;
  const described = payload.chart?.error?.description;
  if (described) throw new Error(`${symbol}: ${described}`);

  const result = payload.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const bars = stamps
    .map((stamp, index) => ({ date: marketDate(new Date(stamp * 1000)), close: closes[index] }))
    .filter((bar): bar is { date: string; close: number } => finite(bar.close));

  const meta = result?.meta;
  const marketState = readMarketState(meta?.currentTradingPeriod?.regular, Date.now() / 1000);
  const todayInMarket = marketDate();

  const quoted = meta?.regularMarketPrice;
  const live = finite(quoted) ? quoted : undefined;
  const stamped = meta?.regularMarketTime;
  const stampedAt = finite(stamped) ? new Date(stamped * 1000) : undefined;

  let price: number;
  let asOf: string;
  let asOfTime: string | undefined;
  if (live !== undefined) {
    price = live;
    asOf = stampedAt ? marketDate(stampedAt) : todayInMarket;
    asOfTime = stampedAt?.toISOString();
  } else {
    // No quote in the payload: fall back to the last completed daily bar.
    if (!bars.length) throw new Error(`${symbol}: no price returned`);
    const last = bars[bars.length - 1];
    price = last.close;
    asOf = last.date;
  }

  // The prior session is the newest daily bar dated before the quote's own day.
  const prior = [...bars].reverse().find(bar => bar.date < asOf);
  const changePercent = prior && prior.close !== 0 ? (price - prior.close) / Math.abs(prior.close) * 100 : undefined;

  const basis: PriceBasis = marketState === "open" && live !== undefined ? "live" : asOf === todayInMarket ? "todayClose" : "previousClose";
  return { ticker: symbol, price, asOf, asOfTime, provider: "Yahoo Finance", previousClose: prior?.close, changePercent, marketState, basis };
}

/** Quotes several symbols at once; one failure never blocks the rest. */
export async function fetchQuotes(tickers: string[], proxyUrl: string): Promise<{ quotes: Quote[]; errors: string[] }> {
  const unique = [...new Set(tickers.map(item => item.trim().toUpperCase()).filter(Boolean))];
  const settled = await Promise.allSettled(unique.map(ticker => fetchQuote(ticker, proxyUrl)));
  return {
    quotes: settled.flatMap(item => item.status === "fulfilled" ? [item.value] : []),
    errors: settled.flatMap(item => item.status === "rejected" ? [item.reason instanceof Error ? item.reason.message : "lookup failed"] : [])
  };
}

// Deterministic offline fallback so the app stays usable without network access.
export const demoPriceProvider: PriceProvider = {
  name: "Demo prices",
  async getPrice(ticker) {
    const known: Record<string, number> = { VTI: 292.18, BND: 72.4, VXUS: 68.15, AAPL: 227.16, MSFT: 505.2, BTC: 108500 };
    return known[ticker.toUpperCase()] ?? Math.max(5, 100 + [...ticker].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 250);
  }
};
