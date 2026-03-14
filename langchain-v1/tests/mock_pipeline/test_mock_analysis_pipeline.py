import json
import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class FakeRedis:
    def __init__(self) -> None:
        self._values = {}
        self._lists = {}

    def ping(self) -> bool:
        return True

    def set(self, key, value, ex=None):  # noqa: ARG002
        self._values[key] = value

    def get(self, key):
        return self._values.get(key)

    def delete(self, key):
        self._values.pop(key, None)

    def lpush(self, key, value):
        self._lists.setdefault(key, []).insert(0, value)

    def lrange(self, key, start, end):
        items = list(self._lists.get(key, []))
        if end == -1:
            end = len(items) - 1
        return items[start : end + 1]

    def ltrim(self, key, start, end):
        items = list(self._lists.get(key, []))
        if end == -1:
            end = len(items) - 1
        self._lists[key] = items[start : end + 1]

    def lrem(self, key, count, value):
        items = list(self._lists.get(key, []))
        removed = 0
        if count == 0:
            new_items = []
            for item in items:
                if item == value:
                    removed += 1
                    continue
                new_items.append(item)
            self._lists[key] = new_items
            return removed

        new_items = []
        for item in items:
            if item == value and removed < abs(count):
                removed += 1
                continue
            new_items.append(item)
        self._lists[key] = new_items
        return removed

    def rpoplpush(self, source, destination):
        source_items = self._lists.get(source, [])
        if not source_items:
            return None
        item = source_items.pop()
        self._lists.setdefault(destination, []).insert(0, item)
        return item

    def brpoplpush(self, source, destination, timeout=0):  # noqa: ARG002
        return self.rpoplpush(source, destination)


class FakeThread:
    def __init__(self, *args, **kwargs):  # noqa: ARG002
        self.started = False

    def start(self):
        self.started = True

    def is_alive(self):
        return False


class FakeTradingAgentsGraph:
    def __init__(self, debug=False, config=None, selected_analysts=None):  # noqa: ARG002
        self.debug = debug
        self.config = config or {}
        self.selected_analysts = selected_analysts or ["market", "social", "news", "fundamentals"]

    def propagate(self, company_name, trade_date, progress_callback=None):
        partial_state = {
            "company_of_interest": company_name,
            "trade_date": trade_date,
            "market_report": "Partial market view ready.",
            "__stage_starts.Market Analyst": 0.0,
            "__stage_ends.Market Analyst": 1.5,
        }
        if progress_callback:
            progress_callback(partial_state)

        state = json.loads((FIXTURES_DIR / "fake_graph_state.json").read_text())
        decision = json.loads((FIXTURES_DIR / "fake_decision.json").read_text())
        state["company_of_interest"] = company_name
        state["trade_date"] = trade_date
        state["raw_trace"]["provider"] = self.config.get("llm_provider", "mock-llm")
        return state, decision


def install_fake_tradingagents_modules() -> None:
    tradingagents_pkg = types.ModuleType("tradingagents")
    tradingagents_pkg.__path__ = []  # type: ignore[attr-defined]

    default_config_module = types.ModuleType("tradingagents.default_config")
    default_config_module.DEFAULT_CONFIG = {
        "deep_think_llm": "mock-deep",
        "quick_think_llm": "mock-quick",
        "max_debate_rounds": 1,
        "max_risk_discuss_rounds": 1,
        "llm_provider": "mock-llm",
        "data_vendors": {
            "core_stock_apis": "mock",
            "technical_indicators": "mock",
            "fundamental_data": "mock",
            "news_data": "mock",
        },
    }

    graph_pkg = types.ModuleType("tradingagents.graph")
    graph_pkg.__path__ = []  # type: ignore[attr-defined]

    trading_graph_module = types.ModuleType("tradingagents.graph.trading_graph")
    trading_graph_module.TradingAgentsGraph = FakeTradingAgentsGraph

    sys.modules["tradingagents"] = tradingagents_pkg
    sys.modules["tradingagents.default_config"] = default_config_module
    sys.modules["tradingagents.graph"] = graph_pkg
    sys.modules["tradingagents.graph.trading_graph"] = trading_graph_module


class MockAnalysisPipelineTest(unittest.TestCase):
    def setUp(self):
        install_fake_tradingagents_modules()
        sys.modules.pop("trading_service", None)
        self.trading_service = importlib.import_module("trading_service")
        self.redis = FakeRedis()
        self.trading_service.redis_client = None
        self.trading_service.worker_thread = None
        self.trading_service.worker_stop_event.clear()

        self.redis_patch = patch.object(self.trading_service, "get_redis_client", return_value=self.redis)
        self.thread_patch = patch.object(self.trading_service.threading, "Thread", FakeThread)
        self.graph_patch = patch.object(self.trading_service, "TradingAgentsGraph", FakeTradingAgentsGraph)

        self.redis_patch.start()
        self.thread_patch.start()
        self.graph_patch.start()
        self.client = TestClient(self.trading_service.app)

    def tearDown(self):
        self.client.close()
        self.graph_patch.stop()
        self.thread_patch.stop()
        self.redis_patch.stop()
        self.trading_service.redis_client = None
        self.trading_service.worker_thread = None
        self.trading_service.worker_stop_event.clear()
        sys.modules.pop("trading_service", None)

    def test_async_pipeline_completes_with_mock_graph(self):
        response = self.client.post(
            "/api/v1/analyze",
            json={
                "ticker": "NVDA",
                "date": "2024-05-10",
                "llm_config": {
                    "provider": "aliyun",
                    "deep_think_llm": "qwen3.5-flash",
                    "quick_think_llm": "qwen3.5-flash"
                }
            },
        )

        self.assertEqual(response.status_code, 202)
        initial = response.json()
        self.assertEqual(initial["status"], "pending")

        payload = self.redis.rpoplpush(self.trading_service.QUEUE_KEY, self.trading_service.PROCESSING_QUEUE_KEY)
        self.assertIsNotNone(payload)

        self.trading_service.process_analysis_payload(payload)
        self.redis.lrem(self.trading_service.PROCESSING_QUEUE_KEY, 1, payload)

        final = self.client.get(f"/api/v1/analysis/{initial['task_id']}")
        self.assertEqual(final.status_code, 200)

        body = final.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["execution_mode"], "default")
        self.assertEqual(body["decision"]["action"], "BUY")
        self.assertEqual(body["decision"]["confidence"], 0.82)
        self.assertTrue(body["stages"])
        self.assertEqual(body["stages"][0]["stage_id"], "market")
        self.assertEqual(body["analysis_report"]["messages"][0]["type"], "human")
        self.assertEqual(body["analysis_report"]["raw_state"]["raw_trace"]["provider"], "aliyun")
        self.assertIsNone(body["error"])

    def test_extract_analysis_report_includes_stage_metadata(self):
        state = {
            "market_report": "Momentum is improving after a short consolidation.",
            "sentiment_report": "Retail sentiment is positive but not euphoric.",
            "news_report": "Macro headlines remain mixed with limited immediate downside.",
            "fundamentals_report": "Revenue growth remains solid and margins are stable.",
            "investment_debate_state": {"judge_decision": "Bull case slightly outweighs the bear case."},
            "investment_plan": "Accumulate gradually with moderate sizing.",
            "trader_investment_plan": "Enter in tranches and reassess after confirmation.",
            "risk_debate_state": {"judge_decision": "Keep size moderate due to event risk."},
            "final_trade_decision": {"action": "BUY", "confidence": 0.82},
            "__stage_starts.Market Analyst": 10.0,
            "__stage_ends.Market Analyst": 12.5,
            "__stage_starts.Research Manager": 20.0,
            "__stage_ends.Research Manager": 23.0,
            "__stage_starts.Risk Judge": 30.0,
            "__stage_ends.Risk Judge": 31.2,
        }

        report = self.trading_service.extract_analysis_report(state, 31.2)

        self.assertIn("__stage_times", report)
        self.assertIn("__key_outputs", report)
        self.assertIn("__stages", report)
        self.assertAlmostEqual(report["__stage_times"]["market_report"], 2.5)
        self.assertAlmostEqual(report["__stage_times"]["investment_plan"], 3.0)
        self.assertAlmostEqual(report["__stage_times"]["final_trade_decision"], 1.2)
        self.assertEqual(report["__key_outputs"]["market_report"]["label"], "Technical")
        self.assertIn("Momentum is improving", report["__key_outputs"]["market_report"]["summary"])
        self.assertEqual(report["__stages"][0]["stage_id"], "market")
        self.assertEqual(report["__stages"][0]["backend"], "default")

    def test_processing_checkpoint_is_persisted_before_completion(self):
        snapshots = []
        original_save = self.trading_service.save_task_state

        def capture_save(task_state):
            snapshots.append(json.loads(json.dumps(task_state)))
            return original_save(task_state)

        payload = {
            "task_id": "checkpoint-task",
            "ticker": "NVDA",
            "date": "2024-05-10",
            "llm_config": {
                "provider": "aliyun",
                "deep_think_llm": "qwen3.5-flash",
                "quick_think_llm": "qwen3.5-flash",
            },
        }

        with patch.object(self.trading_service, "save_task_state", side_effect=capture_save):
            self.trading_service.process_analysis_payload(json.dumps(payload))

        processing_snapshots = [
            snap for snap in snapshots
            if snap["status"] == "processing"
            and isinstance(snap.get("analysis_report"), dict)
            and snap["analysis_report"].get("market_report") == "Partial market view ready."
        ]
        self.assertTrue(processing_snapshots)
        self.assertGreater(processing_snapshots[-1]["processing_time_seconds"], 0)


if __name__ == "__main__":
    unittest.main()
