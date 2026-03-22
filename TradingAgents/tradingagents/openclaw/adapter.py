import json
from typing import Any, Dict
from urllib import error as urllib_error
from urllib import request as urllib_request

from tradingagents.runtime import StageRequest, build_stage_instructions, build_stage_request


REPORT_KEY_BY_STAGE_ID = {
    "market": "market_report",
    "social": "sentiment_report",
    "news": "news_report",
    "fundamentals": "fundamentals_report",
    "portfolio_manager": "investment_plan",
    "trader_plan": "trader_investment_plan",
    "risk_management": "final_trade_decision",
}


class OpenClawStageError(RuntimeError):
    """Raised when OpenClaw gateway orchestration fails for a stage."""


class OpenClawAnalystAdapter:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.gateway_url = str(config.get("openclaw_gateway_url") or "http://localhost:8011").rstrip("/")
        self.user_id = config.get("user_id")
        self.task_id = config.get("task_id")
        timeout_value = config.get("llm_timeout", 300)
        try:
            self.timeout_seconds = max(int(timeout_value), 1)
        except (TypeError, ValueError):
            self.timeout_seconds = 300

    def _post_json(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(
            f"{self.gateway_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise OpenClawStageError(f"agent_run_failed: {detail or exc.reason}") from exc
        except urllib_error.URLError as exc:
            raise OpenClawStageError(f"openclaw_gateway_unavailable: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise OpenClawStageError(f"agent_output_invalid: {exc}") from exc

    def _ensure_agents(self, user_id: int | None = None) -> None:
        effective_user_id = user_id if user_id not in (None, "") else self.user_id
        if effective_user_id in (None, ""):
            raise OpenClawStageError("agent_bootstrap_failed: missing user_id for openclaw execution")
        self._post_json("/internal/openclaw/agents/ensure", {"user_id": effective_user_id})

    def _build_upstream_outputs(self, state: Dict[str, Any]) -> Dict[str, Any]:
        upstream: Dict[str, Any] = {}
        for report_key in (
            "market_report",
            "sentiment_report",
            "news_report",
            "fundamentals_report",
            "investment_debate_state",
            "investment_plan",
            "trader_investment_plan",
            "risk_debate_state",
        ):
            value = state.get(report_key)
            if value:
                upstream[report_key] = value
        return upstream

    def build_stage_request(self, stage_id: str, state: Dict[str, Any], memory: Any = None) -> StageRequest:
        if stage_id not in REPORT_KEY_BY_STAGE_ID:
            raise OpenClawStageError(f"unsupported stage_id {stage_id}")

        instructions = (
            build_stage_instructions(stage_id, state, memory)
            if stage_id in {"portfolio_manager", "trader_plan", "risk_management"} and memory is not None
            else ""
        )

        return build_stage_request(
            task_id=str(self.task_id or state.get("task_id") or ""),
            user_id=self.user_id if isinstance(self.user_id, int) else None,
            stage_id=stage_id,
            ticker=str(state.get("company_of_interest") or ""),
            analysis_date=str(state.get("trade_date") or ""),
            market=str(self.config.get("market") or "us"),
            state=state,
            llm_config={
                "provider": self.config.get("llm_provider"),
                "backend_url": self.config.get("backend_url"),
                "quick_think_llm": self.config.get("quick_think_llm"),
                "deep_think_llm": self.config.get("deep_think_llm"),
            },
            data_vendor_config=self.config.get("data_vendors") or {},
            instructions=instructions,
        )

    def run_stage_result_from_request(self, request: StageRequest) -> Dict[str, Any]:
        effective_user_id = request.user_id if request.user_id is not None else self.user_id
        self._ensure_agents(effective_user_id)

        payload = {
            "user_id": effective_user_id,
            "task_id": request.task_id or self.task_id,
            "stage_id": request.stage_id,
            "ticker": request.ticker,
            "analysis_date": request.analysis_date,
            "market": request.market,
            "upstream_outputs": request.upstream_outputs,
            "llm_config": request.llm_config,
            "data_vendor_config": request.data_vendor_config,
            "instructions": {
                "task_id": request.task_id or self.task_id,
                "execution_mode": self.config.get("execution_mode", "openclaw"),
                "stage_prompt": request.instructions,
                "execution_context": request.execution_context,
            },
            "output_schema_version": "v1",
        }
        result = self._post_json("/internal/openclaw/stages/run", payload)
        if result.get("status") != "completed":
            raise OpenClawStageError(result.get("error") or "agent_run_failed: unknown stage failure")
        return result

    def run_stage_result(self, stage_id: str, state: Dict[str, Any], memory: Any = None) -> Dict[str, Any]:
        request = self.build_stage_request(stage_id, state, memory)
        return self.run_stage_result_from_request(request)

    def run_stage(self, stage_id: str, state: Dict[str, Any], memory: Any = None) -> Dict[str, Any]:
        report_key = REPORT_KEY_BY_STAGE_ID[stage_id]
        result = self.run_stage_result(stage_id, state, memory)

        return {
            report_key: result.get("content", ""),
            f"__stage_backend.{report_key}": result.get("backend", "openclaw"),
            f"__stage_provider.{report_key}": result.get("provider", self.config.get("llm_provider")),
            f"__stage_agent_id.{report_key}": result.get("agent_id"),
            f"__stage_session_key.{report_key}": result.get("session_key"),
            f"__stage_raw_output.{report_key}": result.get("raw_output"),
            f"__stage_summary.{report_key}": result.get("summary"),
            f"__stage_started_at.{report_key}": result.get("started_at"),
            f"__stage_completed_at.{report_key}": result.get("completed_at"),
            f"__stage_error.{report_key}": result.get("error"),
        }
