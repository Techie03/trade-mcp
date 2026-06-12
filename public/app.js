// ─── Constants and Configuration ─────────────────────────────────────
const ENDPOINT_ORIGIN = window.location.origin;
const SSE_ENDPOINT = `${ENDPOINT_ORIGIN}/sse`;

// Client Config Templates
const configs = {
  claude: {
    path: "%APPDATA%\\Claude\\claude_desktop_config.json",
    content: () => `{
  "mcpServers": {
    "trade-mcp": {
      "url": "${SSE_ENDPOINT}"
    }
  }
}`
  },
  cursor: {
    path: "%USERPROFILE%\\.cursor\\mcp.json",
    content: () => `{
  "mcpServers": {
    "trade-mcp": {
      "url": "${SSE_ENDPOINT}"
    }
  }
}`
  },
  windsurf: {
    path: "~/.codeium/windsurf/mcp_config.json",
    content: () => `{
  "mcpServers": {
    "trade-mcp": {
      "url": "${SSE_ENDPOINT}"
    }
  }
}`
  },
  zed: {
    path: "~/.config/zed/settings.json",
    content: () => `{
  "context_servers": {
    "trade-mcp": {
      "url": "${SSE_ENDPOINT}"
    }
  }
}`
  },
  continue: {
    path: "~/.continue/config.json",
    content: () => `{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "sse",
          "url": "${SSE_ENDPOINT}"
        }
      }
    ]
  }
}`
  }
};

// Terminal Playback Scenarios
const scenarios = {
  us_quotes: [
    { type: 'user', text: "Get the current stock price and short description of Apple and NVIDIA." },
    { type: 'tool-call', name: 'search_symbol', params: { query: 'Apple Inc' } },
    { type: 'tool-resp', data: { symbols: [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }] } },
    { type: 'tool-call', name: 'get_quote', params: { symbol: 'AAPL' } },
    { type: 'tool-resp', data: { symbol: 'AAPL', price: 215.40, change: 2.55, changePercent: 1.20, volume: 52400000, marketCap: 3300000000000 } },
    { type: 'tool-call', name: 'get_quote', params: { symbol: 'NVDA' } },
    { type: 'tool-resp', data: { symbol: 'NVDA', price: 128.50, change: 4.22, changePercent: 3.40, volume: 184500000, marketCap: 3150000000000 } },
    { type: 'assistant', text: "Here is the current quote and comparison for Apple and NVIDIA:\n\n* **Apple Inc. (AAPL)**:\n  * Price: **$215.40** (+$2.55, **+1.20%**)\n  * Market Cap: **$3.30T**\n  * Volume: 52.4M shares\n\n* **NVIDIA Corp. (NVDA)**:\n  * Price: **$128.50** (+$4.22, **+3.40%**)\n  * Market Cap: **$3.15T**\n  * Volume: 184.5M shares\n\nBoth companies are seeing strong bullish momentum today, with NVIDIA showing significantly higher trading volume relative to its average, driven by broad interest in semiconductor markets." }
  ],
  nse_options: [
    { type: 'user', text: "Show me Nifty option chain data and give me the major support and resistance levels." },
    { type: 'tool-call', name: 'get_nse_option_chain', params: { symbol: 'NIFTY' } },
    { type: 'tool-resp', data: {
        underlyingValue: 23415.65,
        timestamp: "2026-06-11 15:30:00",
        strikes: [
          { strike: 23300, callOI: 12000, putOI: 48000, callLTP: 165, putLTP: 42 },
          { strike: 23400, callOI: 31000, putOI: 35000, callLTP: 92, putLTP: 78 },
          { strike: 23500, callOI: 54000, putOI: 15000, callLTP: 45, putLTP: 128 }
        ]
      }
    },
    { type: 'assistant', text: "Based on the live NSE Option Chain for **NIFTY** (Underlying Value: **23,415.65**):\n\n1. **Support Level**: Strong support lies at **23,300**, where we see high Put Open Interest (OI) of **48,000 contracts** with minimal Call OI, representing a firm floor.\n2. **Resistance Level**: Immediate resistance is at **23,500** which displays the highest Call Open Interest (**54,000 contracts**).\n3. **Market Sentiment**: The Put-Call Ratio (PCR) near the money (23,400) is **1.13**, indicating a mild bullish bias as option sellers are heavily writing put options." }
  ],
  python_sandbox: [
    { type: 'user', text: "Run a 20-day simple moving average backtest on TCS.NS and plot the chart." },
    { type: 'tool-call', name: 'run_python_analysis', params: { code: 'import pandas as pd\nimport numpy as np\n# Simulated backtest logic...\nprint("TCS Backtest Complete\\nSharpe Ratio: 1.84\\nTotal Returns: 28.5%\\nChart Saved: analysis/tcs_sma.png")' } },
    { type: 'tool-resp', data: { stdout: "TCS Backtest Complete\nSharpe Ratio: 1.84\nTotal Returns: 28.5%\nChart Saved: analysis/tcs_sma.png", stderr: "" } },
    { type: 'assistant', text: "I have written and executed the Python backtest script in the data science sandbox. Here are the results:\n\n* **Asset**: Tata Consultancy Services (TCS.NS)\n* **Strategy**: 20-day Simple Moving Average (SMA) crossover\n* **Total Returns**: **28.5%**\n* **Sharpe Ratio**: **1.84** (indicates highly efficient risk-adjusted returns)\n\nI have generated the performance plot and successfully saved the chart to **`analysis/tcs_sma.png`**." }
  ],
  ai_comparison: [
    { type: 'user', text: "Perform a sentiment analysis and portfolio check for Apple, Reliance, and Infosys." },
    { type: 'tool-call', name: 'analyze_portfolio', params: { symbols: ['AAPL', 'RELIANCE.NS', 'INFY.NS'] } },
    { type: 'tool-resp', data: {
        score: 8.5,
        verdict: "Strong Diversified Bullish",
        details: "US Tech sector (Apple) provides high-growth exposure, while Reliance offers energy stability in India and Infosys captures global IT consulting trends."
      }
    },
    { type: 'assistant', text: "Here is the AI Portfolio Audit for your assets:\n\n* **Overall Score**: **8.5 / 10**\n* **Verdict**: **Strong Diversified Bullish**\n\n### Asset Breakdown:\n1. **Apple Inc. (AAPL)**: High growth, premium brand resilience. Sentiment is bullish.\n2. **Reliance Industries (RELIANCE.NS)**: Market leader in energy/telecom. Technical consolidation showing a clean buy trigger.\n3. **Infosys Ltd. (INFY.NS)**: Stable cash flows, attractive dividend yield. Neutral-to-Bullish.\n\n### Recommendation:\nYour allocation is well-balanced across regions (US and India) and sectors (Hardware, Infrastructure, Services). The portfolio represents a solid defensive growth strategy." }
  ]
};

// ─── Logic Implementation ───────────────────────────────────────────

// 1. Live Server Status Check
async function checkServerStatus() {
  const dot = document.querySelector('.status-dot');
  const text = document.getElementById('status-text');

  try {
    const res = await fetch(`${ENDPOINT_ORIGIN}/health`);
    if (res.ok) {
      const data = await res.json();
      dot.className = 'status-dot active';
      
      const uptimeSec = data.uptime || 0;
      const hours = Math.floor(uptimeSec / 3600);
      const mins = Math.floor((uptimeSec % 3600) / 60);
      let uptimeText = '';
      if (hours > 0) uptimeText += `${hours}h `;
      uptimeText += `${mins}m`;

      text.textContent = `Server Operational • ${data.tools} tools loaded • Uptime: ${uptimeText}`;
    } else {
      throw new Error();
    }
  } catch (err) {
    dot.className = 'status-dot error';
    text.textContent = 'Server Offline • Failed to connect to SSE API';
  }
}

// 2. Config Generator Tab Selector
let activeClient = 'claude';
function updateConfigDisplay() {
  const codeBlock = document.getElementById('code-block');
  const codePath = document.getElementById('code-path');
  const btn = document.getElementById('btn-copy');

  // Reset copy button state
  btn.className = 'btn-copy';
  btn.innerHTML = `
    <svg class="icon-copy" viewBox="0 0 24 24" width="16" height="16">
      <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
    </svg>
    Copy Config
  `;

  if (configs[activeClient]) {
    codePath.textContent = configs[activeClient].path;
    codeBlock.textContent = configs[activeClient].content();
  }
}

// 3. Simulated Terminal Engine
let activeScenario = 'us_quotes';
let terminalInterval = null;

function renderTerminalScenario() {
  const container = document.getElementById('terminal-output');
  container.innerHTML = '';
  
  if (terminalInterval) {
    clearInterval(terminalInterval);
  }

  const steps = scenarios[activeScenario];
  let currentStep = 0;

  function runNextStep() {
    if (currentStep >= steps.length) {
      // Add cursor back and wait
      const cursorDiv = document.createElement('div');
      cursorDiv.innerHTML = '<span class="t-cursor"></span>';
      container.appendChild(cursorDiv);
      container.scrollTop = container.scrollHeight;
      return;
    }

    // Remove old cursors if any
    const oldCursor = container.querySelector('.t-cursor');
    if (oldCursor) oldCursor.parentElement.remove();

    const step = steps[currentStep];
    const msgDiv = document.createElement('div');

    if (step.type === 'user') {
      msgDiv.className = 't-msg user';
      msgDiv.innerHTML = `
        <span class="t-author">USER</span>
        <span class="t-text">${step.text}</span>
      `;
      container.appendChild(msgDiv);
    } else if (step.type === 'assistant') {
      msgDiv.className = 't-msg assistant';
      msgDiv.innerHTML = `
        <span class="t-author">Claude (trade-mcp)</span>
        <span class="t-text">${step.text}</span>
      `;
      container.appendChild(msgDiv);
    } else if (step.type === 'tool-call') {
      msgDiv.className = 't-tool-call';
      msgDiv.innerHTML = `
        <div class="t-tool-header">
          <span>⚙️ callTool: ${step.name}</span>
        </div>
        <pre class="t-tool-params">arguments: ${JSON.stringify(step.params, null, 2)}</pre>
      `;
      container.appendChild(msgDiv);
    } else if (step.type === 'tool-resp') {
      msgDiv.className = 't-tool-response';
      msgDiv.innerHTML = `
        <div class="t-resp-header">
          <span>📦 response data</span>
        </div>
        <pre class="t-resp-body">${JSON.stringify(step.data, null, 2)}</pre>
      `;
      container.appendChild(msgDiv);
    }

    // Add blink cursor placeholder at the bottom
    const progressCursor = document.createElement('div');
    progressCursor.innerHTML = '<span class="t-cursor"></span>';
    container.appendChild(progressCursor);

    // Scroll
    container.scrollTop = container.scrollHeight;

    currentStep++;
    
    // Set variable delays for realistic simulation
    let delay = 1800;
    if (step.type === 'tool-call') delay = 1200;
    if (step.type === 'tool-resp') delay = 2000;
    
    terminalInterval = setTimeout(runNextStep, delay);
  }

  runNextStep();
}

// ─── Event Listeners and Initialization ──────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Check health status initially and every 30 seconds
  checkServerStatus();
  setInterval(checkServerStatus, 30000);

  // Setup Config copy toggles
  const tabButtons = document.querySelectorAll('.config-tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeClient = btn.dataset.client;
      updateConfigDisplay();
    });
  });
  updateConfigDisplay();

  // Setup Clipboard Copy Action
  const copyBtn = document.getElementById('btn-copy');
  copyBtn.addEventListener('click', () => {
    const textToCopy = document.getElementById('code-block').textContent;
    navigator.clipboard.writeText(textToCopy).then(() => {
      copyBtn.className = 'btn-copy copied';
      copyBtn.innerHTML = `
        <svg class="icon-copy" viewBox="0 0 24 24" width="16" height="16" style="color: var(--accent-green)">
          <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        Config Copied!
      `;
      setTimeout(() => {
        copyBtn.className = 'btn-copy';
        copyBtn.innerHTML = `
          <svg class="icon-copy" viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
          Copy Config
        `;
      }, 3000);
    });
  });

  // Setup Playground Scenario button click
  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeScenario = btn.dataset.scenario;
      renderTerminalScenario();
    });
  });
  renderTerminalScenario();
});
