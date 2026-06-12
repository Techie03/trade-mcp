// ─── Shared TypeScript types for trade-mcp ─────────────────────────────────

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  avgVolume: number;
  marketCap?: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  currency: string;
  exchange: string;
  timestamp: number;
  source: string;
}

export interface HistoricalCandle {
  date: string;        // ISO date string YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

export interface CompanyOverview {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  country: string;
  exchange: string;
  currency: string;
  marketCap?: number;
  peRatio?: number;
  pegRatio?: number;
  priceToBook?: number;
  eps?: number;
  dividendYield?: number;
  dividendPerShare?: number;
  beta?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayMA?: number;
  twoHundredDayMA?: number;
  sharesOutstanding?: number;
  bookValue?: number;
  revenuePerShare?: number;
  profitMargin?: number;
  operatingMargin?: number;
  returnOnEquity?: number;
  returnOnAssets?: number;
  quarterlyEarningsGrowth?: number;
  quarterlyRevenueGrowth?: number;
  analystTargetPrice?: number;
  source: string;
}

export interface FinancialStatement {
  symbol: string;
  type: 'income' | 'balance' | 'cashflow';
  frequency: 'annual' | 'quarterly';
  reports: Array<Record<string, string | number | null>>;
  source: string;
}

export interface EarningsEntry {
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprise: number | null;
  epsSurprisePercent: number | null;
  period: string;
}

export interface Earnings {
  symbol: string;
  history: EarningsEntry[];
  nextEarningsDate?: string;
  nextEarningsEpsEstimate?: number;
  source: string;
}

export interface NewsArticle {
  headline: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  relatedSymbols?: string[];
}

export interface TechnicalData {
  symbol: string;
  indicator: string;
  interval: string;
  values: Array<{ date: string; value: number; [key: string]: number | string }>;
  source: string;
}

// ─── NSE-specific types ─────────────────────────────────────────────────────

export interface NSEQuote {
  symbol: string;
  companyName: string;
  series: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  lastPrice: number;
  change: number;
  pChange: number;
  totalTradedVolume: number;
  totalTradedValue: number;
  vwap: number;
  weekHigh52: number;
  weekLow52: number;
  deliveryQuantity?: number;
  deliveryToTradedQty?: number;
  upperCP?: number;      // Upper circuit limit
  lowerCP?: number;      // Lower circuit limit
  marketCap?: number;
  faceValue?: number;
  timestamp: string;
}

export interface NSEIndex {
  name: string;
  indexSymbol: string;
  open: number;
  high: number;
  low: number;
  last: number;
  previousClose: number;
  change: number;
  percentChange: number;
  advance: number;
  decline: number;
  timestamp: string;
}

export interface NSEOptionChainEntry {
  strikePrice: number;
  expiryDate: string;
  // Call option
  CE?: {
    openInterest: number;
    changeinOpenInterest: number;
    totalTradedVolume: number;
    impliedVolatility: number;
    lastPrice: number;
    change: number;
    bidQty: number;
    bidprice: number;
    askQty: number;
    askPrice: number;
    underlyingValue: number;
  };
  // Put option
  PE?: {
    openInterest: number;
    changeinOpenInterest: number;
    totalTradedVolume: number;
    impliedVolatility: number;
    lastPrice: number;
    change: number;
    bidQty: number;
    bidprice: number;
    askQty: number;
    askPrice: number;
    underlyingValue: number;
  };
}

export interface NSEOptionChain {
  symbol: string;
  expiryDates: string[];
  strikePrices: number[];
  underlyingValue: number;
  records: NSEOptionChainEntry[];
  timestamp: string;
}

export interface NSEBhavEntry {
  symbol: string;
  series: string;
  open: number;
  high: number;
  low: number;
  close: number;
  last: number;
  prevClose: number;
  totalTradedQty: number;
  totalTradedValue: number;
  date: string;
  totalTrades?: number;
  isin?: string;
}

export interface NSECorporateAction {
  symbol: string;
  company: string;
  type: string;       // DIVIDEND, BONUS, SPLIT, AGM, etc.
  purpose: string;
  exDate?: string;
  recordDate?: string
  bcStartDate?: string;
  bcEndDate?: string;
  value?: string;
  remarks?: string;
  source: string;
}

// ─── Forex / Crypto ─────────────────────────────────────────────────────────

export interface ForexRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  bid?: number;
  ask?: number;
  timestamp: string;
  source: string;
}

export interface CryptoQuote {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  marketCap?: number;
  currency: string;
  timestamp: string;
  source: string;
}

// ─── AI Intelligence types ──────────────────────────────────────────────────

export interface SentimentResult {
  symbol?: string;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral' | 'Mixed';
  score: number;        // 0-100 where 50 = neutral
  confidence: number;   // 0-100
  reasoning: string;
  keyFactors: string[];
  model: string;
}

export interface StockInsight {
  symbol: string;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  confidence: number;
  summary: string;
  keyPositives: string[];
  keyRisks: string[];
  technicalOutlook: string;
  fundamentalOutlook: string;
  signal: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell';
  targetRange?: string;
  model: string;
}

export interface TradeSignal {
  symbol: string;
  signal: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell';
  confidence: number;
  reasoning: string;
  supportLevels: number[];
  resistanceLevels: number[];
  stopLoss?: number;
  targetPrice?: number;
  timeframe: string;
  model: string;
}

export interface PortfolioAnalysis {
  holdings: string[];
  overallSentiment: string;
  diversificationScore: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Very High';
  summary: string;
  recommendations: string[];
  sectorExposure: Record<string, number>;
  alerts: string[];
  model: string;
}

export interface ComparisonResult {
  symbols: string[];
  winner: string;
  summary: string;
  comparison: Array<{
    symbol: string;
    pros: string[];
    cons: string[];
    signal: string;
    score: number;
  }>;
  recommendation: string;
  model: string;
}

// ─── Market Summary ─────────────────────────────────────────────────────────

export interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  region: string;
}

export interface MarketSummary {
  indices: MarketIndex[];
  marketStatus: string;
  timestamp: string;
  source: string;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  currency?: string;
  region?: string;
}

// ─── Sector Performance ─────────────────────────────────────────────────────

export interface SectorPerformance {
  sector: string;
  changePercent: string;
}
