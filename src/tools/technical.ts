import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getTechnicalIndicator, getSectorPerformance, type Indicator } from '../providers/alphavantage.js';

const INDICATORS = ['RSI', 'MACD', 'SMA', 'EMA', 'BBANDS', 'STOCH', 'ADX', 'CCI', 'AROON', 'OBV'] as const;

export function registerTechnicalTools(server: McpServer): void {

  // ── get_technical_indicators ────────────────────────────────────────────────
  server.tool(
    'get_technical_indicators',
    `Calculate technical indicators for any stock.
    Available indicators:
    - RSI: Relative Strength Index (overbought >70, oversold <30)
    - MACD: Moving Average Convergence Divergence (trend/momentum)
    - SMA: Simple Moving Average
    - EMA: Exponential Moving Average
    - BBANDS: Bollinger Bands (volatility bands)
    - STOCH: Stochastic Oscillator
    - ADX: Average Directional Index (trend strength)
    - CCI: Commodity Channel Index
    - AROON: Aroon Indicator (trend direction)
    - OBV: On-Balance Volume
    
    Note: Uses Alpha Vantage (25 req/day free limit). Choose indicators wisely.`,
    {
      symbol: z.string().describe('Stock ticker (e.g. AAPL, RELIANCE.NS — use without .NS for AV)'),
      indicator: z.enum(INDICATORS).describe('Technical indicator to calculate'),
      interval: z.enum(['1min', '5min', '15min', '30min', '60min', 'daily', 'weekly', 'monthly']).default('daily').describe('Time interval (default: daily)'),
    },
    async ({ symbol, indicator, interval }) => {
      // Strip exchange suffixes for Alpha Vantage
      const avSymbol = symbol.toUpperCase().replace('.NS', '').replace('.BO', '');
      const data = await getTechnicalIndicator(avSymbol, indicator as Indicator, interval);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── get_sector_performance ──────────────────────────────────────────────────
  server.tool(
    'get_sector_performance',
    `Get real-time performance of US market sectors.
    Returns percentage change for sectors like Technology, Financials, Energy, Healthcare,
    Consumer Discretionary, Industrials, Materials, Real Estate, Utilities, Communication Services.
    Data from Alpha Vantage Sector Performance API.`,
    {},
    async () => {
      const sectors = await getSectorPerformance();
      return {
        content: [{ type: 'text', text: JSON.stringify({ sectors, source: 'Alpha Vantage', timestamp: new Date().toISOString() }, null, 2) }],
      };
    }
  );
}
