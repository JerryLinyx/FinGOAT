from __future__ import annotations

from datetime import datetime, timedelta
from time import sleep
from typing import Any

from .google import get_google_news


def _import_pandas():
    import pandas as pd

    return pd


def _normalize_cn_ticker(ticker: str) -> str:
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


def _to_secu_code(ticker: str) -> str:
    symbol = _normalize_cn_ticker(ticker)
    exchange = "SH" if symbol.startswith(("600", "601", "603", "605", "688")) else "SZ"
    return f"{exchange}{symbol}"


def _date_to_compact(value: str) -> str:
    return datetime.strptime(value, "%Y-%m-%d").strftime("%Y%m%d")


def _format_dataframe_preview(title: str, df: Any, max_rows: int = 8) -> str:
    if df is None or getattr(df, "empty", True):
        return f"{title}\n\nNo data available."
    preview = df.head(max_rows).to_csv(index=False)
    return f"{title}\n\n{preview}"


def _is_temporary_upstream_error(exc: Exception) -> bool:
    lowered = str(exc).lower()
    return (
        "connection aborted" in lowered
        or "remote end closed connection without response" in lowered
        or "read timed out" in lowered
        or "temporarily unavailable" in lowered
        or "chunkedencodingerror" in lowered
        or "connection reset by peer" in lowered
        or "max retries exceeded" in lowered
    )


def _fetch_hist_df(ticker: str, start_date: str, end_date: str, period: str = "daily"):
    pd = _import_pandas()
    from akshare.stock_feature.stock_hist_em import stock_zh_a_hist
    from requests.exceptions import ConnectionError as RequestsConnectionError
    from requests.exceptions import ReadTimeout, ChunkedEncodingError

    symbol = _normalize_cn_ticker(ticker)
    last_error: Exception | None = None
    df = None
    for attempt in range(5):
        try:
            df = stock_zh_a_hist(
                symbol=symbol,
                period=period,
                start_date=_date_to_compact(start_date),
                end_date=_date_to_compact(end_date),
                adjust="",
                timeout=12,
            )
            last_error = None
            break
        except (RequestsConnectionError, ReadTimeout, ChunkedEncodingError) as exc:
            last_error = exc
            if attempt < 4:
                sleep(0.45 * (attempt + 1))
                continue
        except Exception as exc:
            if _is_temporary_upstream_error(exc):
                last_error = exc
                if attempt < 4:
                    sleep(0.45 * (attempt + 1))
                    continue
            raise

    if last_error is not None:
        raise RuntimeError(f"temporary upstream connection failure: {last_error}") from last_error
    if df is None or df.empty:
        return pd.DataFrame()

    renamed = df.rename(
        columns={
            "日期": "Date",
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
    renamed["Adj Close"] = renamed["Close"]
    renamed = renamed.dropna(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    return renamed


def _load_realtime_spot_df():
    from akshare.stock_feature.stock_hist_em import stock_zh_a_spot_em
    return stock_zh_a_spot_em()


def _stringify_hist_data(symbol: str, start_date: str, end_date: str, data: Any) -> str:
    if data is None or getattr(data, "empty", True):
        return f"No data found for symbol '{symbol}' between {start_date} and {end_date}"

    output = data.copy()
    output["Date"] = output["Date"].dt.strftime("%Y-%m-%d")
    for col in ("Open", "High", "Low", "Close", "Adj Close"):
        if col in output.columns:
            output[col] = output[col].round(2)

    preferred_columns = [
        "Date",
        "Open",
        "High",
        "Low",
        "Close",
        "Adj Close",
        "Volume",
        "Turnover",
        "PctChange",
        "Change",
        "TurnoverRate",
    ]
    selected = [col for col in preferred_columns if col in output.columns]
    csv_string = output[selected].to_csv(index=False)
    header = f"# Stock data for {symbol} from {start_date} to {end_date}\n"
    header += f"# Total records: {len(output)}\n"
    header += f"# Data retrieved on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    return header + csv_string


def _terminal_period_spec(period: str) -> tuple[str, int, int]:
    normalized = str(period).strip().lower()
    if normalized == "month":
        return "monthly", 365 * 10 + 45, 120
    if normalized == "week":
        return "weekly", 365 * 3 + 30, 156
    return "daily", 365 + 45, 240


def _tail_hist_df_for_terminal(ticker: str, period: str):
    fetch_period, lookback_days, max_rows = _terminal_period_spec(period)
    now = datetime.now()
    start_date = (now - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    df = _fetch_hist_df(ticker, start_date, now.strftime("%Y-%m-%d"), period=fetch_period)
    if df.empty:
        return df
    return df.tail(max_rows).reset_index(drop=True)


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if hasattr(value, "item"):
            value = value.item()
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result:  # NaN
        return None
    return result


def _stringify_value(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, float):
        return f"{value:,.2f}"
    return str(value)


def _date_key(value: Any) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _build_sparse_series(df: Any, value_column: str) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True) or value_column not in df.columns:
        return []

    points: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        numeric = _safe_float(row.get(value_column))
        if numeric is None:
            continue
        points.append(
            {
                "date": _date_key(row["Date"]),
                "value": round(numeric, 4),
            }
        )
    return points


def _build_terminal_chart_from_df(df: Any) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []

    result = []
    for _, row in df.iterrows():
        result.append(
            {
                "date": _date_key(row["Date"]),
                "open": float(row.get("Open", 0) or 0),
                "high": float(row.get("High", 0) or 0),
                "low": float(row.get("Low", 0) or 0),
                "close": float(row.get("Close", 0) or 0),
                "volume": float(row.get("Volume", 0) or 0),
            }
        )
    return result


def _build_terminal_indicators_from_df(df: Any) -> dict[str, Any]:
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


def get_stock_data_akshare(ticker: str, start_date: str, end_date: str) -> str:
    try:
        symbol = _normalize_cn_ticker(ticker)
        data = _fetch_hist_df(symbol, start_date, end_date, period="daily")
        return _stringify_hist_data(symbol, start_date, end_date, data)
    except Exception as exc:
        return f"Failed to retrieve A-share stock data for {ticker}: {exc}"


def get_terminal_chart_data_akshare(ticker: str, period: str) -> list[dict[str, Any]]:
    symbol = _normalize_cn_ticker(ticker)
    df = _tail_hist_df_for_terminal(symbol, period)
    return _build_terminal_chart_from_df(df)


def get_terminal_indicators_akshare(ticker: str, period: str) -> dict[str, Any]:
    symbol = _normalize_cn_ticker(ticker)
    df = _tail_hist_df_for_terminal(symbol, period)
    return _build_terminal_indicators_from_df(df)


def get_terminal_snapshot_akshare(ticker: str, period: str) -> dict[str, Any]:
    symbol = _normalize_cn_ticker(ticker)
    df = _tail_hist_df_for_terminal(symbol, period)
    return {
        "chart": _build_terminal_chart_from_df(df),
        "indicators": _build_terminal_indicators_from_df(df),
    }


def get_realtime_quote_akshare(ticker: str) -> dict[str, Any]:
    from requests.exceptions import ConnectionError as RequestsConnectionError
    from requests.exceptions import ReadTimeout, ChunkedEncodingError

    symbol = _normalize_cn_ticker(ticker)
    last_error: Exception | None = None
    df = None
    for attempt in range(5):
        try:
            df = _load_realtime_spot_df()
            last_error = None
            break
        except (RequestsConnectionError, ReadTimeout, ChunkedEncodingError) as exc:
            last_error = exc
            if attempt < 4:
                sleep(0.45 * (attempt + 1))
                continue
        except Exception as exc:
            if _is_temporary_upstream_error(exc):
                last_error = exc
                if attempt < 4:
                    sleep(0.45 * (attempt + 1))
                    continue
            raise

    if last_error is not None:
        raise RuntimeError(f"temporary upstream connection failure: {last_error}") from last_error
    if df is None or df.empty:
        raise RuntimeError("A-share realtime quote feed returned no data")

    row = df[df["代码"].astype(str) == symbol]
    if row.empty:
        raise ValueError(f"No realtime quote found for A-share ticker {symbol}")

    item = row.iloc[0]
    return {
        "ticker": symbol,
        "name": str(item.get("名称", symbol)),
        "last_price": _safe_float(item.get("最新价")),
        "change": _safe_float(item.get("涨跌额")),
        "change_pct": _safe_float(item.get("涨跌幅")),
        "open": _safe_float(item.get("今开")),
        "high": _safe_float(item.get("最高")),
        "low": _safe_float(item.get("最低")),
        "prev_close": _safe_float(item.get("昨收")),
        "volume": _safe_float(item.get("成交量")),
        "amount": _safe_float(item.get("成交额")),
        "turnover_rate": _safe_float(item.get("换手率")),
        "amplitude": _safe_float(item.get("振幅")),
        "volume_ratio": _safe_float(item.get("量比")),
        "pe_dynamic": _safe_float(item.get("市盈率-动态")),
        "pb": _safe_float(item.get("市净率")),
        "total_market_cap": _safe_float(item.get("总市值")),
        "circulating_market_cap": _safe_float(item.get("流通市值")),
        "speed": _safe_float(item.get("涨速")),
        "pct_60d": _safe_float(item.get("60日涨跌幅")),
        "pct_ytd": _safe_float(item.get("年初至今涨跌幅")),
    }


def get_terminal_metrics_akshare(ticker: str) -> list[dict[str, str]]:
    try:
        from akshare.stock.stock_info_em import stock_individual_info_em

        symbol = _normalize_cn_ticker(ticker)
        info_df = stock_individual_info_em(symbol=symbol)
        if info_df is None or info_df.empty:
            return []

        values = {
            str(row.get("item", "")).strip(): row.get("value")
            for _, row in info_df.iterrows()
        }
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
            metrics.append({"label": label, "value": _stringify_value(values[key])})
        return metrics
    except Exception:
        return []


def get_terminal_notices_akshare(ticker: str, limit: int = 6) -> list[dict[str, Any]]:
    pd = _import_pandas()
    from akshare.stock_fundamental.stock_notice import stock_notice_report

    symbol = _normalize_cn_ticker(ticker)
    end_dt = datetime.now()
    frames = []
    for offset in range(10):
        current = end_dt - timedelta(days=offset)
        daily_df = stock_notice_report(symbol="全部", date=current.strftime("%Y%m%d"))
        if daily_df is None or daily_df.empty:
            continue
        filtered = daily_df[daily_df["代码"].astype(str) == symbol].copy()
        if not filtered.empty:
            frames.append(filtered)

    if not frames:
        return []

    combined = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["代码", "公告标题", "公告日期", "网址"])
    combined = combined.sort_values(by="公告日期", ascending=False, ignore_index=True).head(limit)
    notices = []
    for _, row in combined.iterrows():
        notices.append(
            {
                "title": str(row.get("公告标题", "")).strip(),
                "date": _stringify_value(row.get("公告日期")),
                "type": str(row.get("公告类型", "")).strip() or None,
                "source": "EastMoney",
                "url": str(row.get("网址", "")).strip() or None,
            }
        )
    return notices


def get_indicators_akshare(
    ticker: str,
    indicator: str,
    curr_date: str,
    look_back_days: int,
) -> str:
    indicator_descriptions = {
        "close_50_sma": "50 SMA: A medium-term trend indicator.",
        "close_200_sma": "200 SMA: A long-term trend benchmark.",
        "close_10_ema": "10 EMA: A responsive short-term average.",
        "macd": "MACD: Computes momentum via differences of EMAs.",
        "macds": "MACD Signal: An EMA smoothing of the MACD line.",
        "macdh": "MACD Histogram: Shows the gap between the MACD line and its signal.",
        "rsi": "RSI: Measures momentum to flag overbought/oversold conditions.",
        "boll": "Bollinger Middle: A 20 SMA serving as the basis for Bollinger Bands.",
        "boll_ub": "Bollinger Upper Band: Typically 2 standard deviations above the middle line.",
        "boll_lb": "Bollinger Lower Band: Typically 2 standard deviations below the middle line.",
        "atr": "ATR: Measures volatility using true range.",
        "vwma": "VWMA: A moving average weighted by volume.",
        "mfi": "MFI: Uses price and volume to measure buying and selling pressure.",
    }
    if indicator not in indicator_descriptions:
        raise ValueError(f"Indicator {indicator} is not supported")

    try:
        pd = _import_pandas()
        from stockstats import wrap

        symbol = _normalize_cn_ticker(ticker)
        end_dt = datetime.strptime(curr_date, "%Y-%m-%d")
        start_dt = end_dt - timedelta(days=max(look_back_days + 400, 450))
        data = _fetch_hist_df(symbol, start_dt.strftime("%Y-%m-%d"), curr_date, period="daily")
        if data.empty:
            return f"No indicator data found for {symbol} up to {curr_date}"

        stats_df = data[["Date", "Open", "Close", "High", "Low", "Volume"]].copy()
        stats_df["Date"] = pd.to_datetime(stats_df["Date"], errors="coerce")
        stats_df = wrap(stats_df)
        _ = stats_df[indicator]
        stats_df["Date"] = pd.to_datetime(stats_df["Date"], errors="coerce").dt.strftime("%Y-%m-%d")

        values = []
        current_dt = end_dt
        before = end_dt - timedelta(days=look_back_days)
        while current_dt >= before:
            date_str = current_dt.strftime("%Y-%m-%d")
            row = stats_df.loc[stats_df["Date"] == date_str]
            if row.empty:
                values.append(f"{date_str}: N/A: Not a trading day (weekend or holiday)")
            else:
                val = row.iloc[-1][indicator]
                values.append(f"{date_str}: {val}")
            current_dt -= timedelta(days=1)

        return (
            f"## {indicator} values from {before.strftime('%Y-%m-%d')} to {curr_date}:\n\n"
            + "\n".join(values)
            + "\n\n"
            + indicator_descriptions[indicator]
        )
    except Exception as exc:
        return f"Failed to calculate A-share indicator {indicator} for {ticker}: {exc}"


def get_fundamentals_akshare(ticker: str, curr_date: str | None = None) -> str:
    del curr_date
    try:
        from akshare.stock.stock_info_em import stock_individual_info_em
        from akshare.stock_fundamental.stock_finance_ths import stock_financial_abstract_ths

        symbol = _normalize_cn_ticker(ticker)
        info_df = stock_individual_info_em(symbol=symbol)
        summary_df = stock_financial_abstract_ths(symbol=symbol, indicator="按报告期")

        sections = [
            _format_dataframe_preview(f"## A-share company snapshot for {symbol}", info_df),
            _format_dataframe_preview(f"## Financial abstract for {symbol}", summary_df),
        ]
        return "\n\n".join(sections)
    except Exception as exc:
        return f"Fundamentals temporarily unavailable for A-share ticker {ticker}: {exc}"


def get_balance_sheet_akshare(ticker: str, freq: str, curr_date: str | None = None) -> str:
    del curr_date
    try:
        from akshare.stock_fundamental.stock_finance_ths import stock_financial_debt_ths

        symbol = _normalize_cn_ticker(ticker)
        indicator = "按年度" if freq == "annual" else "按报告期"
        df = stock_financial_debt_ths(symbol=symbol, indicator=indicator)
        return _format_dataframe_preview(f"## Balance sheet for {symbol}", df)
    except Exception as exc:
        return f"Balance sheet temporarily unavailable for A-share ticker {ticker}: {exc}"


def get_cashflow_akshare(ticker: str, freq: str, curr_date: str | None = None) -> str:
    del curr_date
    try:
        from akshare.stock_fundamental.stock_finance_ths import stock_financial_cash_ths

        symbol = _normalize_cn_ticker(ticker)
        indicator = "按年度" if freq == "annual" else "按报告期"
        df = stock_financial_cash_ths(symbol=symbol, indicator=indicator)
        return _format_dataframe_preview(f"## Cashflow statement for {symbol}", df)
    except Exception as exc:
        return f"Cashflow statement temporarily unavailable for A-share ticker {ticker}: {exc}"


def get_income_statement_akshare(ticker: str, freq: str, curr_date: str | None = None) -> str:
    del curr_date
    try:
        from akshare.stock_fundamental.stock_finance_ths import stock_financial_benefit_ths

        symbol = _normalize_cn_ticker(ticker)
        indicator = "按年度" if freq == "annual" else "按报告期"
        df = stock_financial_benefit_ths(symbol=symbol, indicator=indicator)
        return _format_dataframe_preview(f"## Income statement for {symbol}", df)
    except Exception as exc:
        return f"Income statement temporarily unavailable for A-share ticker {ticker}: {exc}"


def get_news_akshare(ticker: str, start_date: str, end_date: str) -> str:
    try:
        pd = _import_pandas()
        from akshare.stock_fundamental.stock_notice import stock_notice_report

        symbol = _normalize_cn_ticker(ticker)
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        if start_dt > end_dt:
            start_dt, end_dt = end_dt, start_dt

        frames = []
        day_count = min((end_dt - start_dt).days + 1, 10)
        for offset in range(day_count):
            current = end_dt - timedelta(days=offset)
            daily_df = stock_notice_report(symbol="全部", date=current.strftime("%Y%m%d"))
            if daily_df is None or daily_df.empty:
                continue
            filtered = daily_df[daily_df["代码"].astype(str) == symbol].copy()
            if not filtered.empty:
                frames.append(filtered)

        if frames:
            combined = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["代码", "公告标题", "公告日期", "网址"])
            combined = combined.sort_values(by="公告日期", ascending=False, ignore_index=True).head(8)
            news_str = ""
            for _, row in combined.iterrows():
                news_str += (
                    f"### {row.get('公告标题', '')} (source: EastMoney, type: {row.get('公告类型', '')})\n\n"
                    f"公告日期: {row.get('公告日期', '')}\n"
                    f"网址: {row.get('网址', '')}\n\n"
                )
            return f"## {symbol} A-share notices from {start_date} to {end_date}:\n\n{news_str}"
    except Exception:
        pass

    look_back_days = max((datetime.strptime(end_date, "%Y-%m-%d") - datetime.strptime(start_date, "%Y-%m-%d")).days, 1)
    return get_google_news(f"{ticker} 股票 公告", end_date, look_back_days)


def get_chart_data_akshare(ticker: str, range_param: str) -> list[dict[str, Any]]:
    symbol = _normalize_cn_ticker(ticker)
    now = datetime.now()
    if range_param == "5y":
        period = "monthly"
        start_date = now - timedelta(days=365 * 5 + 30)
    elif range_param == "1y":
        period = "weekly"
        start_date = now - timedelta(days=365 + 14)
    elif range_param == "6m":
        period = "daily"
        start_date = now - timedelta(days=190)
    elif range_param == "3m":
        period = "daily"
        start_date = now - timedelta(days=100)
    elif range_param == "1m":
        period = "daily"
        start_date = now - timedelta(days=35)
    else:
        period = "daily"
        start_date = now - timedelta(days=10)

    df = _fetch_hist_df(symbol, start_date.strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d"), period=period)
    if df.empty:
        return []

    result = []
    for _, row in df.iterrows():
        result.append(
            {
                "date": row["Date"].strftime("%Y-%m-%d"),
                "open": float(row.get("Open", 0) or 0),
                "high": float(row.get("High", 0) or 0),
                "low": float(row.get("Low", 0) or 0),
                "close": float(row.get("Close", 0) or 0),
                "volume": float(row.get("Volume", 0) or 0),
            }
        )
    return result
