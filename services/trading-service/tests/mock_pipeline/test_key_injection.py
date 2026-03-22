import importlib
import importlib.util
import os
import sys
import unittest
from pathlib import Path


TESTS_DIR = Path(__file__).resolve().parent
SERVICE_DIR = TESTS_DIR.parents[1]


def load_mock_pipeline_helpers():
    helper_path = TESTS_DIR / "test_mock_analysis_pipeline.py"
    spec = importlib.util.spec_from_file_location("mock_pipeline_helpers", helper_path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    return module


install_fake_tradingagents_modules = load_mock_pipeline_helpers().install_fake_tradingagents_modules
install_fake_marketdata_modules = load_mock_pipeline_helpers().install_fake_marketdata_modules


class KeyInjectionIsolationTest(unittest.TestCase):
    def setUp(self):
        install_fake_tradingagents_modules()
        install_fake_marketdata_modules()
        if str(SERVICE_DIR) not in sys.path:
            sys.path.insert(0, str(SERVICE_DIR))
        sys.modules.pop("trading_service", None)
        self.trading_service = importlib.import_module("trading_service")
        self.original_env = dict(os.environ)
        self.original_base = dict(self.trading_service._BASE_PROVIDER_ENV)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.original_env)
        self.trading_service._BASE_PROVIDER_ENV = self.original_base
        sys.modules.pop("trading_service", None)

    def test_inject_user_keys_restores_base_env_before_setting_new_provider(self):
        self.trading_service._BASE_PROVIDER_ENV = {
            "ALPHA_VANTAGE_API_KEY": "base-av",
            "LLM_API_KEY": None,
            "OPENAI_API_KEY": "base-openai",
            "ANTHROPIC_API_KEY": None,
            "CLAUDE_API_KEY": None,
            "GOOGLE_API_KEY": None,
            "GEMINI_API_KEY": None,
            "DEEPSEEK_API_KEY": None,
            "DASHSCOPE_API_KEY": None,
        }

        os.environ["OPENAI_API_KEY"] = "stale-openai-user"
        os.environ["DEEPSEEK_API_KEY"] = "stale-deepseek-user"
        os.environ["LLM_API_KEY"] = "stale-llm-key"

        self.trading_service._inject_user_keys_to_env(
            {
                "llm_provider": "dashscope",
                "llm_api_key": "dash-user-key",
                "alpha_vantage_api_key": "user-av",
            }
        )

        self.assertEqual(os.environ["DASHSCOPE_API_KEY"], "dash-user-key")
        self.assertEqual(os.environ["LLM_API_KEY"], "dash-user-key")
        self.assertEqual(os.environ["ALPHA_VANTAGE_API_KEY"], "user-av")
        self.assertEqual(os.environ["OPENAI_API_KEY"], "base-openai")
        self.assertNotIn("DEEPSEEK_API_KEY", os.environ)

    def test_openai_provider_sets_explicit_openai_env(self):
        self.trading_service._BASE_PROVIDER_ENV = {
            "ALPHA_VANTAGE_API_KEY": None,
            "LLM_API_KEY": None,
            "OPENAI_API_KEY": None,
            "ANTHROPIC_API_KEY": None,
            "CLAUDE_API_KEY": None,
            "GOOGLE_API_KEY": None,
            "GEMINI_API_KEY": None,
            "DEEPSEEK_API_KEY": None,
            "DASHSCOPE_API_KEY": None,
        }

        self.trading_service._inject_user_keys_to_env(
            {
                "llm_provider": "openai",
                "llm_api_key": "openai-user-key",
            }
        )

        self.assertEqual(os.environ["OPENAI_API_KEY"], "openai-user-key")
        self.assertEqual(os.environ["LLM_API_KEY"], "openai-user-key")


if __name__ == "__main__":
    unittest.main()
