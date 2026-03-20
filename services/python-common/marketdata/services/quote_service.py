from __future__ import annotations

from redis import Redis

from marketdata.normalize import normalize_market, normalize_ticker_for_market, utcnow_iso
from marketdata.policies import (
    build_payload_meta,
    read_cache,
    write_cache,
)
from marketdata.services.candles_service import get_terminal_candles
from marketdata.providers.yfinance import raw as yfinance_raw

QUOTE_TTL_SECONDS = 10
QUOTE_STALE_TTL_SECONDS = 600


def _build_quote_from_candles(symbol: str, market: str, candles: list[dict[str, object]], source: str) -> dict:
    latest = candles[-1]
    previous = candles[-2] if len(candles) > 1 else None
    prev_close = previous.get("close") if previous else None
    last_price = latest.get("close")
    change = None
    change_pct = None
    if isinstance(last_price, (int, float)) and isinstance(prev_close, (int, float)):
        change = float(last_price) - float(prev_close)
        if prev_close != 0:
            change_pct = (change / float(prev_close)) * 100

    return build_payload_meta(
        {
            "ticker": symbol,
            "market": market,
            "name": symbol,
            "updated_at": utcnow_iso(),
            "last_price": last_price,
            "change": change,
            "change_pct": change_pct,
            "open": latest.get("open"),
            "high": latest.get("high"),
            "low": latest.get("low"),
            "prev_close": prev_close,
            "volume": latest.get("volume"),
            "amount": None,
            "turnover_rate": None,
        },
        source=source,
        fallback_used=None,
        cache_status="miss",
        stale=False,
    )


def get_quote(redis_client: Redis, ticker: str, market: str, api_key: str | None = None) -> dict:
    normalized_market = normalize_market(market)
    symbol = normalize_ticker_for_market(ticker, normalized_market)
    cache_key = f"market:quote:{normalized_market}:{symbol}"
    cached, cache_status = read_cache(redis_client, cache_key, QUOTE_TTL_SECONDS)
    if cache_status == "fresh" and cached:
        return cached

    if normalized_market == "cn":
        quote = yfinance_raw.fetch_quote(symbol)
        payload = build_payload_meta(
            {
                "ticker": symbol,
                "market": "cn",
                "name": quote["name"],
                "updated_at": utcnow_iso(),
                **quote,
            },
            source="yfinance",
            fallback_used=None,
            cache_status="miss",
            stale=False,
        )
    else:
        candles_payload = get_terminal_candles(redis_client, symbol, normalized_market, "day", api_key=api_key)
        candles = candles_payload.get("candles") or []
        if not candles:
            raise RuntimeError("no quote data available for the requested US ticker")
        payload = _build_quote_from_candles(symbol, normalized_market, candles, str(candles_payload.get("source") or "alpha_vantage"))

    write_cache(redis_client, cache_key, payload, QUOTE_STALE_TTL_SECONDS)
    return payload
