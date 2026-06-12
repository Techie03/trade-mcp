// ─── Trade MCP Live Charts — charts.js ──────────────────────────────────────
// Uses TradingView Lightweight Charts v4 (loaded via CDN in charts.html)
// All indicator math computed client-side (no extra library needed)

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
  ? window.location.origin
  : 'https://nishith374-stock-mcp.hf.space';

function getCurrencySymbol(symbol) {
  if (!symbol) return '$';
  const sym = symbol.toUpperCase();
  if (sym.endsWith('.NS') || sym.endsWith('.BO') || sym.startsWith('^NSE')) {
    return '₹';
  }
  if (sym.includes('EURUSD')) {
    return '€';
  }
  return '$';
}


// ─── Drawing Tools, Replay & Alerts State ─────────────────────────────────────
let activeDrawingTool = 'select';
let drawings = [];
let currentDrawing = null;
let priceAlerts = [];

let replayActive = false;
let replayIndex = 0;
let replayTimer = null;
let replaySpeed = 1000;

// ─── Indicator Math ───────────────────────────────────────────────────────────

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const result = [];
  let ema = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) { result.push(null); continue; }
    if (ema === null) {
      if (i < period - 1) { result.push(null); continue; }
      ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      ema = values[i] * k + ema * (1 - k);
    }
    result.push(parseFloat(ema.toFixed(4)));
  }
  return result;
}

function calcSMA(values, period) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    if (slice.some(v => v == null)) return null;
    return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(4));
  });
}

function calcRSI(closes, period = 14) {
  const result = Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  }
  return result;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null
      ? parseFloat((emaFast[i] - emaSlow[i]).toFixed(4))
      : null
  );
  const validMacd = macdLine.filter(v => v != null);
  const signalRaw = calcEMA(macdLine.filter(v => v != null), signal);
  // Re-align signal to original indices
  const firstValidIdx = macdLine.findIndex(v => v != null);
  const signalLine = macdLine.map((v, i) => {
    if (v == null) return null;
    const sigIdx = i - firstValidIdx - (signal - 1);
    return sigIdx >= 0 ? signalRaw[sigIdx] ?? null : null;
  });
  const histogram = macdLine.map((v, i) =>
    v != null && signalLine[i] != null ? parseFloat((v - signalLine[i]).toFixed(4)) : null
  );
  return { macdLine, signalLine, histogram };
}

function calcBollingerBands(closes, period = 20, stdDevMult = 2) {
  const sma = calcSMA(closes, period);
  return closes.map((_, i) => {
    if (sma[i] == null) return { upper: null, middle: null, lower: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const variance = slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
      upper: parseFloat((mean + stdDevMult * stdDev).toFixed(4)),
      middle: parseFloat(mean.toFixed(4)),
      lower: parseFloat((mean - stdDevMult * stdDev).toFixed(4)),
    };
  });
}

function calcATR(candles, period = 14) {
  const tr = [null];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr1 = cur.high - cur.low;
    const tr2 = Math.abs(cur.high - prev.close);
    const tr3 = Math.abs(cur.low - prev.close);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  const atr = Array(candles.length).fill(null);
  if (candles.length < period + 1) return atr;
  
  let trSum = tr.slice(1, period + 1).reduce((acc, v) => acc + v, 0);
  atr[period] = parseFloat((trSum / period).toFixed(4));
  
  for (let i = period + 1; i < candles.length; i++) {
    const nextAtr = (atr[i - 1] * (period - 1) + tr[i]) / period;
    atr[i] = parseFloat(nextAtr.toFixed(4));
  }
  return atr;
}

function calcStochastic(candles, kPeriod = 14, dPeriod = 3) {
  const kValues = Array(candles.length).fill(null);
  const dValues = Array(candles.length).fill(null);
  
  if (candles.length < kPeriod) return { k: kValues, d: dValues };
  
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const highs = slice.map(c => c.high);
    const lows = slice.map(c => c.low);
    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);
    const close = candles[i].close;
    
    if (highestHigh - lowestLow === 0) {
      kValues[i] = 50;
    } else {
      kValues[i] = parseFloat((((close - lowestLow) / (highestHigh - lowestLow)) * 100).toFixed(2));
    }
  }
  
  for (let i = kPeriod + dPeriod - 2; i < candles.length; i++) {
    const slice = kValues.slice(i - dPeriod + 1, i + 1);
    if (slice.some(v => v === null)) continue;
    const sum = slice.reduce((acc, v) => acc + v, 0);
    dValues[i] = parseFloat((sum / dPeriod).toFixed(2));
  }
  
  return { k: kValues, d: dValues };
}

function calcPriceStdDev(candles) {
  if (!candles || candles.length < 2) return { value: 0, percentage: 0 };
  const closes = candles.map(c => c.close);
  const mean = closes.reduce((acc, v) => acc + v, 0) / closes.length;
  const variance = closes.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / closes.length;
  const stdDev = Math.sqrt(variance);
  const percentage = (stdDev / mean) * 100;
  return {
    value: parseFloat(stdDev.toFixed(2)),
    percentage: parseFloat(percentage.toFixed(2))
  };
}

// ─── Chart State ─────────────────────────────────────────────────────────────

const INTERVAL_SECONDS = {
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1d': 86400,
  '1wk': 604800,
};

let activeSymbol = 'AAPL';
let activeRange = '3mo';
let activeInterval = '1d';
let activeChartType = 'candlestick';
let realtimeTimer = null;
let activeCandles = [];

// Chart instances
let mainChart = null, volChart = null, rsiChart = null, macdChart = null, atrChart = null, stochChart = null;
let mainSeries = null, volSeries = null, rsiSeries = null;
let macdLineSeries = null, macdSignalSeries = null, macdHistSeries = null;
let atrSeries = null, stochKSeries = null, stochDSeries = null;
let ema9Series = null, ema21Series = null, sma50Series = null, sma200Series = null;
let bbUpperSeries = null, bbMiddleSeries = null, bbLowerSeries = null;
let rsiObSeries = null, rsiOsSeries = null;
let stochObSeries = null, stochOsSeries = null;

// ─── Chart Factory ────────────────────────────────────────────────────────────

const CHART_OPTS = {
  layout: { background: { color: '#000000' }, textColor: '#8e8e93', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
  grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
  crosshair: { mode: 1, vertLine: { color: 'rgba(255,255,255,0.25)', style: 0, width: 1, labelBackgroundColor: '#1c1c1e' }, horzLine: { color: 'rgba(255,255,255,0.25)', style: 0, width: 1, labelBackgroundColor: '#1c1c1e' } },
  rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)', scaleMargins: { top: 0.08, bottom: 0.08 } },
  timeScale: { borderColor: 'rgba(255,255,255,0.07)', timeVisible: true, secondsVisible: false },
  handleScroll: { mouseWheel: true, pressedMouseMove: true },
  handleScale: { mouseWheel: true, pinch: true },
};

function createChart(containerId, extraOpts = {}) {
  const el = document.getElementById(containerId);
  const chart = LightweightCharts.createChart(el, {
    ...CHART_OPTS,
    width: el.clientWidth,
    height: el.clientHeight || 300,
    ...extraOpts,
  });
  return chart;
}

function initCharts() {
  // Destroy old charts
  if (mainChart) mainChart.remove();
  if (volChart) volChart.remove();
  if (rsiChart) rsiChart.remove();
  if (macdChart) macdChart.remove();
  if (atrChart) atrChart.remove();
  if (stochChart) stochChart.remove();

  mainChart = createChart('main-chart');
  volChart  = createChart('vol-chart',  { rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0 } } });
  rsiChart  = createChart('rsi-chart',  { rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } } });
  macdChart = createChart('macd-chart', { rightPriceScale: { scaleMargins: { top: 0.2, bottom: 0.2 } } });
  atrChart  = createChart('atr-chart',  { rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } } });
  stochChart = createChart('stoch-chart', { rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } } });

  const allCharts = [mainChart, volChart, rsiChart, macdChart, atrChart, stochChart].filter(Boolean);

  // Sync crosshairs
  allCharts.forEach(src => {
    src.subscribeCrosshairMove(param => {
      const time = param.time;
      if (!time) return;
      allCharts.forEach(dst => {
        if (dst !== src) {
          try { dst.setCrossHairXY && dst.applyOptions({}); } catch {}
        }
      });
    });
  });

  // Sync time scales
  mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (!range) return;
    allCharts.filter(c => c !== mainChart).forEach(c => c.timeScale().setVisibleLogicalRange(range));
    if (typeof drawAllShapes === 'function') drawAllShapes();
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    [mainChart, volChart, rsiChart, macdChart].forEach(c => {
      const el = c.chartElement();
      if (el && el.parentElement) {
        c.resize(el.parentElement.clientWidth, el.parentElement.clientHeight);
      }
    });

    const canvas = document.getElementById('drawing-canvas-overlay');
    const container = document.getElementById('main-chart-container');
    if (canvas && container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      if (typeof drawAllShapes === 'function') drawAllShapes();
    }
  });
  document.querySelectorAll('.chart-pane').forEach(el => ro.observe(el));
  
  if (typeof initDrawingCanvas === 'function') initDrawingCanvas();
}

// ─── Render Charts with Data ──────────────────────────────────────────────────

function renderCharts(candles) {
  const closes = candles.map(c => c.close);
  const times  = candles.map(c => c.time || c.date); // Use UNIX timestamps (numbers) for intraday, fall back to date strings

  // Helper: map values to {time, value} series
  const toLineSeries = (values) =>
    values.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean);

  const toBarSeries = (values, upColor, downColor) =>
    values.map((v, i) => v != null
      ? { time: times[i], value: v, color: v >= 0 ? upColor : downColor }
      : null
    ).filter(Boolean);

  // ── MAIN PRICE CHART ──
  mainChart.removeSeries && null; // handled by remove() in initCharts

  if (activeChartType === 'candlestick') {
    mainSeries = mainChart.addCandlestickSeries({
      upColor: '#30d158', downColor: '#ff453a',
      borderUpColor: '#30d158', borderDownColor: '#ff453a',
      wickUpColor: '#30d158', wickDownColor: '#ff453a',
    });
    mainSeries.setData(candles.map(c => ({
      time: c.time || c.date, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
  } else if (activeChartType === 'line') {
    mainSeries = mainChart.addLineSeries({
      color: '#0a84ff', lineWidth: 2, priceLineVisible: true,
      lastValueVisible: true, crosshairMarkerVisible: true,
    });
    mainSeries.setData(candles.map(c => ({ time: c.time || c.date, value: c.close })));
  } else {
    mainSeries = mainChart.addAreaSeries({
      lineColor: '#0a84ff', topColor: 'rgba(10,132,255,0.3)',
      bottomColor: 'rgba(10,132,255,0)', lineWidth: 2,
    });
    mainSeries.setData(candles.map(c => ({ time: c.time || c.date, value: c.close })));
  }

  // ── EMA OVERLAYS ──
  if (document.getElementById('toggle-ema9').checked) {
    ema9Series = mainChart.addLineSeries({ color: '#ff9f0a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ema9Series.setData(toLineSeries(calcEMA(closes, 9)));
  }
  if (document.getElementById('toggle-ema21').checked) {
    ema21Series = mainChart.addLineSeries({ color: '#af52de', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ema21Series.setData(toLineSeries(calcEMA(closes, 21)));
  }
  if (document.getElementById('toggle-sma50').checked) {
    sma50Series = mainChart.addLineSeries({ color: '#64d2ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    sma50Series.setData(toLineSeries(calcSMA(closes, 50)));
  }
  if (document.getElementById('toggle-sma200').checked) {
    sma200Series = mainChart.addLineSeries({ color: '#ff453a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    sma200Series.setData(toLineSeries(calcSMA(closes, 200)));
  }

  // ── BOLLINGER BANDS ──
  if (document.getElementById('toggle-bb').checked) {
    const bb = calcBollingerBands(closes, 20, 2);
    bbUpperSeries = mainChart.addLineSeries({ color: 'rgba(100,210,255,0.6)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    bbMiddleSeries = mainChart.addLineSeries({ color: 'rgba(100,210,255,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    bbLowerSeries = mainChart.addLineSeries({ color: 'rgba(100,210,255,0.6)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    bbUpperSeries.setData(bb.map((b, i) => b.upper != null ? { time: times[i], value: b.upper } : null).filter(Boolean));
    bbMiddleSeries.setData(bb.map((b, i) => b.middle != null ? { time: times[i], value: b.middle } : null).filter(Boolean));
    bbLowerSeries.setData(bb.map((b, i) => b.lower != null ? { time: times[i], value: b.lower } : null).filter(Boolean));
  }

  // ── VOLUME ──
  const volVisible = document.getElementById('toggle-vol').checked;
  document.getElementById('vol-pane-wrapper').style.display = volVisible ? '' : 'none';
  if (volVisible) {
    volSeries = volChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
    volSeries.setData(candles.map((c, i) => ({
      time: times[i], value: c.volume,
      color: c.close >= c.open ? 'rgba(48,209,88,0.5)' : 'rgba(255,69,58,0.5)',
    })));
  }

  // ── RSI ──
  const rsiVisible = document.getElementById('toggle-rsi').checked;
  document.getElementById('rsi-pane-wrapper').style.display = rsiVisible ? '' : 'none';
  if (rsiVisible) {
    rsiSeries = rsiChart.addLineSeries({ color: '#af52de', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const rsiData = calcRSI(closes, 14);
    rsiSeries.setData(toLineSeries(rsiData));

    // Overbought / Oversold lines
    const firstTime = times[0], lastTime = times[times.length - 1];
    rsiObSeries = rsiChart.addLineSeries({ color: 'rgba(255,69,58,0.5)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    rsiObSeries.setData([{ time: firstTime, value: 70 }, { time: lastTime, value: 70 }]);
    rsiOsSeries = rsiChart.addLineSeries({ color: 'rgba(48,209,88,0.5)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    rsiOsSeries.setData([{ time: firstTime, value: 30 }, { time: lastTime, value: 30 }]);

    rsiChart.priceScale('right').applyOptions({ autoScale: false, minValue: 0, maxValue: 100 });
  }

  // ── MACD ──
  const macdVisible = document.getElementById('toggle-macd').checked;
  document.getElementById('macd-pane-wrapper').style.display = macdVisible ? '' : 'none';
  if (macdVisible) {
    const { macdLine, signalLine, histogram } = calcMACD(closes, 12, 26, 9);
    macdLineSeries   = macdChart.addLineSeries({ color: '#0a84ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    macdSignalSeries = macdChart.addLineSeries({ color: '#ff9f0a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    macdHistSeries   = macdChart.addHistogramSeries({ priceScaleId: 'right', priceLineVisible: false });
    macdLineSeries.setData(toLineSeries(macdLine));
    macdSignalSeries.setData(toLineSeries(signalLine));
    macdHistSeries.setData(toBarSeries(histogram, 'rgba(48,209,88,0.6)', 'rgba(255,69,58,0.6)'));
  }

  // ── ATR ──
  const atrVisible = document.getElementById('toggle-atr') && document.getElementById('toggle-atr').checked;
  const atrWrapper = document.getElementById('atr-pane-wrapper');
  if (atrWrapper) {
    atrWrapper.style.display = atrVisible ? '' : 'none';
  }
  if (atrVisible && atrChart) {
    atrSeries = atrChart.addLineSeries({ color: '#ff453a', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
    const atrData = calcATR(candles, 14);
    atrSeries.setData(toLineSeries(atrData));
  }

  // ── STOCHASTIC OSCILLATOR ──
  const stochVisible = document.getElementById('toggle-stoch') && document.getElementById('toggle-stoch').checked;
  const stochWrapper = document.getElementById('stoch-pane-wrapper');
  if (stochWrapper) {
    stochWrapper.style.display = stochVisible ? '' : 'none';
  }
  if (stochVisible && stochChart) {
    stochKSeries = stochChart.addLineSeries({ color: '#64d2ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
    stochDSeries = stochChart.addLineSeries({ color: '#af52de', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    const { k, d } = calcStochastic(candles, 14, 3);
    stochKSeries.setData(toLineSeries(k));
    stochDSeries.setData(toLineSeries(d));

    const firstTime = times[0], lastTime = times[times.length - 1];
    stochObSeries = stochChart.addLineSeries({ color: 'rgba(255,69,58,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    stochObSeries.setData([{ time: firstTime, value: 80 }, { time: lastTime, value: 80 }]);
    stochOsSeries = stochChart.addLineSeries({ color: 'rgba(48,209,88,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    stochOsSeries.setData([{ time: firstTime, value: 20 }, { time: lastTime, value: 20 }]);

    stochChart.priceScale('right').applyOptions({ autoScale: false, minValue: 0, maxValue: 100 });
  }

  // ── PRICE STANDARD DEVIATION ──
  const stdDevObj = calcPriceStdDev(candles);
  const sibStdDevEl = document.getElementById('sib-stddev');
  if (sibStdDevEl) {
    sibStdDevEl.textContent = `${stdDevObj.value} (${stdDevObj.percentage}%)`;
  }

  mainChart.timeScale().fitContent();
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchAndRender(symbol, range, interval) {
  const loading = document.getElementById('chart-loading');
  loading.classList.remove('hidden');

  try {
    const url = `${API_BASE}/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.candles || data.candles.length === 0) {
      throw new Error('No candle data returned');
    }

    activeCandles = data.candles;

    initCharts();
    renderCharts(data.candles);
    loading.classList.add('hidden');

    // Also fetch quote for the info bar
    fetchAndRenderQuote(symbol);

    // Start realtime loop
    startRealtimeUpdates(symbol);

  } catch (err) {
    loading.classList.add('hidden');
    console.error('Chart fetch error:', err);
  }
}

async function fetchAndRenderQuote(symbol) {
  try {
    const resp = await fetch(`${API_BASE}/api/quote?symbol=${encodeURIComponent(symbol)}`);
    if (!resp.ok) return;
    const q = await resp.json();
    updateInfoBar(q);
  } catch {}
}

function updateInfoBar(q) {
  const symbol = q.symbol || activeSymbol;
  const curr = getCurrencySymbol(symbol);
  const fmt = (n, dec = 2, prefix = curr) => {
    if (n == null) return '—';
    const isNegative = n < 0;
    const absVal = Math.abs(n);
    return (isNegative ? '-' : '') + prefix + absVal.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };
  const fmtVol = (n) => n > 1e9 ? (n/1e9).toFixed(2)+'B' : n > 1e6 ? (n/1e6).toFixed(2)+'M' : n > 1e3 ? (n/1e3).toFixed(1)+'K' : String(n ?? '—');

  document.getElementById('sib-symbol').textContent = q.symbol || activeSymbol;
  document.getElementById('sib-name').textContent = q.name || '';
  document.getElementById('sib-price').textContent = fmt(q.price);
  const changeEl = document.getElementById('sib-change');
  const pct = q.changePercent?.toFixed(2);
  const changePrefix = q.change >= 0 ? '+' : '';
  changeEl.textContent = `${changePrefix}${fmt(q.change)} (${q.change >= 0 ? '+' : ''}${pct}%)`;

  changeEl.className = 'sib-change ' + (q.change >= 0 ? 'up' : 'down');
  document.getElementById('sib-open').textContent = fmt(q.open);
  document.getElementById('sib-high').textContent = fmt(q.high);
  document.getElementById('sib-low').textContent = fmt(q.low);
  document.getElementById('sib-52h').textContent = fmt(q.fiftyTwoWeekHigh);
  document.getElementById('sib-52l').textContent = fmt(q.fiftyTwoWeekLow);
  document.getElementById('sib-vol').textContent = fmtVol(q.volume);

  // Update watchlist name immediately on data retrieval
  const targetSymbol = q.symbol || activeSymbol;
  const wlItem = WATCHLIST.find(item => item.symbol === targetSymbol);
  if (wlItem) {
    wlItem.name = q.name || targetSymbol;
    const nameEl = document.querySelector(`.watchlist-item[data-symbol="${targetSymbol}"] .wi-name`);
    if (nameEl) {
      nameEl.textContent = q.name || targetSymbol;
    }
  }
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

const WATCHLIST = [
  // US Stocks
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com' },
  { symbol: 'META', name: 'Meta Platforms' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'AMD', name: 'AMD' },
  { symbol: 'AVGO', name: 'Broadcom Inc.' },
  { symbol: 'ADBE', name: 'Adobe Inc.' },
  { symbol: 'CRM', name: 'Salesforce Inc.' },
  { symbol: 'QCOM', name: 'Qualcomm Inc.' },
  { symbol: 'COIN', name: 'Coinbase Global' },
  { symbol: 'PLTR', name: 'Palantir Tech' },
  { symbol: 'SMCI', name: 'Super Micro' },

  // Indian Stocks (NSE)
  { symbol: 'RELIANCE.NS', name: 'Reliance Ind.' },
  { symbol: 'TCS.NS', name: 'Tata Consult.' },
  { symbol: 'INFY.NS', name: 'Infosys Ltd' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors' },
  { symbol: 'SBIN.NS', name: 'SBI Bank' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel' },
  { symbol: 'ITC.NS', name: 'ITC Limited' },
  { symbol: 'LT.NS', name: 'Larsen & Toubro' },
  { symbol: 'AXISBANK.NS', name: 'Axis Bank' },
  { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra' },
  { symbol: 'WIPRO.NS', name: 'Wipro Limited' },
  { symbol: 'TATACONSUM.NS', name: 'Tata Consumer' },

  // Crypto
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'ETH-USD', name: 'Ethereum' },
  { symbol: 'SOL-USD', name: 'Solana' },
  { symbol: 'BNB-USD', name: 'Binance Coin' },
  { symbol: 'XRP-USD', name: 'Ripple' },
  { symbol: 'DOGE-USD', name: 'Dogecoin' },

  // Forex & Indices
  { symbol: 'EURUSD=X', name: 'EUR/USD' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD' },
  { symbol: 'USDJPY=X', name: 'USD/JPY' },
  { symbol: '^NSEI', name: 'Nifty 50' },
  { symbol: '^BSESN', name: 'BSE Sensex' },
  { symbol: '^NSEBANK', name: 'Nifty Bank' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^DJI', name: 'Dow 30' },
  { symbol: '^IXIC', name: 'Nasdaq' }
];

const SECONDARY_WATCHLIST = [
  // US Stocks (Secondary)
  { symbol: 'JPM', name: 'JPMorgan Chase' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'MA', name: 'Mastercard Inc.' },
  { symbol: 'WMT', name: 'Walmart Inc.' },
  { symbol: 'COST', name: 'Costco Wholesale' },
  { symbol: 'BAC', name: 'Bank of America' },
  { symbol: 'DIS', name: 'Walt Disney Co.' },
  { symbol: 'INTC', name: 'Intel Corp.' },
  { symbol: 'NKE', name: 'Nike Inc.' },
  { symbol: 'PFE', name: 'Pfizer Inc.' },
  { symbol: 'T', name: 'AT&T Inc.' },
  { symbol: 'KO', name: 'Coca-Cola Co.' },
  { symbol: 'PEP', name: 'PepsiCo Inc.' },
  { symbol: 'SBUX', name: 'Starbucks Corp.' },
  { symbol: 'MRNA', name: 'Moderna Inc.' },

  // Indian Stocks (NSE Secondary)
  { symbol: 'M&M.NS', name: 'Mahindra & Mah.' },
  { symbol: 'ADANIENT.NS', name: 'Adani Ent.' },
  { symbol: 'SUNPHARMA.NS', name: 'Sun Pharma' },
  { symbol: 'TITAN.NS', name: 'Titan Company' },
  { symbol: 'ASIANPAINT.NS', name: 'Asian Paints' },
  { symbol: 'ULTRACEMCO.NS', name: 'UltraTech Cement' },
  { symbol: 'NESTLEIND.NS', name: 'Nestle India' },
  { symbol: 'BAJAJFINSV.NS', name: 'Bajaj Finserv' },
  { symbol: 'NTPC.NS', name: 'NTPC Limited' },
  { symbol: 'ONGC.NS', name: 'ONGC' },
  { symbol: 'POWERGRID.NS', name: 'Power Grid' },
  { symbol: 'COALINDIA.NS', name: 'Coal India' },
  { symbol: 'ADANIPORTS.NS', name: 'Adani Ports' },
  { symbol: 'HINDALCO.NS', name: 'Hindalco Ind.' },
  { symbol: 'JIOFIN.NS', name: 'Jio Financial' },

  // Crypto (Secondary)
  { symbol: 'ADA-USD', name: 'Cardano' },
  { symbol: 'DOT-USD', name: 'Polkadot' },
  { symbol: 'LINK-USD', name: 'Chainlink' },
  { symbol: 'MATIC-USD', name: 'Polygon' },
  { symbol: 'LTC-USD', name: 'Litecoin' },
  { symbol: 'UNI-USD', name: 'Uniswap' },

  // Forex & Indices (Secondary)
  { symbol: 'AUDUSD=X', name: 'AUD/USD' },
  { symbol: 'USDCAD=X', name: 'USD/CAD' },
  { symbol: 'USDCHF=X', name: 'USD/CHF' },
  { symbol: '^FTSE', name: 'FTSE 100' },
  { symbol: '^N225', name: 'Nikkei 225' },
  { symbol: '^HSI', name: 'Hang Seng Index' },
  { symbol: '^GDAXI', name: 'DAX Performance' },
  { symbol: '^FCHI', name: 'CAC 40' }
];

const WATCHLIST_SYMBOLS = WATCHLIST.map(w => w.symbol);

function renderWatchlist() {
  const wlContainer = document.getElementById('watchlist');
  if (!wlContainer) return;
  
  let html = WATCHLIST.map(item => `
    <div class="watchlist-item ${item.symbol === activeSymbol ? 'active' : ''}" data-symbol="${item.symbol}">
      <div class="wi-symbol">${item.symbol.replace('.NS', '').replace('-USD', '').replace('=X', '').replace('^', '')}</div>
      <div class="wi-name">${item.name}</div>
      <div class="wi-price" id="wl-${item.symbol}">—</div>
      <div class="wi-change" id="wl-ch-${item.symbol}">—</div>
    </div>
  `).join('');

  if (SECONDARY_WATCHLIST.length > 0) {
    html += `
      <div style="padding: 10px 12px; text-align: center;">
        <button id="btn-load-more-wl" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text-2); font-size: 11px; padding: 6px 12px; cursor: pointer; width: 100%; transition: all 0.15s; outline: none;">Load More Stocks ⏷</button>
      </div>
    `;
  }

  wlContainer.innerHTML = html;

  // Bind click event listeners to new watchlist elements
  wlContainer.querySelectorAll('.watchlist-item').forEach(item => {
    item.addEventListener('click', () => {
      loadSymbol(item.dataset.symbol);
    });
  });

  const loadMoreBtn = document.getElementById('btn-load-more-wl');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      const batch = SECONDARY_WATCHLIST.splice(0, 25);
      batch.forEach(item => {
        if (!WATCHLIST_SYMBOLS.includes(item.symbol)) {
          WATCHLIST.push(item);
          WATCHLIST_SYMBOLS.push(item.symbol);
        }
      });
      renderWatchlist();
      loadWatchlistPrices();
    });
  }
}

async function loadWatchlistPrices() {
  if (WATCHLIST_SYMBOLS.length === 0) return;
  try {
    const symbolsQuery = WATCHLIST_SYMBOLS.join(',');
    const resp = await fetch(`${API_BASE}/api/ticker?symbols=${encodeURIComponent(symbolsQuery)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    (data.quotes || []).forEach(q => {
      if (!q) return;
      const priceEl  = document.getElementById(`wl-${q.symbol}`);
      const changeEl = document.getElementById(`wl-ch-${q.symbol}`);
      if (priceEl) {
        const oldPrice = parseFloat(priceEl.textContent.replace(/[^0-9.-]/g, ''));
        const newPrice = q.price;
        if (!isNaN(oldPrice) && newPrice !== oldPrice && q.symbol !== activeSymbol) {
          const wlItem = document.querySelector(`.watchlist-item[data-symbol="${q.symbol}"]`);
          if (wlItem) {
            wlItem.classList.remove('flash-green-bg', 'flash-red-bg');
            void wlItem.offsetWidth;
            wlItem.classList.add(newPrice > oldPrice ? 'flash-green-bg' : 'flash-red-bg');
          }
        }
        const curr = getCurrencySymbol(q.symbol);
        priceEl.textContent = q.price != null ? curr + q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
      }
      if (changeEl) {
        const pct = q.changePercent?.toFixed(2);
        changeEl.textContent = pct != null ? `${q.changePercent >= 0 ? '+' : ''}${pct}%` : '—';
        changeEl.className = 'wi-change ' + (q.changePercent >= 0 ? 'up' : 'down');
      }
    });
  } catch {}
}

function startRealtimeUpdates(symbol) {
  if (realtimeTimer) {
    clearInterval(realtimeTimer);
  }

  realtimeTimer = setInterval(async () => {
    if (document.hidden) return;

    try {
      const resp = await fetch(`${API_BASE}/api/quote?symbol=${encodeURIComponent(symbol)}`);
      if (!resp.ok) return;
      const q = await resp.json();

      if (symbol !== activeSymbol) return;

      const priceEl = document.getElementById('sib-price');
      const oldPrice = parseFloat(priceEl.textContent.replace(/,/g, ''));
      const newPrice = q.price;

      if (!isNaN(oldPrice) && newPrice !== oldPrice) {
        const infoBar = document.getElementById('stock-info-bar');
        infoBar.classList.remove('flash-green-bg', 'flash-red-bg');
        void infoBar.offsetWidth;
        infoBar.classList.add(newPrice > oldPrice ? 'flash-green-bg' : 'flash-red-bg');
      }

      updateInfoBar(q);
      if (typeof checkAlerts === 'function') checkAlerts(q.price);

      // Update the last candle on the chart!
      if (activeCandles && activeCandles.length > 0 && mainSeries) {
        const lastCandle = activeCandles[activeCandles.length - 1];
        const isIntraday = ['5m', '15m', '1h'].includes(activeInterval);
        
        let isSameCandle = false;
        if (isIntraday) {
          const seconds = INTERVAL_SECONDS[activeInterval] || 900;
          isSameCandle = (q.timestamp >= lastCandle.time && q.timestamp < lastCandle.time + seconds);
        } else {
          const quoteDate = new Date(q.timestamp * 1000).toISOString().split('T')[0];
          isSameCandle = (lastCandle.date === quoteDate);
        }

        if (isSameCandle) {
          lastCandle.close = q.price;
          if (q.high > lastCandle.high) lastCandle.high = q.high;
          if (q.low < lastCandle.low) lastCandle.low = q.low;
        } else if (!isIntraday || q.timestamp > lastCandle.time) {
          let newTime = q.timestamp;
          if (isIntraday) {
            const seconds = INTERVAL_SECONDS[activeInterval] || 900;
            newTime = Math.floor(q.timestamp / seconds) * seconds;
          }
          const newCandle = {
            date: new Date(newTime * 1000).toISOString().split('T')[0],
            time: newTime,
            open: q.open || q.price,
            high: q.high || q.price,
            low: q.low || q.price,
            close: q.price,
            volume: q.volume || 0
          };
          activeCandles.push(newCandle);
        }

        renderCharts(activeCandles);
      }

      // Update the watchlist item price & change with flashing
      const wlPriceEl = document.getElementById(`wl-${symbol}`);
      if (wlPriceEl) {
        const oldWlPrice = parseFloat(wlPriceEl.textContent.replace(/[^0-9.-]/g, ''));
        if (!isNaN(oldWlPrice) && newPrice !== oldWlPrice) {
          const wlItem = document.querySelector(`.watchlist-item[data-symbol="${symbol}"]`);
          if (wlItem) {
            wlItem.classList.remove('flash-green-bg', 'flash-red-bg');
            void wlItem.offsetWidth;
            wlItem.classList.add(newPrice > oldWlPrice ? 'flash-green-bg' : 'flash-red-bg');
          }
        }
        const curr = getCurrencySymbol(symbol);
        wlPriceEl.textContent = curr + newPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const wlChgEl = document.getElementById(`wl-ch-${symbol}`);
        if (wlChgEl) {
          const pct = q.changePercent?.toFixed(2);
          wlChgEl.textContent = pct != null ? `${q.changePercent >= 0 ? '+' : ''}${pct}%` : '—';
          wlChgEl.className = 'wi-change ' + (q.changePercent >= 0 ? 'up' : 'down');
        }
      }

      // Also dynamically update the watchlist item name if it was newly added and had just the symbol placeholder
      const wlItemName = document.querySelector(`.watchlist-item[data-symbol="${symbol}"] .wi-name`);
      if (wlItemName && wlItemName.textContent === symbol) {
        wlItemName.textContent = q.name || symbol;
      }

    } catch (err) {
      console.error('Realtime update fetch error:', err);
    }
  }, 4000); // Poll every 4 seconds for a snappy, real-time feel
}

// ─── Drawing Canvas Overlay Engine ───────────────────────────────────────────
function initDrawingCanvas() {
  const canvas = document.getElementById('drawing-canvas-overlay');
  const container = document.getElementById('main-chart-container');
  if (!canvas || !container) return;

  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  // Clear and redraw drawings whenever timescale or price scale changes
  if (mainChart) {
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(() => drawAllShapes());
  }

  canvas.addEventListener('mousedown', (e) => {
    if (activeDrawingTool === 'select') return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const time = mainChart.timeScale().coordinateToTime(x);
    const price = mainSeries.coordinateToPrice(y);

    if (time && price) {
      if (activeDrawingTool === 'trendline') {
        currentDrawing = { type: 'trendline', points: [{ time, price }, { time, price }] };
      } else if (activeDrawingTool === 'horizontal') {
        drawings.push({ type: 'horizontal', points: [{ time, price }] });
        drawAllShapes();
      } else if (activeDrawingTool === 'fib') {
        currentDrawing = { type: 'fib', points: [{ time, price }, { time, price }] };
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!currentDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const time = mainChart.timeScale().coordinateToTime(x);
    const price = mainSeries.coordinateToPrice(y);

    if (time && price) {
      currentDrawing.points[1] = { time, price };
      drawAllShapes();
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (currentDrawing) {
      drawings.push(currentDrawing);
      currentDrawing = null;
      drawAllShapes();
    }
  });
}

function drawAllShapes() {
  const canvas = document.getElementById('drawing-canvas-overlay');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawShape = (shape) => {
    if (shape.type === 'trendline') {
      const p1 = shape.points[0];
      const p2 = shape.points[1];
      const x1 = mainChart.timeScale().timeToCoordinate(p1.time);
      const y1 = mainSeries.priceToCoordinate(p1.price);
      const x2 = mainChart.timeScale().timeToCoordinate(p2.time);
      const y2 = mainSeries.priceToCoordinate(p2.price);

      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = '#0a84ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(10, 132, 255, 0.4)';
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
      }
    } else if (shape.type === 'horizontal') {
      const p = shape.points[0];
      const y = mainSeries.priceToCoordinate(p.price);
      if (y !== null) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.strokeStyle = '#ffd60a';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (shape.type === 'fib') {
      const p1 = shape.points[0];
      const p2 = shape.points[1];
      const y1 = mainSeries.priceToCoordinate(p1.price);
      const y2 = mainSeries.priceToCoordinate(p2.price);
      const x1 = mainChart.timeScale().timeToCoordinate(p1.time);
      const x2 = mainChart.timeScale().timeToCoordinate(p2.time);

      if (y1 !== null && y2 !== null && x1 !== null && x2 !== null) {
        const diff = p2.price - p1.price;
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
        const colors = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#af52de'];

        levels.forEach((lvl, idx) => {
          const priceLvl = p1.price + diff * lvl;
          const yLvl = mainSeries.priceToCoordinate(priceLvl);
          if (yLvl !== null) {
            ctx.beginPath();
            ctx.moveTo(Math.min(x1, x2), yLvl);
            ctx.lineTo(Math.max(x1, x2), yLvl);
            ctx.strokeStyle = colors[idx];
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = colors[idx];
            ctx.font = '9px monospace';
            ctx.fillText(`${(lvl * 100).toFixed(1)}% (${priceLvl.toFixed(2)})`, Math.max(x1, x2) + 5, yLvl + 3);
          }
        });
      }
    }
  };

  drawings.forEach(drawShape);
  if (currentDrawing) drawShape(currentDrawing);
}

// ─── Toast System ────────────────────────────────────────────────────────────
function showToast(message, type = 'blue') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  toast.innerHTML = `<span>⚡</span> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideIn 0.25s ease-out reverse';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// ─── Price Alerts Engine ─────────────────────────────────────────────────────
function setPriceAlert(targetPrice) {
  if (isNaN(targetPrice) || targetPrice <= 0) return;
  priceAlerts.push({ symbol: activeSymbol, price: targetPrice, triggered: false });
  showToast(`Alert set for ${activeSymbol} at $${targetPrice}`, 'blue');
}

function checkAlerts(currentPrice) {
  priceAlerts.forEach(alert => {
    if (alert.symbol === activeSymbol && !alert.triggered) {
      if (Math.abs(currentPrice - alert.price) / alert.price < 0.005) {
        alert.triggered = true;
        showToast(`ALERT: ${alert.symbol} crossed Target Price of $${alert.price}!`, 'green');
        if (Notification.permission === 'granted') {
          new Notification(`Price Alert Triggered`, { body: `${alert.symbol} is near $${alert.price}` });
        }
      }
    }
  });
}

// ─── Ticker Tape Engine ──────────────────────────────────────────────────────
async function startTickerTape() {
  const symbols = ['^NSEI', '^GSPC', '^IXIC', 'BTC-USD', 'EURUSD=X'];
  try {
    const resp = await fetch(`${API_BASE}/api/ticker?symbols=${symbols.join(',')}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const container = document.getElementById('ticker-items');
    if (!container) return;
    container.innerHTML = (data.quotes || []).map(q => {
      if (!q) return '';
      const isUp = q.changePercent >= 0;
      const curr = getCurrencySymbol(q.symbol);
      return `
        <div class="ticker-item clickable" onclick="loadSymbol('${q.symbol}')" style="display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; cursor: pointer;">
          <span class="ticker-sym" style="color: var(--text); font-weight: 700;">${q.symbol.replace('^', '')}</span>
          <span class="ticker-val" style="color: var(--text-2);">${curr}${q.price.toLocaleString()}</span>
          <span class="ticker-pct ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${q.changePercent.toFixed(2)}%</span>
        </div>
      `;
    }).join('');
  } catch {}
}

// ─── Movers List (Gainers & Losers) ──────────────────────────────────────────
async function fetchMovers(type = 'gainers') {
  const symbols = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA', 'META', 'RELIANCE.NS', 'TCS.NS', 'INFY.NS'];
  try {
    const resp = await fetch(`${API_BASE}/api/ticker?symbols=${symbols.join(',')}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const sorted = (data.quotes || []).filter(Boolean).sort((a, b) => b.changePercent - a.changePercent);

    const list = document.getElementById('sidebar-movers-list');
    if (!list) return;
    const displayList = type === 'gainers' ? sorted.slice(0, 5) : sorted.reverse().slice(0, 5);

    list.innerHTML = displayList.map(q => {
      const isUp = q.changePercent >= 0;
      const curr = getCurrencySymbol(q.symbol);
      return `
        <div class="mover-item" onclick="loadSymbol('${q.symbol}')">
          <div class="mover-left">
            <span class="mover-sym">${q.symbol}</span>
            <span class="mover-name">${q.name || ''}</span>
          </div>
          <div class="mover-right">
            <span class="mover-price">${curr}${q.price.toFixed(2)}</span>
            <span class="mover-change ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${q.changePercent.toFixed(2)}%</span>
          </div>
        </div>
      `;
    }).join('');
  } catch {}
}

// ─── Export CSV Engine ───────────────────────────────────────────────────────
function exportToCSV() {
  if (!activeCandles || activeCandles.length === 0) return;
  const headers = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume'];
  const rows = activeCandles.map(c => [
    c.date,
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume
  ]);

  const csvContent = "data:text/csv;charset=utf-8," 
    + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `${activeSymbol}_historical_data.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`CSV data exported successfully`, 'green');
}

// ─── Bar Replay Player ───────────────────────────────────────────────────────
function toggleReplayMode() {
  replayActive = !replayActive;
  const btn = document.getElementById('replay-toggle');
  
  if (replayActive) {
    btn.classList.add('active');
    document.getElementById('replay-back').classList.remove('hidden');
    document.getElementById('replay-play').classList.remove('hidden');
    document.getElementById('replay-forward').classList.remove('hidden');

    // Rewind back to middle
    replayIndex = Math.floor(activeCandles.length * 0.7);
    updateReplayFrame();
    showToast('Bar Replay mode activated. Click Play to start.', 'blue');
  } else {
    btn.classList.remove('active');
    document.getElementById('replay-back').classList.add('hidden');
    document.getElementById('replay-play').classList.add('hidden');
    document.getElementById('replay-forward').classList.add('hidden');
    
    if (replayTimer) clearInterval(replayTimer);
    displayCandles = [...activeCandles];
    renderCharts(displayCandles);
    showToast('Bar Replay mode deactivated', 'blue');
  }
}

function updateReplayFrame() {
  displayCandles = activeCandles.slice(0, replayIndex);
  renderCharts(displayCandles);
}

function stepForward() {
  if (replayIndex < activeCandles.length) {
    replayIndex++;
    updateReplayFrame();
  } else {
    clearInterval(replayTimer);
  }
}

function stepBackward() {
  if (replayIndex > 5) {
    replayIndex--;
    updateReplayFrame();
  }
}

function toggleReplayPlayback() {
  const playBtn = document.getElementById('replay-play');
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
    playBtn.textContent = '▶ Play';
  } else {
    replayTimer = setInterval(stepForward, replaySpeed);
    playBtn.textContent = '⏸ Pause';
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function loadSymbol(symbol, range, interval, addToWatchlist = true) {
  activeSymbol = symbol;
  activeRange = range || activeRange;
  activeInterval = interval || activeInterval;

  if (realtimeTimer) {
    clearInterval(realtimeTimer);
    realtimeTimer = null;
  }

  // Reset/hide AI Analyst panel
  const aiPanel = document.getElementById('ai-analyst-panel');
  if (aiPanel) aiPanel.classList.add('hidden');

  // Add symbol dynamically if not in watchlist
  if (addToWatchlist && !WATCHLIST_SYMBOLS.includes(symbol)) {
    WATCHLIST.unshift({ symbol, name: symbol });
    WATCHLIST_SYMBOLS.unshift(symbol);
    renderWatchlist();
    loadWatchlistPrices();
  }

  // Update watchlist active state
  document.querySelectorAll('.watchlist-item').forEach(el => {
    el.classList.toggle('active', el.dataset.symbol === symbol);
  });

  // Close mobile sidebar and backdrop if open
  const sidebarEl = document.querySelector('.sidebar');
  const backdropEl = document.getElementById('sidebar-backdrop');
  if (sidebarEl) sidebarEl.classList.remove('open');
  if (backdropEl) backdropEl.classList.remove('visible');

  fetchAndRender(activeSymbol, activeRange, activeInterval);
}

document.addEventListener('DOMContentLoaded', () => {
  // Mobile sidebar toggle
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  if (toggleBtn && sidebar && backdrop) {
    const toggle = () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('visible');
    };
    toggleBtn.addEventListener('click', toggle);
    backdrop.addEventListener('click', toggle);
  }

  // Render dynamic watchlist
  renderWatchlist();

  // Timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRange = btn.dataset.range;
      activeInterval = btn.dataset.interval;
      fetchAndRender(activeSymbol, activeRange, activeInterval);
    });
  });

  // Chart type buttons
  document.querySelectorAll('.ct-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ct-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeChartType = btn.dataset.type;
      fetchAndRender(activeSymbol, activeRange, activeInterval);
    });
  });

  // Indicator toggles
  document.querySelectorAll('.ind-toggle input').forEach(cb => {
    cb.addEventListener('change', () => {
      fetchAndRender(activeSymbol, activeRange, activeInterval);
    });
  });


  // Symbol search and autocomplete suggestions
  const input = document.getElementById('symbol-input');
  const btn = document.getElementById('search-btn');
  const suggestionsList = document.getElementById('search-suggestions');

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const val = input.value.trim();
    if (!val) {
      suggestionsList.innerHTML = '';
      suggestionsList.classList.add('hidden');
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(val)}`);
        if (!resp.ok) return;
        const suggestions = await resp.json();
        if (suggestions.length === 0) {
          suggestionsList.innerHTML = '';
          suggestionsList.classList.add('hidden');
          return;
        }
        suggestionsList.innerHTML = suggestions.map(s => `
          <div class="suggestion-item" data-symbol="${s.symbol}" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; cursor: pointer;">
            <div style="display: flex; flex-direction: column; gap: 2px; text-align: left; max-width: 140px;">
              <span class="sym" style="font-weight: 600; color: var(--text);">${s.symbol}</span>
              <span class="name" style="font-size: 10px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.name || ''}</span>
            </div>
            <span class="exch" style="font-size: 10px; color: var(--text-3); font-weight: 500;">${s.exchange || ''}</span>
          </div>
        `).join('');
        suggestionsList.classList.remove('hidden');

        // Click suggestions
        suggestionsList.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            const sym = item.dataset.symbol;
            loadSymbol(sym);
            input.value = '';
            suggestionsList.innerHTML = '';
            suggestionsList.classList.add('hidden');
          });
        });
      } catch (err) {
        console.error('Suggestions error:', err);
      }
    }, 200);
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !suggestionsList.contains(e.target)) {
      suggestionsList.classList.add('hidden');
    }
  });

  const submit = async () => {
    const val = input.value.trim();
    if (!val) return;

    const uppercaseVal = val.toUpperCase();
    if (WATCHLIST_SYMBOLS.includes(uppercaseVal)) {
      loadSymbol(uppercaseVal);
      input.value = '';
      suggestionsList.innerHTML = '';
      suggestionsList.classList.add('hidden');
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(val)}`);
      if (resp.ok) {
        const suggestions = await resp.json();
        if (suggestions && suggestions.length > 0) {
          const bestMatch = suggestions[0].symbol;
          loadSymbol(bestMatch);
        } else {
          loadSymbol(uppercaseVal);
        }
      } else {
        loadSymbol(uppercaseVal);
      }
    } catch {
      loadSymbol(uppercaseVal);
    }

    input.value = '';
    suggestionsList.innerHTML = '';
    suggestionsList.classList.add('hidden');
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });


  // AI Analyst Panel Actions
  const btnAi = document.getElementById('btn-ai-analyze');
  const aiPanel = document.getElementById('ai-analyst-panel');
  const btnCloseAip = document.getElementById('btn-close-aip');
  const aipSymbol = document.getElementById('aip-symbol');
  const aipLoader = aiPanel.querySelector('.aip-loader');
  const aipContent = document.getElementById('aip-content');

  btnCloseAip.addEventListener('click', () => {
    aiPanel.classList.add('hidden');
  });

  btnAi.addEventListener('click', async () => {
    aiPanel.classList.remove('hidden');
    aipSymbol.textContent = activeSymbol;
    aipLoader.style.display = 'flex';
    aipContent.classList.add('hidden');

    try {
      const resp = await fetch(`${API_BASE}/api/insight?symbol=${encodeURIComponent(activeSymbol)}`);
      if (!resp.ok) {
        if (resp.status === 503) {
          throw new Error('AI provider keys are missing on the backend. Please add GROQ_API_KEY or NVIDIA_API_KEY to your .env file to enable live AI analysis.');
        }
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();

      const signalClass = (data.signal || 'Hold').toLowerCase();
      const negativesList = (data.keyRisks || []).map(r => `<li>${r}</li>`).join('');
      const positivesList = (data.keyPositives || []).map(p => `<li>${p}</li>`).join('');

      aipContent.innerHTML = `
        <div class="aip-signal-badge ${signalClass}">
          Signal: ${data.signal || 'Hold'} (Confidence: ${(data.confidence * 100).toFixed(0)}%)
        </div>
        
        <p class="aip-narrative">"${data.summary || 'Analysis complete.'}"</p>

        <div class="aip-grid">
          <div class="aip-box">
            <div class="aip-box-title">🟢 Key Positives</div>
            <ul class="aip-box-list">${positivesList || '<li>No immediate positives reported</li>'}</ul>
          </div>
          <div class="aip-box">
            <div class="aip-box-title">🔴 Key Risks / Concerns</div>
            <ul class="aip-box-list">${negativesList || '<li>No immediate risks reported</li>'}</ul>
          </div>
        </div>

        <div class="aip-grid">
          <div class="aip-box">
            <div class="aip-box-title">📊 Technical Outlook</div>
            <p>${data.technicalOutlook || 'Neutral consolidation.'}</p>
          </div>
          <div class="aip-box">
            <div class="aip-box-title">🏛️ Fundamental Outlook</div>
            <p>${data.fundamentalOutlook || 'Stable overview.'}</p>
          </div>
        </div>

        <div class="aip-model">Engine: ${data.model || 'Groq LLaMA 3.3'}</div>
      `;

      aipLoader.style.display = 'none';
      aipContent.classList.remove('hidden');

    } catch (err) {
      aipLoader.style.display = 'none';
      aipContent.innerHTML = `
        <div style="color: var(--red); font-size: 13px; line-height: 1.5; padding: 10px; border: 1px dashed var(--red); border-radius: 6px; background: rgba(255,69,58,0.05);">
          <strong>Analysis Failed:</strong> ${err.message || err}
        </div>
      `;
      aipContent.classList.remove('hidden');
    }
  });

  // AI Chat tabs & interactive conversation logic
  const tabReport = document.getElementById('tab-report');
  const tabChat = document.getElementById('tab-chat');
  const reportContent = document.getElementById('report-tab-content');
  const chatContent = document.getElementById('chat-tab-content');

  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatMessages = document.getElementById('chat-messages');

  let chatHistory = [];

  tabReport.addEventListener('click', () => {
    tabReport.classList.add('active');
    tabChat.classList.remove('active');
    reportContent.classList.remove('hidden');
    chatContent.classList.add('hidden');
  });

  tabChat.addEventListener('click', () => {
    tabChat.classList.add('active');
    tabReport.classList.remove('active');
    chatContent.classList.remove('hidden');
    reportContent.classList.add('hidden');
    chatInput.focus();
  });

  function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-bubble assistant-msg';
    div.style.borderLeft = '3px solid var(--blue)';
    div.innerHTML = `⚙️ <em>System Action:</em> ${text}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function executeActionCommand(action) {
    if (!action) return;
    
    if (action.loadSymbol) {
      const sym = action.loadSymbol.toUpperCase();
      if (sym !== activeSymbol) {
        loadSymbol(sym);
        addSystemMessage(`Switched active chart to <strong>${sym}</strong>.`);
      }
    }
    
    if (action.toggleIndicator) {
      const ind = action.toggleIndicator.toLowerCase();
      const state = !!action.state;
      const checkboxMap = {
        'rsi': 'toggle-rsi',
        'macd': 'toggle-macd',
        'vol': 'toggle-vol',
        'volume': 'toggle-vol',
        'ema9': 'toggle-ema9',
        'ema21': 'toggle-ema21',
        'sma50': 'toggle-sma50',
        'sma200': 'toggle-sma200',
        'bb': 'toggle-bb',
        'atr': 'toggle-atr',
        'stoch': 'toggle-stoch',
        'stochastic': 'toggle-stoch'
      };
      
      const id = checkboxMap[ind];
      if (id) {
        const el = document.getElementById(id);
        if (el && el.checked !== state) {
          el.checked = state;
          el.dispatchEvent(new Event('change'));
          addSystemMessage(`${state ? 'Enabled' : 'Disabled'} indicator <strong>${el.nextElementSibling.textContent.trim()}</strong>.`);
        }
      }
    }

    if (action.changeChartType) {
      const type = action.changeChartType.toLowerCase();
      const btn = document.querySelector(`.ct-btn[data-type="${type}"]`);
      if (btn && !btn.classList.contains('active')) {
        btn.click();
        addSystemMessage(`Changed chart display to <strong>${type}</strong>.`);
      }
    }
  }

  function renderResponseText(text) {
    let cleanText = text;
    const actionIndex = text.indexOf('ACTION:');
    if (actionIndex !== -1) {
      try {
        const actionJsonStr = text.substring(actionIndex + 7).trim();
        const action = JSON.parse(actionJsonStr);
        setTimeout(() => executeActionCommand(action), 50);
      } catch (err) {
        console.error('Failed to parse action json:', err);
      }
      cleanText = text.substring(0, actionIndex).trim();
    }

    return cleanText
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: var(--bg-surface); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>')
      .replace(/\n/g, '<br>');
  }

  // File attachments and Web Speech API
  const fileInput = document.getElementById('chat-file-input');
  const attachBtn = document.getElementById('chat-attach-btn');
  const attachmentPreview = document.getElementById('chat-attachment-preview');
  const micBtn = document.getElementById('chat-mic-btn');

  let attachedFile = null;

  attachBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    const extension = file.name.split('.').pop().toLowerCase();
    attachedFile = {
      name: file.name,
      type: extension,
      size: file.size,
      content: ''
    };

    if (['csv', 'xml', 'txt', 'json'].includes(extension)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        attachedFile.content = e.target.result;
      };
      reader.readAsText(file);
    } else {
      attachedFile.content = `[Attached Binary/Image File: name=${file.name}, size=${file.size} bytes. Direct data reading is mocked for this file type.]`;
    }

    attachmentPreview.innerHTML = `
      <div class="cap-details">
        📎 <strong>[${extension.toUpperCase()}]</strong> ${file.name} (${(file.size / 1024).toFixed(1)} KB)
      </div>
      <button class="cap-remove" id="btn-remove-attachment">&times;</button>
    `;
    attachmentPreview.classList.remove('hidden');

    document.getElementById('btn-remove-attachment').addEventListener('click', removeAttachment);
  });

  function removeAttachment() {
    attachedFile = null;
    fileInput.value = '';
    attachmentPreview.classList.add('hidden');
    attachmentPreview.innerHTML = '';
  }

  // Web Speech API
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    let isListening = false;

    micBtn.addEventListener('click', () => {
      if (isListening) {
        recognition.stop();
      } else {
        recognition.start();
        micBtn.classList.add('active');
        isListening = true;
        chatInput.placeholder = "Listening...";
      }
    });

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      chatInput.value = (chatInput.value + ' ' + transcript).trim();
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      micBtn.classList.remove('active');
      isListening = false;
      chatInput.placeholder = "Ask AI Analyst / control graph...";
    };

    recognition.onend = () => {
      micBtn.classList.remove('active');
      isListening = false;
      chatInput.placeholder = "Ask AI Analyst / control graph...";
    };
  } else {
    micBtn.style.display = 'none';
  }

  const sendChatMessage = async () => {
    const msg = chatInput.value.trim();
    if (!msg && !attachedFile) return;

    let displayMsg = msg;
    let payloadMsg = msg;

    if (attachedFile) {
      displayMsg = `📎 Attached [${attachedFile.type.toUpperCase()}]: ${attachedFile.name}\n${msg}`;
      payloadMsg = `[User attached file ${attachedFile.name} (Type: ${attachedFile.type}, Size: ${attachedFile.size} bytes)]\nFile Content:\n"""\n${attachedFile.content.substring(0, 15000)}\n"""\n\nUser Message: ${msg}`;
    }

    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user-msg';
    userBubble.innerHTML = displayMsg.replace(/\n/g, '<br>');
    chatMessages.appendChild(userBubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    chatInput.value = '';
    chatInput.disabled = true;
    chatSendBtn.disabled = true;
    if (attachedFile) {
      removeAttachment();
    }

    const activeIndicators = [];
    document.querySelectorAll('.ind-toggle input').forEach(cb => {
      if (cb.checked) {
        activeIndicators.push(cb.id.replace('toggle-', ''));
      }
    });

    const priceText = document.getElementById('sib-price')?.textContent || '—';
    const stdDevText = document.getElementById('sib-stddev')?.textContent || '—';

    const assistantBubble = document.createElement('div');
    assistantBubble.className = 'chat-bubble assistant-msg';
    assistantBubble.innerHTML = `<span style="color: var(--text-3)">Analyzing...</span>`;
    chatMessages.appendChild(assistantBubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const resp = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: activeSymbol,
          message: payloadMsg,
          history: chatHistory.slice(-6),
          chartContext: {
            price: priceText,
            range: activeRange,
            interval: activeInterval,
            indicators: activeIndicators,
            stdDev: stdDevText
          }
        })
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      assistantBubble.innerHTML = renderResponseText(data.response);
      
      chatHistory.push({ role: 'user', content: payloadMsg });
      const actionIndex = data.response.indexOf('ACTION:');
      const cleanResp = actionIndex !== -1 ? data.response.substring(0, actionIndex).trim() : data.response;
      chatHistory.push({ role: 'assistant', content: cleanResp });

    } catch (err) {
      assistantBubble.className = 'chat-bubble system-error';
      assistantBubble.innerHTML = `<strong>Error:</strong> ${err.message || err}`;
    } finally {
      chatInput.disabled = false;
      chatSendBtn.disabled = false;
      chatInput.focus();
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  };

  chatSendBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });

  // ─── Ticker tape & movers ───
  startTickerTape();
  fetchMovers('gainers');
  setInterval(startTickerTape, 12000);

  // Tab listeners for Daily Movers
  const tabGainers = document.getElementById('sidebar-tab-gainers');
  const tabLosers = document.getElementById('sidebar-tab-losers');
  tabGainers.addEventListener('click', () => {
    tabGainers.classList.add('active');
    tabLosers.classList.remove('active');
    fetchMovers('gainers');
  });
  tabLosers.addEventListener('click', () => {
    tabLosers.classList.add('active');
    tabGainers.classList.remove('active');
    fetchMovers('losers');
  });

  // ─── Drawing Tools ───
  const tools = ['select', 'trendline', 'horizontal', 'fib'];
  tools.forEach(tool => {
    const el = document.getElementById(`tool-${tool}`);
    if (el) {
      el.addEventListener('click', () => {
        tools.forEach(t => document.getElementById(`tool-${t}`).classList.remove('active'));
        el.classList.add('active');
        activeDrawingTool = tool;

        const overlay = document.getElementById('drawing-canvas-overlay');
        if (overlay) {
          overlay.style.pointerEvents = (tool === 'select') ? 'none' : 'auto';
        }
      });
    }
  });

  const clearBtn = document.getElementById('tool-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      drawings = [];
      drawAllShapes();
      showToast('Drawings cleared', 'blue');
    });
  }

  // ─── Bar Replay Player ───
  document.getElementById('replay-toggle').addEventListener('click', toggleReplayMode);
  document.getElementById('replay-back').addEventListener('click', stepBackward);
  document.getElementById('replay-forward').addEventListener('click', stepForward);
  document.getElementById('replay-play').addEventListener('click', toggleReplayPlayback);

  // ─── Price Alerts ───
  document.getElementById('alert-add-btn').addEventListener('click', () => {
    const input = document.getElementById('alert-price-input');
    const price = parseFloat(input.value);
    setPriceAlert(price);
    input.value = '';
  });

  // ─── CSV Downloader ───
  document.getElementById('btn-csv-export').addEventListener('click', exportToCSV);

  // Initial load - load chart but do not add to watchlist on start
  loadSymbol('AAPL', '3mo', '1d', false);
  loadWatchlistPrices();
  setInterval(loadWatchlistPrices, 30000);
});
