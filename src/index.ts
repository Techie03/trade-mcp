import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

import { registerQuoteTools }       from './tools/quotes.js';
import { registerHistoricalTools }  from './tools/historical.js';
import { registerFundamentalTools } from './tools/fundamentals.js';
import { registerNewsTools }        from './tools/news.js';
import { registerTechnicalTools }   from './tools/technical.js';
import { registerIndiaTools }       from './tools/india.js';
import { registerSearchTools }      from './tools/search.js';
import { registerForexTools }       from './tools/forex.js';
import { registerAITools }          from './tools/ai.js';
import { registerPythonTools }      from './tools/python.js';
import { getAIStatus }              from './providers/ai.js';

// ─── Server factory ───────────────────────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({
    name: 'trade-mcp',
    version: '1.0.0',
  });

  // Register all 26 tools
  registerQuoteTools(server);
  registerHistoricalTools(server);
  registerFundamentalTools(server);
  registerNewsTools(server);
  registerTechnicalTools(server);
  registerIndiaTools(server);
  registerSearchTools(server);
  registerForexTools(server);
  registerAITools(server);
  registerPythonTools(server);

  return server;
}

// ─── Startup banner (stderr only — never stdout in stdio mode) ───────────────

function printBanner(): void {
  const transport = process.env.MCP_TRANSPORT ?? 'stdio';
  const port = process.env.PORT ?? '3000';
  console.error('');
  console.error('╔═══════════════════════════════════════════════════╗');
  console.error('║            trade-mcp  v1.0.0                      ║');
  console.error('║   Worldwide Stock Market MCP Server               ║');
  console.error('╠═══════════════════════════════════════════════════╣');
  console.error(`║  Transport : ${transport.padEnd(37)}║`);
  if (transport === 'http') {
    console.error(`║  Port      : ${port.padEnd(37)}║`);
    console.error(`║  SSE URL   : ${'http://localhost:' + port + '/sse'.padEnd(35)}║`);
    console.error(`║  Post URL  : ${'http://localhost:' + port + '/message'.padEnd(35)}║`);
    console.error(`║  Health    : ${'http://localhost:' + port + '/health'.padEnd(35)}║`);
  }
  console.error('╠═══════════════════════════════════════════════════╣');
  console.error(`║  Data      : Yahoo Finance (no key required)      ║`);
  console.error(`║  Data      : Alpha Vantage${process.env.ALPHA_VANTAGE_KEY ? ' ✓' : ' ✗ (add key)'}${' '.repeat(process.env.ALPHA_VANTAGE_KEY ? 21 : 19)}║`);
  console.error(`║  Data      : Finnhub${process.env.FINNHUB_KEY ? ' ✓' : ' ✗ (add key)'}${' '.repeat(process.env.FINNHUB_KEY ? 27 : 25)}║`);
  console.error(`║  Data      : NSE India (no key required)          ║`);
  console.error('╠═══════════════════════════════════════════════════╣');
  console.error(`║  AI        : ${getAIStatus().substring(0, 37).padEnd(37)}║`);
  console.error('╚═══════════════════════════════════════════════════╝');
  console.error('');
}

// ─── Stdio mode (default) ─────────────────────────────────────────────────────

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  printBanner();
  console.error('[trade-mcp] Ready — listening on stdio');
}

// ─── HTTP/SSE mode ────────────────────────────────────────────────────────────

async function runHttp(): Promise<void> {
  const app = express();
  const port = parseInt(process.env.PORT ?? '3000', 10);

  app.use(cors());
  app.use(express.json());
  
  // Track active SSE transports by session
  const transports = new Map<string, SSEServerTransport>();

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      server: 'trade-mcp',
      version: '1.0.0',
      transports: ['sse', 'streamable-http'],
      endpoints: {
        sse: '/sse',
        streamableHttp: '/mcp',
        message: '/message',
      },
      tools: 28,
      uptime: process.uptime(),
    });
  });

  // SSE connection endpoint — each client gets its own server+transport
  app.get('/sse', async (req, res) => {
    console.error(`[trade-mcp] New SSE connection from ${req.ip}`);
    const transport = new SSEServerTransport('/message', res);
    transports.set(transport.sessionId, transport);

    const server = createServer();
    res.on('close', () => {
      console.error(`[trade-mcp] SSE disconnected: ${transport.sessionId}`);
      transports.delete(transport.sessionId);
      server.close().catch(() => {});
    });

    await server.connect(transport);
  });

  // ── Streamable HTTP endpoint (new MCP standard — supports Manus, Cursor, etc.) ──
  // Stateless: each request creates a fresh server instance (no session affinity required)
  app.all('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });
    const server = createServer();
    res.on('close', () => {
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Message POST endpoint
  app.post('/message', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found. Reconnect via /sse' });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  // ── REST API: OHLCV chart data for the live charts page ──────────────────────
  app.get('/api/chart', async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || 'AAPL';
      const range = (req.query.range as string) || '3mo';
      const interval = (req.query.interval as string) || '1d';
      const { getHistorical } = await import('./providers/yahoo.js');
      const candles = await getHistorical(symbol.toUpperCase(), range, interval);
      res.json({ symbol: symbol.toUpperCase(), range, interval, count: candles.length, candles });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ── REST API: Live ticker tape data (15 major symbols) ───────────────────────
  const TICKER_SYMBOLS = [
    'AAPL','MSFT','NVDA','GOOGL','AMZN','TSLA','META','RELIANCE.NS','TCS.NS',
    'INFY.NS','^NSEI','^GSPC','^DJI','BTC-USD','EURUSD=X'
  ];
  app.get('/api/ticker', async (req, res) => {
    try {
      const querySymbols = req.query.symbols as string;
      const symbolsList = querySymbols
        ? querySymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
        : TICKER_SYMBOLS;

      const { getQuote } = await import('./providers/yahoo.js');
      const results = await Promise.allSettled(
        symbolsList.map(sym => getQuote(sym))
      );
      const quotes = results
        .map((r, i) => r.status === 'fulfilled' ? r.value : null)
        .filter(Boolean);
      res.json({ quotes, timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ── REST API: Quote for a single symbol (used by charts page) ────────────────
  app.get('/api/quote', async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || 'AAPL';
      const { getQuote } = await import('./providers/yahoo.js');
      const quote = await getQuote(symbol.toUpperCase());
      res.json(quote);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ── REST API: Search for symbols (autocomplete) ──────────────────────────────
  app.get('/api/search', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      if (!query) {
        res.json([]);
        return;
      }
      const { searchSymbol } = await import('./providers/yahoo.js');
      const results = await searchSymbol(query);
      res.json(results);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });



  app.get('/', (req, res, next) => {
    if (req.headers.accept?.includes('application/json')) {
      res.json({
        name: 'trade-mcp',
        description: 'Worldwide Stock Market MCP Server',
        endpoints: {
          sse: '/sse',
          message: '/message',
          health: '/health',
        },
        tools: 28,
        dataSources: ['Yahoo Finance', 'Alpha Vantage', 'Finnhub', 'NSE India'],
        aiEngines: ['Groq', 'NVIDIA NIM'],
      });
    } else {
      next();
    }
  });

  // Dynamic favicon.ico serving to bypass binary Git push constraints
  const FAVICON_BASE64 = "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";
  app.get('/favicon.ico', (_req, res) => {
    const img = Buffer.from(FAVICON_BASE64, 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length
    });
    res.end(img);
  });

  // Serve static files from 'public' folder (absolute path — works in any working directory)
  app.use(express.static(PUBLIC_DIR));

  // Explicit route for charts page
  app.get('/charts.html', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'charts.html'));
  });
  app.get('/charts', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'charts.html'));
  });

  app.listen(port, () => {
    printBanner();
    console.error(`[trade-mcp] HTTP server ready on port ${port}`);
  });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const mode = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();

if (mode === 'http') {
  runHttp().catch(err => {
    console.error('[trade-mcp] Fatal error:', err);
    process.exit(1);
  });
} else {
  runStdio().catch(err => {
    console.error('[trade-mcp] Fatal error:', err);
    process.exit(1);
  });
}
