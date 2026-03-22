---
id: ADR-040
kind: review
title: 2026-03-21 Analysis Chain Secret Hygiene Review
date: 2026-03-21
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# 2026-03-21 Analysis Chain Secret Hygiene Review

## Scope

Reviewed the end-to-end analysis chain after the recent user/BYOK rollout, with focus on:

- secret handling during initial analysis submission and resume
- persisted task config contents
- Python worker per-task credential isolation
- OpenAI-specific fallback tooling behavior

This review captures the bugs found in the chain and the fixes applied.

## Findings

### 1. Resume dropped per-user provider secrets and Alpha Vantage BYOK

Affected code before fix:

- `backend/controllers/trading_controller.go`
- `backend/controllers/trading_runtime.go`

Original behavior:

- initial analysis submission hydrated the request with decrypted user BYOK values
- task config persisted a sanitized request, which did not carry the user-specific Alpha Vantage key
- resume rebuilt the request from stored config but did not re-hydrate provider secrets from the current user record

Impact:

- resumed US-market analyses could fail because `alpha_vantage_api_key` was missing
- resumed tasks did not have the same credential semantics as first-run tasks
- credential behavior depended on execution path instead of current user configuration

Fix applied:

1. added a shared `hydrateAnalysisRequestSecrets(...)` helper in Go
2. reuse the helper in both:
   - `RequestAnalysis`
   - `ResumeAnalysis`
3. hydrate:
   - provider BYOK for non-Ollama providers
   - normalized Ollama base URL for local runs
   - `alpha_vantage_api_key` for US-market tasks
4. refresh `task.LLMProvider`, `task.LLMModel`, and `task.LLMBaseURL` on resume after re-hydration

Status:

- fixed in `backend/controllers/trading_controller.go`

### 2. Task config persisted plaintext provider API keys

Affected code before fix:

- `backend/controllers/trading_runtime.go`

Original behavior:

- the request object already contained the decrypted `llm_config.api_key`
- `marshalTaskConfig(...)` serialized the whole `LLMConfig` into `trading_analysis_tasks.config`

Impact:

- every task row duplicated a plaintext BYOK secret into the database
- backups, exports, and logs gained an unnecessary secret exposure surface

Fix applied:

1. clone `request.LLMConfig` inside `marshalTaskConfig(...)`
2. blank `api_key` in the cloned copy
3. persist only the sanitized config payload

Status:

- fixed in `backend/controllers/trading_runtime.go`
- locked by `TestMarshalTaskConfigStripsLLMAPIKey`

### 3. Python worker leaked provider credentials across tasks through global env mutation

Affected code before fix:

- `services/trading-service/trading_service.py`

Original behavior:

- the worker mirrored the current task's BYOK values into `os.environ`
- it never restored unrelated provider env vars to their original base state

Impact:

- a later task could inherit stale provider keys from an earlier task
- cross-provider fallback paths could accidentally use the wrong user's credentials
- the leak risk was highest for long-lived worker processes handling multiple users sequentially

Fix applied:

1. defined the set of provider-related env vars used by the worker
2. captured `_BASE_PROVIDER_ENV` at process startup
3. added `_restore_base_provider_env()` before every per-task injection
4. injected only the current task's active provider aliases after reset

Status:

- fixed in `services/trading-service/trading_service.py`
- covered by `services/trading-service/tests/mock_pipeline/test_key_injection.py`

### 4. OpenAI-only tool paths accepted generic `LLM_API_KEY`

Affected code before fix:

- `TradingAgents/tradingagents/dataflows/openai.py`

Original behavior:

- OpenAI tool/news/fundamental helper functions would use:
  - `OPENAI_API_KEY`
  - or fall back to `LLM_API_KEY`

Impact:

- if a prior task wrote a non-OpenAI provider key into `LLM_API_KEY`, OpenAI-only fallback paths could hit the OpenAI endpoint with the wrong credential
- this amplified the worker env isolation bug and created incorrect billing/auth behavior

Fix applied:

- require explicit `OPENAI_API_KEY` for all OpenAI-only helper paths
- remove fallback to `LLM_API_KEY`

Status:

- fixed in `TradingAgents/tradingagents/dataflows/openai.py`
- covered by `TradingAgents/tests/test_openai_tool_key_routing.py`

## Verification

- `cd backend && go test ./...`
- `python3 -m unittest TradingAgents.tests.test_embedding_settings TradingAgents.tests.test_openai_tool_key_routing`
- `python3 -m unittest discover -s services/trading-service/tests/mock_pipeline -p 'test_key_injection.py'`

## Residual Risks

- `Terminate` is still cooperative cancellation, not hard interruption of an in-flight model/tool HTTP request.
- Health reporting can still show `degraded` when the legacy OpenClaw adapter URL is unavailable, even if default analysis mode is healthy.
