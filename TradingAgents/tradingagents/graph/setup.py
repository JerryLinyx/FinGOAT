# TradingAgents/graph/setup.py

import asyncio
import time
from typing import Dict, Any
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph, START
from langgraph.prebuilt import ToolNode

from tradingagents.agents import *
from tradingagents.agents.utils.agent_states import AgentState

from .conditional_logic import ConditionalLogic


class GraphSetup:
    """Handles the setup and configuration of the agent graph."""

    def __init__(
        self,
        quick_thinking_llm: ChatOpenAI,
        deep_thinking_llm: ChatOpenAI,
        tool_nodes: Dict[str, ToolNode],
        bull_memory,
        bear_memory,
        trader_memory,
        invest_judge_memory,
        risk_manager_memory,
        conditional_logic: ConditionalLogic,
        config: Dict[str, Any],
        openclaw_adapter,
        usage_collector=None,
    ):
        """Initialize with required components."""
        self.quick_thinking_llm = quick_thinking_llm
        self.deep_thinking_llm = deep_thinking_llm
        self.tool_nodes = tool_nodes
        self.bull_memory = bull_memory
        self.bear_memory = bear_memory
        self.trader_memory = trader_memory
        self.invest_judge_memory = invest_judge_memory
        self.risk_manager_memory = risk_manager_memory
        self.conditional_logic = conditional_logic
        self.config = config
        self.openclaw_adapter = openclaw_adapter
        self.usage_collector = usage_collector

    def setup_graph(
        self, selected_analysts=["market", "social", "news", "fundamentals"]
    ):
        """Set up and compile the agent workflow graph.

        Args:
            selected_analysts (list): List of analyst types to include. Options are:
                - "market": Market analyst
                - "social": Social media analyst
                - "news": News analyst
                - "fundamentals": Fundamentals analyst
        """
        if len(selected_analysts) == 0:
            raise ValueError("Trading Agents Graph Setup Error: no analysts selected!")

        # Create analyst nodes
        analyst_nodes = {}
        tool_nodes = {}

        agent_backend_overrides = dict(self.config.get("agent_backend_overrides") or {})
        execution_mode = str(self.config.get("execution_mode") or "default")

        def analyst_backend(analyst_type: str) -> str:
            override = agent_backend_overrides.get(analyst_type)
            if isinstance(override, str) and override.strip():
                return override.strip().lower()
            # ADR-010 keeps LangGraph as the main orchestrator while allowing analyst-level OpenClaw routing.
            if execution_mode == "openclaw":
                return "openclaw"
            return "default"

        def build_openclaw_node(analyst_type: str):
            def node(state):
                return self.openclaw_adapter.run_stage(analyst_type, state)

            return node

        _collector = self.usage_collector

        if "market" in selected_analysts:
            analyst_nodes["market"] = create_market_analyst(
                self.quick_thinking_llm, usage_collector=_collector
            )
            if analyst_backend("market") == "openclaw":
                analyst_nodes["market"] = build_openclaw_node("market")
            else:
                tool_nodes["market"] = self.tool_nodes["market"]

        if "social" in selected_analysts:
            analyst_nodes["social"] = create_social_media_analyst(
                self.quick_thinking_llm, usage_collector=_collector
            )
            if analyst_backend("social") == "openclaw":
                analyst_nodes["social"] = build_openclaw_node("social")
            else:
                tool_nodes["social"] = self.tool_nodes["social"]

        if "news" in selected_analysts:
            analyst_nodes["news"] = create_news_analyst(
                self.quick_thinking_llm, usage_collector=_collector
            )
            if analyst_backend("news") == "openclaw":
                analyst_nodes["news"] = build_openclaw_node("news")
            else:
                tool_nodes["news"] = self.tool_nodes["news"]

        if "fundamentals" in selected_analysts:
            analyst_nodes["fundamentals"] = create_fundamentals_analyst(
                self.quick_thinking_llm, usage_collector=_collector
            )
            if analyst_backend("fundamentals") == "openclaw":
                analyst_nodes["fundamentals"] = build_openclaw_node("fundamentals")
            else:
                tool_nodes["fundamentals"] = self.tool_nodes["fundamentals"]

        # Create researcher and manager nodes
        bull_researcher_node = create_bull_researcher(
            self.quick_thinking_llm, self.bull_memory, usage_collector=_collector
        )
        bear_researcher_node = create_bear_researcher(
            self.quick_thinking_llm, self.bear_memory, usage_collector=_collector
        )
        research_manager_node = create_research_manager(
            self.deep_thinking_llm, self.invest_judge_memory, usage_collector=_collector
        )
        trader_node = create_trader(self.quick_thinking_llm, self.trader_memory, usage_collector=_collector)

        # Create risk analysis nodes
        risky_analyst = create_risky_debator(self.quick_thinking_llm, usage_collector=_collector)
        neutral_analyst = create_neutral_debator(self.quick_thinking_llm, usage_collector=_collector)
        safe_analyst = create_safe_debator(self.quick_thinking_llm, usage_collector=_collector)
        risk_manager_node = create_risk_manager(
            self.deep_thinking_llm, self.risk_manager_memory, usage_collector=_collector
        )

        # Create workflow
        workflow = StateGraph(AgentState)

        def timed_node(label: str, fn):
            async def wrapper(state):
                start_key = f"__stage_starts.{label}"
                end_key = f"__stage_ends.{label}"

                start_ts = state.get(start_key, time.time())
                result = fn(state)
                if asyncio.iscoroutine(result) or isinstance(result, asyncio.Future):
                    result = await result
                end_ts = time.time()

                timing_update = {start_key: start_ts, end_key: end_ts}
                if isinstance(result, dict):
                    return {**result, **timing_update}
                return timing_update

            return wrapper

        # Add analyst nodes to the graph
        for analyst_type, node in analyst_nodes.items():
            workflow.add_node(
                f"{analyst_type.capitalize()} Analyst",
                timed_node(f"{analyst_type.capitalize()} Analyst", node),
            )
            if analyst_type in tool_nodes:
                workflow.add_node(f"tools_{analyst_type}", tool_nodes[analyst_type])

        workflow.add_node("Analyst Join", lambda state: state)
        workflow.add_node("Analyst Wait", lambda state: state)
        workflow.add_node("Msg Clear Analysts", create_msg_delete())

        # Add other nodes
        workflow.add_node("Bull Researcher", timed_node("Bull Researcher", bull_researcher_node))
        workflow.add_node("Bear Researcher", timed_node("Bear Researcher", bear_researcher_node))
        workflow.add_node("Research Manager", timed_node("Research Manager", research_manager_node))
        workflow.add_node("Trader", timed_node("Trader", trader_node))
        workflow.add_node("Risky Analyst", timed_node("Risky Analyst", risky_analyst))
        workflow.add_node("Neutral Analyst", timed_node("Neutral Analyst", neutral_analyst))
        workflow.add_node("Safe Analyst", timed_node("Safe Analyst", safe_analyst))
        workflow.add_node("Risk Judge", timed_node("Risk Judge", risk_manager_node))

        def should_proceed_all_analysts(state):
            required_reports = []
            if "market" in selected_analysts:
                required_reports.append(state.get("market_report"))
            if "social" in selected_analysts:
                required_reports.append(state.get("sentiment_report"))
            if "news" in selected_analysts:
                required_reports.append(state.get("news_report"))
            if "fundamentals" in selected_analysts:
                required_reports.append(state.get("fundamentals_report"))

            ready = all(bool(report) for report in required_reports)
            return "proceed" if ready else "wait"

        # Define edges
        # Start all independent analysts in parallel. Synchronize them through
        # an explicit join node before entering the downstream debate workflow.
        for analyst_type in selected_analysts:
            workflow.add_edge(START, f"{analyst_type.capitalize()} Analyst")

        for analyst_type in selected_analysts:
            current_analyst = f"{analyst_type.capitalize()} Analyst"
            if analyst_type in tool_nodes:
                current_tools = f"tools_{analyst_type}"

                workflow.add_conditional_edges(
                    current_analyst,
                    getattr(self.conditional_logic, f"should_continue_{analyst_type}"),
                    [current_tools, "Analyst Join"],
                )
                workflow.add_edge(current_tools, current_analyst)
            else:
                workflow.add_edge(current_analyst, "Analyst Join")

        workflow.add_conditional_edges(
            "Analyst Join",
            should_proceed_all_analysts,
            {
                "proceed": "Msg Clear Analysts",
                "wait": "Analyst Wait",
            },
        )
        workflow.add_edge("Analyst Wait", "Analyst Join")
        workflow.add_edge("Msg Clear Analysts", "Bull Researcher")

        # Add remaining edges
        workflow.add_conditional_edges(
            "Bull Researcher",
            self.conditional_logic.should_continue_debate,
            {
                "Bear Researcher": "Bear Researcher",
                "Research Manager": "Research Manager",
            },
        )
        workflow.add_conditional_edges(
            "Bear Researcher",
            self.conditional_logic.should_continue_debate,
            {
                "Bull Researcher": "Bull Researcher",
                "Research Manager": "Research Manager",
            },
        )
        workflow.add_edge("Research Manager", "Trader")
        workflow.add_edge("Trader", "Risky Analyst")
        workflow.add_conditional_edges(
            "Risky Analyst",
            self.conditional_logic.should_continue_risk_analysis,
            {
                "Safe Analyst": "Safe Analyst",
                "Risk Judge": "Risk Judge",
            },
        )
        workflow.add_conditional_edges(
            "Safe Analyst",
            self.conditional_logic.should_continue_risk_analysis,
            {
                "Neutral Analyst": "Neutral Analyst",
                "Risk Judge": "Risk Judge",
            },
        )
        workflow.add_conditional_edges(
            "Neutral Analyst",
            self.conditional_logic.should_continue_risk_analysis,
            {
                "Risky Analyst": "Risky Analyst",
                "Risk Judge": "Risk Judge",
            },
        )

        workflow.add_edge("Risk Judge", END)

        # Compile and return
        return workflow.compile()
