import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCompanyOverview, getFinancialStatement } from '../providers/alphavantage.js';
import { getCompanyProfile, getEarnings } from '../providers/finnhub.js';

export function registerFundamentalTools(server: McpServer): void {

  // ── get_company_overview ────────────────────────────────────────────────────
  server.tool(
    'get_company_overview',
    `Get comprehensive company fundamentals: P/E ratio, EPS, market cap, sector, industry, 
    52-week range, beta, dividend yield, profit margins, ROE, analyst target price, and more.
    Best for US stocks. For Indian stocks, some fields may be limited.`,
    {
      symbol: z.string().describe('Stock ticker (e.g. AAPL, MSFT, RELIANCE.NS for US-listed Indian ADRs)'),
    },
    async ({ symbol }) => {
      try {
        const overview = await getCompanyOverview(symbol);
        return {
          content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }],
        };
      } catch (err) {
        // Try Finnhub profile as fallback
        try {
          const profile = await getCompanyProfile(symbol);
          return {
            content: [{ type: 'text', text: JSON.stringify({ ...profile, source: 'Finnhub (Alpha Vantage unavailable)' }, null, 2) }],
          };
        } catch (_fhErr) {
          throw new Error(`Company overview unavailable for ${symbol}: ${(err as Error).message}`);
        }
      }
    }
  );

  // ── get_financials ──────────────────────────────────────────────────────────
  server.tool(
    'get_financials',
    `Get financial statements: income statement, balance sheet, or cash flow statement.
    Returns annual or quarterly data with up to 5 years of history.
    Data from Alpha Vantage (counts toward 25 req/day free quota).`,
    {
      symbol: z.string().describe('Stock ticker (e.g. AAPL, TSLA)'),
      type: z.enum(['income', 'balance', 'cashflow']).describe('Statement type: income, balance, or cashflow'),
      frequency: z.enum(['annual', 'quarterly']).default('annual').describe('annual or quarterly (default: annual)'),
    },
    async ({ symbol, type, frequency }) => {
      const statement = await getFinancialStatement(symbol, type, frequency);
      return {
        content: [{ type: 'text', text: JSON.stringify(statement, null, 2) }],
      };
    }
  );

  // ── get_earnings ────────────────────────────────────────────────────────────
  server.tool(
    'get_earnings',
    `Get earnings history with EPS actuals, estimates, surprise amounts and percentages.
    Also returns the next scheduled earnings date and consensus estimate.
    Data from Finnhub (free tier: 60 req/min).`,
    {
      symbol: z.string().describe('Stock ticker (e.g. AAPL, GOOGL, INFY)'),
    },
    async ({ symbol }) => {
      const earnings = await getEarnings(symbol);
      return {
        content: [{ type: 'text', text: JSON.stringify(earnings, null, 2) }],
      };
    }
  );
}
