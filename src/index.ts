import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import cors from 'cors';

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
  
  // Serve static files from 'public' folder
  app.use(express.static('public'));

  // Track active SSE transports by session
  const transports = new Map<string, SSEServerTransport>();

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      server: 'trade-mcp',
      version: '1.0.0',
      transport: 'http/sse',
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

  // Info page or fallback JSON endpoint for '/'
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
