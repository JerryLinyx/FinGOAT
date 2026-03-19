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


def _strip_tool_calls(msg):
    cleaned = copy.copy(msg)
    cleaned.tool_calls = []
    if hasattr(cleaned, "additional_kwargs"):
        cleaned.additional_kwargs = {
            k: v for k, v in cleaned.additional_kwargs.items() if k != "tool_calls"
        }
    return cleaned


def sanitize_orphan_tool_calls(messages: list) -> list:
    """Strip any tool_calls that are not immediately resolved by ToolMessages.

    DashScope enforces strict tool-call ordering: every assistant message that
    contains ``tool_calls`` must be followed by the corresponding tool result
    messages before any other assistant/human/system message appears.

    The original implementation only cleaned a trailing orphaned tool call.
    That is insufficient when analysts run in parallel and one branch's pending
    tool call is interleaved with another branch's assistant message.

    Returns a new list where any AI message whose tool calls are not fully
    matched by subsequent contiguous ToolMessages has those tool calls removed.
    """
    if not messages:
        return messages

    result = list(messages)

    for i, msg in enumerate(result):
        tool_calls = getattr(msg, "tool_calls", None) or []
        if not tool_calls:
            continue

        expected_ids = {
            call.get("id")
            for call in tool_calls
            if isinstance(call, dict) and call.get("id")
        }
        if not expected_ids:
            continue

        seen_ids = set()
        j = i + 1
        while j < len(result) and getattr(result[j], "type", None) == "tool":
            tool_call_id = getattr(result[j], "tool_call_id", None)
            if tool_call_id:
                seen_ids.add(tool_call_id)
            j += 1

        if expected_ids.issubset(seen_ids):
            continue

        result[i] = _strip_tool_calls(msg)
        logger.warning(
            "Stripped orphaned/interleaved tool_calls from message at index %d",
            i,
        )

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
