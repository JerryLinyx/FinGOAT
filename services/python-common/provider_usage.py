from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class UsageMetrics:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model: Optional[str] = None


def _to_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return 0


def _response_metadata(result: Any) -> Dict[str, Any]:
    metadata = getattr(result, "response_metadata", None)
    return metadata if isinstance(metadata, dict) else {}


def _usage_from_usage_metadata(result: Any) -> UsageMetrics:
    usage = getattr(result, "usage_metadata", None)
    if not isinstance(usage, dict):
        return UsageMetrics()

    prompt_tokens = _to_int(usage.get("input_tokens") or usage.get("prompt_tokens"))
    completion_tokens = _to_int(usage.get("output_tokens") or usage.get("completion_tokens"))
    total_tokens = _to_int(usage.get("total_tokens")) or (prompt_tokens + completion_tokens)
    return UsageMetrics(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )


def _usage_from_response_metadata(result: Any) -> UsageMetrics:
    response_metadata = _response_metadata(result)
    token_usage = response_metadata.get("token_usage", response_metadata.get("usage", {})) or {}
    if not isinstance(token_usage, dict):
        token_usage = {}

    prompt_tokens = _to_int(token_usage.get("prompt_tokens") or token_usage.get("input_tokens"))
    completion_tokens = _to_int(token_usage.get("completion_tokens") or token_usage.get("output_tokens"))
    total_tokens = _to_int(token_usage.get("total_tokens")) or (prompt_tokens + completion_tokens)
    return UsageMetrics(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )


def _usage_from_ollama_response(result: Any) -> UsageMetrics:
    response_metadata = _response_metadata(result)
    prompt_tokens = _to_int(response_metadata.get("prompt_eval_count"))
    completion_tokens = _to_int(response_metadata.get("eval_count"))
    total_tokens = prompt_tokens + completion_tokens
    if total_tokens > 0:
        return UsageMetrics(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )

    generation_info = getattr(result, "generation_info", None)
    if isinstance(generation_info, dict):
        prompt_tokens = _to_int(generation_info.get("prompt_eval_count"))
        completion_tokens = _to_int(generation_info.get("eval_count"))
        total_tokens = prompt_tokens + completion_tokens

    return UsageMetrics(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )


def normalize_usage(provider: str, result: Any) -> UsageMetrics:
    normalized_provider = (provider or "").strip().lower()
    if normalized_provider == "aliyun":
        normalized_provider = "dashscope"

    usage = _usage_from_usage_metadata(result)
    if usage.total_tokens <= 0:
        usage = _usage_from_response_metadata(result)
    if normalized_provider == "ollama" and usage.total_tokens <= 0:
        usage = _usage_from_ollama_response(result)

    response_metadata = _response_metadata(result)
    model = response_metadata.get("model_name") if isinstance(response_metadata, dict) else None
    if not model:
        generation_info = getattr(result, "generation_info", None)
        if isinstance(generation_info, dict):
            model = generation_info.get("model")

    return UsageMetrics(
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        total_tokens=usage.total_tokens,
        model=model,
    )
