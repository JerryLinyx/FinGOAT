from __future__ import annotations

import concurrent.futures
import json
import logging
import time
from copy import deepcopy
from typing import Any, Callable

from redis import Redis

from .normalize import utcnow_iso

logger = logging.getLogger("marketdata")

BREAKER_FAILURE_THRESHOLD = 3
BREAKER_OPEN_SECONDS = 30


class MarketDataUnavailableError(RuntimeError):
    pass


def is_temporary_upstream_error(exc: Exception) -> bool:
    lowered = str(exc).lower()
    return (
        "connection aborted" in lowered
        or "remote end closed connection without response" in lowered
        or "read timed out" in lowered
        or "temporarily unavailable" in lowered
        or "chunkedencodingerror" in lowered
        or "connection reset by peer" in lowered
        or "max retries exceeded" in lowered
        or "502" in lowered
        or "503" in lowered
        or "504" in lowered
    )


def retry_call(
    action_name: str,
    func: Callable[[], Any],
    retries: int,
    backoffs: list[float],
) -> Any:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        started_at = time.time()
        try:
            return func()
        except Exception as exc:
            elapsed_ms = int((time.time() - started_at) * 1000)
            if not is_temporary_upstream_error(exc) or attempt >= retries:
                logger.warning("%s failed after %sms: %s", action_name, elapsed_ms, exc)
                raise
            last_error = exc
            sleep_seconds = backoffs[min(attempt, len(backoffs) - 1)] if backoffs else 0
            logger.warning("%s temporary failure after %sms: %s; retrying in %.2fs", action_name, elapsed_ms, exc, sleep_seconds)
            time.sleep(sleep_seconds)
    raise last_error or MarketDataUnavailableError(f"{action_name} failed")


def best_effort_with_timeout(factory: Callable[[], Any], timeout_seconds: float, default: Any) -> Any:
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(factory)
    try:
        result = future.result(timeout=timeout_seconds)
        executor.shutdown(wait=False, cancel_futures=False)
        return result
    except Exception:
        future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        return deepcopy(default)


def _cache_envelope(payload: dict[str, Any]) -> dict[str, Any]:
    envelope = deepcopy(payload)
    envelope["fetched_at"] = envelope.get("fetched_at") or utcnow_iso()
    envelope["_fetched_ts"] = time.time()
    return envelope


def read_cache(redis_client: Redis, key: str, fresh_ttl_seconds: int) -> tuple[dict[str, Any] | None, str]:
    raw = redis_client.get(key)
    if not raw:
        return None, "miss"
    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError:
        return None, "miss"
    fetched_ts = float(envelope.get("_fetched_ts") or 0)
    if fetched_ts and time.time() - fetched_ts <= fresh_ttl_seconds:
        payload = deepcopy(envelope)
        payload.pop("_fetched_ts", None)
        payload["cache_status"] = "fresh"
        payload["stale"] = False
        return payload, "fresh"
    payload = deepcopy(envelope)
    payload.pop("_fetched_ts", None)
    payload["cache_status"] = "stale"
    payload["stale"] = True
    return payload, "stale"


def write_cache(redis_client: Redis, key: str, payload: dict[str, Any], stale_ttl_seconds: int) -> None:
    redis_client.set(key, json.dumps(_cache_envelope(payload), ensure_ascii=False), ex=stale_ttl_seconds)


def _breaker_key(provider: str, kind: str, suffix: str) -> str:
    return f"market:breaker:{provider}:{kind}:{suffix}"


def is_breaker_open(redis_client: Redis, provider: str, kind: str) -> bool:
    return bool(redis_client.get(_breaker_key(provider, kind, "open")))


def record_breaker_success(redis_client: Redis, provider: str, kind: str) -> None:
    redis_client.delete(_breaker_key(provider, kind, "failures"))
    redis_client.delete(_breaker_key(provider, kind, "open"))


def record_breaker_failure(redis_client: Redis, provider: str, kind: str) -> None:
    failures_key = _breaker_key(provider, kind, "failures")
    failures = redis_client.incr(failures_key)
    redis_client.expire(failures_key, BREAKER_OPEN_SECONDS * 2)
    if failures >= BREAKER_FAILURE_THRESHOLD:
        redis_client.set(_breaker_key(provider, kind, "open"), "1", ex=BREAKER_OPEN_SECONDS)
        logger.warning("Circuit breaker opened for %s/%s after %s failures", provider, kind, failures)


def build_payload_meta(payload: dict[str, Any], *, source: str, fallback_used: str | None, cache_status: str, stale: bool) -> dict[str, Any]:
    enriched = deepcopy(payload)
    enriched["source"] = source
    enriched["fallback_used"] = fallback_used
    enriched["cache_status"] = cache_status
    enriched["stale"] = stale
    enriched["fetched_at"] = enriched.get("fetched_at") or utcnow_iso()
    return enriched
