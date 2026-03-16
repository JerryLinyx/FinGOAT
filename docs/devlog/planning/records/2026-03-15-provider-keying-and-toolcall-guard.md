# Provider Key Injection, Alpha Vantage BYOK, and Tool-Call Guard

## 1. Background

Three independent work streams completed in one session:

1. **Provider key injection gap** — user API keys stored in `user_api_keys` were never read by the Go backend when forwarding analysis requests; Python fell back to env vars instead.
2. **Alpha Vantage BYOK** — `ALPHA_VANTAGE_API_KEY` was a startup env var shared across all users; migrated to per-user DB storage.
3. **Frontend provider gating** — API mode provider dropdown allowed selecting any provider regardless of whether the user had configured a key.
4. **Tool-call infinite loop** — models like kimi-k2.5 and GLM-4.7 on DashScope loop on tool calls without producing a final text report; no iteration limit existed.

---

## 2. Changes

### 2.1 Backend — `lookupDecryptedKey` helper (`user_controller.go`)

- Added `lookupDecryptedKey(userID uint, provider string) (string, error)` helper.
  - Queries `user_api_keys` table, decrypts via `utils.DecryptAPIKey`.
  - Returns `("", nil)` if no key stored (not an error).
- Added `"alpha_vantage"` to `providers` slice so the BYOK endpoint accepts and stores it.

### 2.2 Backend — Key injection in `RequestAnalysis` (`trading_controller.go`)

- After LLM config normalization, injects the user's stored LLM API key for non-Ollama providers:
  - If key is missing → HTTP 400 with actionable message directing user to Profile & API Keys.
- Injects user's stored `alpha_vantage` key into `req.AlphaVantageAPIKey` (may be empty; Python falls back to env var).
- Added `AlphaVantageAPIKey string` field to `AnalysisRequest` struct (`trading_runtime.go`).

### 2.3 Backend — Chart endpoint uses DB key (`chart.go`)

- Replaced `os.Getenv("ALPHA_VANTAGE_API_KEY")` with DB lookup via `lookupDecryptedKey`.
- Fallback order: user DB key → env var → HTTP 400 with setup message.

### 2.4 Python — Alpha Vantage key passthrough (`trading_service.py`)

- Added `alpha_vantage_api_key: Optional[str]` field to `AnalysisRequest` Pydantic model.
- `build_config()` propagates the field into config dict.
- `_run_streaming_analysis_async()` and `run_analysis()`: if key is present, sets `os.environ["ALPHA_VANTAGE_API_KEY"]` before graph init.
  - Single-worker model makes per-run env mutation safe.

### 2.5 Frontend — Provider gating + clear model presets (`App.tsx`)

- Added `configuredProviders: Set<string>` state.
- After login and on page reload, calls `getAPIKeys()` to populate the set from `is_set` keys.
- Provider `<select>` in API mode: each provider option shows `(no key)` and is `disabled` if not in `configuredProviders`.
- `MODEL_PRESETS`: all API provider presets cleared to `[]`; `openai-compatible` and `vllm` removed entirely.
- `BASE_DEFAULTS`: `openai-compatible` and `vllm` removed.
- `handleLlmProviderChange`: clears model field (no auto-fill since presets are empty).
- `handleExecutionModeChange`: when switching to API mode, picks first provider with a configured key instead of hardcoding `openai`.
- Model preset dropdown removed (was useless with empty presets); only text input remains.
- Base URL condition updated to only show for `deepseek` and `dashscope`.

### 2.6 Tool-call iteration guard (`conditional_logic.py`)

- Added `MAX_ANALYST_TOOL_ITERATIONS = 5` constant.
- `_should_continue_analyst()` shared helper: counts AI messages with `tool_calls` in the current state; if count exceeds limit, exits to `"Analyst Join"` regardless of last message content.
- All four `should_continue_*` methods (market, social, news, fundamentals) now delegate to this helper.
- `ConditionalLogic.__init__` accepts `max_analyst_tool_iterations` parameter for override.

### 2.7 LLM timeout increase (`default_config.py`)

- `llm_timeout`: `60` → `300` seconds.
- Previous 60s caused premature `The read operation timed out` for slow/large models (kimi-k2.5, GLM).

---

## 3. Investigation: kimi-k2.5 Failure Analysis

### 3.1 Failure Pattern

Live run with `dashscope / kimi-k2.5` on BABA failed with `"The read operation timed out"`.

All 4 analyst reports were empty (0 chars). The only message in state had `finish_reason: "tool_calls"` — the model called `get_news` but never produced a final text response.

### 3.2 Root Cause

Two compounding issues:
1. **No iteration limit**: `should_continue_market` looped as long as `last_message.tool_calls` was true — unlimited iterations.
2. **60s timeout too short**: kimi-k2.5 is slow; LLM calls exceeded the timeout before producing output.

Both are now fixed by §2.6 and §2.7.

### 3.3 Streaming Behavior Investigation

Token events appear in Redis stream 230 seconds after stage_end events, in a 717ms burst — not real-time. Root cause:

- During the analyst phase, models make tool calls (no `on_chat_model_stream` events for tool call responses, only for text generation).
- The 4611 tokens labeled as analyst stages appear during the research_debate phase — likely from debate agents re-invoking analyst-type LLM calls, or from LangGraph buffering parallel branch events until completion.
- This is a known characteristic of `astream_events` with parallel LangGraph nodes: events may batch-deliver after the parallel branch completes.

**Streaming is architecturally correct but only meaningful for text-generating phases, not tool-call-heavy analyst phases.**

---

## 4. Open Issues

- [ ] DashScope orphaned tool_call sanitization: when analyst exits at iteration limit, the messages list may end with an unpaired `tool_calls` assistant message. DashScope enforces strict tool_call/tool_result pairing → will reject downstream LLM calls. Fix: sanitize messages before each DashScope API call (strip or pair orphaned tool_calls).
- [ ] Verify kimi-k2.5 end-to-end with iteration guard in place.

---

## 5. Env Var Status

| Variable | Status |
|----------|--------|
| `BYOK_ENCRYPTION_KEY` | Still required at startup |
| `ALPHA_VANTAGE_API_KEY` | Optional fallback; primary source is now per-user DB key |
| `LLM_API_KEY` / `OPENAI_API_KEY` etc. | No longer needed; Go injects from DB |
| `LLM_TIMEOUT` | Default raised to 300s; still overridable via env |
