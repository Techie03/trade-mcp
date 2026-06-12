import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getNSEQuote, getNSEIndices, getNSEOptionChain, getNSECorporateActions } from '../providers/nse.js';
import { getQuote as yfQuote } from '../providers/yahoo.js';

export function registerIndiaTools(server: McpServer): void {

  // ── get_nse_quote ───────────────────────────────────────────────────────────
  server.tool(
    'get_nse_quote',
    `Get live NSE India quote with exchange-specific data not available elsewhere:
    - VWAP (Volume Weighted Average Price)
    - Circuit breaker limits (Upper/Lower Circuit Price)
    - Delivery quantity and delivery-to-traded ratio
    - Face value and market lot
    Uses the official NSE India REST API (no API key required).`,
    {
      symbol: z.string().describe('NSE symbol (e.g. RELIANCE, TCS, INFY, HDFCBANK — without .NS suffix)'),
    },
    async ({ symbol }) => {
      const quote = await getNSEQuote(symbol);
      return {
        content: [{ type: 'text', text: JSON.stringify(quote, null, 2) }],
      };
    }
  );

  // ── get_nse_indices ─────────────────────────────────────────────────────────
  server.tool(
    'get_nse_indices',
    `Get live data for all NSE India indices including:
    NIFTY 50, BANKNIFTY, NIFTY IT, NIFTY PHARMA, NIFTY AUTO, NIFTY FMCG,
    NIFTY MIDCAP 150, NIFTY SMALLCAP 250, NIFTY NEXT 50, INDIA VIX, and more.
    Returns open, high, low, last price, change, and advance/decline counts.
    Data from the official NSE India API.`,
    {
      filter: z.string().optional().describe('Filter indices by name (e.g. "NIFTY", "BANK", "IT"). Omit for all.'),
    },
    async ({ filter }) => {
      const indices = await getNSEIndices();
      const filtered = filter
        ? indices.filter(i => i.name.toUpperCase().includes(filter.toUpperCase()))
        : indices;

      return {
        content: [{ type: 'text', text: JSON.stringify({ count: filtered.length, indices: filtered, source: 'NSE India' }, null, 2) }],
      };
    }
  );

  // ── get_nse_option_chain ────────────────────────────────────────────────────
  server.tool(
    'get_nse_option_chain',
    `Get the full F&O option chain for NSE stocks and indices.
    Returns all strike prices with Call (CE) and Put (PE) data:
    - Open Interest and Change in OI
    - Implied Volatility
    - Last Traded Price, Bid/Ask
    - Volume
    Works for: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, and individual stocks.
    Data from the official NSE India API.`,
    {
      symbol: z.string().describe('NSE F&O symbol (e.g. NIFTY, BANKNIFTY, RELIANCE, TCS)'),
      expiry: z.string().optional().describe('Filter by expiry date (e.g. "30-Jan-2025"). Omit for all expiries.'),
    },
    async ({ symbol, expiry }) => {
      const chain = await getNSEOptionChain(symbol);
      const filtered = expiry
        ? { ...chain, records: chain.records.filter(r => r.expiryDate === expiry) }
        : chain;

      return {
        content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }],
      };
    }
  );

  // ── get_bse_quote ───────────────────────────────────────────────────────────
  server.tool(
    'get_bse_quote',
    `Get BSE (Bombay Stock Exchange) stock quote.
    Use the .BO suffix for BSE stocks (e.g. RELIANCE.BO, TATASTEEL.BO).
    If you only have the company name, try the NSE symbol with .BO suffix.
    Data via Yahoo Finance.`,
    {
      symbol: z.string().describe('BSE symbol with .BO suffix (e.g. RELIANCE.BO, HDFCBANK.BO)'),
    },
    async ({ symbol }) => {
      const bsoSymbol = symbol.toUpperCase().endsWith('.BO') ? symbol : `${symbol.replace('.NS', '')}.BO`;
      const quote = await yfQuote(bsoSymbol);
      return {
        content: [{ type: 'text', text: JSON.stringify(quote, null, 2) }],
      };
    }
  );

  // ── get_nse_corporate_actions ───────────────────────────────────────────────
  server.tool(
    'get_nse_corporate_actions',
    `Get NSE India corporate actions including:
    - Dividends (ex-date, record date, amount)
    - Bonus issues (ratio)
    - Stock splits (ratio)
    - Rights issues
    - Board meeting dates
    - AGM / EGM notices
    Data sourced from NSE India JSON API with XML/RSS fallback.`,
    {
      symbol: z.string().optional().describe('NSE symbol (e.g. RELIANCE, INFY). Omit for all recent corporate actions.'),
    },
    async ({ symbol }) => {
      const actions = await getNSECorporateActions(symbol);
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: actions.length, actions, source: 'NSE India' }, null, 2) }],
      };
    }
  );
}
