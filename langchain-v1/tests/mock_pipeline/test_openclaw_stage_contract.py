import importlib
import sys
import unittest

from tests.mock_pipeline.test_mock_analysis_pipeline import install_fake_tradingagents_modules


class OpenClawStageContractTest(unittest.TestCase):
    def setUp(self):
        install_fake_tradingagents_modules()
        sys.modules.pop("trading_service", None)
        self.trading_service = importlib.import_module("trading_service")

    def tearDown(self):
        sys.modules.pop("trading_service", None)

    def test_extract_analysis_report_preserves_openclaw_stage_metadata(self):
        state = {
            "market_report": "OpenClaw produced a stage-specific market brief.",
            "__stage_backend.market_report": "openclaw",
            "__stage_agent_id.market_report": "user-1-market-analyst",
            "__stage_session_key.market_report": "agent:user-1-market-analyst:web:analysis:task-1:market",
            "__stage_summary.market_report": "OpenClaw market summary",
            "__stage_raw_output.market_report": {"result": {"payloads": [{"text": "body"}]}},
            "__stage_started_at.market_report": "2026-03-13T10:00:00Z",
            "__stage_completed_at.market_report": "2026-03-13T10:00:02Z",
            "__stage_starts.Market Analyst": 0.0,
            "__stage_ends.Market Analyst": 2.0,
        }

        report = self.trading_service.extract_analysis_report(
            state,
            2.0,
            task_status="processing",
            execution_mode="openclaw",
        )

        self.assertEqual(report["__stages"][0]["backend"], "openclaw")
        self.assertEqual(report["__stages"][0]["agent_id"], "user-1-market-analyst")
        self.assertEqual(report["__stages"][0]["session_key"], "agent:user-1-market-analyst:web:analysis:task-1:market")
        self.assertEqual(report["__stages"][0]["summary"], "OpenClaw market summary")
        self.assertEqual(report["__stages"][0]["duration_seconds"], 2.0)


if __name__ == "__main__":
    unittest.main()
