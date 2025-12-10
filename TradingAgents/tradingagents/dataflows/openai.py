import os
from openai import OpenAI
from .config import get_config


def get_stock_news_openai(query, start_date, end_date):
    # Always hit OpenAI endpoint with OpenAI key (not the LLM provider base_url)
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY", "")
    # Use a dedicated OpenAI tool model; avoid picking deepseek/other providers from config
    model = os.getenv("OPENAI_TOOL_MODEL", "gpt-4o-mini")
    client = OpenAI(base_url="https://api.openai.com/v1", api_key=api_key)

    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": f"Can you search Social Media for {query} from {start_date} to {end_date}? Make sure you only get the data posted during that period.",
                    }
                ],
            }
        ],
        text={"format": {"type": "text"}},
        reasoning={},
        tools=[
            {
                "type": "web_search_preview",
                "user_location": {"type": "approximate"},
                "search_context_size": "low",
            }
        ],
        temperature=1,
        max_output_tokens=4096,
        top_p=1,
        store=True,
    )

    return response.output[1].content[0].text


def get_global_news_openai(curr_date, look_back_days=7, limit=5):
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY", "")
    model = os.getenv("OPENAI_TOOL_MODEL", "gpt-4o-mini")
    client = OpenAI(base_url="https://api.openai.com/v1", api_key=api_key)

    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": f"Can you search global or macroeconomics news from {look_back_days} days before {curr_date} to {curr_date} that would be informative for trading purposes? Make sure you only get the data posted during that period. Limit the results to {limit} articles.",
                    }
                ],
            }
        ],
        text={"format": {"type": "text"}},
        reasoning={},
        tools=[
            {
                "type": "web_search_preview",
                "user_location": {"type": "approximate"},
                "search_context_size": "low",
            }
        ],
        temperature=1,
        max_output_tokens=4096,
        top_p=1,
        store=True,
    )

    return response.output[1].content[0].text


def get_fundamentals_openai(ticker, curr_date):
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY", "")
    model = os.getenv("OPENAI_TOOL_MODEL", "gpt-4o-mini")
    client = OpenAI(base_url="https://api.openai.com/v1", api_key=api_key)

    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": f"Can you search Fundamental for discussions on {ticker} during of the month before {curr_date} to the month of {curr_date}. Make sure you only get the data posted during that period. List as a table, with PE/PS/Cash flow/ etc",
                    }
                ],
            }
        ],
        text={"format": {"type": "text"}},
        reasoning={},
        tools=[
            {
                "type": "web_search_preview",
                "user_location": {"type": "approximate"},
                "search_context_size": "low",
            }
        ],
        temperature=1,
        max_output_tokens=4096,
        top_p=1,
        store=True,
    )

    return response.output[1].content[0].text
