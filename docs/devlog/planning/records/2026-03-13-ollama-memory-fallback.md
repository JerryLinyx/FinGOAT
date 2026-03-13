# Ollama Memory Fallback

## Background

After the Ollama model path was restored, analysis tasks progressed past the initial researcher stages but failed again around research debate.

## Problem and impact

- Ollama-backed runs were reaching memory retrieval in debate-stage agents
- `FinancialSituationMemory` attempted to call Ollama embeddings with `nomic-embed-text`
- the local Ollama server did not have that embedding model installed
- this caused the whole task to fail even though the main chat model path was healthy

Observed live failure:

- task `5dc791be-ff8c-4595-9056-38e4592fbca0`
- failed with `model "nomic-embed-text" not found`
- stack reached `Bull Researcher -> memory.get_memories(...)`

## Final decision

Treat Ollama embedding failures as a degradable memory-layer dependency instead of a hard failure for the main analysis workflow.

## Implementation design

- `TradingAgents/tradingagents/agents/utils/memory.py`
  - added `_should_degrade_memory_failure(...)`
  - for `ollama`, degrade on common local embedding/runtime failures such as:
    - missing embedding model
    - invalid api key
    - local connection failures
  - `get_memories(...)` now logs a warning and returns `[]` instead of raising when the failure is degradable
  - `add_situations(...)` now also skips persistence instead of failing the whole flow when the same class of embedding errors occurs
- `TradingAgents/tests/test_embedding_settings.py`
  - added coverage proving Ollama embedding failures now return empty memories
  - added coverage proving non-Ollama unexpected embedding failures still raise

## Testing and validation

Validated locally with:

```bash
python -m unittest /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tests/test_embedding_settings.py
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/agents/utils/memory.py
```

Live validation:

- restarted the trading service
- submitted task `19a454aa-9c3d-499f-8df9-b2d7c9d0e035`
- observed `POST http://localhost:11434/v1/embeddings` returning `404 model "nomic-embed-text" not found`
- observed warning-level fallback instead of task failure
- confirmed the task progressed into `investment_debate_state` with a bull argument populated

## Outcome and follow-up

Status: implemented.

Remaining gap:

- the local Ollama embedding model is still missing
- installing `nomic-embed-text` would restore memory retrieval quality, but is no longer required for the main research debate path to continue
