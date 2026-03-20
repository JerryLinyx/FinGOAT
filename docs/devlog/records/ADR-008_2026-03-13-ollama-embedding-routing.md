---
id: ADR-008
kind: decision
title: Ollama Embedding Routing
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Ollama Embedding Routing

## Background

The project had already made embedding defaults provider-aware for Aliyun DashScope, but Ollama-backed runs were still using the OpenAI embedding route.

## Problem and impact

- `FinancialSituationMemory` only special-cased `aliyun`
- when `llm_provider=ollama`, embedding configuration still fell back to:
  - model: `text-embedding-3-small`
  - base URL: `https://api.openai.com/v1`
- live Ollama runs therefore still emitted:
  - `POST https://api.openai.com/v1/embeddings`

This broke provider fidelity and caused local-model analysis to keep depending on external OpenAI credentials and billing.

## Final decision

Extend embedding routing so Ollama uses local OpenAI-compatible embeddings by default.

## Implementation design

- `TradingAgents/tradingagents/agents/utils/memory.py`
  - added `OLLAMA_COMPAT_BASE_URL = "http://localhost:11434/v1"`
  - added `_ollama_embed_base_url(...)` to normalize Ollama embedding base URLs to OpenAI-compatible `/v1`
  - `_resolve_embedding_settings(...)` now:
    - respects request-level/provider-level `backend_url`
    - routes `ollama` embeddings to local Ollama by default
    - uses `OLLAMA_EMBED_MODEL` when present, otherwise defaults to `nomic-embed-text`
    - uses `OLLAMA_API_KEY` or `"ollama"` when no embedding key is configured
- `services/trading-service/.env.trading`
  - documented recommended Ollama embedding defaults
- `TradingAgents/.env.example`
  - added `OLLAMA_API_KEY` placeholder
- `TradingAgents/tests/test_embedding_settings.py`
  - verifies Ollama no longer resolves to OpenAI embeddings
  - verifies explicit embedding overrides still win
  - verifies Aliyun routing is unchanged

## Testing and validation

Validated locally with:

```bash
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/agents/utils/memory.py /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tests/test_embedding_settings.py
cd /Users/linyuxuan/workSpace/FinGOAT && python -m unittest TradingAgents.tests.test_embedding_settings
cd /Users/linyuxuan/workSpace/FinGOAT/services/trading-service && python -m unittest tests.mock_pipeline.test_mock_analysis_pipeline tests.mock_pipeline.test_redis_worker_client
```

Live verification:

- restarted the trading service with the updated code
- confirmed `/health` returned `200 OK`
- during the post-fix validation window, no new OpenAI embedding call was observed from the restarted process

## Outcome and follow-up

Status: implemented.

Remaining gap:

- a full end-to-end Ollama completion run is still useful to close the broader provider-fidelity item
