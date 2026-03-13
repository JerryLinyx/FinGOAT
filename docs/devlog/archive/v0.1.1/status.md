# v0.1.1 Status

## Summary

v0.1.1 supports a Redis-backed task runtime loop with Go as the main business API boundary and Python as the execution worker for TradingAgents.

## Confirmed core capabilities

- Go backend provides auth, RSS/article APIs, and trading analysis lifecycle APIs.
- Analysis tasks are created in Go, persisted in PostgreSQL, and enqueued into Redis.
- Python trading service consumes Redis queue payloads and writes runtime checkpoints/results back to Redis.
- Go reconciles runtime state and persists terminal results/decisions in PostgreSQL.
- Frontend can submit, poll, cancel, and resume analysis tasks.
- Stage transparency is available through `analysis_report.__stage_times` and `analysis_report.__key_outputs`.
- Worker liveness auto-restart and processing-queue recovery are implemented.

## Confirmed boundaries

- Go/Python response contracts are still partially weakly typed.
- Provider-fidelity regression is not fully closed for all vendor/provider combinations.
- Configuration precedence across Go/Python/Docker is not yet fully standardized.
- Python still exposes public task endpoints, but they are no longer the primary product path.
