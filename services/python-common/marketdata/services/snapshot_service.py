from __future__ import annotations

from redis import Redis

from marketdata.normalize import normalize_market, normalize_ticker_for_market, utcnow_iso
from marketdata.policies import build_payload_meta, read_cache, write_cache
from marketdata.services.candles_service import get_terminal_candles
from marketdata.services.fundamentals_service import get_terminal_metrics
from marketdata.services.indicator_service import get_terminal_indicators
from marketdata.services.notice_service import get_terminal_notices

SNAPSHOT_TTL_SECONDS = 30
SNAPSHOT_STALE_TTL_SECONDS = 10 * 60


def _empty_indicators() -> dict:
    return {
        "ma": {"ma5": [], "ma10": [], "ma20": [], "ma60": []},
        "macd": {"dif": [], "dea": [], "hist": []},
    }


def _build_capabilities(market: str, partial: bool) -> dict:
    if market == "us":
        return {
            "chart": True,
            "intraday": False,
            "ma": True,
            "macd": True,
            "notices": False,
            "terminal_sidebar": False,
            "quote_polling": True,
        }
    return {
        "chart": True,
        "intraday": False,
        "ma": True,
        "macd": True,
        "notices": not partial,
        "terminal_sidebar": not partial,
        "quote_polling": True,
    }


def get_terminal_snapshot(
    redis_client: Redis,
    ticker: str,
    market: str,
    period: str,
    before: str | None = None,
    api_key: str | None = None,
) -> dict:
    normalized_market = normalize_market(market)
    symbol = normalize_ticker_for_market(ticker, normalized_market)
    use_cache = not before
    cache_key = f"market:snapshot:{normalized_market}:{symbol}:{period}"
    if use_cache:
        cached, cache_status = read_cache(redis_client, cache_key, SNAPSHOT_TTL_SECONDS)
        if cache_status == "fresh" and cached:
            return cached

    candles_payload = get_terminal_candles(redis_client, symbol, normalized_market, period, before=before, api_key=api_key)
    candles = candles_payload.get("candles") or []
    if not candles:
        raise RuntimeError("no chart data available for the requested ticker")

    all_candles = candles_payload.get("all_candles") or candles
    indicator_payload = get_terminal_indicators(redis_client, symbol, normalized_market, period, all_candles)
    indicators = indicator_payload.get("indicators") or _empty_indicators()
    oldest_date = candles_payload.get("oldest_date")
    newest_date = candles_payload.get("newest_date")

    if oldest_date:
        for key in ("ma5", "ma10", "ma20", "ma60"):
            indicators["ma"][key] = [
                point for point in indicators["ma"].get(key, [])
                if oldest_date <= point.get("date", "") <= (newest_date or point.get("date", ""))
            ]
        for key in ("dif", "dea", "hist"):
            indicators["macd"][key] = [
                point for point in indicators["macd"].get(key, [])
                if oldest_date <= point.get("date", "") <= (newest_date or point.get("date", ""))
            ]

    metrics_payload = get_terminal_metrics(redis_client, symbol, normalized_market)
    notices_payload = get_terminal_notices(redis_client, symbol, normalized_market)

    partial = (
        metrics_payload.get("source") == "unavailable"
        or notices_payload.get("source") == "unavailable"
    )

    payload = build_payload_meta(
        {
            "ticker": symbol,
            "market": normalized_market,
            "name": symbol,
            "period": period,
            "updated_at": utcnow_iso(),
            "chart": candles,
            "indicators": indicators,
            "sidebar": {
                "metrics": metrics_payload.get("metrics") or [],
                "notices": notices_payload.get("notices") or [],
            },
            "capabilities": _build_capabilities(normalized_market, partial),
            "partial": partial,
            "has_more_left": bool(candles_payload.get("has_more_left")),
            "oldest_date": oldest_date,
            "newest_date": newest_date,
            "fetched_at": candles_payload.get("fetched_at") or utcnow_iso(),
        },
        source=str(candles_payload.get("source") or "unknown"),
        fallback_used=candles_payload.get("fallback_used"),
        cache_status=str(candles_payload.get("cache_status") or "miss"),
        stale=bool(candles_payload.get("stale")),
    )
    if use_cache:
        write_cache(redis_client, cache_key, payload, SNAPSHOT_STALE_TTL_SECONDS)
    return payload
