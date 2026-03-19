import importlib.util
import os
import sys
import types
import unittest
from typing import TypedDict as StdlibTypedDict, Optional as StdlibOptional


MODULE_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "tradingagents",
        "agents",
        "utils",
        "agent_states.py",
    )
)


langchain_openai = types.ModuleType("langchain_openai")
langchain_openai.ChatOpenAI = object
sys.modules.setdefault("langchain_openai", langchain_openai)

tradingagents_pkg = types.ModuleType("tradingagents")
tradingagents_pkg.__path__ = []  # type: ignore[attr-defined]
agents_pkg = types.ModuleType("tradingagents.agents")
agents_pkg.__path__ = []  # type: ignore[attr-defined]
sys.modules.setdefault("tradingagents", tradingagents_pkg)
sys.modules.setdefault("tradingagents.agents", agents_pkg)

langgraph_pkg = types.ModuleType("langgraph")
prebuilt_module = types.ModuleType("langgraph.prebuilt")
prebuilt_module.ToolNode = object
graph_module = types.ModuleType("langgraph.graph")
graph_module.END = object()
graph_module.START = object()
graph_module.StateGraph = object
graph_module.MessagesState = dict
sys.modules.setdefault("langgraph", langgraph_pkg)
sys.modules.setdefault("langgraph.prebuilt", prebuilt_module)
sys.modules.setdefault("langgraph.graph", graph_module)

typing_extensions_module = types.ModuleType("typing_extensions")
typing_extensions_module.TypedDict = StdlibTypedDict
typing_extensions_module.Optional = StdlibOptional
sys.modules.setdefault("typing_extensions", typing_extensions_module)

SPEC = importlib.util.spec_from_file_location("agent_states_under_test", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AgentStateReducersTest(unittest.TestCase):
    def test_keep_latest_non_empty_prefers_new_content(self) -> None:
        self.assertEqual(MODULE.keep_latest_non_empty("", "report"), "report")

    def test_keep_latest_non_empty_preserves_existing_on_empty_update(self) -> None:
        self.assertEqual(MODULE.keep_latest_non_empty("report", ""), "report")


if __name__ == "__main__":
    unittest.main()
