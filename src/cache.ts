import NodeCache from 'node-cache';

// ─── Cache configuration ─────────────────────────────────────────────────────
// Different TTLs for different data types to balance freshness vs. API quota.

const cache = new NodeCache({ useClones: false });

export const TTL = {
  QUOTE:          60,         // 1 minute  — live prices
  MARKET_SUMMARY: 60,         // 1 minute  — index data
  HISTORICAL:     300,        // 5 minutes — EOD bars
  BHAVCOPY:       300,        // 5 minutes — NSE CSV data
  NEWS:           300,        // 5 minutes — news articles
  OPTION_CHAIN:   180,        // 3 minutes — F&O chain
  TECHNICAL:      600,        // 10 minutes — indicators
  FUNDAMENTALS:   86400,      // 24 hours  — company data changes rarely
  AI_INSIGHT:     600,        // 10 minutes — AI analysis
  SECTOR:         3600,       // 1 hour    — sector data
  FOREX:          120,        // 2 minutes — FX rates
  SEARCH:         3600,       // 1 hour    — symbol lookup
  NSE_COOKIES:    300,        // 5 minutes — NSE session refresh
} as const;

export function cacheGet<T>(key: string): T | undefined {
  return cache.get<T>(key) ?? undefined;
}

export function cacheSet<T>(key: string, value: T, ttl: number): void {
  cache.set(key, value, ttl);
}

export function cacheKey(...parts: (string | number)[]): string {
  return parts.map(String).join(':');
}

// Rate limit guards stored in cache
export function getRateLimitCounter(key: string): number {
  return cache.get<number>(key) ?? 0;
}

export function incrementRateLimit(key: string, windowSecs: number): number {
  const current = getRateLimitCounter(key);
  const next = current + 1;
  cache.set(key, next, windowSecs);
  return next;
}
