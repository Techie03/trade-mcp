import axios from 'axios';
import axiosRetry from 'axios-retry';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { parseStringPromise } from 'xml2js';
import type { NSEQuote, NSEIndex, NSEOptionChain, NSEBhavEntry, NSECorporateAction } from '../types.js';
import { cacheGet, cacheSet, cacheKey, TTL } from '../cache.js';

// ─── NSE India provider ───────────────────────────────────────────────────────
// Combines: JSON REST API + CSV/ZIP Bhavcopy + XML/RSS feeds + XBRL filings
// No API key required — all public endpoints.

const NSE_BASE = 'https://www.nseindia.com';
const NSE_ARCHIVES = 'https://nsearchives.nseindia.com';

// Standard browser headers required by NSE servers
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.nseindia.com/',
  'Connection': 'keep-alive',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// ─── Session manager ─────────────────────────────────────────────────────────
// NSE requires a valid session cookie before API calls work.
// Two-step handshake: homepage → equity market page → API calls.

let nseSession = { cookies: '', lastRefresh: 0 };

const sessionClient = axios.create({ timeout: 15000, headers: BROWSER_HEADERS });
axiosRetry(sessionClient, { retries: 3, retryDelay: (n) => n * 2000 });

function parseCookies(setCookieArr: string[] | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const c of setCookieArr ?? []) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

function cookieJarToString(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureSession(): Promise<string> {
  const now = Date.now();
  if (nseSession.cookies && now - nseSession.lastRefresh < TTL.NSE_COOKIES * 1000) {
    return nseSession.cookies;
  }

  const jar: Record<string, string> = {};

  try {
    // Step 1: Visit NSE homepage
    const res1 = await sessionClient.get(NSE_BASE, {
      responseType: 'text',
      headers: { ...BROWSER_HEADERS, 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
    });
    Object.assign(jar, parseCookies(res1.headers['set-cookie']));
    await sleep(800);

    // Step 2: Visit the equity market page (warms up session fully)
    const res2 = await sessionClient.get(`${NSE_BASE}/market-data/live-equity-market`, {
      responseType: 'text',
      headers: { ...BROWSER_HEADERS, Cookie: cookieJarToString(jar), 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' },
    });
    Object.assign(jar, parseCookies(res2.headers['set-cookie']));

    nseSession.cookies = cookieJarToString(jar);
    nseSession.lastRefresh = Date.now();
    console.error('[NSE] Session refreshed (2-step handshake)');
  } catch (err) {
    console.error('[NSE] Session refresh failed:', (err as Error).message);
    // Use whatever cookies we got from step 1
    nseSession.cookies = cookieJarToString(jar);
    nseSession.lastRefresh = Date.now();
  }
  return nseSession.cookies;
}

async function nseApiGet(path: string): Promise<unknown> {
  const cookies = await ensureSession();
  const { data } = await sessionClient.get(`${NSE_BASE}${path}`, {
    headers: { ...BROWSER_HEADERS, Cookie: cookies },
  });
  return data;
}

// ─── JSON API: Live Quote ─────────────────────────────────────────────────────

export async function getNSEQuote(symbol: string): Promise<NSEQuote> {
  const upper = symbol.toUpperCase().replace('.NS', '');
  const key = cacheKey('nse:quote', upper);
  const cached = cacheGet<NSEQuote>(key);
  if (cached) return cached;

  const data = await nseApiGet(`/api/quote-equity?symbol=${encodeURIComponent(upper)}`) as Record<string, unknown>;
  const pd = data.priceInfo as Record<string, number | string> ?? {};
  const md = data.metadata as Record<string, string | number> ?? {};
  const sd = data.securityInfo as Record<string, number | string> ?? {};

  const result: NSEQuote = {
    symbol: upper,
    companyName: String(md.companyName ?? md.symbol ?? upper),
    series: String(md.series ?? 'EQ'),
    open: Number(pd.open ?? 0),
    high: Number(pd.intraDayHighLow ? (pd.intraDayHighLow as unknown as Record<string, number>).max : 0),
    low: Number(pd.intraDayHighLow ? (pd.intraDayHighLow as unknown as Record<string, number>).min : 0),
    close: Number(pd.close ?? pd.lastPrice ?? 0),
    previousClose: Number(pd.previousClose ?? 0),
    lastPrice: Number(pd.lastPrice ?? 0),
    change: Number(pd.change ?? 0),
    pChange: Number(pd.pChange ?? 0),
    totalTradedVolume: Number(pd.totalTradedVolume ?? 0),
    totalTradedValue: Number(pd.totalTradedValue ?? 0),
    vwap: Number(pd.vwap ?? 0),
    weekHigh52: Number(pd['52weekHighLow'] ? (pd['52weekHighLow'] as unknown as Record<string, number>).max : 0),
    weekLow52: Number(pd['52weekHighLow'] ? (pd['52weekHighLow'] as unknown as Record<string, number>).min : 0),
    deliveryQuantity: Number(sd.deliveryQuantity ?? 0) || undefined,
    deliveryToTradedQty: Number(sd.deliveryToTradedQuantity ?? 0) || undefined,
    upperCP: Number(pd.upperCP ?? 0) || undefined,
    lowerCP: Number(pd.lowerCP ?? 0) || undefined,
    faceValue: Number(md.faceValue ?? sd.faceValue ?? 0) || undefined,
    timestamp: new Date().toISOString(),
  };

  cacheSet(key, result, TTL.QUOTE);
  return result;
}

// ─── JSON API: All Indices ────────────────────────────────────────────────────

export async function getNSEIndices(): Promise<NSEIndex[]> {
  const key = 'nse:indices';
  const cached = cacheGet<NSEIndex[]>(key);
  if (cached) return cached;

  const data = await nseApiGet('/api/allIndices') as { data?: Array<Record<string, unknown>> };
  const indices: NSEIndex[] = (data.data ?? []).map(i => ({
    name: String(i.indexSymbol ?? i.index ?? ''),
    indexSymbol: String(i.indexSymbol ?? ''),
    open: Number(i.open ?? 0),
    high: Number(i.high ?? 0),
    low: Number(i.low ?? 0),
    last: Number(i.last ?? 0),
    previousClose: Number(i.previousClose ?? 0),
    change: Number(i.change ?? 0),
    percentChange: Number(i.percentChange ?? 0),
    advance: Number(i.advances ?? 0),
    decline: Number(i.declines ?? 0),
    timestamp: String(i.timeVal ?? new Date().toISOString()),
  }));

  cacheSet(key, indices, TTL.MARKET_SUMMARY);
  return indices;
}

// ─── JSON API: Option Chain ───────────────────────────────────────────────────

export async function getNSEOptionChain(symbol: string): Promise<NSEOptionChain> {
  const upper = symbol.toUpperCase().replace('.NS', '');
  const key = cacheKey('nse:oc', upper);
  const cached = cacheGet<NSEOptionChain>(key);
  if (cached) return cached;

  const endpoint = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(upper)
    ? `/api/option-chain-indices?symbol=${upper}`
    : `/api/option-chain-equities?symbol=${upper}`;

  const data = await nseApiGet(endpoint) as { records?: Record<string, unknown> };
  const records = data.records ?? {};

  const result: NSEOptionChain = {
    symbol: upper,
    expiryDates: (records.expiryDates ?? []) as string[],
    strikePrices: (records.strikePrices ?? []) as number[],
    underlyingValue: Number(records.underlyingValue ?? 0),
    records: ((records.data ?? []) as Array<Record<string, unknown>>).slice(0, 100).map(r => ({
      strikePrice: Number(r.strikePrice ?? 0),
      expiryDate: String(r.expiryDate ?? ''),
      CE: r.CE as NSEOptionChain['records'][0]['CE'],
      PE: r.PE as NSEOptionChain['records'][0]['PE'],
    })),
    timestamp: new Date().toISOString(),
  };

  cacheSet(key, result, TTL.OPTION_CHAIN);
  return result;
}

// ─── CSV/ZIP Bhavcopy: Historical EOD data ────────────────────────────────────

function bhavDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function getPreviousBusinessDay(days: number = 1): Date {
  const d = new Date();
  let count = 0;
  while (count < days) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return d;
}

export async function getNSEBhavcopy(date?: string): Promise<NSEBhavEntry[]> {
  // Try a given date, fall back up to 5 previous business days (file not published on holidays)
  const maxTries = date ? 1 : 5;
  let targetDate = date ?? bhavDate(getPreviousBusinessDay());

  for (let attempt = 0; attempt < maxTries; attempt++) {
    if (attempt > 0) {
      // Walk one more business day back
      const d = new Date(
        parseInt(targetDate.slice(0, 4)),
        parseInt(targetDate.slice(4, 6)) - 1,
        parseInt(targetDate.slice(6, 8))
      );
      d.setDate(d.getDate() - 1);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
      targetDate = bhavDate(d);
    }

    const key = cacheKey('nse:bhav', targetDate);
    const cached = cacheGet<NSEBhavEntry[]>(key);
    if (cached) return cached;

    const cookies = await ensureSession();

    // NSE changed archive URL format over time — try both patterns
    const urlPatterns = [
      `${NSE_ARCHIVES}/content/cm/BhavCopy_NSE_CM_0_0_0_${targetDate}_F_0000.csv.zip`,
      `${NSE_ARCHIVES}/products/content/BhavCopy_NSE_CM_0_0_0_${targetDate}_F_0000.csv.zip`,
      `${NSE_ARCHIVES}/content/historical/EQUITIES/${targetDate.slice(0, 4)}/${new Date(parseInt(targetDate.slice(0,4)),parseInt(targetDate.slice(4,6))-1,1).toLocaleString('en-US',{month:'short'}).toUpperCase()}/cm${targetDate.slice(6,8)}${new Date(parseInt(targetDate.slice(0,4)),parseInt(targetDate.slice(4,6))-1,1).toLocaleString('en-US',{month:'short'}).toUpperCase()}${targetDate.slice(0,4)}bhav.csv.zip`,
    ];

    for (const url of urlPatterns) {
      try {
        const { data } = await sessionClient.get(url, {
          responseType: 'arraybuffer',
          headers: { ...BROWSER_HEADERS, Cookie: cookies },
          timeout: 30000,
        });

        const zip = new AdmZip(Buffer.from(data));
        const csvEntry = zip.getEntries().find(e => e.entryName.endsWith('.csv'));
        if (!csvEntry) continue;

        const csvText = csvEntry.getData().toString('utf8');
        const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];

        const entries: NSEBhavEntry[] = rows
          .filter(r => r.SERIES === 'EQ' || r.SERIES === 'BE' || r.SctySrs === 'EQ' || r.SctySrs === 'BE')
          .map(r => ({
            symbol: r.SYMBOL ?? r.TckrSymb ?? '',
            series: r.SERIES ?? r.SctySrs ?? 'EQ',
            open: parseFloat(r.OPEN_PRICE ?? r.OPEN ?? r.OpnPric ?? '0'),
            high: parseFloat(r.HIGH_PRICE ?? r.HIGH ?? r.HghPric ?? '0'),
            low: parseFloat(r.LOW_PRICE ?? r.LOW ?? r.LwPric ?? '0'),
            close: parseFloat(r.CLOSE_PRICE ?? r.CLOSE ?? r.ClsPric ?? '0'),
            last: parseFloat(r.LAST_PRICE ?? r.LAST ?? r.LastPric ?? '0'),
            prevClose: parseFloat(r.PREV_CLOSE ?? r.PREV_CLS_PRICE ?? r.PrvsClsgPric ?? '0'),
            totalTradedQty: parseInt(r.TTL_TRD_QNTY ?? r.TOTTRDQTY ?? r.TtlTradgVol ?? '0'),
            totalTradedValue: parseFloat(r.TURNOVER_LACS ?? r.TOTTRDVAL ?? r.TtlTrfVal ?? '0'),
            date: `${targetDate.slice(0, 4)}-${targetDate.slice(4, 6)}-${targetDate.slice(6, 8)}`,
            isin: r.ISIN ?? r.ISIN_CODE ?? '',
          }));

        if (entries.length > 0) {
          cacheSet(key, entries, TTL.BHAVCOPY);
          return entries;
        }
      } catch (_urlErr) {
        // Try next URL pattern
      }
    }
    // If both URL patterns failed for this date, try the next previous business day
  }

  throw new Error(`NSE Bhavcopy not available for date ${targetDate} (tried ${maxTries} business days back). Market may have been closed.`);
}


// ─── XML/RSS: Corporate Actions & Announcements ───────────────────────────────


export async function getNSECorporateActions(symbol?: string): Promise<NSECorporateAction[]> {
  const key = cacheKey('nse:corpact', symbol ?? 'all');
  const cached = cacheGet<NSECorporateAction[]>(key);
  if (cached) return cached;

  try {
    // Try JSON API first (more reliable than XML)
    const endpoint = symbol
      ? `/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol.toUpperCase().replace('.NS', ''))}`
      : `/api/corporates-corporateActions?index=equities`;

    const data = await nseApiGet(endpoint) as Array<Record<string, string>>;
    if (Array.isArray(data) && data.length > 0) {
      const actions: NSECorporateAction[] = data.slice(0, 50).map(a => ({
        symbol: a.symbol ?? symbol ?? '',
        company: a.comp ?? a.subject ?? '',
        type: a.subject ?? a.purpose ?? '',
        purpose: a.purpose ?? a.subject ?? '',
        exDate: a.exDate ?? a.exdt ?? undefined,
        recordDate: a.recDate ?? undefined,
        bcStartDate: a.bcStartDate ?? undefined,
        bcEndDate: a.bcEndDate ?? undefined,
        value: a.faceVal ?? undefined,
        remarks: a.remarks ?? undefined,
        source: 'NSE India JSON API',
      }));
      cacheSet(key, actions, TTL.HISTORICAL);
      return actions;
    }
  } catch (_jsonErr) {
    console.error('[NSE] JSON corporate actions failed, trying RSS fallback');
  }

  // XML/RSS fallback
  try {
    const cookies = await ensureSession();
    const rssUrl = `${NSE_BASE}/companies-listing/corporate-filings-rss`;
    const { data: xmlData } = await sessionClient.get(rssUrl, {
      headers: { ...BROWSER_HEADERS, Cookie: cookies, Accept: 'application/xml, text/xml, */*' },
      responseType: 'text',
    });

    const parsed = await parseStringPromise(xmlData, { explicitArray: false });
    const items: Array<Record<string, string>> = parsed?.rss?.channel?.item ?? [];
    const itemArr = Array.isArray(items) ? items : [items];

    const actions: NSECorporateAction[] = itemArr
      .filter(item => !symbol || String(item.title ?? '').toUpperCase().includes(symbol.toUpperCase().replace('.NS', '')))
      .slice(0, 30)
      .map(item => ({
        symbol: symbol ?? '',
        company: String(item.title ?? ''),
        type: String(item.category ?? 'ANNOUNCEMENT'),
        purpose: String(item.description ?? ''),
        exDate: undefined,
        source: 'NSE India RSS/XML',
      }));

    cacheSet(key, actions, TTL.NEWS);
    return actions;
  } catch (rssErr) {
    throw new Error(`NSE corporate actions unavailable: ${(rssErr as Error).message}`);
  }
}
