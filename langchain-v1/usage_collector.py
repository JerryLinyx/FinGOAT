"""
Collects LLM usage metrics (tokens, latency, errors) during analysis runs
and writes them to Redis for Go backend to persist to PostgreSQL.

Usage:
    collector = UsageCollector(task_id, user_id, provider, model, redis_client)
    # In each agent node:
    start = time.time()
    result = chain.invoke(...)
    collector.record_llm_call("Market Analyst", result, start)
    # After task completes:
    collector.flush_to_redis()
"""

import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, List, Optional

from redis import Redis

logger = logging.getLogger(__name__)

USAGE_EVENTS_KEY_PREFIX = "usage:events"


@dataclass
class UsageEvent:
    task_id: str
    user_id: int
    provider: str
    model: str
    node_name: str
    event_type: str  # chat_completion, embedding, tool_call
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    success: bool = True
    error_message: str = ""
    request_started_at: str = ""
    request_completed_at: str = ""


class UsageCollector:
    """Collects LLM usage events during an analysis run."""

    def __init__(
        self,
        task_id: str,
        user_id: int,
        provider: str,
        model: str,
        redis_client: Redis,
    ):
        self.task_id = task_id
        self.user_id = user_id
        self.provider = provider
        self.model = model
        self.redis = redis_client
        self._events: List[UsageEvent] = []

    def record_llm_call(
        self,
        node_name: str,
        result: Any,
        start_time: float,
        event_type: str = "chat_completion",
        error: Optional[str] = None,
    ) -> None:
        """Record a single LLM call's usage from the LangChain result object."""
        end_time = time.time()
        latency_ms = int((end_time - start_time) * 1000)

        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0

        if result is not None and error is None:
            # Try LangChain's usage_metadata (preferred path)
            usage = getattr(result, "usage_metadata", None)
            if usage and isinstance(usage, dict):
                prompt_tokens = (
                    usage.get("input_tokens", 0)
                    or usage.get("prompt_tokens", 0)
                    or 0
                )
                completion_tokens = (
                    usage.get("output_tokens", 0)
                    or usage.get("completion_tokens", 0)
                    or 0
                )
                total_tokens = usage.get("total_tokens", 0) or (
                    prompt_tokens + completion_tokens
                )
            else:
                # Fallback: response_metadata
                resp_meta = getattr(result, "response_metadata", {}) or {}
                token_usage = (
                    resp_meta.get("token_usage", resp_meta.get("usage", {})) or {}
                )
                if isinstance(token_usage, dict):
                    prompt_tokens = token_usage.get("prompt_tokens", 0) or 0
                    completion_tokens = token_usage.get("completion_tokens", 0) or 0
                    total_tokens = token_usage.get("total_tokens", 0) or (
                        prompt_tokens + completion_tokens
                    )

        # Determine model from result if available
        result_model = self.model
        resp_meta = getattr(result, "response_metadata", {}) or {}
        if isinstance(resp_meta, dict) and resp_meta.get("model_name"):
            result_model = resp_meta["model_name"]

        event = UsageEvent(
            task_id=self.task_id,
            user_id=self.user_id,
            provider=self.provider,
            model=result_model,
            node_name=node_name,
            event_type=event_type,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            success=error is None,
            error_message=error or "",
            request_started_at=datetime.fromtimestamp(
                start_time, tz=timezone.utc
            ).isoformat(),
            request_completed_at=datetime.fromtimestamp(
                end_time, tz=timezone.utc
            ).isoformat(),
        )
        self._events.append(event)

    @property
    def event_count(self) -> int:
        return len(self._events)

    def flush_to_redis(self) -> int:
        """Write all collected events to Redis list for Go to pick up."""
        if not self._events:
            return 0
        key = f"{USAGE_EVENTS_KEY_PREFIX}:{self.task_id}"
        pipe = self.redis.pipeline()
        for event in self._events:
            pipe.rpush(key, json.dumps(asdict(event)))
        pipe.expire(key, 86400)  # 24h TTL
        pipe.execute()
        count = len(self._events)
        logger.info("Flushed %d usage events for task %s", count, self.task_id)
        return count
