import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getForexRate } from '../providers/alphavantage.js';
import { getCryptoQuote } from '../providers/finnhub.js';
import type { ForexRate } from '../types.js';

export function registerForexTools(server: McpServer): void {

  // ── get_forex ────────────────────────────────────────────────────────────────
  server.tool(
    'get_forex',
    `Get currency exchange rates for any currency pair.
    Common pairs: USD/INR, EUR/USD, GBP/INR, JPY/USD, USD/SGD, AUD/USD.
    Data from Alpha Vantage (counts toward 25 req/day free quota).`,
    {
      from_currency: z.string().length(3).describe('Source currency code (e.g. USD, EUR, GBP, JPY)'),
      to_currency: z.string().length(3).describe('Target currency code (e.g. INR, USD, EUR)'),
    },
    async ({ from_currency, to_currency }) => {
      const from = from_currency.toUpperCase();
      const to = to_currency.toUpperCase();
      const rate = await getForexRate(from, to);
      const result: ForexRate = {
        fromCurrency: from,
        toCurrency: to,
        rate: rate.rate,
        bid: rate.bid,
        ask: rate.ask,
        timestamp: new Date().toISOString(),
        source: 'Alpha Vantage',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── get_crypto_quote ─────────────────────────────────────────────────────────
  server.tool(
    'get_crypto_quote',
    `Get cryptocurrency price quotes in USD.
    Supported coins: BTC, ETH, DOGE, SOL, XRP, ADA, MATIC, DOT, AVAX, LINK, and many more.
    Data from Finnhub via Binance USDT pairs.`,
    {
      symbol: z.string().describe('Crypto symbol (e.g. BTC, ETH, DOGE, SOL, XRP)'),
    },
    async ({ symbol }) => {
      const quote = await getCryptoQuote(symbol);
      return {
        content: [{ type: 'text', text: JSON.stringify(quote, null, 2) }],
      };
    }
  );
}
