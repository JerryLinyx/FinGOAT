from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Mapping

from tradingagents.agents.managers.research_manager import (
    build_portfolio_manager_prompt,
    run_portfolio_manager_stage,
)
from tradingagents.agents.managers.risk_manager import (
    build_risk_management_prompt,
    run_risk_management_stage,
)
from tradingagents.agents.trader.trader import build_trader_messages, run_trader_stage
from .contracts import StageEvent, StageRequest, StageResult


STAGE_LABELS = {
    "portfolio_manager": "Portfolio Manager",
    "trader_plan": "Trader Plan",
    "risk_management": "Risk Management",
}

CONTENT_KEY_BY_STAGE_ID = {
    "portfolio_manager": "investment_plan",
    "trader_plan": "trader_investment_plan",
    "risk_management": "final_trade_decision",
}


def _usage_delta(after: Mapping[str, Any], before: Mapping[str, Any]) -> Dict[str, int]:
    delta: Dict[str, int] = {}
    for key in ("prompt_tokens", "completion_tokens", "total_tokens", "llm_calls", "failed_calls", "latency_ms"):
        after_value = after.get(key)
        before_value = before.get(key, 0)
        if isinstance(after_value, (int, float)):
            delta[key] = int(after_value - (before_value if isinstance(before_value, (int, float)) else 0))
    return delta


def _normalize_summary(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        for key in ("judge_decision", "current_response", "summary", "thesis", "plan", "action", "explanation"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                value = candidate
                break
        else:
            try:
                value = json.dumps(value, ensure_ascii=False)
            except Exception:
                value = str(value)
    if isinstance(value, list):
        normalized_items = [_normalize_summary(item) for item in value]
        value = " ".join(item for item in normalized_items if item)
    text = " ".join(str(value).split()).strip()
    if len(text) <= 220:
        return text
    return text[:219] + "..."


def build_stage_instructions(stage_id: str, state: Dict[str, Any], memory: Any) -> str:
    if stage_id == "portfolio_manager":
        return build_portfolio_manager_prompt(state, memory)
    if stage_id == "trader_plan":
        return "\n\n".join(
            str(message.get("content", "")).strip()
            for message in build_trader_messages(state, memory)
            if isinstance(message, dict) and str(message.get("content", "")).strip()
        )
    if stage_id == "risk_management":
        return build_risk_management_prompt(state, memory)
    raise ValueError(f"unsupported unified stage {stage_id}")


def build_stage_request(
    *,
    task_id: str,
    user_id: int | None,
    stage_id: str,
    ticker: str,
    analysis_date: str,
    market: str,
    state: Dict[str, Any],
    llm_config: Dict[str, Any],
    data_vendor_config: Dict[str, Any],
    instructions: str,
) -> StageRequest:
    return StageRequest(
        task_id=task_id,
        user_id=user_id,
        stage_id=stage_id,
        ticker=ticker,
        analysis_date=analysis_date,
        market=market,
        upstream_outputs={
            key: state.get(key)
            for key in (
                "market_report",
                "sentiment_report",
                "news_report",
                "fundamentals_report",
                "investment_debate_state",
                "investment_plan",
                "trader_investment_plan",
                "risk_debate_state",
            )
            if state.get(key) is not None
        },
        llm_config=dict(llm_config),
        data_vendor_config=dict(data_vendor_config),
        execution_context={"state": state},
        instructions=instructions,
    )


class LangGraphExecutionBackend:
    def __init__(self, *, llms: Dict[str, Any], memories: Dict[str, Any], usage_collector: Any = None):
        self.llms = llms
        self.memories = memories
        self.usage_collector = usage_collector

    def run_stage(self, request: StageRequest) -> StageResult:
        state = dict(request.execution_context.get("state") or {})
        stage_id = request.stage_id
        started_at = datetime.now(timezone.utc)
        start_ts = time.time()

        usage_before = {}
        if self.usage_collector is not None and hasattr(self.usage_collector, "stage_usage_summary"):
            usage_before = dict(self.usage_collector.stage_usage_summary().get(stage_id, {}))

        if stage_id == "portfolio_manager":
            result = run_portfolio_manager_stage(
                state,
                self.llms["portfolio_manager"],
                self.memories["portfolio_manager"],
                self.usage_collector,
            )
        elif stage_id == "trader_plan":
            result = run_trader_stage(
                state,
                self.llms["trader_plan"],
                self.memories["trader_plan"],
                self.usage_collector,
            )
        elif stage_id == "risk_management":
            result = run_risk_management_stage(
                state,
                self.llms["risk_management"],
                self.memories["risk_management"],
                self.usage_collector,
            )
        else:
            raise ValueError(f"unsupported unified langgraph stage {stage_id}")

        completed_at = datetime.now(timezone.utc)
        usage_after = {}
        if self.usage_collector is not None and hasattr(self.usage_collector, "stage_usage_summary"):
            usage_after = dict(self.usage_collector.stage_usage_summary().get(stage_id, {}))
        usage = _usage_delta(usage_after, usage_before)

        content_key = CONTENT_KEY_BY_STAGE_ID[stage_id]
        content = result.get(content_key)
        return StageResult(
            stage_id=stage_id,
            label=STAGE_LABELS[stage_id],
            status="completed",
            backend="langgraph",
            provider=str(request.llm_config.get("provider") or "unknown"),
            summary=_normalize_summary(content),
            content=content,
            raw_output=result,
            started_at=started_at.isoformat(),
            completed_at=completed_at.isoformat(),
            duration_seconds=max((completed_at - started_at).total_seconds(), 0.0),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"),
            llm_calls=usage.get("llm_calls"),
            failed_calls=usage.get("failed_calls"),
            latency_ms=usage.get("latency_ms"),
        )

    def stream_stage(self, request: StageRequest) -> Iterable[StageEvent]:
        yield StageEvent(type="stage_start", stage_id=request.stage_id)
        result = self.run_stage(request)
        yield StageEvent(type="stage_complete", stage_id=request.stage_id, payload=result.to_dict())

    def cancel_stage(self, run_id: str) -> None:  # noqa: ARG002
        return None


class OpenClawExecutionBackend:
    def __init__(self, adapter: Any):
        self.adapter = adapter

    def run_stage(self, request: StageRequest) -> StageResult:
        result = self.adapter.run_stage_result_from_request(request)
        return StageResult(
            stage_id=request.stage_id,
            label=result.get("label") or STAGE_LABELS.get(request.stage_id, request.stage_id),
            status=result.get("status", "completed"),
            backend=result.get("backend", "openclaw"),
            provider=str(result.get("provider") or request.llm_config.get("provider") or "unknown"),
            summary=result.get("summary"),
            content=result.get("content"),
            raw_output=result.get("raw_output"),
            started_at=result.get("started_at"),
            completed_at=result.get("completed_at"),
            duration_seconds=result.get("duration_seconds"),
            prompt_tokens=result.get("prompt_tokens"),
            completion_tokens=result.get("completion_tokens"),
            total_tokens=result.get("total_tokens"),
            llm_calls=result.get("llm_calls"),
            failed_calls=result.get("failed_calls"),
            latency_ms=result.get("latency_ms"),
            error=result.get("error"),
            agent_id=result.get("agent_id"),
            session_key=result.get("session_key"),
        )

    def stream_stage(self, request: StageRequest) -> Iterable[StageEvent]:
        yield StageEvent(type="stage_start", stage_id=request.stage_id)
        result = self.run_stage(request)
        yield StageEvent(type="stage_complete", stage_id=request.stage_id, payload=result.to_dict())

    def cancel_stage(self, run_id: str) -> None:  # noqa: ARG002
        return None
