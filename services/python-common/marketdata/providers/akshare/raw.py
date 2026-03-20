from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from marketdata.normalize import date_to_compact, market_code_for_cn_ticker, normalize_cn_ticker


def fetch_candles(symbol: str, period: str, start_date: str, end_date: str, timeout: float) -> Any:
    from akshare.stock_feature.stock_hist_em import stock_zh_a_hist

    return stock_zh_a_hist(
        symbol=normalize_cn_ticker(symbol),
        period=period,
        start_date=date_to_compact(start_date),
        end_date=date_to_compact(end_date),
        adjust="",
        timeout=timeout,
    )


def fetch_quote(symbol: str) -> Any:
    from akshare.stock_feature.stock_hist_em import stock_zh_a_spot_em

    return stock_zh_a_spot_em()


def fetch_company_info(symbol: str, timeout: float | None = None) -> Any:
    from akshare.stock.stock_info_em import stock_individual_info_em

    return stock_individual_info_em(symbol=normalize_cn_ticker(symbol), timeout=timeout)


def fetch_notices(symbol: str, lookback_days: int = 10) -> Any:
    from akshare.stock_fundamental.stock_notice import stock_notice_report

    pd = __import__("pandas")
    normalized = normalize_cn_ticker(symbol)
    end_dt = datetime.now()
    frames = []
    for offset in range(lookback_days):
        current = end_dt - timedelta(days=offset)
        daily_df = stock_notice_report(symbol="全部", date=current.strftime("%Y%m%d"))
        if daily_df is None or getattr(daily_df, "empty", True):
            continue
        filtered = daily_df[daily_df["代码"].astype(str) == normalized].copy()
        if not filtered.empty:
            frames.append(filtered)
    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, ignore_index=True)
    return combined.drop_duplicates(subset=["代码", "公告标题", "公告日期", "网址"]).sort_values(by="公告日期", ascending=False, ignore_index=True)


def fetch_fundamentals(symbol: str) -> Any:
    from akshare.stock.stock_info_em import stock_individual_info_em

    return stock_individual_info_em(symbol=normalize_cn_ticker(symbol))

