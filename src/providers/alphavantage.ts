import axios from 'axios';
import axiosRetry from 'axios-retry';
import type {
  Quote, CompanyOverview, FinancialStatement, TechnicalData, SectorPerformance
} from '../types.js';
import { cacheGet, cacheSet, cacheKey, TTL, getRateLimitCounter, incrementRateLimit } from '../cache.js';

// ─── Alpha Vantage provider ───────────────────────────────────────────────────
// Free tier: 25 requests/day (burst: 5/min). No key = graceful skip.
// Key signup: https://www.alphavantage.co/support/#api-key

const API_KEY = process.env.ALPHA_VANTAGE_KEY ?? '';
const BASE = 'https://www.alphavantage.co/query';

// Daily quota guard — tracks requests with 24h TTL
const DAILY_LIMIT = 25;
const DAILY_KEY = 'av:daily_count';

function checkQuota(): void {
  if (!API_KEY) throw new Error('ALPHA_VANTAGE_KEY not set. Get a free key at alphavantage.co');
  const count = getRateLimitCounter(DAILY_KEY);
  if (count >= DAILY_LIMIT) {
    throw new Error(`Alpha Vantage daily quota (${DAILY_LIMIT} req/day) reached. Resets at midnight UTC.`);
  }
}

function useQuota(): void {
  incrementRateLimit(DAILY_KEY, 86400); // 24h window
}

const client = axios.create({ baseURL: BASE, timeout: 15000 });
axiosRetry(client, { retries: 2, retryDelay: axiosRetry.exponentialDelay });

async function avGet(params: Record<string, string>): Promise<Record<string, unknown>> {
  checkQuota();
  const { data } = await client.get('', { params: { ...params, apikey: API_KEY } });
  useQuota();
  if (data['Note'] || data['Information']) {
    throw new Error(`Alpha Vantage rate limit: ${data['Note'] ?? data['Information']}`);
  }
  return data as Record<string, unknown>;
}

// ─── Global Quote ────────────────────────────────────────────────────────────

export async function getAVQuote(symbol: string): Promise<Partial<Quote>> {
  const key = cacheKey('av:quote', symbol.toUpperCase());
  const cached = cacheGet<Partial<Quote>>(key);
  if (cached) return cached;

  const data = await avGet({ function: 'GLOBAL_QUOTE', symbol });
  const q = data['Global Quote'] as Record<string, string>;
  if (!q || !q['05. price']) return {};

  const result: Partial<Quote> = {
    symbol: q['01. symbol'],
    price: parseFloat(q['05. price']),
    open: parseFloat(q['02. open']),
    high: parseFloat(q['03. high']),
    low: parseFloat(q['04. low']),
    previousClose: parseFloat(q['08. previous close']),
    change: parseFloat(q['09. change']),
    changePercent: parseFloat(q['10. change percent']?.replace('%', '') ?? '0'),
    volume: parseInt(q['06. volume'] ?? '0'),
    source: 'Alpha Vantage',
  };

  cacheSet(key, result, TTL.QUOTE);
  return result;
}

// ─── Company Overview ────────────────────────────────────────────────────────

export async function getCompanyOverview(symbol: string): Promise<CompanyOverview> {
  const key = cacheKey('av:overview', symbol.toUpperCase());
  const cached = cacheGet<CompanyOverview>(key);
  if (cached) return cached;

  const data = await avGet({ function: 'OVERVIEW', symbol });
  if (!data['Symbol']) throw new Error(`No overview data for ${symbol}`);

  const d = data as Record<string, string>;
  const result: CompanyOverview = {
    symbol: d.Symbol,
    name: d.Name,
    description: d.Description,
    sector: d.Sector,
    industry: d.Industry,
    country: d.Country,
    exchange: d.Exchange,
    currency: d.Currency,
    marketCap: parseFloat(d.MarketCapitalization) || undefined,
    peRatio: parseFloat(d.PERatio) || undefined,
    pegRatio: parseFloat(d.PEGRatio) || undefined,
    priceToBook: parseFloat(d.PriceToBookRatio) || undefined,
    eps: parseFloat(d.EPS) || undefined,
    dividendYield: parseFloat(d.DividendYield) || undefined,
    dividendPerShare: parseFloat(d.DividendPerShare) || undefined,
    beta: parseFloat(d.Beta) || undefined,
    fiftyTwoWeekHigh: parseFloat(d['52WeekHigh']) || undefined,
    fiftyTwoWeekLow: parseFloat(d['52WeekLow']) || undefined,
    fiftyDayMA: parseFloat(d['50DayMovingAverage']) || undefined,
    twoHundredDayMA: parseFloat(d['200DayMovingAverage']) || undefined,
    sharesOutstanding: parseFloat(d.SharesOutstanding) || undefined,
    bookValue: parseFloat(d.BookValue) || undefined,
    revenuePerShare: parseFloat(d.RevenuePerShareTTM) || undefined,
    profitMargin: parseFloat(d.ProfitMargin) || undefined,
    operatingMargin: parseFloat(d.OperatingMarginTTM) || undefined,
    returnOnEquity: parseFloat(d.ReturnOnEquityTTM) || undefined,
    returnOnAssets: parseFloat(d.ReturnOnAssetsTTM) || undefined,
    quarterlyEarningsGrowth: parseFloat(d.QuarterlyEarningsGrowthYOY) || undefined,
    quarterlyRevenueGrowth: parseFloat(d.QuarterlyRevenueGrowthYOY) || undefined,
    analystTargetPrice: parseFloat(d.AnalystTargetPrice) || undefined,
    source: 'Alpha Vantage',
  };

  cacheSet(key, result, TTL.FUNDAMENTALS);
  return result;
}

// ─── Financial Statements ────────────────────────────────────────────────────

type StatementFunction = 'INCOME_STATEMENT' | 'BALANCE_SHEET' | 'CASH_FLOW';
type StatementType = 'income' | 'balance' | 'cashflow';

const fnMap: Record<StatementType, StatementFunction> = {
  income: 'INCOME_STATEMENT',
  balance: 'BALANCE_SHEET',
  cashflow: 'CASH_FLOW',
};

export async function getFinancialStatement(
  symbol: string,
  type: StatementType,
  frequency: 'annual' | 'quarterly' = 'annual'
): Promise<FinancialStatement> {
  const key = cacheKey('av:fin', symbol.toUpperCase(), type, frequency);
  const cached = cacheGet<FinancialStatement>(key);
  if (cached) return cached;

  const data = await avGet({ function: fnMap[type], symbol });
  const reportsKey = frequency === 'annual' ? 'annualReports' : 'quarterlyReports';
  const reports = (data[reportsKey] ?? []) as Record<string, string>[];

  const result: FinancialStatement = {
    symbol,
    type,
    frequency,
    reports: reports.map(r => {
      const normalized: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(r)) {
        normalized[k] = v === 'None' ? null : isNaN(Number(v)) ? v : Number(v);
      }
      return normalized;
    }),
    source: 'Alpha Vantage',
  };

  cacheSet(key, result, TTL.FUNDAMENTALS);
  return result;
}

// ─── Technical Indicators ────────────────────────────────────────────────────

export type Indicator = 'RSI' | 'MACD' | 'SMA' | 'EMA' | 'BBANDS' | 'STOCH' | 'ADX' | 'CCI' | 'AROON' | 'OBV';

const indicatorDefaults: Record<Indicator, Record<string, string>> = {
  RSI:    { time_period: '14', series_type: 'close' },
  MACD:   { series_type: 'close', fastperiod: '12', slowperiod: '26', signalperiod: '9' },
  SMA:    { time_period: '20', series_type: 'close' },
  EMA:    { time_period: '20', series_type: 'close' },
  BBANDS: { time_period: '20', series_type: 'close', nbdevup: '2', nbdevdn: '2' },
  STOCH:  { fastkperiod: '5', slowkperiod: '3', slowdperiod: '3' },
  ADX:    { time_period: '14' },
  CCI:    { time_period: '20' },
  AROON:  { time_period: '14' },
  OBV:    {},
};

export async function getTechnicalIndicator(
  symbol: string,
  indicator: Indicator,
  interval: string = 'daily'
): Promise<TechnicalData> {
  const key = cacheKey('av:tech', symbol.toUpperCase(), indicator, interval);
  const cached = cacheGet<TechnicalData>(key);
  if (cached) return cached;

  const params = {
    function: indicator,
    symbol,
    interval,
    ...indicatorDefaults[indicator],
  };
  const data = await avGet(params);

  // Find the time series key (varies by indicator)
  const tsKey = Object.keys(data).find(k => k.startsWith('Technical Analysis'));
  if (!tsKey) throw new Error(`No technical data for ${indicator}`);

  const ts = data[tsKey] as Record<string, Record<string, string>>;
  const values = Object.entries(ts)
    .slice(0, 100) // last 100 data points
    .map(([date, vals]) => ({
      date,
      ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, parseFloat(v)])),
      value: parseFloat(Object.values(vals)[0]),
    }));

  const result: TechnicalData = { symbol, indicator, interval, values, source: 'Alpha Vantage' };
  cacheSet(key, result, TTL.TECHNICAL);
  return result;
}

// ─── Sector Performance ──────────────────────────────────────────────────────

export async function getSectorPerformance(): Promise<SectorPerformance[]> {
  const key = 'av:sectors';
  const cached = cacheGet<SectorPerformance[]>(key);
  if (cached) return cached;

  const data = await avGet({ function: 'SECTOR' });
  const dayPerf = data['Rank A: Real-Time Performance'] as Record<string, string> ?? {};
  const sectors: SectorPerformance[] = Object.entries(dayPerf).map(([sector, change]) => ({
    sector,
    changePercent: change,
  }));

  cacheSet(key, sectors, TTL.SECTOR);
  return sectors;
}

// ─── Forex ───────────────────────────────────────────────────────────────────

export async function getForexRate(fromCurrency: string, toCurrency: string): Promise<{ rate: number; bid?: number; ask?: number }> {
  const key = cacheKey('av:forex', fromCurrency, toCurrency);
  const cached = cacheGet<{ rate: number }>(key);
  if (cached) return cached;

  const data = await avGet({ function: 'CURRENCY_EXCHANGE_RATE', from_currency: fromCurrency, to_currency: toCurrency });
  const r = data['Realtime Currency Exchange Rate'] as Record<string, string>;
  if (!r) throw new Error(`No forex data for ${fromCurrency}/${toCurrency}`);

  const result = {
    rate: parseFloat(r['5. Exchange Rate']),
    bid: parseFloat(r['8. Bid Price']) || undefined,
    ask: parseFloat(r['9. Ask Price']) || undefined,
  };

  cacheSet(key, result, TTL.FOREX);
  return result;
}
