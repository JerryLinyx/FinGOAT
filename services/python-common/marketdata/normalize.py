from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
from typing import Any


def _import_pandas():
    import pandas as pd

    return pd


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


US_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


def normalize_market(value: str | None) -> str:
    return "cn" if str(value or "").strip().lower() == "cn" else "us"


def normalize_us_ticker(ticker: str) -> str:
    normalized = str(ticker).strip().upper()
    if not US_TICKER_RE.match(normalized):
        raise ValueError("US ticker must be 1-10 characters (letters, digits, dots, hyphens)")
    return normalized


def normalize_ticker_for_market(ticker: str, market: str) -> str:
    normalized_market = normalize_market(market)
    if normalized_market == "cn":
        return normalize_cn_ticker(ticker)
    return normalize_us_ticker(ticker)


def normalize_cn_ticker(ticker: str) -> str:
    normalized = str(ticker).strip()
    if len(normalized) != 6 or not normalized.isdigit():
        raise ValueError("A-share ticker must be a 6-digit stock code")
    if normalized.startswith("8"):
        raise ValueError("Beijing Stock Exchange tickers are not supported in v1")
    if normalized.startswith(("600", "601", "603", "605", "688")):
        return normalized
    if normalized.startswith(("000", "001", "002", "003", "300")):
        return normalized
    raise ValueError(f"Unsupported A-share ticker: {normalized}")


def market_code_for_cn_ticker(ticker: str) -> int:
    symbol = normalize_cn_ticker(ticker)
    return 1 if symbol.startswith(("600", "601", "603", "605", "688")) else 0


def yfinance_symbol_for_cn_ticker(ticker: str) -> str:
    symbol = normalize_cn_ticker(ticker)
    return f"{symbol}.SS" if symbol.startswith(("600", "601", "603", "605", "688")) else f"{symbol}.SZ"


def date_to_compact(value: str) -> str:
    return datetime.strptime(value, "%Y-%m-%d").strftime("%Y%m%d")


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if hasattr(value, "item"):
            value = value.item()
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result:
        return None
    return result


def stringify_value(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, float):
        return f"{value:,.2f}"
    return str(value)


def date_key(value: Any) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)


def range_to_daily_lookback(range_param: str) -> tuple[int, int]:
    normalized = str(range_param).strip().lower()
    if normalized == "5d":
        return 10, 5
    if normalized == "1m":
        return 45, 23
    if normalized == "6m":
        return 200, 126
    if normalized == "1y":
        return 420, 260
    if normalized == "5y":
        return 365 * 6, 360
    return 120, 66


def terminal_period_spec(period: str) -> tuple[str, int, int]:
    normalized = str(period).strip().lower()
    if normalized == "month":
        return "monthly", 365 * 10 + 45, 120
    if normalized == "week":
        return "weekly", 365 * 3 + 30, 156
    return "daily", 365 + 45, 240


def chart_range_window(range_param: str) -> tuple[str, str, str, int]:
    now = datetime.now()
    lookback_days, max_rows = range_to_daily_lookback(range_param)
    return (
        "daily",
        (now - timedelta(days=lookback_days)).strftime("%Y-%m-%d"),
        now.strftime("%Y-%m-%d"),
        max_rows,
    )


def alpha_vantage_chart_config(range_param: str) -> dict[str, str]:
    normalized = str(range_param).strip().lower()
    if normalized == "1y":
        return {
            "function": "TIME_SERIES_WEEKLY_ADJUSTED",
            "series_key": "Weekly Adjusted Time Series",
            "volume_field": "6. volume",
            "outputsize": "compact",
        }
    if normalized == "5y":
        return {
            "function": "TIME_SERIES_MONTHLY_ADJUSTED",
            "series_key": "Monthly Adjusted Time Series",
            "volume_field": "6. volume",
            "outputsize": "compact",
        }
    return {
        "function": "TIME_SERIES_DAILY",
        "series_key": "Time Series (Daily)",
        "volume_field": "5. volume",
        "outputsize": "compact",
    }


def alpha_vantage_terminal_config(period: str) -> dict[str, str]:
    normalized = str(period).strip().lower()
    if normalized == "month":
        return {
            "function": "TIME_SERIES_MONTHLY_ADJUSTED",
            "series_key": "Monthly Adjusted Time Series",
            "volume_field": "6. volume",
            "outputsize": "compact",
        }
    if normalized == "week":
        return {
            "function": "TIME_SERIES_WEEKLY_ADJUSTED",
            "series_key": "Weekly Adjusted Time Series",
            "volume_field": "6. volume",
            "outputsize": "compact",
        }
    return {
        "function": "TIME_SERIES_DAILY",
        "series_key": "Time Series (Daily)",
        "volume_field": "5. volume",
        "outputsize": "full",
    }


def normalize_hist_dataframe(df: Any) -> Any:
    pd = _import_pandas()

    if df is None or getattr(df, "empty", True):
        return pd.DataFrame(columns=["Date", "Open", "Close", "High", "Low", "Volume", "Turnover", "PctChange", "Change", "TurnoverRate"])

    renamed = df.copy()
    if "Date" not in renamed.columns and "日期" not in renamed.columns and "时间" not in renamed.columns:
        index_name = getattr(renamed.index, "name", None)
        if index_name == "Date" or str(getattr(renamed.index, "dtype", "")).startswith("datetime64") or "datetime" in str(type(renamed.index)).lower():
            renamed = renamed.reset_index()
            first_column = renamed.columns[0]
            if first_column != "Date":
                renamed = renamed.rename(columns={first_column: "Date"})

    renamed = renamed.rename(
        columns={
            "日期": "Date",
            "时间": "Date",
            "开盘": "Open",
            "收盘": "Close",
            "最高": "High",
            "最低": "Low",
            "成交量": "Volume",
            "成交额": "Turnover",
            "涨跌幅": "PctChange",
            "涨跌额": "Change",
            "换手率": "TurnoverRate",
        }
    ).copy()
    renamed["Date"] = pd.to_datetime(renamed["Date"], errors="coerce")
    for col in ("Open", "Close", "High", "Low", "Volume", "Turnover", "PctChange", "Change", "TurnoverRate"):
        if col in renamed.columns:
            renamed[col] = pd.to_numeric(renamed[col], errors="coerce")
    renamed = renamed.dropna(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    return renamed


def build_chart_points(df: Any) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    points = []
    for _, row in df.iterrows():
        points.append(
            {
                "date": date_key(row["Date"]),
                "open": float(row.get("Open", 0) or 0),
                "high": float(row.get("High", 0) or 0),
                "low": float(row.get("Low", 0) or 0),
                "close": float(row.get("Close", 0) or 0),
                "volume": float(row.get("Volume", 0) or 0),
            }
        )
    return points


def build_chart_points_from_alpha_vantage(payload: dict[str, Any], series_key: str, volume_field: str, cutoff_date: str | None = None) -> list[dict[str, Any]]:
    series_map = payload.get(series_key)
    if not isinstance(series_map, dict):
        raise RuntimeError("unexpected Alpha Vantage response format")

    points: list[dict[str, Any]] = []
    for date_str, values in series_map.items():
        if cutoff_date and str(date_str) < cutoff_date:
            continue
        if not isinstance(values, dict):
            continue
        points.append(
            {
                "date": str(date_str),
                "open": float(values.get("1. open", 0) or 0),
                "high": float(values.get("2. high", 0) or 0),
                "low": float(values.get("3. low", 0) or 0),
                "close": float(values.get("4. close", 0) or 0),
                "volume": float(values.get(volume_field, 0) or 0),
            }
        )

    points.sort(key=lambda point: point["date"])
    return points


def candles_to_dataframe(points: list[dict[str, Any]]) -> Any:
    pd = _import_pandas()
    if not points:
        return pd.DataFrame(columns=["Date", "Open", "High", "Low", "Close", "Volume"])
    df = pd.DataFrame(points).copy()
    df["Date"] = pd.to_datetime(df["date"], errors="coerce")
    df["Open"] = pd.to_numeric(df["open"], errors="coerce")
    df["High"] = pd.to_numeric(df["high"], errors="coerce")
    df["Low"] = pd.to_numeric(df["low"], errors="coerce")
    df["Close"] = pd.to_numeric(df["close"], errors="coerce")
    df["Volume"] = pd.to_numeric(df["volume"], errors="coerce")
    return df[["Date", "Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Date"]).reset_index(drop=True)


def _build_sparse_series(df: Any, value_column: str) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True) or value_column not in df.columns:
        return []

    points: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        numeric = safe_float(row.get(value_column))
        if numeric is None:
            continue
        points.append({"date": date_key(row["Date"]), "value": round(numeric, 4)})
    return points


def build_indicator_payload(df: Any) -> dict[str, Any]:
    pd = _import_pandas()
    if df is None or getattr(df, "empty", True):
        return {
            "ma": {"ma5": [], "ma10": [], "ma20": [], "ma60": []},
            "macd": {"dif": [], "dea": [], "hist": []},
        }

    indicator_df = df[["Date", "Close", "Volume"]].copy()
    indicator_df["Close"] = pd.to_numeric(indicator_df["Close"], errors="coerce")
    indicator_df["ma5"] = indicator_df["Close"].rolling(window=5).mean()
    indicator_df["ma10"] = indicator_df["Close"].rolling(window=10).mean()
    indicator_df["ma20"] = indicator_df["Close"].rolling(window=20).mean()
    indicator_df["ma60"] = indicator_df["Close"].rolling(window=60).mean()

    ema12 = indicator_df["Close"].ewm(span=12, adjust=False).mean()
    ema26 = indicator_df["Close"].ewm(span=26, adjust=False).mean()
    indicator_df["dif"] = ema12 - ema26
    indicator_df["dea"] = indicator_df["dif"].ewm(span=9, adjust=False).mean()
    indicator_df["hist"] = (indicator_df["dif"] - indicator_df["dea"]) * 2

    macd_df = indicator_df.iloc[25:].copy().reset_index(drop=True)

    return {
        "ma": {
            "ma5": _build_sparse_series(indicator_df, "ma5"),
            "ma10": _build_sparse_series(indicator_df, "ma10"),
            "ma20": _build_sparse_series(indicator_df, "ma20"),
            "ma60": _build_sparse_series(indicator_df, "ma60"),
        },
        "macd": {
            "dif": _build_sparse_series(macd_df, "dif"),
            "dea": _build_sparse_series(macd_df, "dea"),
            "hist": _build_sparse_series(macd_df, "hist"),
        },
    }


def quote_from_akshare_dataframe(df: Any, ticker: str) -> dict[str, Any]:
    symbol = normalize_cn_ticker(ticker)
    if df is None or getattr(df, "empty", True):
        raise RuntimeError("A-share realtime quote feed returned no data")
    row = df[df["代码"].astype(str) == symbol]
    if row.empty:
        raise ValueError(f"No realtime quote found for A-share ticker {symbol}")
    item = row.iloc[0]
    return {
        "ticker": symbol,
        "name": str(item.get("名称", symbol)),
        "last_price": safe_float(item.get("最新价")),
        "change": safe_float(item.get("涨跌额")),
        "change_pct": safe_float(item.get("涨跌幅")),
        "open": safe_float(item.get("今开")),
        "high": safe_float(item.get("最高")),
        "low": safe_float(item.get("最低")),
        "prev_close": safe_float(item.get("昨收")),
        "volume": safe_float(item.get("成交量")),
        "amount": safe_float(item.get("成交额")),
        "turnover_rate": safe_float(item.get("换手率")),
        "amplitude": safe_float(item.get("振幅")),
        "volume_ratio": safe_float(item.get("量比")),
        "pe_dynamic": safe_float(item.get("市盈率-动态")),
        "pb": safe_float(item.get("市净率")),
        "total_market_cap": safe_float(item.get("总市值")),
        "circulating_market_cap": safe_float(item.get("流通市值")),
        "speed": safe_float(item.get("涨速")),
        "pct_60d": safe_float(item.get("60日涨跌幅")),
        "pct_ytd": safe_float(item.get("年初至今涨跌幅")),
    }


def quote_from_eastmoney_payload(payload: dict[str, Any], ticker: str) -> dict[str, Any]:
    data = payload.get("data") or {}
    symbol = normalize_cn_ticker(ticker)
    if not data:
        raise RuntimeError("EastMoney quote feed returned no data")
    return {
        "ticker": symbol,
        "name": str(data.get("f58") or symbol),
        "last_price": safe_float(data.get("f43")),
        "change": safe_float(data.get("f169")),
        "change_pct": safe_float(data.get("f170")),
        "open": safe_float(data.get("f46")),
        "high": safe_float(data.get("f44")),
        "low": safe_float(data.get("f45")),
        "prev_close": safe_float(data.get("f60")),
        "volume": safe_float(data.get("f47")),
        "amount": safe_float(data.get("f48")),
        "turnover_rate": safe_float(data.get("f168")),
        "amplitude": safe_float(data.get("f171")),
        "volume_ratio": safe_float(data.get("f50")),
        "pe_dynamic": safe_float(data.get("f162")),
        "pb": safe_float(data.get("f167")),
        "total_market_cap": safe_float(data.get("f116")),
        "circulating_market_cap": safe_float(data.get("f117")),
        "speed": safe_float(data.get("f22")),
        "pct_60d": safe_float(data.get("f24")),
        "pct_ytd": safe_float(data.get("f25")),
    }


def metrics_from_company_info_df(df: Any) -> list[dict[str, str]]:
    if df is None or getattr(df, "empty", True):
        return []
    values = {str(row.get("item", "")).strip(): row.get("value") for _, row in df.iterrows()}
    desired_items = [
        ("行业", "行业"),
        ("总市值", "总市值"),
        ("流通市值", "流通市值"),
        ("总股本", "总股本"),
        ("流通股", "流通股"),
        ("上市时间", "上市时间"),
    ]
    metrics = []
    for label, key in desired_items:
        if key not in values:
            continue
        metrics.append({"label": label, "value": stringify_value(values[key])})
    return metrics


def notices_from_dataframe(df: Any, limit: int = 6) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    notices = []
    for _, row in df.head(limit).iterrows():
        notices.append(
            {
                "title": str(row.get("公告标题", "")).strip(),
                "date": stringify_value(row.get("公告日期")),
                "type": str(row.get("公告类型", "")).strip() or None,
                "source": "EastMoney",
                "url": str(row.get("网址", "")).strip() or None,
            }
        )
    return notices


def analysis_csv_from_dataframe(symbol: str, start_date: str, end_date: str, data: Any) -> str:
    if data is None or getattr(data, "empty", True):
        return f"No data found for symbol '{symbol}' between {start_date} and {end_date}"

    output = data.copy()
    output["Date"] = output["Date"].dt.strftime("%Y-%m-%d")
    for col in ("Open", "High", "Low", "Close"):
        if col in output.columns:
            output[col] = output[col].round(2)

    preferred_columns = ["Date", "Open", "High", "Low", "Close", "Volume", "Turnover", "PctChange", "Change", "TurnoverRate"]
    selected = [col for col in preferred_columns if col in output.columns]
    csv_string = output[selected].to_csv(index=False)
    header = f"# Stock data for {symbol} from {start_date} to {end_date}\n"
    header += f"# Total records: {len(output)}\n"
    header += f"# Data retrieved on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    return header + csv_string
