# Ollama Default Model

## Background

The project had already added working Ollama support, but the default selections across the stack still pointed to OpenAI models in several places.

## Problem and impact

- the frontend still initialized with `openai / gpt-4o-mini`
- `TradingAgents` code-level defaults still assumed OpenAI-compatible endpoints
- the trading service request schema still defaulted to OpenAI values
- Docker and local `.env` defaults were not aligned with the intended local-model workflow

This meant a fresh session could still start on OpenAI unless the user manually changed provider and model first.

## Final decision

Use Ollama as the default provider and `gemma3:1b` as the default model across the main local-analysis path.

## Implementation design

- `frontend/src/App.tsx`
  - changed initial provider to `ollama`
  - changed initial model to `gemma3:1b`
  - restored the frontend default base URL for `ollama` to `http://localhost:11434` after live regressions showed the local verified path should stay explicit
  - reordered Ollama presets so `gemma3:1b` is the first selectable preset
- `TradingAgents/tradingagents/default_config.py`
  - changed default provider/model/base URL to `ollama / gemma3:1b / http://localhost:11434`
- `langchain-v1/trading_service.py`
  - changed `LLMConfig` defaults to `ollama / gemma3:1b`
- `langchain-v1/.env.trading`
  - changed template defaults to Ollama and local Ollama embeddings
- `langchain-v1/.env`
  - changed local runtime defaults to Ollama while preserving existing secrets
- `docker-compose.yml`
  - changed container defaults from `gemma3:27b` to `gemma3:1b`
- `TradingAgents/main.py`
  - updated sample config to `gemma3:1b`

## Testing and validation

Validated locally with:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/frontend && npm run build
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/default_config.py /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/main.py /Users/linyuxuan/workSpace/FinGOAT/langchain-v1/trading_service.py
```

## Outcome and follow-up

Status: implemented.

Operational note:

- already running services need a restart before they pick up the new default environment values
- the frontend now explicitly sends `http://localhost:11434` again for Ollama requests because leaving `base_url` empty caused live local runs to hit the wrong effective endpoint
