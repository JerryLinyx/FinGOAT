import json
from typing import Any, Dict
from urllib import error as urllib_error
from urllib import request as urllib_request


REPORT_KEY_BY_STAGE_ID = {
    "market": "market_report",
    "social": "sentiment_report",
    "news": "news_report",
    "fundamentals": "fundamentals_report",
}


class OpenClawStageError(RuntimeError):
    """Raised when OpenClaw gateway orchestration fails for an analyst stage."""


class OpenClawAnalystAdapter:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.gateway_url = str(config.get("openclaw_gateway_url") or "http://localhost:8011").rstrip("/")
        self.user_id = config.get("user_id")
        self.task_id = config.get("task_id")

    def _post_json(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(
            f"{self.gateway_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise OpenClawStageError(f"agent_run_failed: {detail or exc.reason}") from exc
        except urllib_error.URLError as exc:
            raise OpenClawStageError(f"openclaw_gateway_unavailable: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise OpenClawStageError(f"agent_output_invalid: {exc}") from exc

    def _ensure_agents(self) -> None:
        if self.user_id in (None, ""):
            raise OpenClawStageError("agent_bootstrap_failed: missing user_id for openclaw execution")
        self._post_json("/internal/openclaw/agents/ensure", {"user_id": self.user_id})

    def _build_upstream_outputs(self, state: Dict[str, Any]) -> Dict[str, Any]:
        upstream: Dict[str, Any] = {}
        for report_key in REPORT_KEY_BY_STAGE_ID.values():
            value = state.get(report_key)
            if value:
                upstream[report_key] = value
        return upstream

    def run_stage(self, stage_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
        report_key = REPORT_KEY_BY_STAGE_ID[stage_id]
        self._ensure_agents()

        payload = {
            "user_id": self.user_id,
            "task_id": self.task_id,
            "stage_id": stage_id,
            "ticker": state.get("company_of_interest"),
            "analysis_date": state.get("trade_date"),
            "upstream_outputs": self._build_upstream_outputs(state),
            "llm_config": {
                "provider": self.config.get("llm_provider"),
                "backend_url": self.config.get("backend_url"),
                "quick_think_llm": self.config.get("quick_think_llm"),
                "deep_think_llm": self.config.get("deep_think_llm"),
            },
            "data_vendor_config": self.config.get("data_vendors") or {},
            "instructions": {
                "task_id": self.task_id,
                "execution_mode": self.config.get("execution_mode", "openclaw"),
            },
            "output_schema_version": "v1",
        }
        result = self._post_json("/internal/openclaw/stages/run", payload)
        if result.get("status") != "completed":
            raise OpenClawStageError(result.get("error") or "agent_run_failed: unknown stage failure")

        return {
            report_key: result.get("content", ""),
            f"__stage_backend.{report_key}": result.get("backend", "openclaw"),
            f"__stage_agent_id.{report_key}": result.get("agent_id"),
            f"__stage_session_key.{report_key}": result.get("session_key"),
            f"__stage_raw_output.{report_key}": result.get("raw_output"),
            f"__stage_summary.{report_key}": result.get("summary"),
            f"__stage_started_at.{report_key}": result.get("started_at"),
            f"__stage_completed_at.{report_key}": result.get("completed_at"),
            f"__stage_error.{report_key}": result.get("error"),
        }
