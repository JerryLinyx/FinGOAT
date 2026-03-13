# Milestones

## Phase 1: Boundary Consolidation and Execution Stability

### Objective

Stabilize the execution path and remove API boundary overlap between Go and Python.

### Deliverables

- Go remains the only external trading API boundary
- Python trading service is reduced to internal worker/runtime responsibilities
- Python public task APIs are restricted/deprecated for production path
- Task state model redesign
- Redis-backed execution coordination
- PostgreSQL-backed persistent task truth
- Go/Python response schema cleanup

### Risks

- Cross-service changes may break current polling flow if rolled out partially.
- Boundary cleanup may temporarily impact local developer workflows that still call `:8001` directly.

## Phase 2: Transparency and Observability

### Objective

Expose meaningful intermediate progress to both users and developers.

### Deliverables

- Stage timing in Python analysis responses
- Typed stage/result payloads in Go
- Frontend stage display for analysis progress and outputs

### Risks

- Stage schema may churn if not standardized before UI integration.

## Phase 3: Project Structure Cleanup

### Objective

Reduce future iteration cost.

### Deliverables

- Configuration source-of-truth rules
- Frontend state/module cleanup
- Devlog and appendix structure finalized in-repo

### Risks

- Cleanup may get deprioritized if execution stability work overruns.

## Phase 4: Analysis Quality Enhancements

### Objective

Improve decision quality on top of the stabilized system.

### Deliverables

- Selective absorption of `dev_gq2142` structured analyst output work
- Selective absorption of `rag_fund` fundamentals RAG components
- Vendor caching and data-fetch deduplication improvements

### Risks

- Quality work can reintroduce complexity if done before boundaries are stable.
