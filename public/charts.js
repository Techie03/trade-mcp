// ─── Trade MCP Live Charts — charts.js ──────────────────────────────────────
// Uses TradingView Lightweight Charts v4 (loaded via CDN in charts.html)
// All indicator math computed client-side (no extra library needed)

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
  ? window.location.origin
  : 'https://nishith374-stock-mcp.hf.space';

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
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    [mainChart, volChart, rsiChart, macdChart].forEach(c => {
      const el = c.chartElement();
      if (el && el.parentElement) {
        c.resize(el.parentElement.clientWidth, el.parentElement.clientHeight);
      }
    });
  });
  document.querySelectorAll('.chart-pane').forEach(el => ro.observe(el));
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
  const fmt = (n, dec = 2, prefix = '') => n != null ? prefix + Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—';
  const fmtVol = (n) => n > 1e9 ? (n/1e9).toFixed(2)+'B' : n > 1e6 ? (n/1e6).toFixed(2)+'M' : n > 1e3 ? (n/1e3).toFixed(1)+'K' : String(n ?? '—');

  document.getElementById('sib-symbol').textContent = q.symbol || activeSymbol;
  document.getElementById('sib-name').textContent = q.name || '';
  document.getElementById('sib-price').textContent = fmt(q.price);
  const changeEl = document.getElementById('sib-change');
  const pct = q.changePercent?.toFixed(2);
  changeEl.textContent = `${q.change >= 0 ? '+' : ''}${fmt(q.change)} (${q.change >= 0 ? '+' : ''}${pct}%)`;
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

const WATCHLIST = [];
const WATCHLIST_SYMBOLS = [];

function renderWatchlist() {
  const wlContainer = document.getElementById('watchlist');
  if (!wlContainer) return;
  wlContainer.innerHTML = WATCHLIST.map(item => `
    <div class="watchlist-item ${item.symbol === activeSymbol ? 'active' : ''}" data-symbol="${item.symbol}">
      <div class="wi-symbol">${item.symbol.replace('.NS', '').replace('-USD', '').replace('=X', '').replace('^', '')}</div>
      <div class="wi-name">${item.name}</div>
      <div class="wi-price" id="wl-${item.symbol}">—</div>
      <div class="wi-change" id="wl-ch-${item.symbol}">—</div>
    </div>
  `).join('');

  // Bind click event listeners to new watchlist elements
  wlContainer.querySelectorAll('.watchlist-item').forEach(item => {
    item.addEventListener('click', () => {
      loadSymbol(item.dataset.symbol);
    });
  });
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
        const oldPrice = parseFloat(priceEl.textContent.replace(/,/g, ''));
        const newPrice = q.price;
        if (!isNaN(oldPrice) && newPrice !== oldPrice && q.symbol !== activeSymbol) {
          const wlItem = document.querySelector(`.watchlist-item[data-symbol="${q.symbol}"]`);
          if (wlItem) {
            wlItem.classList.remove('flash-green-bg', 'flash-red-bg');
            void wlItem.offsetWidth;
            wlItem.classList.add(newPrice > oldPrice ? 'flash-green-bg' : 'flash-red-bg');
          }
        }
        priceEl.textContent = q.price != null ? q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
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
        const oldWlPrice = parseFloat(wlPriceEl.textContent.replace(/,/g, ''));
        if (!isNaN(oldWlPrice) && newPrice !== oldWlPrice) {
          const wlItem = document.querySelector(`.watchlist-item[data-symbol="${symbol}"]`);
          if (wlItem) {
            wlItem.classList.remove('flash-green-bg', 'flash-red-bg');
            void wlItem.offsetWidth;
            wlItem.classList.add(newPrice > oldWlPrice ? 'flash-green-bg' : 'flash-red-bg');
          }
        }
        wlPriceEl.textContent = newPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const sendChatMessage = async () => {
    const msg = chatInput.value.trim();
    if (!msg) return;

    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user-msg';
    userBubble.textContent = msg;
    chatMessages.appendChild(userBubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    chatInput.value = '';
    chatInput.disabled = true;
    chatSendBtn.disabled = true;

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
          message: msg,
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
      
      chatHistory.push({ role: 'user', content: msg });
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

  // Initial load - load chart but do not add to watchlist on start
  loadSymbol('AAPL', '3mo', '1d', false);
  loadWatchlistPrices();
  setInterval(loadWatchlistPrices, 30000);
});
