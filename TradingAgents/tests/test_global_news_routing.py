import importlib.util
import sys
import types
import unittest
from pathlib import Path


INTERFACE_PATH = Path(__file__).resolve().parent.parent / "tradingagents" / "dataflows" / "interface.py"


def _callable(value):
    return lambda *args, **kwargs: value  # noqa: ARG005


def load_interface_module(news_vendor: str, alpha_impl, local_impl, openai_impl):
    module_names = [
        "tradingagents",
        "tradingagents.dataflows",
        "tradingagents.dataflows.local",
        "tradingagents.dataflows.y_finance",
        "tradingagents.dataflows.google",
        "tradingagents.dataflows.openai",
        "tradingagents.dataflows.alpha_vantage",
        "tradingagents.dataflows.alpha_vantage_news",
        "tradingagents.dataflows.alpha_vantage_common",
        "tradingagents.dataflows.config",
        "tradingagents.dataflows.interface",
    ]

    for name in module_names:
        sys.modules.pop(name, None)

    tradingagents_pkg = types.ModuleType("tradingagents")
    tradingagents_pkg.__path__ = []  # type: ignore[attr-defined]
    dataflows_pkg = types.ModuleType("tradingagents.dataflows")
    dataflows_pkg.__path__ = []  # type: ignore[attr-defined]

    local = types.ModuleType("tradingagents.dataflows.local")
    local.get_YFin_data = _callable("local-stock")
    local.get_finnhub_news = _callable("local-news")
    local.get_finnhub_company_insider_sentiment = _callable("local-insider-sentiment")
    local.get_finnhub_company_insider_transactions = _callable("local-insider-transactions")
    local.get_simfin_balance_sheet = _callable("local-balance")
    local.get_simfin_cashflow = _callable("local-cashflow")
    local.get_simfin_income_statements = _callable("local-income")
    local.get_reddit_global_news = local_impl
    local.get_reddit_company_news = _callable("reddit-company-news")

    y_finance = types.ModuleType("tradingagents.dataflows.y_finance")
    y_finance.get_YFin_data_online = _callable("yfinance-stock")
    y_finance.get_stock_stats_indicators_window = _callable("yfinance-indicators")
    y_finance.get_balance_sheet = _callable("yfinance-balance")
    y_finance.get_cashflow = _callable("yfinance-cashflow")
    y_finance.get_income_statement = _callable("yfinance-income")
    y_finance.get_insider_transactions = _callable("yfinance-insider-transactions")

    google = types.ModuleType("tradingagents.dataflows.google")
    google.get_google_news = _callable("google-news")

    openai = types.ModuleType("tradingagents.dataflows.openai")
    openai.get_stock_news_openai = _callable("openai-stock-news")
    openai.get_global_news_openai = openai_impl
    openai.get_fundamentals_openai = _callable("openai-fundamentals")

    alpha_vantage = types.ModuleType("tradingagents.dataflows.alpha_vantage")
    alpha_vantage.get_stock = _callable("alpha-stock")
    alpha_vantage.get_indicator = _callable("alpha-indicator")
    alpha_vantage.get_fundamentals = _callable("alpha-fundamentals")
    alpha_vantage.get_balance_sheet = _callable("alpha-balance")
    alpha_vantage.get_cashflow = _callable("alpha-cashflow")
    alpha_vantage.get_income_statement = _callable("alpha-income")
    alpha_vantage.get_insider_transactions = _callable("alpha-insider-transactions")
    alpha_vantage.get_news = _callable("alpha-news")

    alpha_vantage_news = types.ModuleType("tradingagents.dataflows.alpha_vantage_news")
    alpha_vantage_news.get_global_news = alpha_impl

    alpha_vantage_common = types.ModuleType("tradingagents.dataflows.alpha_vantage_common")

    class AlphaVantageRateLimitError(Exception):
        pass

    alpha_vantage_common.AlphaVantageRateLimitError = AlphaVantageRateLimitError

    config = types.ModuleType("tradingagents.dataflows.config")
    config.get_config = lambda: {"data_vendors": {"news_data": news_vendor}}

    sys.modules["tradingagents"] = tradingagents_pkg
    sys.modules["tradingagents.dataflows"] = dataflows_pkg
    sys.modules["tradingagents.dataflows.local"] = local
    sys.modules["tradingagents.dataflows.y_finance"] = y_finance
    sys.modules["tradingagents.dataflows.google"] = google
    sys.modules["tradingagents.dataflows.openai"] = openai
    sys.modules["tradingagents.dataflows.alpha_vantage"] = alpha_vantage
    sys.modules["tradingagents.dataflows.alpha_vantage_news"] = alpha_vantage_news
    sys.modules["tradingagents.dataflows.alpha_vantage_common"] = alpha_vantage_common
    sys.modules["tradingagents.dataflows.config"] = config

    spec = importlib.util.spec_from_file_location("tradingagents.dataflows.interface", INTERFACE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["tradingagents.dataflows.interface"] = module
    spec.loader.exec_module(module)
    return module, AlphaVantageRateLimitError


class GlobalNewsRoutingTest(unittest.TestCase):
    def test_global_news_uses_alpha_vantage_when_configured(self):
        calls = []

        def alpha_impl(*args, **kwargs):  # noqa: ARG001
            calls.append("alpha_vantage")
            return "alpha-global-news"

        def local_impl(*args, **kwargs):  # noqa: ARG001
            calls.append("local")
            return "local-global-news"

        def openai_impl(*args, **kwargs):  # noqa: ARG001
            calls.append("openai")
            return "openai-global-news"

        module, _ = load_interface_module("alpha_vantage", alpha_impl, local_impl, openai_impl)
        result = module.route_to_vendor("get_global_news", "2026-03-13", 7, 5)

        self.assertEqual(result, "alpha-global-news")
        self.assertEqual(calls, ["alpha_vantage"])

    def test_global_news_rate_limit_falls_back_to_local_not_openai(self):
        calls = []
        module_ref = {}

        def local_impl(*args, **kwargs):  # noqa: ARG001
            calls.append("local")
            return "local-global-news"

        def openai_impl(*args, **kwargs):  # noqa: ARG001
            calls.append("openai")
            raise AssertionError("OpenAI fallback should not be used for get_global_news")

        def alpha_impl(*args, **kwargs):  # noqa: ARG001
            calls.append("alpha_vantage")
            raise module_ref["rate_limit_error"]("rate limited")

        module, rate_limit_error = load_interface_module("alpha_vantage", alpha_impl, local_impl, openai_impl)
        module_ref["rate_limit_error"] = rate_limit_error

        result = module.route_to_vendor("get_global_news", "2026-03-13", 7, 5)

        self.assertEqual(result, "local-global-news")
        self.assertEqual(calls, ["alpha_vantage", "local"])


if __name__ == "__main__":
    unittest.main()
