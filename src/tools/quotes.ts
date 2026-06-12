import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getQuote as yfQuote, getMarketSummary as yfMarketSummary } from '../providers/yahoo.js';
import { getFinnhubQuote } from '../providers/finnhub.js';

export function registerQuoteTools(server: McpServer): void {

  // ── get_quote ───────────────────────────────────────────────────────────────
  server.tool(
    'get_quote',
    `Get live/delayed stock quote for any symbol worldwide.
    - US stocks: AAPL, TSLA, MSFT
    - NSE India: RELIANCE.NS, TCS.NS, INFY.NS
    - BSE India: TATASTEEL.BO, HDFCBANK.BO
    - Indices: ^NSEI (NIFTY), ^BSESN (SENSEX), ^GSPC (S&P 500)`,
    {
      symbol: z.string().describe('Stock ticker symbol (e.g. RELIANCE.NS, AAPL, ^NSEI)'),
    },
    async ({ symbol }) => {
      try {
        const quote = await yfQuote(symbol);
        return {
          content: [{ type: 'text', text: JSON.stringify(quote, null, 2) }],
        };
      } catch (yfErr) {
        // Fallback to Finnhub for US stocks
        try {
          const fhQuote = await getFinnhubQuote(symbol);
          if (fhQuote) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ symbol, ...fhQuote, source: 'Finnhub (fallback)' }, null, 2) }],
            };
          }
        } catch (_fhErr) { /* ignore */ }
        throw new Error(`Failed to get quote for ${symbol}: ${(yfErr as Error).message}`);
      }
    }
  );

  // ── get_market_summary ──────────────────────────────────────────────────────
  server.tool(
    'get_market_summary',
    `Get a snapshot of major world indices including NIFTY50, SENSEX, BANKNIFTY, S&P500, NASDAQ, DOW, FTSE, Nikkei, Hang Seng, and DAX.
    Optionally filter by region: India, US, UK, Japan, HongKong, Germany`,
    {
      region: z.string().optional().describe('Filter by region: India, US, UK, Japan, HongKong, Germany (optional, returns all if omitted)'),
    },
    async ({ region }) => {
      const summary = await yfMarketSummary(region);
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      };
    }
  );
}
