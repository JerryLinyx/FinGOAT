# P1 Cleanup and DashScope Tool-Call Bug

## 1. Background

Two independent sessions worth of work: completing the remaining P1 backlog items, and discovering a DashScope provider fidelity bug during live verification.

---

## 2. Changes

### 2.1 Duplicate-Run Guard

- **`frontend/src/components/TradingAnalysis.tsx`**: Added duplicate-run check in `handleSubmit`, before `tradingService.requestAnalysis()` is called.
  - Checks `previousAnalyses` for any entry where `ticker` (case-insensitive) and `analysis_date` match the current form values, and `status` is `completed`, `processing`, or `pending`.
  - Shows `window.confirm()` with status and date context. User can proceed or cancel.
  - If cancelled, resets loading state and returns without submitting.

### 2.2 Remove Stale Frontend Dev Proxy

- **`frontend/vite.config.ts`**: Removed `'/trading': 'http://localhost:8001'` proxy entry.
  - Added comment clarifying that the Python trading service is an internal worker only — the frontend exclusively calls `'/api'` (Go backend on port 3000).
  - All frontend service calls already used `/api/trading/...` paths; no functional change required.

### 2.3 Boundary Regression Check Script

- **`scripts/check-boundaries.sh`** (new): CI-runnable shell script that greps `frontend/src/` for bare `/trading/` fetch calls (without the `/api/` prefix).
  - Exit 0 = clean; exit 1 = violation with file:line details.
  - Verified: `✅ Boundary check passed` on current codebase.

---

## 3. DashScope GLM-4.7 Tool-Call Bug (Discovered)

### 3.1 Error

During live test with DashScope provider + `glm-4.7` model, the Technical (Market Analyst) stage fails immediately with:

```
<400> InternalError.Algo.InvalidParameter: An assistant message with "tool_calls"
must be followed by tool messages responding to each "tool_call_id".
The following tool_call_ids did not have response messages: message[3].role
```

### 3.2 Root Cause

DashScope enforces strict OpenAI-compatible message ordering: every assistant message containing `tool_calls` must be immediately followed by `tool` role messages covering every `tool_call_id`. OpenAI and Ollama tolerate orphaned tool_calls; DashScope rejects them with HTTP 400.

The breakage occurs during message history construction in the LangGraph agent nodes. When the market analyst (or any tool-using analyst) makes a tool call in one turn, the resulting message history passed into the next LLM invocation can contain an unpaired `tool_calls` entry — specifically at `message[3]` in the conversation.

### 3.3 Fix Direction

Before each DashScope LLM call, sanitize the message list:
- Identify all assistant messages with non-empty `tool_calls`.
- For each such message, verify a matching `tool` message exists immediately after with the correct `tool_call_id`.
- Drop any unpaired `tool_calls` entries (or insert a placeholder `tool` response with an empty result).

This sanitization should be applied in the DashScope provider adapter or as a LangGraph pre-call hook, not in the general message pipeline (to avoid affecting OpenAI/Ollama behaviour).

### 3.4 Status

- [ ] Fix: sanitize orphaned tool_calls before DashScope API calls
- [ ] Regression: re-run BABA analysis end-to-end with `dashscope / glm-4.7`

---

## 4. Status

### P1 items

- [x] Duplicate-run guard
- [x] Remove stale `/trading` proxy from vite.config.ts
- [x] Boundary regression check script (`scripts/check-boundaries.sh`)

### P0 provider fidelity

- [ ] DashScope GLM-4.7 tool-call orphan bug — blocks end-to-end DashScope verification
