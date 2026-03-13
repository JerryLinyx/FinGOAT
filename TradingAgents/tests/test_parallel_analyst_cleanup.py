import importlib.util
import os
import sys
import types
import unittest
from types import SimpleNamespace

MODULE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "tradingagents", "graph", "conditional_logic.py")
)
tradingagents_pkg = types.ModuleType("tradingagents")
tradingagents_pkg.__path__ = []  # type: ignore[attr-defined]
agents_pkg = types.ModuleType("tradingagents.agents")
agents_pkg.__path__ = []  # type: ignore[attr-defined]
utils_pkg = types.ModuleType("tradingagents.agents.utils")
utils_pkg.__path__ = []  # type: ignore[attr-defined]
agent_states_module = types.ModuleType("tradingagents.agents.utils.agent_states")
agent_states_module.AgentState = dict
sys.modules.setdefault("tradingagents", tradingagents_pkg)
sys.modules.setdefault("tradingagents.agents", agents_pkg)
sys.modules.setdefault("tradingagents.agents.utils", utils_pkg)
sys.modules.setdefault("tradingagents.agents.utils.agent_states", agent_states_module)
SPEC = importlib.util.spec_from_file_location("conditional_logic_under_test", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
ConditionalLogic = MODULE.ConditionalLogic


class ParallelAnalystCleanupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.logic = ConditionalLogic()

    def test_market_joins_after_last_non_tool_message(self) -> None:
        state = {"messages": [SimpleNamespace(tool_calls=[])]}
        self.assertEqual(self.logic.should_continue_market(state), "Analyst Join")

    def test_social_joins_after_last_non_tool_message(self) -> None:
        state = {"messages": [SimpleNamespace(tool_calls=[])]}
        self.assertEqual(self.logic.should_continue_social(state), "Analyst Join")

    def test_news_joins_after_last_non_tool_message(self) -> None:
        state = {"messages": [SimpleNamespace(tool_calls=[])]}
        self.assertEqual(self.logic.should_continue_news(state), "Analyst Join")

    def test_fundamentals_joins_after_last_non_tool_message(self) -> None:
        state = {"messages": [SimpleNamespace(tool_calls=[])]}
        self.assertEqual(self.logic.should_continue_fundamentals(state), "Analyst Join")

    def test_tool_calls_still_route_back_to_tools(self) -> None:
        state = {"messages": [SimpleNamespace(tool_calls=[{"id": "call-1"}])]}
        self.assertEqual(self.logic.should_continue_market(state), "tools_market")
        self.assertEqual(self.logic.should_continue_social(state), "tools_social")
        self.assertEqual(self.logic.should_continue_news(state), "tools_news")
        self.assertEqual(self.logic.should_continue_fundamentals(state), "tools_fundamentals")


if __name__ == "__main__":
    unittest.main()
