import importlib
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from test_mock_analysis_pipeline import install_fake_marketdata_modules, install_fake_tradingagents_modules

SERVICE_DIR = Path(__file__).resolve().parents[2]


class FakeProcess:
    def __init__(self, target=None, args=(), name=None):  # noqa: ARG002
        self.target = target
        self.args = args
        self.name = name
        self.started = False
        self.terminated = False
        self.killed = False
        self.join_calls = 0
        self.exitcode = None

    def start(self):
        self.started = True

    def is_alive(self):
        return self.started and self.exitcode is None

    def join(self, timeout=None):  # noqa: ARG002
        self.join_calls += 1
        return None

    def terminate(self):
        self.terminated = True
        self.exitcode = -15

    def kill(self):
        self.killed = True
        self.exitcode = -9


class AnalysisCancellationProcessTest(unittest.TestCase):
    def setUp(self):
        install_fake_tradingagents_modules()
        install_fake_marketdata_modules()
        if str(SERVICE_DIR) not in sys.path:
            sys.path.insert(0, str(SERVICE_DIR))
        sys.modules.pop("trading_service", None)
        self.trading_service = importlib.import_module("trading_service")

    def tearDown(self):
        sys.modules.pop("trading_service", None)

    def test_process_analysis_payload_terminates_running_subprocess_on_cancel(self):
        payload = json.dumps(
            {
                "task_id": "task-cancel-1",
                "ticker": "NVDA",
                "market": "us",
                "date": "2024-05-10",
                "execution_mode": "default",
                "llm_config": {"provider": "ollama"},
            }
        )

        process_holder = {}

        def fake_process_factory(*args, **kwargs):
            proc = FakeProcess(*args, **kwargs)
            process_holder["proc"] = proc
            return proc

        with (
            patch.object(self.trading_service.multiprocessing, "Process", side_effect=fake_process_factory),
            patch.object(
                self.trading_service,
                "load_task_state",
                side_effect=[
                    {"status": self.trading_service.TaskStatus.PENDING.value},
                    {"status": self.trading_service.TaskStatus.CANCELLED.value},
                ],
            ),
        ):
            self.trading_service.process_analysis_payload(payload)

        proc = process_holder["proc"]
        self.assertTrue(proc.started)
        self.assertTrue(proc.terminated)
        self.assertFalse(proc.killed)


if __name__ == "__main__":
    unittest.main()
