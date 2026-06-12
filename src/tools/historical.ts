import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHistorical as yfHistorical } from '../providers/yahoo.js';
import { getNSEBhavcopy } from '../providers/nse.js';

// Valid Yahoo Finance ranges and intervals
const VALID_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max'] as const;
const VALID_INTERVALS = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'] as const;

export function registerHistoricalTools(server: McpServer): void {

  // ── get_historical ──────────────────────────────────────────────────────────
  server.tool(
    'get_historical',
    `Get OHLCV historical price data for any stock or index globally.
    Supports US stocks (AAPL), NSE stocks (RELIANCE.NS), BSE stocks (HDFCBANK.BO), and indices (^NSEI, ^GSPC).
    Range: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
    Interval: 1m, 5m, 15m, 30m, 1h, 1d, 1wk, 1mo`,
    {
      symbol: z.string().describe('Ticker symbol (e.g. TCS.NS, AAPL, ^NSEI)'),
      range: z.enum(VALID_RANGES).default('3mo').describe('Time range (default: 3mo)'),
      interval: z.enum(VALID_INTERVALS).default('1d').describe('Bar interval (default: 1d)'),
    },
    async ({ symbol, range, interval }) => {
      const candles = await yfHistorical(symbol, range, interval);
      const response = {
        symbol,
        range,
        interval,
        count: candles.length,
        candles,
        source: 'Yahoo Finance',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ── get_nse_historical ──────────────────────────────────────────────────────
  server.tool(
    'get_nse_historical',
    `Get NSE India End-of-Day (EOD) historical data from the official NSE Bhavcopy files (CSV/ZIP format).
    This fetches the official CM-UDiFF Bhavcopy archive from nsearchives.nseindia.com.
    Returns full EOD data for all ~2000 NSE equity stocks for a given date.
    If no symbol is provided, returns the full Bhavcopy for that date.
    Date format: YYYYMMDD (e.g. 20240115). Defaults to the last business day.`,
    {
      symbol: z.string().optional().describe('NSE symbol to filter (e.g. RELIANCE, TCS). Omit for full Bhavcopy.'),
      date: z.string().optional().describe('Date in YYYYMMDD format. Defaults to last business day.'),
    },
    async ({ symbol, date }) => {
      const entries = await getNSEBhavcopy(date);
      const filtered = symbol
        ? entries.filter(e => e.symbol === symbol.toUpperCase().replace('.NS', ''))
        : entries;

      const response = {
        date: date ?? 'last_business_day',
        symbol: symbol ?? 'ALL',
        count: filtered.length,
        data: filtered,
        source: 'NSE India Bhavcopy (CSV/ZIP)',
        note: 'Official EOD data from nsearchives.nseindia.com',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}
