import json
from datetime import datetime

from dateutil.relativedelta import relativedelta

from .alpha_vantage_common import _make_api_request, format_datetime_for_api

def get_news(ticker, start_date, end_date) -> dict[str, str] | str:
    """Returns live and historical market news & sentiment data from premier news outlets worldwide.

    Covers stocks, cryptocurrencies, forex, and topics like fiscal policy, mergers & acquisitions, IPOs.

    Args:
        ticker: Stock symbol for news articles.
        start_date: Start date for news search.
        end_date: End date for news search.

    Returns:
        Dictionary containing news sentiment data or JSON string.
    """

    params = {
        "tickers": ticker,
        "time_from": format_datetime_for_api(start_date),
        "time_to": format_datetime_for_api(end_date),
        "sort": "LATEST",
        "limit": "50",
    }
    
    return _make_api_request("NEWS_SENTIMENT", params)


def get_global_news(curr_date: str, look_back_days: int = 7, limit: int = 5) -> str:
    """Return macro/global news using Alpha Vantage topic filters.

    Alpha Vantage's NEWS_SENTIMENT endpoint supports topic-based queries. We use
    macro- and market-oriented topics so this tool stays aligned with the
    configured `news_data` vendor instead of silently falling back to OpenAI.
    """

    curr_date_dt = datetime.strptime(curr_date, "%Y-%m-%d")
    start_date_dt = curr_date_dt - relativedelta(days=look_back_days)

    params = {
        "topics": "economy_macro,economy_monetary,economy_fiscal,financial_markets",
        "time_from": format_datetime_for_api(start_date_dt),
        "time_to": format_datetime_for_api(curr_date_dt),
        "sort": "LATEST",
        "limit": str(max(limit, 1)),
    }

    response = _make_api_request("NEWS_SENTIMENT", params)

    try:
        payload = json.loads(response) if isinstance(response, str) else response
    except json.JSONDecodeError:
        return response

    feed = payload.get("feed", [])
    if not feed:
        return f"## Global News via Alpha Vantage, from {start_date_dt:%Y-%m-%d} to {curr_date}:\nNo articles found."

    sections = []
    for article in feed[:limit]:
        title = article.get("title", "Untitled")
        source = article.get("source", "Unknown source")
        published_at = article.get("time_published", "")
        summary = article.get("summary", "")
        overall_sentiment = article.get("overall_sentiment_label", "")

        header = f"### {title}"
        metadata = f"source: {source}"
        if published_at:
            metadata += f" | published: {published_at}"
        if overall_sentiment:
            metadata += f" | sentiment: {overall_sentiment}"

        article_text = header + "\n" + metadata
        if summary:
            article_text += "\n\n" + summary
        sections.append(article_text)

    articles = "\n\n".join(sections)
    return f"## Global News via Alpha Vantage, from {start_date_dt:%Y-%m-%d} to {curr_date}:\n\n{articles}"

def get_insider_transactions(symbol: str) -> dict[str, str] | str:
    """Returns latest and historical insider transactions by key stakeholders.

    Covers transactions by founders, executives, board members, etc.

    Args:
        symbol: Ticker symbol. Example: "IBM".

    Returns:
        Dictionary containing insider transaction data or JSON string.
    """

    params = {
        "symbol": symbol,
    }

    return _make_api_request("INSIDER_TRANSACTIONS", params)
