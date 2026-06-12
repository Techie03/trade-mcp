import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchSymbol as yfSearch } from '../providers/yahoo.js';
import { searchFinnhub } from '../providers/finnhub.js';
import { searchTavily } from '../providers/tavily.js';

export function registerSearchTools(server: McpServer): void {
  
  // ── search_symbol ──────────────────────────────────────────────────────────
  server.tool(
    'search_symbol',
    `Search for stock symbols by company name or keyword.
    Returns matching symbols with exchange and type information.
    Useful for finding:
    - Indian companies (e.g. search "Reliance" → RELIANCE.NS, RELIANCE.BO)
    - US companies (e.g. search "Apple" → AAPL)
    - ETFs, mutual funds, indices
    Combines results from Yahoo Finance and Finnhub.`,
    {
      query: z.string().min(2).describe('Company name or keyword to search (e.g. "Reliance", "HDFC Bank", "Apple")'),
    },
    async ({ query }) => {
      const [yfResults, fhResults] = await Promise.allSettled([
        yfSearch(query),
        searchFinnhub(query),
      ]);

      const yf = yfResults.status === 'fulfilled' ? yfResults.value : [];
      const fh = fhResults.status === 'fulfilled' ? fhResults.value : [];

      // Merge and deduplicate by symbol
      const seen = new Set<string>();
      const merged = [...yf, ...fh].filter(r => {
        if (!r.symbol || seen.has(r.symbol)) return false;
        seen.add(r.symbol);
        return true;
      });

      return {
        content: [{ type: 'text', text: JSON.stringify({ query, count: merged.length, results: merged }, null, 2) }],
      };
    }
  );

  // ── search_web ──────────────────────────────────────────────────────────────
  server.tool(
    'search_web',
    `Perform a financial or general web search using the Tavily search engine.
    Optimized for LLM context, returning concise and relevant web snippets.
    Useful for looking up:
    - Real-time stock news and breaking corporate announcements
    - Earnings releases, financial consensus, and company reports
    - Macroeconomic events, interest rate decisions, and policy updates`,
    {
      query: z.string().describe('The search query (e.g. "Reliance Q3 results 2026", "NVDA stock surge reason today")'),
      max_results: z.number().int().min(1).max(10).default(5).describe('Maximum number of results to return (default: 5)'),
    },
    async ({ query, max_results }) => {
      try {
        const results = await searchTavily(query, max_results);
        return {
          content: [{ type: 'text', text: JSON.stringify({ query, count: results.length, results }, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );
}
