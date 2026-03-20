from __future__ import annotations

from redis import Redis

from marketdata.normalize import (
    build_indicator_payload,
    candles_to_dataframe,
    normalize_market,
    normalize_ticker_for_market,
    utcnow_iso,
)
from marketdata.policies import build_payload_meta, read_cache, write_cache

INDICATORS_TTL_SECONDS = 120
INDICATORS_STALE_TTL_SECONDS = 24 * 60 * 60


def get_terminal_indicators(
    redis_client: Redis,
    ticker: str,
    market: str,
    period: str,
    candles: list[dict[str, object]],
) -> dict:
    normalized_market = normalize_market(market)
    symbol = normalize_ticker_for_market(ticker, normalized_market)
    cache_key = f"market:indicators:{normalized_market}:{symbol}:{period}"
    cached, cache_status = read_cache(redis_client, cache_key, INDICATORS_TTL_SECONDS)
    if cache_status == "fresh" and cached:
        return cached

    indicator_payload = build_indicator_payload(candles_to_dataframe(candles))
    payload = build_payload_meta(
        {
            "ticker": symbol,
            "market": normalized_market,
            "period": period,
            "indicators": indicator_payload,
            "fetched_at": utcnow_iso(),
        },
        source="derived",
        fallback_used=None,
        cache_status="miss",
        stale=False,
    )
    write_cache(redis_client, cache_key, payload, INDICATORS_STALE_TTL_SECONDS)
    return payload
