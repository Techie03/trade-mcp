import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callAI, parseAIJson, isAIAvailable, getAIStatus } from '../providers/ai.js';
import { getQuote } from '../providers/yahoo.js';
import { getCompanyNews, getEarnings } from '../providers/finnhub.js';
import { getCompanyOverview, getTechnicalIndicator } from '../providers/alphavantage.js';
import {
  sentimentPrompt, insightPrompt, summarizeNewsPrompt, earningsPrompt,
  compareStocksPrompt, tradeSignalPrompt, portfolioPrompt, explainIndicatorPrompt
} from '../prompts.js';
import type {
  SentimentResult, StockInsight, TradeSignal, PortfolioAnalysis, ComparisonResult
} from '../types.js';

function requireAI(): void {
  if (!isAIAvailable()) {
    throw new Error(`AI tools require at least one AI key. Status: ${getAIStatus()}\nSet GROQ_API_KEY (console.groq.com) or NVIDIA_API_KEY (build.nvidia.com) in your .env file.`);
  }
}

export function registerAITools(server: McpServer): void {

  // ── analyze_sentiment ────────────────────────────────────────────────────────
  server.tool(
    'analyze_sentiment',
    `AI-powered sentiment analysis of news text or recent news for a ticker.
    Returns: Bullish/Bearish/Neutral/Mixed with a 0-100 score and key factors.
    Uses Groq (LLaMA 3.3-70B) with NVIDIA NIM fallback.`,
    {
      symbol: z.string().optional().describe('Stock symbol to fetch and analyze news for (e.g. AAPL, TCS)'),
      text: z.string().optional().describe('Custom text to analyze (overrides symbol news fetch)'),
    },
    async ({ symbol, text }) => {
      requireAI();
      let content = text ?? '';
      if (!content && symbol) {
        const news = await getCompanyNews(symbol.replace('.NS', ''), 3);
        content = news.map(n => `${n.headline}. ${n.summary}`).join('\n\n');
      }
      if (!content) throw new Error('Provide either a symbol or text to analyze');

      const { result, model } = await callAI(sentimentPrompt(content, symbol));
      const parsed = parseAIJson<SentimentResult>(result, {
        symbol, sentiment: 'Neutral', score: 50, confidence: 0,
        reasoning: 'Analysis unavailable', keyFactors: [], model,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...parsed, model }, null, 2) }],
      };
    }
  );

  // ── get_stock_insight ────────────────────────────────────────────────────────
  server.tool(
    'get_stock_insight',
    `Full AI analysis combining price data, fundamentals, recent news, and technical indicators.
    Returns: sentiment, signal (Buy/Hold/Sell), key positives, key risks, target range.
    Best tool for a comprehensive view of any stock.
    Uses Groq (LLaMA 3.3-70B) with NVIDIA NIM fallback.`,
    {
      symbol: z.string().describe('Stock symbol (e.g. RELIANCE.NS, AAPL, TCS.NS)'),
    },
    async ({ symbol }) => {
      requireAI();
      const avSymbol = symbol.toUpperCase().replace('.NS', '').replace('.BO', '');

      const [quoteR, overviewR, newsR, rsiR] = await Promise.allSettled([
        getQuote(symbol),
        getCompanyOverview(avSymbol),
        getCompanyNews(avSymbol, 5),
        getTechnicalIndicator(avSymbol, 'RSI', 'daily'),
      ]);

      const data = {
        symbol,
        quote: quoteR.status === 'fulfilled' ? quoteR.value as unknown as Record<string, unknown> : undefined,
        overview: overviewR.status === 'fulfilled' ? overviewR.value as unknown as Record<string, unknown> : undefined,
        news: newsR.status === 'fulfilled' ? newsR.value : undefined,
        technicals: rsiR.status === 'fulfilled' ? { RSI: rsiR.value.values.slice(0, 5) } : undefined,
      };

      const { result, model } = await callAI(insightPrompt(data));
      const parsed = parseAIJson<StockInsight>(result, {
        symbol, sentiment: 'Neutral', confidence: 0, summary: result,
        keyPositives: [], keyRisks: [], technicalOutlook: '', fundamentalOutlook: '',
        signal: 'Hold', model,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...parsed, model }, null, 2) }],
      };
    }
  );

  // ── summarize_news ────────────────────────────────────────────────────────────
  server.tool(
    'summarize_news',
    `AI-powered concise briefing of the latest news for a stock.
    Returns: overall sentiment, key themes, narrative summary, upcoming catalysts, risk events.
    Uses Groq (LLaMA 3.3-70B) with NVIDIA NIM fallback.`,
    {
      symbol: z.string().describe('Stock symbol (e.g. TSLA, INFY, WIPRO)'),
      days: z.number().int().min(1).max(14).default(7).describe('Days of news to summarize (default: 7)'),
    },
    async ({ symbol, days }) => {
      requireAI();
      const fhSymbol = symbol.toUpperCase().replace('.NS', '').replace('.BO', '');
      const articles = await getCompanyNews(fhSymbol, days);
      if (articles.length === 0) throw new Error(`No news found for ${symbol} in the last ${days} days`);

      const { result, model } = await callAI(summarizeNewsPrompt(symbol, articles));
      return {
        content: [{ type: 'text', text: JSON.stringify({ symbol, days, articleCount: articles.length, ...parseAIJson(result, { briefing: result }), model }, null, 2) }],
      };
    }
  );

  // ── analyze_earnings ──────────────────────────────────────────────────────────
  server.tool(
    'analyze_earnings',
    `AI analysis of earnings history: trend, EPS surprise quality, forward outlook.
    Returns: trend assessment, average surprise %, earnings quality rating, key insights.
    Uses Groq (LLaMA 3.3-70B) with NVIDIA NIM fallback.`,
    {
      symbol: z.string().describe('Stock symbol (e.g. AAPL, GOOGL, INFY)'),
    },
    async ({ symbol }) => {
      requireAI();
      const earnings = await getEarnings(symbol);
      const { result, model } = await callAI(earningsPrompt(symbol, earnings as unknown as Record<string, unknown>));
      return {
        content: [{ type: 'text', text: JSON.stringify({ symbol, nextEarningsDate: earnings.nextEarningsDate, ...parseAIJson(result, { analysis: result }), model }, null, 2) }],
      };
    }
  );

  // ── compare_stocks ────────────────────────────────────────────────────────────
  server.tool(
    'compare_stocks',
    `Side-by-side AI comparison of 2-5 stocks with pros, cons, and recommendation.
    Returns a ranked comparison with a clear winner and reasoning.
    Mix US and Indian stocks freely (e.g. ["AAPL", "RELIANCE.NS", "TCS.NS"]).
    Uses Groq (LLaMA 3.3-70B) with NVIDIA NIM fallback.`,
    {
      symbols: z.array(z.string()).min(2).max(5).describe('List of 2-5 stock symbols to compare'),
    },
    async ({ symbols }) => {
      requireAI();
      const stockData = await Promise.allSettled(
        symbols.map(async s => ({
          symbol: s,
          quote: await getQuote(s).then(q => q as unknown as Record<string, unknown>).catch(() => undefined),
          overview: await getCompanyOverview(s.replace('.NS', '').replace('.BO', '')).then(o => o as unknown as Record<string, unknown>).catch(() => undefined),
        }))
      );

      const data = stockData
        .filter((r): r is PromiseFulfilledResult<typeof r extends PromiseFulfilledResult<infer T> ? T : never> => r.status === 'fulfilled')
        .map(r => r.value);

      const { result, model } = await callAI(compareStocksPrompt(symbols, data));
      const parsed = parseAIJson<ComparisonResult>(result, {
        symbols, winner: '', summary: result, comparison: [], recommendation: '', model,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...parsed, model }, null, 2) }],
      };
    }
  );

  // ── get_trade_signal ──────────────────────────────────────────────────────────
  server.tool(
    'get_trade_signal',
    `AI-generated trade signal based on technical analysis + fundamentals.
    Returns: Buy/Hold/Sell signal with confidence %, support/resistance levels, stop loss, target.
    NOT financial advice — for educational and analytical purposes only.
    Uses Groq (LLaMA 3.3-70B) with NVIDIA NIM fallback.`,
    {
      symbol: z.string().describe('Stock symbol (e.g. NIFTY, BANKNIFTY, AAPL, RELIANCE.NS)'),
    },
    async ({ symbol }) => {
      requireAI();
      const avSymbol = symbol.toUpperCase().replace('.NS', '').replace('.BO', '');

      const [quoteR, techR, overviewR] = await Promise.allSettled([
        getQuote(symbol),
        getTechnicalIndicator(avSymbol, 'MACD', 'daily'),
        getCompanyOverview(avSymbol),
      ]);

      const data = {
        quote: quoteR.status === 'fulfilled' ? quoteR.value as unknown as Record<string, unknown> : undefined,
        technicals: techR.status === 'fulfilled' ? { MACD: techR.value.values.slice(0, 10) } : undefined,
        overview: overviewR.status === 'fulfilled' ? overviewR.value as unknown as Record<string, unknown> : undefined,
      };

      const { result, model } = await callAI(tradeSignalPrompt(symbol, data));
      const parsed = parseAIJson<TradeSignal>(result, {
        symbol, signal: 'Hold', confidence: 0, reasoning: result,
        supportLevels: [], resistanceLevels: [], timeframe: 'Medium-term (1-4 weeks)', model,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...parsed, disclaimer: 'Not financial advice', model }, null, 2) }],
      };
    }
  );

  // ── analyze_portfolio ─────────────────────────────────────────────────────────
  server.tool(
    'analyze_portfolio',
    `AI portfolio health check for a list of stocks.
    Returns: overall sentiment, diversification score, risk level, sector exposure, and recommendations.
    Mix US and Indian stocks freely.
    Uses Groq (LLaMA 3.3-70B) with NVIDIA NIM fallback.`,
    {
      symbols: z.array(z.string()).min(1).max(20).describe('List of stock symbols in portfolio (e.g. ["AAPL", "RELIANCE.NS", "HDFCBANK.NS"])'),
    },
    async ({ symbols }) => {
      requireAI();
      const quotes = await Promise.allSettled(symbols.map(s => getQuote(s)));
      const quoteData = quotes
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof getQuote>>> => r.status === 'fulfilled')
        .map(r => r.value as unknown as Record<string, unknown>);

      const { result, model } = await callAI(portfolioPrompt(symbols, quoteData));
      const parsed = parseAIJson<PortfolioAnalysis>(result, {
        holdings: symbols, overallSentiment: 'Neutral', diversificationScore: 0,
        riskLevel: 'Medium', summary: result, recommendations: [], sectorExposure: {}, alerts: [], model,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...parsed, model }, null, 2) }],
      };
    }
  );

  // ── explain_indicator ─────────────────────────────────────────────────────────
  server.tool(
    'explain_indicator',
    `Plain-English AI explanation of any technical indicator value.
    Tells you what the reading means, if it's bullish/bearish, and what traders typically do.
    Great for learning or explaining technical analysis to non-experts.
    Uses Groq (LLaMA 3.3-70B) with NVIDIA NIM fallback.`,
    {
      indicator: z.string().describe('Indicator name (e.g. RSI, MACD, Bollinger Bands, VWAP)'),
      value: z.union([z.string(), z.number()]).describe('The indicator value to explain (e.g. 72.5 for RSI)'),
      symbol: z.string().optional().default('the stock').describe('Stock context for the explanation'),
    },
    async ({ indicator, value, symbol }) => {
      requireAI();
      const { result, model } = await callAI(explainIndicatorPrompt(indicator, value, symbol ?? 'the stock'));
      return {
        content: [{ type: 'text', text: JSON.stringify({ indicator, value, symbol, ...parseAIJson(result, { interpretation: result }), model }, null, 2) }],
      };
    }
  );
}
