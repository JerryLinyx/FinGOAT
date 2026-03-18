# TradingAgents/graph/conditional_logic.py

import copy
import logging

from tradingagents.agents.utils.agent_states import AgentState

logger = logging.getLogger(__name__)

# Maximum number of tool-call iterations allowed per analyst before forcing exit.
# Prevents models that loop on tool calls (e.g. DashScope kimi / GLM) from
# running indefinitely without producing a final text report.
MAX_ANALYST_TOOL_ITERATIONS = 5


def _count_tool_call_rounds(messages, analyst_node_name: str) -> int:
    """Count how many times the given analyst node has emitted tool_calls."""
    count = 0
    for m in messages:
        if (
            getattr(m, "name", None) == analyst_node_name
            or getattr(m, "response_metadata", {}).get("model_provider") is not None
        ) and getattr(m, "tool_calls", None):
            count += 1
    return count


def _analyst_tool_calls_in_messages(messages) -> int:
    """Count AI messages with tool_calls in the current message list."""
    return sum(
        1 for m in messages
        if hasattr(m, "tool_calls") and m.tool_calls
    )


def sanitize_orphan_tool_calls(messages: list) -> list:
    """Strip orphaned tool_calls from the tail of a message list.

    DashScope (and other strict providers) reject message histories where an
    AIMessage has ``tool_calls`` but is NOT immediately followed by the
    corresponding ``ToolMessage`` responses.  This typically happens when an
    analyst hits the iteration limit and we exit the tool-calling loop early.

    The function works **backwards** from the end of the list, removing
    ``tool_calls`` (and the matching ``additional_kwargs`` entry) from any
    trailing AIMessage that lacks a paired ToolMessage.  It stops as soon as
    it encounters a properly-paired tool call or a non-AI message.

    Returns a *new* list (original is not mutated).
    """
    if not messages:
        return messages

    result = list(messages)  # shallow copy
    i = len(result) - 1

    while i >= 0:
        msg = result[i]
        # Only AIMessages (or subclasses) carry tool_calls
        if not getattr(msg, "tool_calls", None):
            break  # no orphan — stop scanning

        # Check whether the *next* message (i+1) is a ToolMessage for this call
        has_paired_tool = False
        if i + 1 < len(result):
            next_msg = result[i + 1]
            if getattr(next_msg, "type", None) == "tool":
                has_paired_tool = True

        if has_paired_tool:
            break  # properly paired — nothing to clean

        # Orphan detected: deep-copy and strip tool_calls
        cleaned = copy.copy(msg)
        cleaned.tool_calls = []
        if hasattr(cleaned, "additional_kwargs"):
            cleaned.additional_kwargs = {
                k: v for k, v in cleaned.additional_kwargs.items()
                if k != "tool_calls"
            }
        # Preserve any text content the model did produce
        result[i] = cleaned
        logger.warning(
            "Stripped orphaned tool_calls from message at index %d "
            "(likely analyst hit iteration limit)",
            i,
        )
        i -= 1

    return result


class ConditionalLogic:
    """Handles conditional logic for determining graph flow."""

    def __init__(self, max_debate_rounds=1, max_risk_discuss_rounds=1,
                 max_analyst_tool_iterations=MAX_ANALYST_TOOL_ITERATIONS):
        """Initialize with configuration parameters."""
        self.max_debate_rounds = max_debate_rounds
        self.max_risk_discuss_rounds = max_risk_discuss_rounds
        self.max_analyst_tool_iterations = max_analyst_tool_iterations

    def _should_continue_analyst(self, state: AgentState, tools_node: str) -> str:
        """Shared logic: continue to tools_node unless max iterations reached."""
        messages = state["messages"]
        last_message = messages[-1]
        if last_message.tool_calls:
            tool_rounds = _analyst_tool_calls_in_messages(messages)
            if tool_rounds <= self.max_analyst_tool_iterations:
                return tools_node
            # Iteration limit reached — sanitize orphaned tool_calls so that
            # strict providers (DashScope) don't reject downstream LLM calls.
            logger.info(
                "Analyst tool-call limit (%d) reached; sanitizing messages",
                self.max_analyst_tool_iterations,
            )
            state["messages"] = sanitize_orphan_tool_calls(messages)
        return "Analyst Join"

    def should_continue_market(self, state: AgentState):
        """Determine if market analysis should continue."""
        return self._should_continue_analyst(state, "tools_market")

    def should_continue_social(self, state: AgentState):
        """Determine if social media analysis should continue."""
        return self._should_continue_analyst(state, "tools_social")

    def should_continue_news(self, state: AgentState):
        """Determine if news analysis should continue."""
        return self._should_continue_analyst(state, "tools_news")

    def should_continue_fundamentals(self, state: AgentState):
        """Determine if fundamentals analysis should continue."""
        return self._should_continue_analyst(state, "tools_fundamentals")

    def should_continue_debate(self, state: AgentState) -> str:
        """Determine if debate should continue."""

        if (
            state["investment_debate_state"]["count"] >= 2 * self.max_debate_rounds
        ):  # 3 rounds of back-and-forth between 2 agents
            return "Research Manager"
        if state["investment_debate_state"]["current_response"].startswith("Bull"):
            return "Bear Researcher"
        return "Bull Researcher"

    def should_continue_risk_analysis(self, state: AgentState) -> str:
        """Determine if risk analysis should continue."""
        if (
            state["risk_debate_state"]["count"] >= 3 * self.max_risk_discuss_rounds
        ):  # 3 rounds of back-and-forth between 3 agents
            return "Risk Judge"
        latest_speaker = state["risk_debate_state"].get("latest_speaker", "")
        if latest_speaker.startswith("Risky"):
            return "Safe Analyst"
        if latest_speaker.startswith("Safe"):
            return "Neutral Analyst"
        return "Risky Analyst"
