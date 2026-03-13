# DashScope qwen3.5-flash Provider Verification

## Background

FinGOAT already exposes `Aliyun DashScope` as a selectable LLM provider in the frontend, and the local Python environment includes a configured `DASHSCOPE_API_KEY`.

## Problem and impact

- The Aliyun preset list did not include a low-cost Qwen model intended for routine provider verification.
- When testing non-OpenAI providers, the current stack needs explicit validation to ensure requests do not silently fall back to OpenAI defaults.
- Without a known-good DashScope preset, provider-routing checks are slower and easier to misconfigure.
- Embedding defaults were still OpenAI-specific, so an `aliyun` run could silently keep using OpenAI embeddings unless the operator overrode environment variables at process start.

## Current state analysis

Confirmed from the repository and local environment:

- Frontend provider presets include `Aliyun DashScope`.
- `langchain-v1/trading_service.py` loads `.env` at startup and accepts request-level provider/model overrides.
- `TradingAgents/tradingagents/llm_provider.py` includes DashScope-specific base URL and API-key environment lookup.

## Final decision

Use `qwen3.5-flash` as the primary DashScope verification model and validate provider fidelity across the full request path.

## Implementation design

- Add `qwen3.5-flash` to the Aliyun model presets in the frontend configuration panel.
- Keep DashScope base URL pointed to `https://dashscope.aliyuncs.com/compatible-mode/v1`.
- Make embedding defaults follow the selected provider when no explicit embedding override is present.
- Run an end-to-end analysis request with:
  - `provider = aliyun`
  - `deep_think_llm = qwen3.5-flash`
  - `quick_think_llm = qwen3.5-flash`
- Verify all of the following before considering the path healthy:
  - frontend request payload uses the DashScope provider/model
  - Go API persists the selected provider/model on the task
  - Python runtime builds the DashScope configuration rather than OpenAI defaults
  - outbound HTTP targets DashScope rather than `api.openai.com`

## Testing and validation

Observed in local validation:

- frontend preset selection verification passed
- local API task submission persisted:
  - `llm_provider = aliyun`
  - `llm_model = qwen3.5-flash`
  - `llm_base_url = https://dashscope.aliyuncs.com/compatible-mode/v1`
- live worker logs showed outbound model traffic to:
  - `POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
  - `POST https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings`
- configured data vendors during this test were:
  - `core_stock_apis = yfinance`
  - `technical_indicators = yfinance`
  - `fundamental_data = alpha_vantage`
  - `news_data = alpha_vantage`
- no OpenAI model endpoint usage was observed in the live worker logs during the DashScope validation run
- provider-fidelity check therefore passed for both chat and embedding traffic during the DashScope run
- final task state for `64c41ad9-f91e-4f27-902d-b339b4023eed` became:
  - `status = failed`
  - `error = Object of type HumanMessage is not JSON serializable`
- the failure happened after DashScope model and embedding calls had already been confirmed, so the remaining issue is output serialization rather than provider routing

## Outcome and follow-up

Status:

- `qwen3.5-flash` preset added to frontend
- build verification passed
- embedding defaults now follow `aliyun` to DashScope when no explicit embedding override is supplied
- DashScope embedding calls now retry with shorter input when the provider returns the `input length should be [1, 8192]` error
- `get_global_news` now supports `alpha_vantage` topic-based macro news and, for this method, default fallback is limited to `local` rather than silently routing to OpenAI
- provider-fidelity validation confirmed for observed model and embedding requests
- `analysis_report` persistence now sanitizes LangChain message objects into JSON-safe structures before Redis writes

Still open:

- end-to-end provider fidelity is not yet fully closed because the new `get_global_news` routing change still needs one live DashScope/Alpha Vantage regression run after service restart
