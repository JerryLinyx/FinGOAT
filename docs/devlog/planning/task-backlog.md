# Task Backlog

## P0

- [ ] Consolidate service API ownership: Go is the only external trading API, Python trading service is internal worker-only
  - Record: `records/2026-03-13-v020-kickoff-requirements.md`
- [ ] Restrict or deprecate Python public task endpoints (`/api/v1/analyze`, `/api/v1/analysis/{task_id}`) from production exposure
  - Record: `records/2026-03-13-v020-kickoff-requirements.md`
- [x] Redesign analysis task state lifecycle
  - Record: `records/2026-03-13-task-state-redesign.md`
- [x] Define PostgreSQL and Redis boundary for task execution
  - Record: `records/2026-03-13-redis-postgres-boundary.md`
- [ ] Replace weak Go/Python response parsing with typed contracts
- [x] Unify auth header contract and service-side validation behavior
  - Record: `records/2026-03-13-task-state-redesign.md`
- [x] Add `qwen3.5-flash` as an Aliyun DashScope model preset for provider testing
  - Record: `records/2026-03-13-dashscope-qwen35-flash-provider-verification.md`
- [x] Make embedding defaults provider-aware so Aliyun runs do not fall back to OpenAI embeddings
  - Record: `records/2026-03-13-dashscope-qwen35-flash-provider-verification.md`
- [x] Extend provider-aware embedding routing so Ollama runs do not fall back to OpenAI embeddings
  - Record: `records/2026-03-13-ollama-embedding-routing.md`
- [x] Handle DashScope embedding input-length failures with retry-based fallback truncation
  - Record: `records/2026-03-13-dashscope-qwen35-flash-provider-verification.md`
- [ ] Verify end-to-end provider fidelity when Aliyun DashScope is selected
  - Record: `records/2026-03-13-dashscope-qwen35-flash-provider-verification.md`
- [x] Sanitize LangChain message objects before persisting `analysis_report`
  - Record: `records/2026-03-13-dashscope-qwen35-flash-provider-verification.md`
- [x] Add a mock analysis pipeline testcase that runs the task lifecycle without real model or vendor calls
  - Record: `records/2026-03-13-mock-analysis-pipeline-test.md`
- [x] Reconcile stale `pending/processing` tasks when Redis runtime state is missing
  - Record: `records/2026-03-13-redis-postgres-boundary.md`
- [x] Make `get_global_news` follow the configured news vendor and avoid implicit OpenAI fallback for `alpha_vantage`
  - Record: `records/2026-03-13-dashscope-qwen35-flash-provider-verification.md`
- [x] Separate worker Redis blocking reads from request Redis timeouts to avoid spurious socket timeout errors
  - Record: `records/2026-03-13-redis-worker-timeout.md`
- [x] Expose worker liveness and auto-restart a dead trading worker thread
  - Record: `records/2026-03-13-redis-worker-timeout.md`
- [x] Make Ollama with `llama3.2` the default provider/model across frontend and service defaults
  - Record: `records/2026-03-13-ollama-default-model.md`

## P1

- [ ] Remove stale frontend dev proxy path `/trading -> :8001` if frontend no longer calls Python APIs directly
  - Record: `records/2026-03-13-v020-kickoff-requirements.md`
- [ ] Add boundary regression checks to prevent reintroducing direct frontend->Python or Go->Python analyze-path coupling
  - Record: `records/2026-03-13-v020-kickoff-requirements.md`
- [x] Add stage timing and key outputs to the mainline analysis response
  - Record: `records/2026-03-13-stage-timing-and-stage-view.md`
- [x] Add stage-based frontend analysis view
  - Record: `records/2026-03-13-stage-timing-and-stage-view.md`
- [x] Preserve in-progress analysis visibility across logout/login and polling transitions
  - Record: `records/2026-03-13-stage-timing-and-stage-view.md`
- [x] Make recent analyses clickable so historical analysis details can be reopened
  - Record: `records/2026-03-13-stage-timing-and-stage-view.md`
- [x] Remove placeholder navigation and dead-end shell UI from the main app
  - Record: `records/2026-03-13-stage-timing-and-stage-view.md`
- [x] Persist processing-stage checkpoints so partial reports are visible before task completion
  - Record: `records/2026-03-13-processing-checkpoints.md`
- [x] Adopt async graph execution and parallelize independent analyst stages
  - Record: `records/2026-03-13-async-graph-execution.md`
- [x] Make parallel analyst cleanup concurrency-safe to avoid duplicate message deletion during Ollama runs
  - Record: `records/2026-03-13-parallel-analyst-cleanup.md`
- [x] Degrade Ollama memory retrieval when embeddings are unavailable so research debate can continue
  - Record: `records/2026-03-13-ollama-memory-fallback.md`
- [x] Add terminate and continue controls for analysis tasks
  - Record: `records/2026-03-13-analysis-cancel-and-resume.md`
- [x] Make terminate/resume clean Redis queue state and prevent duplicate task payloads
  - Record: `records/2026-03-13-analysis-cancel-and-resume.md`
- [ ] Define configuration precedence rules across Go, Python, and Docker
- [ ] Refactor frontend state boundaries for auth, article feed, and analysis

## P2

- [ ] Evaluate selective adoption of fundamentals RAG
  - Related branch review: `records/2026-03-13-branch-capability-review.md`
- [ ] Evaluate selective adoption of valuation analyst and structured analyst outputs
- [x] Add RSS article refresh deduplication and batch backfill for unseen feed items
  - Record: `records/2026-03-13-rss-refresh-deduplication.md`
- [x] Switch stock chart fetching to Alpha Vantage free-tier-compatible endpoints
  - Record: `records/2026-03-13-rss-refresh-deduplication.md`
- [x] Redesign chart controls so bar interval and lookback window are not conflated
  - Record: `records/2026-03-13-rss-refresh-deduplication.md`
- [ ] Add vendor fetch deduplication and runtime caching for expensive data calls
