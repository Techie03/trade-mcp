import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

def calculate_rsi(prices, period=14):
    """
    Calculate Relative Strength Index (RSI) for a series of prices.
    """
    if len(prices) < period:
        return pd.Series(np.nan, index=prices.index if hasattr(prices, 'index') else range(len(prices)))
    
    delta = prices.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def calculate_macd(prices, slow=26, fast=12, signal=9):
    """
    Calculate MACD, Signal line, and MACD Histogram.
    """
    exp1 = prices.ewm(span=fast, adjust=False).mean()
    exp2 = prices.ewm(span=slow, adjust=False).mean()
    macd = exp1 - exp2
    signal_line = macd.ewm(span=signal, adjust=False).mean()
    histogram = macd - signal_line
    return pd.DataFrame({
        'MACD': macd,
        'Signal': signal_line,
        'Histogram': histogram
    })

def plot_stock_chart(df, symbol, filename="stock_chart.png"):
    """
    Generate a double-subplot chart (Price + Volume) for a stock dataframe.
    Expects df to have: 'Close', 'Volume' (and optionally 'Open', 'High', 'Low').
    Index should be datetime or dates.
    """
    plt.style.use('ggplot')
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), sharex=True, 
                                   gridspec_kw={'height_ratios': [3, 1]})
    
    # Plot Close Price
    ax1.plot(df.index, df['Close'], label='Close Price', color='#2b5c8f', linewidth=2)
    if 'Open' in df.columns:
        # Subtle moving average if available
        ma = df['Close'].rolling(window=15).mean()
        ax1.plot(df.index, ma, label='15-day SMA', color='#e05a47', linestyle='--')
        
    ax1.set_title(f"{symbol} Stock Performance Analysis", fontsize=16, fontweight='bold', pad=15)
    ax1.set_ylabel("Price ($ / ₹)", fontsize=12)
    ax1.legend(loc='upper left', frameon=True)
    ax1.grid(True, linestyle=':', alpha=0.6)

    # Plot Volume
    color = np.where(df['Close'].diff() >= 0, '#26a69a', '#ef5350') # Green if gain, Red if loss
    ax2.bar(df.index, df['Volume'], color=color, alpha=0.8, width=0.6)
    ax2.set_ylabel("Volume", fontsize=12)
    ax2.set_xlabel("Date", fontsize=12)
    ax2.grid(True, linestyle=':', alpha=0.6)

    # Adjust layout and save
    plt.tight_layout()
    plt.savefig(filename, dpi=300)
    plt.close()
    print(f"Chart saved successfully as {filename}")

def optimize_portfolio(returns_df, risk_free_rate=0.05):
    """
    Finds maximum Sharpe ratio weights for a given DataFrame of stock returns.
    """
    mean_returns = returns_df.mean() * 252
    cov_matrix = returns_df.cov() * 252
    num_assets = len(returns_df.columns)
    
    # Monte Carlo simulation for portfolio optimization
    num_portfolios = 5000
    results = np.zeros((3, num_portfolios))
    weights_record = []
    
    for i in range(num_portfolios):
        weights = np.random.random(num_assets)
        weights /= np.sum(weights)
        weights_record.append(weights)
        
        portfolio_return = np.sum(weights * mean_returns)
        portfolio_stddev = np.sqrt(np.dot(weights.T, np.dot(cov_matrix, weights)))
        
        results[0,i] = portfolio_return
        results[1,i] = portfolio_stddev
        results[2,i] = (portfolio_return - risk_free_rate) / portfolio_stddev # Sharpe Ratio
        
    max_sharpe_idx = np.argmax(results[2])
    best_return = results[0, max_sharpe_idx]
    best_volatility = results[1, max_sharpe_idx]
    best_sharpe = results[2, max_sharpe_idx]
    best_weights = weights_record[max_sharpe_idx]
    
    assets_weights = {returns_df.columns[j]: float(best_weights[j]) for j in range(num_assets)}
    
    return {
        'weights': assets_weights,
        'annualized_return': float(best_return),
        'annualized_volatility': float(best_volatility),
        'sharpe_ratio': float(best_sharpe)
    }
