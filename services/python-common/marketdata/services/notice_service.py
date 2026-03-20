from __future__ import annotations

from redis import Redis

from marketdata.normalize import normalize_market, normalize_ticker_for_market, utcnow_iso
from marketdata.policies import build_payload_meta, read_cache

NOTICES_TTL_SECONDS = 600
NOTICES_STALE_TTL_SECONDS = 24 * 60 * 60


def get_terminal_notices(redis_client: Redis, ticker: str, market: str, limit: int = 6) -> dict:
    normalized_market = normalize_market(market)
    symbol = normalize_ticker_for_market(ticker, normalized_market)
    cache_key = f"market:notices:{normalized_market}:{symbol}"
    cached, cache_status = read_cache(redis_client, cache_key, NOTICES_TTL_SECONDS)
    if cache_status == "fresh" and cached:
        return cached

    # Terminal v1 keeps notices as best-effort placeholders on both markets.
    return build_payload_meta(
        {"ticker": symbol, "market": normalized_market, "notices": [], "fetched_at": utcnow_iso()},
        source="unavailable",
        fallback_used=None,
        cache_status="empty",
        stale=False,
    )
