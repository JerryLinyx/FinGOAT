from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
import time
import json
from tradingagents.agents.utils.agent_utils import get_fundamentals, get_balance_sheet, get_cashflow, get_income_statement, get_insider_sentiment, get_insider_transactions
from tradingagents.dataflows.config import get_config
from tradingagents.agents.analysts.rag import FundamentalsRAGRetriever


def create_fundamentals_analyst(llm, config=None):
    """Create fundamentals analyst node with RAG integration.
    
    Args:
        llm: Language model instance
        config: Optional configuration dictionary
    """
    # Initialize RAG retriever
    rag_retriever = FundamentalsRAGRetriever(config=config or get_config())
    
    def fundamentals_analyst_node(state):
        current_date = state["trade_date"]
        ticker = state["company_of_interest"]
        company_name = state["company_of_interest"]

        # Retrieve RAG context
        rag_result = rag_retriever.retrieve(
            ticker=ticker,
            query=f"{ticker} fundamental analysis financial statements SEC filings earnings",
            top_k=5
        )
        
        # Save RAG context to file
        rag_filepath = rag_retriever.save_context_to_file(
            rag_result=rag_result,
            ticker=ticker,
            trade_date=current_date
        )
        
        # Extract RAG context for injection
        rag_context = rag_result.get("context", "")
        
        # Build system message with RAG context
        base_system_message = (
            "You are a researcher tasked with analyzing fundamental information over the past week about a company. Please write a comprehensive report of the company's fundamental information such as financial documents, company profile, basic company financials, and company financial history to gain a full view of the company's fundamental information to inform traders. Make sure to include as much detail as possible. Do not simply state the trends are mixed, provide detailed and finegrained analysis and insights that may help traders make decisions."
            + " Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read."
            + " Use the available tools: `get_fundamentals` for comprehensive company analysis, `get_balance_sheet`, `get_cashflow`, and `get_income_statement` for specific financial statements."
        )
        
        # Inject RAG context if available
        if rag_context:
            system_message = (
                base_system_message
                + "\n\n"
                + "ADDITIONAL CONTEXT FROM KNOWLEDGE BASE:\n"
                + "The following information has been retrieved from our knowledge base to provide additional context for your analysis. Use this information to enhance your understanding of the company's fundamentals, but prioritize the real-time data from the tools when making your analysis.\n\n"
                + rag_context
                + "\n"
                + "When analyzing, synthesize information from both the tools and the knowledge base context above. If there are discrepancies, note them in your report."
            )
        else:
            system_message = base_system_message

        tools = [
            get_fundamentals,
            get_balance_sheet,
            get_cashflow,
            get_income_statement,
        ]

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a helpful AI assistant, collaborating with other assistants."
                    " Use the provided tools to progress towards answering the question."
                    " If you are unable to fully answer, that's OK; another assistant with different tools"
                    " will help where you left off. Execute what you can to make progress."
                    " If you or any other assistant has the FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** or deliverable,"
                    " prefix your response with FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** so the team knows to stop."
                    " You have access to the following tools: {tool_names}.\n{system_message}"
                    "For your reference, the current date is {current_date}. The company we want to look at is {ticker}",
                ),
                MessagesPlaceholder(variable_name="messages"),
            ]
        )

        prompt = prompt.partial(system_message=system_message)
        prompt = prompt.partial(tool_names=", ".join([tool.name for tool in tools]))
        prompt = prompt.partial(current_date=current_date)
        prompt = prompt.partial(ticker=ticker)

        try:
            chain = prompt | llm.bind_tools(tools)
            tool_capable = True
        except NotImplementedError:
            chain = prompt | llm
            tool_capable = False

        result = chain.invoke(state["messages"])

        report = ""

        if not tool_capable or len(getattr(result, "tool_calls", []) or []) == 0:
            report = result.content

        # Include RAG metadata in return
        return {
            "messages": [result],
            "fundamentals_report": report,
            "rag_context_file": rag_filepath,  # Path to saved RAG context file
            "rag_num_results": rag_result.get("num_results", 0),  # Number of retrieved documents
        }

    return fundamentals_analyst_node
