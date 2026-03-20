from __future__ import annotations

from typing import Any

import yfinance as yf

from marketdata.normalize import normalize_cn_ticker, yfinance_symbol_for_cn_ticker


def fetch_us_candles(symbol: str, period: str) -> Any:
    normalized = str(symbol).strip().upper()
    ticker = yf.Ticker(normalized)
    interval_map = {
        "daily": "1d",
        "weekly": "1wk",
        "monthly": "1mo",
    }
    period_map = {
        "daily": "2y",
        "weekly": "5y",
        "monthly": "10y",
    }
    data = ticker.history(
        period=period_map[period],
        interval=interval_map[period],
        auto_adjust=False,
        actions=False,
    )
    if data is None or getattr(data, "empty", True):
        raise RuntimeError(f"yfinance returned no candle data for {normalized}")
    return data


def fetch_candles(symbol: str, period: str) -> Any:
    normalized = normalize_cn_ticker(symbol)
    ticker = yf.Ticker(yfinance_symbol_for_cn_ticker(normalized))
    interval_map = {
        "daily": "1d",
        "weekly": "1wk",
        "monthly": "1mo",
    }
    period_map = {
        "daily": "2y",
        "weekly": "5y",
        "monthly": "10y",
    }
    data = ticker.history(
        period=period_map[period],
        interval=interval_map[period],
        auto_adjust=False,
        actions=False,
    )
    if data is None or getattr(data, "empty", True):
        raise RuntimeError(f"yfinance returned no candle data for {normalized}")
    return data


def fetch_quote(symbol: str) -> dict[str, Any]:
    normalized = normalize_cn_ticker(symbol)
    ticker = yf.Ticker(yfinance_symbol_for_cn_ticker(normalized))
    data = ticker.history(period="5d", interval="1d", auto_adjust=False, actions=False)
    if data is None or getattr(data, "empty", True):
        raise RuntimeError(f"yfinance returned no quote data for {normalized}")

    latest = data.iloc[-1]
    prev = data.iloc[-2] if len(data) > 1 else None
    prev_close = float(prev["Close"]) if prev is not None else None
    last_price = float(latest["Close"])
    change = last_price - prev_close if prev_close is not None else None
    change_pct = ((change / prev_close) * 100) if prev_close not in (None, 0) and change is not None else None
    return {
        "ticker": normalized,
        "name": normalized,
        "last_price": last_price,
        "change": change,
        "change_pct": change_pct,
        "open": float(latest["Open"]),
        "high": float(latest["High"]),
        "low": float(latest["Low"]),
        "prev_close": prev_close,
        "volume": float(latest["Volume"]),
        "amount": None,
        "turnover_rate": None,
    }
