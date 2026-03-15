# TradingAgents/graph/trading_graph.py

import os
import asyncio
from pathlib import Path
import json
from datetime import date
from typing import Dict, Any, Tuple, List, Optional, Callable, Awaitable

from langgraph.prebuilt import ToolNode

from tradingagents.agents import *
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.agents.utils.memory import FinancialSituationMemory
from tradingagents.agents.utils.agent_states import (
    AgentState,
    InvestDebateState,
    RiskDebateState,
)
from tradingagents.dataflows.config import set_config

# Import the new abstract tool methods from agent_utils
from tradingagents.agents.utils.agent_utils import (
    get_stock_data,
    get_indicators,
    get_fundamentals,
    get_balance_sheet,
    get_cashflow,
    get_income_statement,
    get_news,
    get_insider_sentiment,
    get_insider_transactions,
    get_global_news
)

from tradingagents.llm_provider import build_llm
from tradingagents.openclaw import OpenClawAnalystAdapter
from .conditional_logic import ConditionalLogic
from .setup import GraphSetup
from .propagation import Propagator
from .reflection import Reflector
from .signal_processing import SignalProcessor


# ── Streaming helpers ────────────────────────────────────────────────────────

# Maps LangGraph node name → frontend stage_id used in StageProgress
NODE_TO_STAGE: dict = {
    "Market Analyst":       "market",
    "Social Analyst":       "social",
    "News Analyst":         "news",
    "Fundamentals Analyst": "fundamentals",
    "Bull Researcher":      "research_debate",
    "Bear Researcher":      "research_debate",
    "Research Manager":     "portfolio_manager",   # fills investment_plan
    "Trader":               "trader_plan",
    "Risky Analyst":        "risk_debate",
    "Safe Analyst":         "risk_debate",
    "Neutral Analyst":      "risk_debate",
    "Risk Judge":           "risk_management",
}

# Tool / join nodes that produce no meaningful LLM tokens
SKIP_NODES: frozenset = frozenset({
    "Analyst Join", "Analyst Wait", "Msg Clear Analysts",
    "tools_market", "tools_social", "tools_news", "tools_fundamentals",
})


class TradingAgentsGraph:
    """Main class that orchestrates the trading agents framework."""

    def __init__(
        self,
        selected_analysts=["market", "social", "news", "fundamentals"],
        debug=False,
        config: Dict[str, Any] = None,
    ):
        """Initialize the trading agents graph and components.

        Args:
            selected_analysts: List of analyst types to include
            debug: Whether to run in debug mode
            config: Configuration dictionary. If None, uses default config
        """
        self.debug = debug
        self.config = config or DEFAULT_CONFIG

        # Update the interface's config
        set_config(self.config)

        # Create necessary directories
        os.makedirs(
            os.path.join(self.config["project_dir"], "dataflows/data_cache"),
            exist_ok=True,
        )

        # Initialize LLMs
        self.deep_thinking_llm = build_llm(self.config, which="deep")
        self.quick_thinking_llm = build_llm(self.config, which="quick")
        
        # Initialize memories
        self.bull_memory = FinancialSituationMemory("bull_memory", self.config)
        self.bear_memory = FinancialSituationMemory("bear_memory", self.config)
        self.trader_memory = FinancialSituationMemory("trader_memory", self.config)
        self.invest_judge_memory = FinancialSituationMemory("invest_judge_memory", self.config)
        self.risk_manager_memory = FinancialSituationMemory("risk_manager_memory", self.config)

        # Create tool nodes
        self.tool_nodes = self._create_tool_nodes()

        # Initialize components
        self.conditional_logic = ConditionalLogic()
        self.graph_setup = GraphSetup(
            self.quick_thinking_llm,
            self.deep_thinking_llm,
            self.tool_nodes,
            self.bull_memory,
            self.bear_memory,
            self.trader_memory,
            self.invest_judge_memory,
            self.risk_manager_memory,
            self.conditional_logic,
            self.config,
            OpenClawAnalystAdapter(self.config),
        )

        self.propagator = Propagator()
        self.reflector = Reflector(self.quick_thinking_llm)
        self.signal_processor = SignalProcessor(self.quick_thinking_llm)

        # State tracking
        self.curr_state = None
        self.ticker = None
        self.log_states_dict = {}  # date to full state dict

        # Set up the graph
        self.graph = self.graph_setup.setup_graph(selected_analysts)

    def _create_tool_nodes(self) -> Dict[str, ToolNode]:
        """Create tool nodes for different data sources using abstract methods."""
        return {
            "market": ToolNode(
                [
                    # Core stock data tools
                    get_stock_data,
                    # Technical indicators
                    get_indicators,
                ]
            ),
            "social": ToolNode(
                [
                    # News tools for social media analysis
                    get_news,
                ]
            ),
            "news": ToolNode(
                [
                    # News and insider information
                    get_news,
                    get_global_news,
                    get_insider_sentiment,
                    get_insider_transactions,
                ]
            ),
            "fundamentals": ToolNode(
                [
                    # Fundamental analysis tools
                    get_fundamentals,
                    get_balance_sheet,
                    get_cashflow,
                    get_income_statement,
                ]
            ),
        }

    def propagate(
        self,
        company_name,
        trade_date,
        progress_callback: Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]] = None,
    ):
        """Run the trading agents graph for a company on a specific date."""

        self.ticker = company_name

        # Initialize state
        init_agent_state = self.propagator.create_initial_state(
            company_name, trade_date
        )
        args = self.propagator.get_graph_args()

        final_state = asyncio.run(
            self.propagate_async(
                init_agent_state,
                args,
                progress_callback=progress_callback,
            )
        )

        # Store current state for reflection
        self.curr_state = final_state

        # Log state
        self._log_state(trade_date, final_state)

        # Return decision and processed signal
        return final_state, self.process_signal(final_state["final_trade_decision"])

    async def propagate_async(
        self,
        init_agent_state,
        args,
        progress_callback: Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]] = None,
    ):
        if self.debug or progress_callback is not None:
            latest_chunk = init_agent_state
            async for chunk in self.graph.astream(init_agent_state, **args):
                latest_chunk = chunk
                if progress_callback is not None:
                    maybe_awaitable = progress_callback(chunk)
                    if asyncio.iscoroutine(maybe_awaitable) or isinstance(maybe_awaitable, asyncio.Future):
                        await maybe_awaitable
                if self.debug and len(chunk.get("messages", [])) > 0:
                    chunk["messages"][-1].pretty_print()
            return latest_chunk

        return await self.graph.ainvoke(init_agent_state, **args)

    async def propagate_streaming(
        self,
        company_name: str,
        trade_date: str,
        token_callback: Callable[[str, str, str], Awaitable[None]],
        stage_end_callback: Callable[[str, Dict[str, Any]], Awaitable[None]],
    ) -> Dict[str, Any]:
        """Stream analysis via astream_events, calling callbacks per-token and per-node.

        Args:
            company_name: Stock ticker symbol
            trade_date: Analysis date string (YYYY-MM-DD)
            token_callback: async (stage_id, node_name, token_text) -> None
            stage_end_callback: async (stage_id, state_snapshot) -> None

        Returns:
            Final merged state dict
        """
        init_state = self.propagator.create_initial_state(company_name, trade_date)
        base_args = self.propagator.get_graph_args()
        # astream_events does NOT accept stream_mode — only pass config
        events_config = {"config": base_args.get("config", {})}

        last_state: Dict[str, Any] = dict(init_state) if isinstance(init_state, dict) else {}

        async for event in self.graph.astream_events(init_state, **events_config, version="v2"):
            etype = event.get("event", "")
            node = event.get("metadata", {}).get("langgraph_node", "")

            if etype == "on_chat_model_stream" and node not in SKIP_NODES:
                chunk = event["data"].get("chunk")
                token = getattr(chunk, "content", "") if chunk else ""
                stage_id = NODE_TO_STAGE.get(node)
                if token and stage_id:
                    await token_callback(stage_id, node, token)

            elif etype == "on_chain_end" and node not in SKIP_NODES:
                output = event["data"].get("output", {})
                if isinstance(output, dict):
                    last_state.update(output)
                stage_id = NODE_TO_STAGE.get(node)
                if stage_id:
                    await stage_end_callback(stage_id, last_state)

        return last_state

    def _log_state(self, trade_date, final_state):
        """Log the final state to a JSON file."""
        self.log_states_dict[str(trade_date)] = {
            "company_of_interest": final_state["company_of_interest"],
            "trade_date": final_state["trade_date"],
            "market_report": final_state["market_report"],
            "sentiment_report": final_state["sentiment_report"],
            "news_report": final_state["news_report"],
            "fundamentals_report": final_state["fundamentals_report"],
            "investment_debate_state": {
                "bull_history": final_state["investment_debate_state"]["bull_history"],
                "bear_history": final_state["investment_debate_state"]["bear_history"],
                "history": final_state["investment_debate_state"]["history"],
                "current_response": final_state["investment_debate_state"][
                    "current_response"
                ],
                "judge_decision": final_state["investment_debate_state"][
                    "judge_decision"
                ],
            },
            "trader_investment_decision": final_state["trader_investment_plan"],
            "risk_debate_state": {
                "risky_history": final_state["risk_debate_state"]["risky_history"],
                "safe_history": final_state["risk_debate_state"]["safe_history"],
                "neutral_history": final_state["risk_debate_state"]["neutral_history"],
                "history": final_state["risk_debate_state"]["history"],
                "judge_decision": final_state["risk_debate_state"]["judge_decision"],
            },
            "investment_plan": final_state["investment_plan"],
            "final_trade_decision": final_state["final_trade_decision"],
        }

        # Save to file
        directory = Path(f"eval_results/{self.ticker}/TradingAgentsStrategy_logs/")
        directory.mkdir(parents=True, exist_ok=True)

        with open(
            f"eval_results/{self.ticker}/TradingAgentsStrategy_logs/full_states_log_{trade_date}.json",
            "w",
        ) as f:
            json.dump(self.log_states_dict, f, indent=4)

    def reflect_and_remember(self, returns_losses):
        """Reflect on decisions and update memory based on returns."""
        self.reflector.reflect_bull_researcher(
            self.curr_state, returns_losses, self.bull_memory
        )
        self.reflector.reflect_bear_researcher(
            self.curr_state, returns_losses, self.bear_memory
        )
        self.reflector.reflect_trader(
            self.curr_state, returns_losses, self.trader_memory
        )
        self.reflector.reflect_invest_judge(
            self.curr_state, returns_losses, self.invest_judge_memory
        )
        self.reflector.reflect_risk_manager(
            self.curr_state, returns_losses, self.risk_manager_memory
        )

    def process_signal(self, full_signal):
        """Process a signal to extract the core decision."""
        return self.signal_processor.process_signal(full_signal)
