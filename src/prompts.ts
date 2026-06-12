// ─── Finance-tuned LLM prompts ───────────────────────────────────────────────
// All prompts are structured for reliable JSON output.
// IMPORTANT: These never give financial advice — analysis only.

export const SYSTEM_ANALYST = `You are an expert quantitative stock analyst with deep knowledge of global markets including Indian (NSE/BSE) and US equities. Your role is to analyze data and provide structured, objective insights.

Rules:
- Always respond with valid JSON matching the requested schema exactly
- Be data-driven and concise — no filler text
- Never give investment advice or recommend specific financial actions
- Clearly distinguish between analysis and speculation
- For Indian stocks, consider NSE/BSE-specific factors like circuit breakers, F&O expiry cycles, FII/DII data
- Flag data gaps or low-confidence assessments explicitly`;

export function sentimentPrompt(text: string, symbol?: string): string {
  return `Analyze the sentiment of the following ${symbol ? `content about ${symbol}` : 'market content'} and respond with this exact JSON:
{
  "sentiment": "Bullish" | "Bearish" | "Neutral" | "Mixed",
  "score": <0-100, where 50=neutral, 100=extremely bullish>,
  "confidence": <0-100>,
  "reasoning": "<one sentence>",
  "keyFactors": ["<factor1>", "<factor2>", "<factor3>"]
}

Content to analyze:
${text.substring(0, 3000)}`;
}

export function insightPrompt(data: {
  symbol: string;
  quote?: Record<string, unknown>;
  overview?: Record<string, unknown>;
  news?: Array<{ headline: string }>;
  technicals?: Record<string, unknown>;
}): string {
  return `Generate a comprehensive stock insight for ${data.symbol}. Use this market data:

PRICE DATA: ${JSON.stringify(data.quote ?? {}, null, 2)}
FUNDAMENTALS: ${JSON.stringify(data.overview ?? {}, null, 2)}
RECENT NEWS HEADLINES: ${JSON.stringify((data.news ?? []).slice(0, 5).map(n => n.headline))}
TECHNICAL INDICATORS: ${JSON.stringify(data.technicals ?? {})}

Respond with this exact JSON schema:
{
  "sentiment": "Bullish" | "Bearish" | "Neutral",
  "confidence": <0-100>,
  "summary": "<2-3 sentences of key analysis>",
  "keyPositives": ["<positive1>", "<positive2>", "<positive3>"],
  "keyRisks": ["<risk1>", "<risk2>", "<risk3>"],
  "technicalOutlook": "<1 sentence on technical setup>",
  "fundamentalOutlook": "<1 sentence on fundamental picture>",
  "signal": "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell",
  "targetRange": "<price range or null>"
}`;
}

export function summarizeNewsPrompt(symbol: string, articles: Array<{ headline: string; summary: string }>): string {
  return `Summarize the latest news for ${symbol} into a concise briefing. Articles:

${articles.slice(0, 8).map((a, i) => `${i + 1}. ${a.headline}\n   ${a.summary ?? ''}`).join('\n\n')}

Respond with this exact JSON:
{
  "overallSentiment": "Positive" | "Negative" | "Neutral" | "Mixed",
  "keyThemes": ["<theme1>", "<theme2>", "<theme3>"],
  "briefing": "<3-4 sentence narrative summary of news>",
  "catalysts": ["<upcoming event or catalyst>"],
  "riskEvents": ["<risk or negative development>"]
}`;
}

export function earningsPrompt(symbol: string, earnings: Record<string, unknown>): string {
  return `Analyze the earnings data for ${symbol}:

${JSON.stringify(earnings, null, 2)}

Respond with this exact JSON:
{
  "trend": "Improving" | "Declining" | "Stable" | "Volatile",
  "lastSurprise": "<positive/negative/inline with estimates>",
  "avgSurpisePercent": <number or null>,
  "forwardOutlook": "<1-2 sentence forward guidance analysis>",
  "keyInsights": ["<insight1>", "<insight2>", "<insight3>"],
  "earningsQuality": "High" | "Medium" | "Low"
}`;
}

export function compareStocksPrompt(
  symbols: string[],
  data: Array<{ symbol: string; quote?: Record<string, unknown>; overview?: Record<string, unknown> }>
): string {
  return `Compare these stocks: ${symbols.join(', ')}

Data:
${data.map(d => `\n### ${d.symbol}\nPrice: ${JSON.stringify(d.quote ?? {})}\nFundamentals: ${JSON.stringify(d.overview ?? {})}`).join('\n')}

Respond with this exact JSON:
{
  "winner": "<symbol of best opportunity>",
  "summary": "<2-3 sentence comparative overview>",
  "comparison": [
    {
      "symbol": "<symbol>",
      "pros": ["<pro1>", "<pro2>"],
      "cons": ["<con1>", "<con2>"],
      "signal": "Buy" | "Hold" | "Sell",
      "score": <0-100>
    }
  ],
  "recommendation": "<1-2 sentence final take>"
}`;
}

export function tradeSignalPrompt(symbol: string, data: {
  quote?: Record<string, unknown>;
  technicals?: Record<string, unknown>;
  overview?: Record<string, unknown>;
}): string {
  return `Generate a technical trade signal for ${symbol}.

QUOTE: ${JSON.stringify(data.quote ?? {})}
TECHNICALS: ${JSON.stringify(data.technicals ?? {})}
FUNDAMENTALS: ${JSON.stringify(data.overview ?? {})}

Respond with this exact JSON:
{
  "signal": "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell",
  "confidence": <0-100>,
  "reasoning": "<2-3 sentence technical reasoning>",
  "supportLevels": [<price1>, <price2>],
  "resistanceLevels": [<price1>, <price2>],
  "stopLoss": <price or null>,
  "targetPrice": <price or null>,
  "timeframe": "Short-term (1-5 days)" | "Medium-term (1-4 weeks)" | "Long-term (1-6 months)"
}`;
}

export function portfolioPrompt(symbols: string[], quoteData: Record<string, unknown>[]): string {
  return `Analyze this stock portfolio: ${symbols.join(', ')}

Holdings data: ${JSON.stringify(quoteData, null, 2)}

Respond with this exact JSON:
{
  "overallSentiment": "Bullish" | "Bearish" | "Neutral" | "Mixed",
  "diversificationScore": <0-100>,
  "riskLevel": "Low" | "Medium" | "High" | "Very High",
  "summary": "<2-3 sentence portfolio overview>",
  "recommendations": ["<rec1>", "<rec2>", "<rec3>"],
  "sectorExposure": {"<sector>": <percentage>},
  "alerts": ["<alert if any concentration risk, correlation etc>"]
}`;
}

export function explainIndicatorPrompt(indicator: string, value: string | number, symbol: string): string {
  return `Explain what this technical indicator reading means for ${symbol}:

Indicator: ${indicator}
Value: ${value}

Respond with this exact JSON:
{
  "interpretation": "<plain English meaning of this value>",
  "implication": "Bullish" | "Bearish" | "Neutral",
  "context": "<what this means in the current market context>",
  "thresholds": {"bullish": "<threshold>", "bearish": "<threshold>", "neutral": "<range>"},
  "tradingSignal": "<what a trader typically does at this reading>"
}`;
}
