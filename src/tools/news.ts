import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCompanyNews, getMarketNews } from '../providers/finnhub.js';

export function registerNewsTools(server: McpServer): void {

  // ── get_news ────────────────────────────────────────────────────────────────
  server.tool(
    'get_news',
    `Get latest news articles for a specific stock or ticker.
    Returns headlines, summaries, URLs, and publication timestamps.
    Covers US stocks, Indian companies (use their NSE symbol), global equities.
    Data from Finnhub (free tier).`,
    {
      symbol: z.string().describe('Stock ticker (e.g. AAPL, TCS, RELIANCE)'),
      days: z.number().int().min(1).max(30).default(7).describe('Number of days of news to fetch (1-30, default: 7)'),
    },
    async ({ symbol, days }) => {
      // For NSE stocks, strip the .NS suffix for Finnhub
      const fhSymbol = symbol.toUpperCase().replace('.NS', '').replace('.BO', '');
      const articles = await getCompanyNews(fhSymbol, days);
      const response = {
        symbol: fhSymbol,
        days,
        count: articles.length,
        articles,
        source: 'Finnhub',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ── get_market_news ─────────────────────────────────────────────────────────
  server.tool(
    'get_market_news',
    `Get general market news feed by category.
    Categories: general (all markets), forex (currency), crypto (digital assets), merger (M&A deals).
    Returns top 20 articles with headlines, summaries, and URLs.`,
    {
      category: z.enum(['general', 'forex', 'crypto', 'merger']).default('general').describe('News category (default: general)'),
    },
    async ({ category }) => {
      const articles = await getMarketNews(category);
      const response = {
        category,
        count: articles.length,
        articles,
        source: 'Finnhub',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}
