import importlib
import os
import sys
import types
import unittest
from unittest.mock import patch


TRADING_AGENTS_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class FakeResponses:
    def create(self, **kwargs):
        self.kwargs = kwargs
        return types.SimpleNamespace(output=[None, types.SimpleNamespace(content=[types.SimpleNamespace(text="ok")])])


class FakeClient:
    instances = []

    def __init__(self, base_url=None, api_key=None):
        self.base_url = base_url
        self.api_key = api_key
        self.responses = FakeResponses()
        FakeClient.instances.append(self)


class OpenAIToolKeyRoutingTest(unittest.TestCase):
    def setUp(self):
        openai_module = types.ModuleType("openai")
        openai_module.OpenAI = FakeClient
        sys.modules["openai"] = openai_module
        FakeClient.instances = []

        if TRADING_AGENTS_ROOT not in sys.path:
            sys.path.insert(0, TRADING_AGENTS_ROOT)
        sys.modules.pop("tradingagents.dataflows.openai", None)
        self.module = importlib.import_module("tradingagents.dataflows.openai")

    def tearDown(self):
        sys.modules.pop("tradingagents.dataflows.openai", None)
        sys.modules.pop("openai", None)

    def test_openai_tooling_ignores_generic_llm_api_key(self):
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "real-openai-key",
                "LLM_API_KEY": "wrong-provider-key",
            },
            clear=False,
        ):
            result = self.module.get_global_news_openai("2026-03-21")

        self.assertEqual(result, "ok")
        self.assertEqual(len(FakeClient.instances), 1)
        self.assertEqual(FakeClient.instances[0].api_key, "real-openai-key")
        self.assertEqual(FakeClient.instances[0].base_url, "https://api.openai.com/v1")


if __name__ == "__main__":
    unittest.main()
