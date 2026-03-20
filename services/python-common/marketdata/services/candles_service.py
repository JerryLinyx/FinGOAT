from __future__ import annotations

from redis import Redis

from marketdata.normalize import (
    alpha_vantage_chart_config,
    alpha_vantage_terminal_config,
    build_chart_points,
    build_chart_points_from_alpha_vantage,
    chart_range_window,
    normalize_hist_dataframe,
    normalize_market,
    normalize_ticker_for_market,
    terminal_period_spec,
    utcnow_iso,
)
from marketdata.policies import build_payload_meta, read_cache, write_cache
from marketdata.providers.alpha_vantage import raw as alpha_vantage_raw
from marketdata.providers.yfinance import raw as yfinance_raw

CANDLES_TTL_SECONDS = 120
CANDLES_STALE_TTL_SECONDS = 24 * 60 * 60


def _build_terminal_page(full_points: list[dict], max_rows: int, before: str | None) -> tuple[list[dict], bool, str | None, str | None]:
    if before:
        eligible = [point for point in full_points if str(point.get("date")) < before]
    else:
        eligible = full_points

    page = eligible[-max_rows:]
    has_more_left = len(eligible) > len(page)
    oldest_date = str(page[0]["date"]) if page else None
    newest_date = str(page[-1]["date"]) if page else None
    return page, has_more_left, oldest_date, newest_date


def _get_cn_all_terminal_candles(redis_client: Redis, symbol: str, period: str) -> dict:
    cache_key = f"market:candles:cn:{symbol}:{period}:full"
    cached, cache_status = read_cache(redis_client, cache_key, CANDLES_TTL_SECONDS)
    if cache_status == "fresh" and cached:
        return cached

    provider_period, _, _ = terminal_period_spec(period)
    df = yfinance_raw.fetch_candles(symbol, provider_period)
    points = build_chart_points(normalize_hist_dataframe(df).reset_index(drop=True))
    payload = build_payload_meta(
        {
            "ticker": symbol,
            "market": "cn",
            "period": period,
            "all_candles": points,
            "fetched_at": utcnow_iso(),
        },
        source="yfinance",
        fallback_used=None,
        cache_status="miss",
        stale=False,
    )
    write_cache(redis_client, cache_key, payload, CANDLES_STALE_TTL_SECONDS)
    return payload


def _get_us_all_terminal_candles(redis_client: Redis, symbol: str, period: str, api_key: str) -> dict:
    cache_key = f"market:candles:us:{symbol}:{period}:full"
    cached, cache_status = read_cache(redis_client, cache_key, CANDLES_TTL_SECONDS)
    if cache_status == "fresh" and cached:
        return cached

    config = alpha_vantage_terminal_config(period)
    fallback_used = None
    source = "alpha_vantage"
    try:
        raw = alpha_vantage_raw.fetch_series(symbol, config["function"], api_key, config.get("outputsize"))
        points = build_chart_points_from_alpha_vantage(raw, config["series_key"], config["volume_field"])
    except Exception as exc:
        # Alpha Vantage full-history daily data is premium-only on free plans.
        if "premium" not in str(exc).lower() and "outputsize=full" not in str(exc).lower():
            raise
        provider_period, _, _ = terminal_period_spec(period)
        df = yfinance_raw.fetch_us_candles(symbol, provider_period)
        points = build_chart_points(normalize_hist_dataframe(df).reset_index(drop=True))
        source = "yfinance"
        fallback_used = "alpha_vantage"

    payload = build_payload_meta(
        {
            "ticker": symbol,
            "market": "us",
            "period": period,
            "all_candles": points,
            "fetched_at": utcnow_iso(),
        },
        source=source,
        fallback_used=fallback_used,
        cache_status="miss",
        stale=False,
    )
    write_cache(redis_client, cache_key, payload, CANDLES_STALE_TTL_SECONDS)
    return payload


def get_terminal_candles(redis_client: Redis, ticker: str, market: str, period: str, before: str | None = None, api_key: str | None = None) -> dict:
    normalized_market = normalize_market(market)
    symbol = normalize_ticker_for_market(ticker, normalized_market)
    _, _, max_rows = terminal_period_spec(period)

    if normalized_market == "cn":
        all_payload = _get_cn_all_terminal_candles(redis_client, symbol, period)
    else:
        all_payload = _get_us_all_terminal_candles(redis_client, symbol, period, api_key or "")

    all_points = all_payload.get("all_candles") or []
    points, has_more_left, oldest_date, newest_date = _build_terminal_page(all_points, max_rows, before)
    payload = build_payload_meta(
        {
            "ticker": symbol,
            "market": normalized_market,
            "period": period,
            "candles": points,
            "has_more_left": has_more_left,
            "oldest_date": oldest_date,
            "newest_date": newest_date,
            "all_candles": all_points,
            "fetched_at": utcnow_iso(),
        },
        source=str(all_payload.get("source") or ("yfinance" if normalized_market == "cn" else "alpha_vantage")),
        fallback_used=all_payload.get("fallback_used"),
        cache_status=str(all_payload.get("cache_status") or "miss"),
        stale=bool(all_payload.get("stale")),
    )
    return payload


def get_chart_payload(redis_client: Redis, ticker: str, market: str, range_param: str, api_key: str | None = None) -> dict:
    normalized_market = normalize_market(market)
    symbol = normalize_ticker_for_market(ticker, normalized_market)
    cache_key = f"market:candles:{normalized_market}:{symbol}:range:{range_param}"
    cached, cache_status = read_cache(redis_client, cache_key, CANDLES_TTL_SECONDS)
    if cache_status == "fresh" and cached:
        return cached

    if normalized_market == "cn":
        provider_period, _, _, max_rows = chart_range_window(range_param)
        df = yfinance_raw.fetch_candles(symbol, provider_period)
        points = build_chart_points(normalize_hist_dataframe(df).tail(max_rows).reset_index(drop=True))
        payload = build_payload_meta(
            {
                "ticker": symbol,
                "market": normalized_market,
                "range": range_param,
                "data": points,
                "fetched_at": utcnow_iso(),
            },
            source="yfinance",
            fallback_used=None,
            cache_status="miss",
            stale=False,
        )
    else:
        config = alpha_vantage_chart_config(range_param)
        _, start_date, _, _ = chart_range_window(range_param)
        raw = alpha_vantage_raw.fetch_series(symbol, config["function"], api_key or "", config.get("outputsize"))
        points = build_chart_points_from_alpha_vantage(raw, config["series_key"], config["volume_field"], start_date)
        payload = build_payload_meta(
            {
                "ticker": symbol,
                "market": normalized_market,
                "range": range_param,
                "data": points,
                "fetched_at": utcnow_iso(),
            },
            source="alpha_vantage",
            fallback_used=None,
            cache_status="miss",
            stale=False,
        )

    write_cache(redis_client, cache_key, payload, CANDLES_STALE_TTL_SECONDS)
    return payload
