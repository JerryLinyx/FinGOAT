import importlib
import os
import sys
import types
import unittest
from dataclasses import dataclass


TRADING_AGENTS_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if TRADING_AGENTS_ROOT not in sys.path:
    sys.path.insert(0, TRADING_AGENTS_ROOT)


@dataclass
class FakeStageRequest:
    task_id: str
    user_id: int | None
    stage_id: str
    ticker: str
    analysis_date: str
    market: str
    upstream_outputs: dict
    llm_config: dict
    data_vendor_config: dict
    execution_context: dict
    instructions: str


def install_fake_runtime_module():
    runtime_module = types.ModuleType("tradingagents.runtime")

    def build_stage_instructions(stage_id, state, memory):
        return f"instructions:{stage_id}"

    def build_stage_request(**kwargs):
        return FakeStageRequest(
            task_id=kwargs["task_id"],
            user_id=kwargs["user_id"],
            stage_id=kwargs["stage_id"],
            ticker=kwargs["ticker"],
            analysis_date=kwargs["analysis_date"],
            market=kwargs["market"],
            upstream_outputs=kwargs.get("state", {}),
            llm_config=kwargs["llm_config"],
            data_vendor_config=kwargs["data_vendor_config"],
            execution_context={"state": kwargs.get("state", {})},
            instructions=kwargs["instructions"],
        )

    runtime_module.StageRequest = FakeStageRequest
    runtime_module.build_stage_instructions = build_stage_instructions
    runtime_module.build_stage_request = build_stage_request
    sys.modules["tradingagents.runtime"] = runtime_module


class OpenClawAdapterTest(unittest.TestCase):
    def setUp(self):
        install_fake_runtime_module()
        sys.modules.pop("tradingagents.openclaw.adapter", None)
        self.module = importlib.import_module("tradingagents.openclaw.adapter")
        self.adapter_class = self.module.OpenClawAnalystAdapter

    def tearDown(self):
        sys.modules.pop("tradingagents.openclaw.adapter", None)
        sys.modules.pop("tradingagents.runtime", None)

    def test_request_user_id_is_used_for_agent_bootstrap(self):
        adapter = self.adapter_class(
            {
                "openclaw_gateway_url": "http://localhost:8011",
                "llm_timeout": 300,
            }
        )
        calls = []

        def fake_post(path, payload):
            calls.append((path, payload))
            if path == "/internal/openclaw/agents/ensure":
                return {"status": "ok"}
            if path == "/internal/openclaw/stages/run":
                return {
                    "status": "completed",
                    "label": "Portfolio Manager",
                    "backend": "openclaw",
                    "provider": "ollama",
                    "content": "plan",
                }
            raise AssertionError(f"unexpected path {path}")

        adapter._post_json = fake_post  # type: ignore[method-assign]

        request = FakeStageRequest(
            task_id="task-1",
            user_id=42,
            stage_id="portfolio_manager",
            ticker="NVDA",
            analysis_date="2026-03-22",
            market="us",
            upstream_outputs={"market_report": "summary"},
            llm_config={"provider": "ollama"},
            data_vendor_config={},
            execution_context={},
            instructions="do the thing",
        )

        result = adapter.run_stage_result_from_request(request)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(calls[0], ("/internal/openclaw/agents/ensure", {"user_id": 42}))
        self.assertEqual(calls[1][1]["user_id"], 42)

    def test_timeout_comes_from_llm_timeout_config(self):
        adapter = self.adapter_class({"llm_timeout": "120"})
        self.assertEqual(adapter.timeout_seconds, 120)


if __name__ == "__main__":
    unittest.main()
