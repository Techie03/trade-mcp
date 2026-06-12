import axios from 'axios';
import axiosRetry from 'axios-retry';
import type {
  Quote, HistoricalCandle, MarketSummary, SearchResult, MarketIndex
} from '../types.js';
import { cacheGet, cacheSet, cacheKey, TTL } from '../cache.js';

// ─── Yahoo Finance unofficial v8 API ─────────────────────────────────────────
// No API key required. Covers US, NSE (.NS), BSE (.BO), and 60+ global exchanges.
// Uses exponential backoff to respect soft rate limits.

const BASE = 'https://query1.finance.yahoo.com';
const BASE2 = 'https://query2.finance.yahoo.com'; // fallback domain

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

const client = axios.create({ headers: HEADERS, timeout: 15000 });
axiosRetry(client, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (err) => {
    const status = err.response?.status;
    return axiosRetry.isNetworkOrIdempotentRequestError(err) || status === 429 || status === 503;
  },
});

// ─── Fetch chart data (quote + historical) ───────────────────────────────────

async function fetchChart(symbol: string, range: string = '1d', interval: string = '1d'): Promise<Record<string, unknown>> {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}`;
  try {
    const { data } = await client.get(url, { params: { range, interval, includePrePost: false } });
    return data?.chart?.result?.[0] ?? {};
  } catch {
    // Try fallback domain
    const { data } = await client.get(url.replace(BASE, BASE2), { params: { range, interval } });
    return data?.chart?.result?.[0] ?? {};
  }
}

// ─── get_quote ───────────────────────────────────────────────────────────────

export async function getQuote(symbol: string): Promise<Quote> {
  const key = cacheKey('yf:quote', symbol.toUpperCase());
  const cached = cacheGet<Quote>(key);
  if (cached) return cached;

  const result = await fetchChart(symbol, '1d', '1d');
  const meta = result.meta as Record<string, unknown>;
  if (!meta) throw new Error(`No data found for symbol: ${symbol}`);

  const q: Quote = {
    symbol: String(meta.symbol ?? symbol).toUpperCase(),
    name: String(meta.longName ?? meta.shortName ?? symbol),
    price: Number(meta.regularMarketPrice ?? 0),
    change: Number(meta.regularMarketPrice ?? 0) - Number(meta.chartPreviousClose ?? meta.previousClose ?? 0),
    changePercent: 0,
    open: Number(meta.regularMarketOpen ?? 0),
    high: Number(meta.regularMarketDayHigh ?? 0),
    low: Number(meta.regularMarketDayLow ?? 0),
    previousClose: Number(meta.chartPreviousClose ?? meta.previousClose ?? 0),
    volume: Number(meta.regularMarketVolume ?? 0),
    avgVolume: Number(meta.averageDailyVolume10Day ?? 0),
    marketCap: meta.marketCap as number | undefined,
    fiftyTwoWeekHigh: Number(meta.fiftyTwoWeekHigh ?? 0),
    fiftyTwoWeekLow: Number(meta.fiftyTwoWeekLow ?? 0),
    currency: String(meta.currency ?? 'USD'),
    exchange: String(meta.exchangeName ?? meta.fullExchangeName ?? ''),
    timestamp: Number(meta.regularMarketTime ?? Date.now() / 1000),
    source: 'Yahoo Finance',
  };
  q.changePercent = q.previousClose ? ((q.price - q.previousClose) / q.previousClose) * 100 : 0;

  cacheSet(key, q, TTL.QUOTE);
  return q;
}

// ─── get_historical ──────────────────────────────────────────────────────────

export async function getHistorical(
  symbol: string,
  range: string = '3mo',
  interval: string = '1d'
): Promise<HistoricalCandle[]> {
  const key = cacheKey('yf:hist', symbol.toUpperCase(), range, interval);
  const cached = cacheGet<HistoricalCandle[]>(key);
  if (cached) return cached;

  const result = await fetchChart(symbol, range, interval);
  const timestamps = result.timestamp as number[] | undefined;
  const indicators = result.indicators as Record<string, unknown> | undefined;
  const quote = (indicators?.quote as Record<string, unknown>[])?.[0];
  const adjClose = (indicators?.adjclose as Record<string, number[]>[])?.[0]?.adjclose;

  if (!timestamps || !quote) return [];

  const opens = quote.open as number[];
  const highs = quote.high as number[];
  const lows = quote.low as number[];
  const closes = quote.close as number[];
  const volumes = quote.volume as number[];

  const candles: HistoricalCandle[] = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      open: Number((opens[i] ?? 0).toFixed(2)),
      high: Number((highs[i] ?? 0).toFixed(2)),
      low: Number((lows[i] ?? 0).toFixed(2)),
      close: Number((closes[i] ?? 0).toFixed(2)),
      volume: Math.round(volumes[i] ?? 0),
      adjClose: adjClose ? Number((adjClose[i] ?? 0).toFixed(2)) : undefined,
    }))
    .filter(c => c.close > 0);

  cacheSet(key, candles, TTL.HISTORICAL);
  return candles;
}

// ─── get_market_summary ──────────────────────────────────────────────────────

const WORLD_INDICES = [
  { symbol: '^NSEI',  name: 'NIFTY 50',      region: 'India' },
  { symbol: '^BSESN', name: 'BSE SENSEX',    region: 'India' },
  { symbol: '^NSEBANK', name: 'BANKNIFTY',   region: 'India' },
  { symbol: '^GSPC',  name: 'S&P 500',       region: 'US' },
  { symbol: '^DJI',   name: 'Dow Jones',     region: 'US' },
  { symbol: '^IXIC',  name: 'NASDAQ',        region: 'US' },
  { symbol: '^FTSE',  name: 'FTSE 100',      region: 'UK' },
  { symbol: '^N225',  name: 'Nikkei 225',    region: 'Japan' },
  { symbol: '^HSI',   name: 'Hang Seng',     region: 'HongKong' },
  { symbol: '^GDAXI', name: 'DAX',           region: 'Germany' },
];

export async function getMarketSummary(region?: string): Promise<MarketSummary> {
  const key = cacheKey('yf:market', region ?? 'all');
  const cached = cacheGet<MarketSummary>(key);
  if (cached) return cached;

  const indices = region
    ? WORLD_INDICES.filter(i => i.region.toLowerCase() === region.toLowerCase())
    : WORLD_INDICES;

  const results = await Promise.allSettled(
    indices.map(async (idx) => {
      const chart = await fetchChart(idx.symbol, '1d', '1d');
      const meta = chart.meta as Record<string, unknown>;
      return {
        symbol: idx.symbol,
        name: idx.name,
        price: Number(meta?.regularMarketPrice ?? 0),
        change: Number(meta?.regularMarketPrice ?? 0) - Number(meta?.chartPreviousClose ?? 0),
        changePercent: 0,
        region: idx.region,
      } as MarketIndex;
    })
  );

  const marketIndices: MarketIndex[] = results
    .filter((r): r is PromiseFulfilledResult<MarketIndex> => r.status === 'fulfilled')
    .map(r => {
      const idx = r.value;
      const prevClose = idx.price - idx.change;
      idx.changePercent = prevClose ? (idx.change / prevClose) * 100 : 0;
      return idx;
    });

  const summary: MarketSummary = {
    indices: marketIndices,
    marketStatus: 'Live',
    timestamp: new Date().toISOString(),
    source: 'Yahoo Finance',
  };

  cacheSet(key, summary, TTL.MARKET_SUMMARY);
  return summary;
}

// ─── search_symbol ───────────────────────────────────────────────────────────

export async function searchSymbol(query: string): Promise<SearchResult[]> {
  const key = cacheKey('yf:search', query.toLowerCase());
  const cached = cacheGet<SearchResult[]>(key);
  if (cached) return cached;

  const { data } = await client.get(`${BASE}/v1/finance/search`, {
    params: { q: query, quotesCount: 15, newsCount: 0, enableFuzzyQuery: false },
  });

  const quotes: SearchResult[] = (data?.quotes ?? []).map((q: Record<string, string>) => ({
    symbol: q.symbol,
    name: q.longname ?? q.shortname ?? q.symbol,
    exchange: q.exchDisp ?? q.exchange ?? '',
    type: q.typeDisp ?? q.quoteType ?? 'EQUITY',
    currency: q.currency,
    region: q.region,
  }));

  cacheSet(key, quotes, TTL.SEARCH);
  return quotes;
}
