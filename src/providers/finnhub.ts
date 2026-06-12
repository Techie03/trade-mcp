import axios from 'axios';
import axiosRetry from 'axios-retry';
import type { Earnings, EarningsEntry, NewsArticle, SearchResult, CryptoQuote } from '../types.js';
import { cacheGet, cacheSet, cacheKey, TTL, incrementRateLimit, getRateLimitCounter } from '../cache.js';

// ─── Finnhub provider ─────────────────────────────────────────────────────────
// Free tier: 60 requests/minute.
// Key signup: https://finnhub.io/register

const API_KEY = process.env.FINNHUB_KEY ?? '';
const BASE = 'https://finnhub.io/api/v1';

// Per-minute rate guard
const RPM_LIMIT = 55; // stay a bit under 60 for safety
const RPM_KEY = 'fh:rpm';

function checkRate(): void {
  if (!API_KEY) throw new Error('FINNHUB_KEY not set. Get a free key at finnhub.io/register');
  const count = getRateLimitCounter(RPM_KEY);
  if (count >= RPM_LIMIT) {
    throw new Error(`Finnhub rate limit (${RPM_LIMIT} req/min) reached. Please wait a minute.`);
  }
  incrementRateLimit(RPM_KEY, 60);
}

const client = axios.create({ baseURL: BASE, timeout: 12000 });
axiosRetry(client, { retries: 2, retryDelay: (n) => n * 1000 });

async function fhGet(endpoint: string, params: Record<string, string | number> = {}): Promise<unknown> {
  checkRate();
  const { data } = await client.get(endpoint, { params: { ...params, token: API_KEY } });
  return data;
}

// ─── Quote ───────────────────────────────────────────────────────────────────

export async function getFinnhubQuote(symbol: string): Promise<{ price: number; change: number; changePercent: number; high: number; low: number; open: number; previousClose: number } | null> {
  const key = cacheKey('fh:quote', symbol.toUpperCase());
  const cached = cacheGet<Record<string, number>>(key);
  if (cached) return cached as typeof cached & { price: number; change: number; changePercent: number; high: number; low: number; open: number; previousClose: number };

  const data = await fhGet('/quote', { symbol }) as Record<string, number>;
  if (!data.c) return null;

  const result = {
    price: data.c,
    change: data.d,
    changePercent: data.dp,
    high: data.h,
    low: data.l,
    open: data.o,
    previousClose: data.pc,
  };

  cacheSet(key, result, TTL.QUOTE);
  return result;
}

// ─── Company Profile ─────────────────────────────────────────────────────────

export async function getCompanyProfile(symbol: string): Promise<Record<string, unknown> | null> {
  const key = cacheKey('fh:profile', symbol.toUpperCase());
  const cached = cacheGet<Record<string, unknown>>(key);
  if (cached) return cached;

  const data = await fhGet('/stock/profile2', { symbol }) as Record<string, unknown>;
  if (!data.name) return null;

  cacheSet(key, data, TTL.FUNDAMENTALS);
  return data;
}

// ─── Company News ────────────────────────────────────────────────────────────

export async function getCompanyNews(symbol: string, days: number = 7): Promise<NewsArticle[]> {
  const key = cacheKey('fh:news', symbol.toUpperCase(), days);
  const cached = cacheGet<NewsArticle[]>(key);
  if (cached) return cached;

  const to = new Date();
  const from = new Date(Date.now() - days * 86400 * 1000);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const data = await fhGet('/company-news', {
    symbol,
    from: fmt(from),
    to: fmt(to),
  }) as Array<Record<string, unknown>>;

  const articles: NewsArticle[] = (Array.isArray(data) ? data : [])
    .slice(0, 20)
    .map(a => ({
      headline: String(a.headline ?? ''),
      summary: String(a.summary ?? ''),
      url: String(a.url ?? ''),
      source: String(a.source ?? 'Finnhub'),
      publishedAt: new Date(Number(a.datetime ?? 0) * 1000).toISOString(),
      relatedSymbols: [symbol],
    }));

  cacheSet(key, articles, TTL.NEWS);
  return articles;
}

// ─── Market News ─────────────────────────────────────────────────────────────

export async function getMarketNews(
  category: 'general' | 'forex' | 'crypto' | 'merger' = 'general'
): Promise<NewsArticle[]> {
  const key = cacheKey('fh:marketnews', category);
  const cached = cacheGet<NewsArticle[]>(key);
  if (cached) return cached;

  const data = await fhGet('/news', { category }) as Array<Record<string, unknown>>;

  const articles: NewsArticle[] = (Array.isArray(data) ? data : [])
    .slice(0, 20)
    .map(a => ({
      headline: String(a.headline ?? ''),
      summary: String(a.summary ?? ''),
      url: String(a.url ?? ''),
      source: String(a.source ?? 'Finnhub'),
      publishedAt: new Date(Number(a.datetime ?? 0) * 1000).toISOString(),
    }));

  cacheSet(key, articles, TTL.NEWS);
  return articles;
}

// ─── Earnings ────────────────────────────────────────────────────────────────

export async function getEarnings(symbol: string): Promise<Earnings> {
  const key = cacheKey('fh:earnings', symbol.toUpperCase());
  const cached = cacheGet<Earnings>(key);
  if (cached) return cached;

  const [history, estimate] = await Promise.allSettled([
    fhGet('/stock/earnings', { symbol, limit: 12 }),
    fhGet('/calendar/earnings', { symbol }),
  ]);

  const histData = (history.status === 'fulfilled' ? history.value : []) as Array<Record<string, unknown>>;
  const estData = (estimate.status === 'fulfilled' ? estimate.value : null) as Record<string, unknown> | null;

  const entries: EarningsEntry[] = (Array.isArray(histData) ? histData : []).map(e => ({
    date: String(e.period ?? ''),
    epsActual: typeof e.actual === 'number' ? e.actual : null,
    epsEstimate: typeof e.estimate === 'number' ? e.estimate : null,
    epsSurprise: typeof e.surprise === 'number' ? e.surprise : null,
    epsSurprisePercent: typeof e.surprisePercent === 'number' ? e.surprisePercent : null,
    period: String(e.period ?? ''),
  }));

  const upcoming = (estData?.earningsCalendar as Array<Record<string, unknown>> ?? [])
    .find(e => new Date(String(e.date)) > new Date());

  const result: Earnings = {
    symbol,
    history: entries,
    nextEarningsDate: upcoming ? String(upcoming.date) : undefined,
    nextEarningsEpsEstimate: upcoming?.epsEstimate as number | undefined,
    source: 'Finnhub',
  };

  cacheSet(key, result, TTL.FUNDAMENTALS);
  return result;
}

// ─── Symbol Search ───────────────────────────────────────────────────────────

export async function searchFinnhub(query: string): Promise<SearchResult[]> {
  const key = cacheKey('fh:search', query.toLowerCase());
  const cached = cacheGet<SearchResult[]>(key);
  if (cached) return cached;

  const data = await fhGet('/search', { q: query }) as { result?: Array<Record<string, string>> };
  const results: SearchResult[] = (data.result ?? []).slice(0, 10).map(r => ({
    symbol: r.symbol,
    name: r.description,
    exchange: r.primaryExchange ?? '',
    type: r.type ?? 'Common Stock',
  }));

  cacheSet(key, results, TTL.SEARCH);
  return results;
}

// ─── Crypto Quote ────────────────────────────────────────────────────────────

const CRYPTO_SYMBOLS: Record<string, string> = {
  BTC: 'BINANCE:BTCUSDT', ETH: 'BINANCE:ETHUSDT', DOGE: 'BINANCE:DOGEUSDT',
  SOL: 'BINANCE:SOLUSDT', XRP: 'BINANCE:XRPUSDT', ADA: 'BINANCE:ADAUSDT',
  MATIC: 'BINANCE:MATICUSDT', DOT: 'BINANCE:DOTUSDT', AVAX: 'BINANCE:AVAXUSDT',
  LINK: 'BINANCE:LINKUSDT',
};

export async function getCryptoQuote(symbol: string): Promise<CryptoQuote> {
  const upper = symbol.toUpperCase().replace('/USDT', '').replace('-USD', '');
  const fhSymbol = CRYPTO_SYMBOLS[upper] ?? `BINANCE:${upper}USDT`;
  const key = cacheKey('fh:crypto', upper);
  const cached = cacheGet<CryptoQuote>(key);
  if (cached) return cached;

  const data = await fhGet('/quote', { symbol: fhSymbol }) as Record<string, number>;
  if (!data.c) throw new Error(`No crypto data for ${symbol}`);

  const result: CryptoQuote = {
    symbol: upper,
    name: upper,
    price: data.c,
    change24h: data.d,
    changePercent24h: data.dp,
    volume24h: 0,
    currency: 'USD',
    timestamp: new Date().toISOString(),
    source: 'Finnhub',
  };

  cacheSet(key, result, TTL.QUOTE);
  return result;
}
