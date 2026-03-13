# Analysis Report Schema

## Current shape

The current system persists a flexible `analysis_report` payload that may include:

- `fundamental_analysis`
- `sentiment_analysis`
- `technical_analysis`
- `news_analysis`
- `bull_researcher`
- `bear_researcher`
- `trader_analysis`
- `risk_assessment`
- `portfolio_manager`
- `messages`
- `raw_state`

## Known issue

The report is still relatively weakly structured and has compatibility handling on the frontend. This should be tightened during v0.2.

## Planned direction

- define stable top-level fields
- separate runtime stage payloads from final persisted summaries
- support stage timing and key outputs explicitly

