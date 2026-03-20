from __future__ import annotations

from redis import Redis

from marketdata.normalize import normalize_market, normalize_ticker_for_market, utcnow_iso
from marketdata.policies import build_payload_meta, read_cache

FUNDAMENTALS_TTL_SECONDS = 6 * 60 * 60
FUNDAMENTALS_STALE_TTL_SECONDS = 7 * 24 * 60 * 60


def get_terminal_metrics(redis_client: Redis, ticker: str, market: str) -> dict:
    normalized_market = normalize_market(market)
    symbol = normalize_ticker_for_market(ticker, normalized_market)
    cache_key = f"market:fundamentals:{normalized_market}:{symbol}"
    cached, cache_status = read_cache(redis_client, cache_key, FUNDAMENTALS_TTL_SECONDS)
    if cache_status == "fresh" and cached:
        return cached

    # Terminal v1 keeps sidebar metrics as best-effort placeholders on both markets.
    return build_payload_meta(
        {"ticker": symbol, "market": normalized_market, "metrics": [], "fetched_at": utcnow_iso()},
        source="unavailable",
        fallback_used=None,
        cache_status="empty",
        stale=False,
    )
