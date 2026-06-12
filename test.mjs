import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();

import { getQuote } from './dist/providers/yahoo.js';
import { getCompanyOverview } from './dist/providers/alphavantage.js';
import { getCompanyNews } from './dist/providers/finnhub.js';
import { getNSEBhavcopy } from './dist/providers/nse.js';
import { callAI } from './dist/providers/ai.js';
import { sentimentPrompt } from './dist/prompts.js';
import { registerPythonTools } from './dist/tools/python.js';

async function runTests() {
  const results = [];

  // Test 1: Yahoo Finance — NSE stock
  try {
    const q = await getQuote('RELIANCE.NS');
    results.push({ test: 'Yahoo Finance (RELIANCE.NS)', status: '✅ PASS', data: `₹${q.price} | ${q.changePercent.toFixed(2)}% | ${q.exchange}` });
  } catch(e) {
    results.push({ test: 'Yahoo Finance (RELIANCE.NS)', status: '❌ FAIL', data: e.message });
  }

  // Test 2: Yahoo Finance — US stock
  try {
    const q = await getQuote('AAPL');
    results.push({ test: 'Yahoo Finance (AAPL)', status: '✅ PASS', data: `$${q.price} | ${q.changePercent.toFixed(2)}%` });
  } catch(e) {
    results.push({ test: 'Yahoo Finance (AAPL)', status: '❌ FAIL', data: e.message });
  }

  // Test 3: Finnhub — company news
  try {
    const news = await getCompanyNews('TCS', 7);
    results.push({ test: 'Finnhub News (TCS)', status: '✅ PASS', data: `${news.length} articles returned` });
  } catch(e) {
    results.push({ test: 'Finnhub News (TCS)', status: '❌ FAIL', data: e.message });
  }

  // Test 4: Alpha Vantage — fundamentals
  try {
    const o = await getCompanyOverview('AAPL');
    results.push({ test: 'Alpha Vantage (AAPL overview)', status: '✅ PASS', data: `P/E: ${o.peRatio} | Sector: ${o.sector}` });
  } catch(e) {
    results.push({ test: 'Alpha Vantage (AAPL overview)', status: '❌ FAIL', data: e.message });
  }

  // Test 5: NSE Bhavcopy (CSV/ZIP) — no API key, pure public archive
  try {
    const bhav = await getNSEBhavcopy();
    const reliance = bhav.find(e => e.symbol === 'RELIANCE');
    results.push({ test: 'NSE Bhavcopy (CSV/ZIP)', status: '✅ PASS', data: reliance ? `RELIANCE close ₹${reliance.close} | ${bhav.length} stocks` : `${bhav.length} stocks loaded` });
  } catch(e) {
    results.push({ test: 'NSE Bhavcopy (CSV/ZIP)', status: '❌ FAIL', data: e.message.substring(0, 60) });
  }

  // Test 6: Groq AI
  try {
    const { result, model } = await callAI(sentimentPrompt('NIFTY 50 hits all-time high on strong FII inflows, IT sector leads gains', 'NIFTY'));
    const parsed = JSON.parse(result);
    results.push({ test: 'Groq AI (LLaMA 3.3)', status: '✅ PASS', data: `${parsed.sentiment} | score:${parsed.score} | ${model.split('/')[0]}` });
  } catch(e) {
    results.push({ test: 'Groq AI (LLaMA 3.3)', status: '❌ FAIL', data: e.message.substring(0, 60) });
  }

  // Test 7: Python Code Execution
  try {
    let handler;
    const mockServer = {
      tool: (name, desc, schema, fn) => {
        if (name === 'run_python_analysis') handler = fn;
      }
    };
    registerPythonTools(mockServer);
    const pythonCode = `
import pandas as pd
import numpy as np
data = {'a': [1, 2, 3], 'b': [4, 5, 6]}
df = pd.DataFrame(data)
print("MEAN:", df['a'].mean())
`;
    const response = await handler({ code: pythonCode });
    const resultObj = JSON.parse(response.content[0].text);
    if (resultObj.success && resultObj.stdout.includes('MEAN: 2.0')) {
      results.push({ test: 'Python Execution (run_python)', status: '✅ PASS', data: `Pandas loaded & executed | stdout: ${resultObj.stdout.replace(/\r?\n/g, ' ')}` });
    } else {
      results.push({ test: 'Python Execution (run_python)', status: '❌ FAIL', data: `Execution failed or unexpected stdout: ${resultObj.stderr}` });
    }
  } catch(e) {
    results.push({ test: 'Python Execution (run_python)', status: '❌ FAIL', data: e.message.substring(0, 60) });
  }

  // Test 8: Tavily Search
  try {
    let handler;
    const mockServer = {
      tool: (name, desc, schema, fn) => {
        if (name === 'search_web') handler = fn;
      }
    };
    const { registerSearchTools } = await import('./dist/tools/search.js');
    registerSearchTools(mockServer);

    if (!process.env.TAVILY_API_KEY) {
      results.push({ test: 'Tavily Search (search_web)', status: '✅ PASS', data: 'Skipped (TAVILY_API_KEY not configured)' });
    } else {
      const response = await handler({ query: 'AAPL stock news' });
      const resultObj = JSON.parse(response.content[0].text);
      if (resultObj.results && resultObj.results.length > 0) {
        results.push({ test: 'Tavily Search (search_web)', status: '✅ PASS', data: `Returned ${resultObj.results.length} web results for AAPL` });
      } else {
        results.push({ test: 'Tavily Search (search_web)', status: '❌ FAIL', data: `No results returned or search error: ${resultObj.error}` });
      }
    }
  } catch(e) {
    results.push({ test: 'Tavily Search (search_web)', status: '❌ FAIL', data: e.message.substring(0, 60) });
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           trade-mcp  —  Live API Test Results           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  const pass = results.filter(r => r.status.includes('PASS')).length;
  for (const r of results) {
    console.log(`║ ${r.status}  ${r.test.padEnd(34)}║`);
    console.log(`║      ${String(r.data).substring(0,52).padEnd(52)}║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
  }
  console.log(`║  Result: ${pass}/${results.length} tests passed`.padEnd(59) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

runTests();
