import json
import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SERVICE_DIR = Path(__file__).resolve().parents[2]


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

    def expire(self, key, ttl):  # noqa: ARG002
        return True

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

    def xadd(self, key, values, maxlen=None):  # noqa: ARG002
        self._lists.setdefault(key, []).append(values)
        return str(len(self._lists[key]))

    def close(self):
        return None

    def pipeline(self):
        outer = self

        class FakePipeline:
            def __init__(self):
                self._ops = []

            def rpush(self, key, value):
                self._ops.append(("rpush", key, value))
                return self

            def expire(self, key, ttl):
                self._ops.append(("expire", key, ttl))
                return self

            def execute(self):
                for op, key, value in self._ops:
                    if op == "rpush":
                        outer._lists.setdefault(key, []).append(value)
                    elif op == "expire":
                        outer.expire(key, value)
                return True

        return FakePipeline()


class FakeProcess:
    def __init__(self, target=None, args=(), name=None, daemon=None):  # noqa: ARG002
        self.target = target
        self.args = args
        self.name = name
        self.daemon = daemon
        self.exitcode = None
        self.started = False

    def start(self):
        self.started = True
        try:
            if self.target is not None:
                self.target(*self.args)
            self.exitcode = 0
        except Exception:
            self.exitcode = 1
            raise

    def is_alive(self):
        return False

    def join(self, timeout=None):  # noqa: ARG002
        return None

    def terminate(self):
        self.exitcode = -15

    def kill(self):
        self.exitcode = -9


class FakeTradingAgentsGraph:
    def __init__(self, debug=False, config=None, selected_analysts=None, usage_collector=None):  # noqa: ARG002
        self.debug = debug
        self.config = config or {}
        self.selected_analysts = selected_analysts or ["market", "social", "news", "fundamentals"]
        self.usage_collector = usage_collector

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

    async def propagate_streaming(self, company_name, trade_date, token_callback, stage_end_callback, event_callback=None):  # noqa: ARG002
        stage_id = self.selected_analysts[0] if self.selected_analysts else None
        if self.config.get("top_level_only") and stage_id:
            node_name = {
                "market": "Market Analyst",
                "social": "Social Analyst",
                "news": "News Analyst",
                "fundamentals": "Fundamentals Analyst",
            }[stage_id]
            report_key = {
                "market": "market_report",
                "social": "sentiment_report",
                "news": "news_report",
                "fundamentals": "fundamentals_report",
            }[stage_id]
            state = {
                "company_of_interest": company_name,
                "trade_date": trade_date,
                report_key: f"{stage_id} report ready.",
                f"__stage_starts.{node_name}": 0.0,
                f"__stage_ends.{node_name}": 1.5,
                "__stage_usage": {
                    stage_id: {
                        "prompt_tokens": 50,
                        "completion_tokens": 20,
                        "total_tokens": 70,
                        "llm_calls": 1,
                        "failed_calls": 0,
                        "latency_ms": 800,
                    }
                },
            }
            await token_callback(stage_id, node_name, f"{stage_id} token")
            await stage_end_callback(stage_id, state)
            return state

        partial_state = {
            "company_of_interest": company_name,
            "trade_date": trade_date,
            "market_report": "Partial market view ready.",
            "__stage_starts.Market Analyst": 0.0,
            "__stage_ends.Market Analyst": 1.5,
        }
        await token_callback("market", "Market Analyst", "Partial market")
        await stage_end_callback("market", partial_state)

        state = json.loads((FIXTURES_DIR / "fake_graph_state.json").read_text())
        state["company_of_interest"] = company_name
        state["trade_date"] = trade_date
        state["raw_trace"]["provider"] = self.config.get("llm_provider", "mock-llm")
        return state

    async def propagate_from_state_streaming(self, init_state, token_callback, stage_end_callback, event_callback=None):  # noqa: ARG002
        state = dict(init_state)
        state.update(json.loads((FIXTURES_DIR / "fake_graph_state.json").read_text()))
        state["company_of_interest"] = init_state.get("company_of_interest", "NVDA")
        state["trade_date"] = init_state.get("trade_date", "2024-05-10")
        state["raw_trace"]["provider"] = self.config.get("llm_provider", "mock-llm")
        await token_callback("research_debate", "Bull Researcher", "bull token")
        await stage_end_callback("research_debate", state)
        await stage_end_callback("portfolio_manager", state)
        await stage_end_callback("trader_plan", state)
        await stage_end_callback("risk_debate", state)
        await stage_end_callback("risk_management", state)
        return state

    def process_signal(self, full_signal):
        if isinstance(full_signal, dict) and full_signal:
            return full_signal
        return json.loads((FIXTURES_DIR / "fake_decision.json").read_text())


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
    propagation_module = types.ModuleType("tradingagents.graph.propagation")

    class FakePropagator:
        def create_initial_state(self, company_name: str, trade_date: str):
            return {
                "messages": [("human", company_name)],
                "company_of_interest": company_name,
                "trade_date": trade_date,
                "investment_debate_state": {"history": "", "current_response": "", "count": 0},
                "risk_debate_state": {
                    "history": "",
                    "risky_history": "",
                    "safe_history": "",
                    "neutral_history": "",
                    "latest_speaker": "",
                    "current_risky_response": "",
                    "current_safe_response": "",
                    "current_neutral_response": "",
                    "judge_decision": "",
                    "count": 0,
                },
                "market_report": "",
                "fundamentals_report": "",
                "sentiment_report": "",
                "news_report": "",
            }

    propagation_module.Propagator = FakePropagator

    sys.modules["tradingagents"] = tradingagents_pkg
    sys.modules["tradingagents.default_config"] = default_config_module
    sys.modules["tradingagents.graph"] = graph_pkg
    sys.modules["tradingagents.graph.trading_graph"] = trading_graph_module
    sys.modules["tradingagents.graph.propagation"] = propagation_module


def install_fake_marketdata_modules() -> None:
    marketdata_pkg = types.ModuleType("marketdata")
    marketdata_pkg.__path__ = []  # type: ignore[attr-defined]
    services_pkg = types.ModuleType("marketdata.services")
    services_pkg.__path__ = []  # type: ignore[attr-defined]

    candles_module = types.ModuleType("marketdata.services.candles_service")
    candles_module.get_chart_payload = lambda *args, **kwargs: {}  # noqa: ARG005

    quote_module = types.ModuleType("marketdata.services.quote_service")
    quote_module.get_quote = lambda *args, **kwargs: {}  # noqa: ARG005

    snapshot_module = types.ModuleType("marketdata.services.snapshot_service")
    snapshot_module.get_terminal_snapshot = lambda *args, **kwargs: {}  # noqa: ARG005

    sys.modules["marketdata"] = marketdata_pkg
    sys.modules["marketdata.services"] = services_pkg
    sys.modules["marketdata.services.candles_service"] = candles_module
    sys.modules["marketdata.services.quote_service"] = quote_module
    sys.modules["marketdata.services.snapshot_service"] = snapshot_module


class MockAnalysisPipelineTest(unittest.TestCase):
    def setUp(self):
        install_fake_tradingagents_modules()
        install_fake_marketdata_modules()
        if str(SERVICE_DIR) not in sys.path:
            sys.path.insert(0, str(SERVICE_DIR))
        sys.modules.pop("trading_service", None)
        self.trading_service = importlib.import_module("trading_service")
        self.redis = FakeRedis()
        self.trading_service.redis_client = None
        self.trading_service.worker_thread = None
        self.trading_service.worker_stop_event.clear()

        self.redis_patch = patch.object(self.trading_service, "get_redis_client", return_value=self.redis)
        self.worker_patch = patch.object(self.trading_service, "ensure_worker_thread_running", return_value=False)
        self.graph_patch = patch.object(self.trading_service, "TradingAgentsGraph", FakeTradingAgentsGraph)
        self.process_patch = patch.object(self.trading_service.multiprocessing, "Process", FakeProcess)
        self.redis_builder_patch = patch.object(self.trading_service, "build_redis_client", return_value=self.redis)

        self.redis_patch.start()
        self.worker_patch.start()
        self.graph_patch.start()
        self.process_patch.start()
        self.redis_builder_patch.start()
        self.client = TestClient(self.trading_service.app)

    def tearDown(self):
        self.client.close()
        self.process_patch.stop()
        self.graph_patch.stop()
        self.worker_patch.stop()
        self.redis_patch.stop()
        self.redis_builder_patch.stop()
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
                    "provider": "dashscope",
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
        self.assertEqual(body["stages"][0]["backend"], "default")
        self.assertEqual(body["stages"][0]["provider"], "dashscope")
        self.assertEqual(body["analysis_report"]["messages"][0]["type"], "human")
        self.assertEqual(body["analysis_report"]["raw_state"]["raw_trace"]["provider"], "dashscope")
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
        self.assertEqual(report["__stages"][0]["provider"], "unknown")

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
                "provider": "dashscope",
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
            and snap["analysis_report"].get("market_report")
        ]
        self.assertTrue(processing_snapshots)
        self.assertGreater(processing_snapshots[-1]["processing_time_seconds"], 0)

    def test_parallel_analyst_subprocesses_publish_stream_events(self):
        payload = {
            "task_id": "streaming-top-analysts",
            "ticker": "NVDA",
            "date": "2024-05-10",
            "llm_config": {
                "provider": "dashscope",
                "deep_think_llm": "qwen3.5-flash",
                "quick_think_llm": "qwen3.5-flash",
            },
        }

        self.trading_service.process_analysis_payload(json.dumps(payload))

        for stage_id in ("market", "social", "news", "fundamentals"):
            stream_key = self.trading_service.analyst_stream_key(payload["task_id"], stage_id)
            entries = self.redis._lists.get(stream_key, [])
            self.assertTrue(entries, f"missing stream entries for {stage_id}")
            self.assertEqual(entries[0]["type"], "analyst_start")
            self.assertIn(entries[-1]["type"], {"stage_end", "analyst_complete"})

    def test_extract_analysis_report_includes_stage_usage(self):
        class FakeCollector:
            def stage_usage_summary(self):
                return {
                    "market": {
                        "prompt_tokens": 120,
                        "completion_tokens": 45,
                        "total_tokens": 165,
                        "llm_calls": 1,
                        "failed_calls": 0,
                        "latency_ms": 1800,
                    },
                    "research_debate": {
                        "prompt_tokens": 300,
                        "completion_tokens": 110,
                        "total_tokens": 410,
                        "llm_calls": 2,
                        "failed_calls": 0,
                        "latency_ms": 4200,
                    },
                }

        state = {
            "market_report": "Momentum is improving after a short consolidation.",
            "investment_debate_state": {"judge_decision": "Bull case slightly outweighs the bear case."},
            "__stage_starts.Market Analyst": 10.0,
            "__stage_ends.Market Analyst": 12.5,
            "__stage_starts.Bull Researcher": 20.0,
            "__stage_ends.Bull Researcher": 23.0,
        }

        report = self.trading_service.extract_analysis_report(state, 23.0, usage_collector=FakeCollector())

        self.assertIn("__stage_usage", report)
        self.assertEqual(report["__stage_usage"]["market"]["total_tokens"], 165)
        self.assertEqual(report["__stage_usage"]["research_debate"]["llm_calls"], 2)
        self.assertEqual(report["__stages"][0]["total_tokens"], 165)
        self.assertEqual(report["__stages"][4]["prompt_tokens"], 300)
        self.assertEqual(report["__stages"][4]["latency_ms"], 4200)


if __name__ == "__main__":
    unittest.main()
