---
id: ADR-014
kind: decision
title: Redis Worker Timeout
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Redis Worker Timeout

## Background

The Python trading service runs a background worker that blocks on Redis queue reads while the rest of the service uses Redis for short request/response operations.

## Problem and impact

- The worker repeatedly logged:
  - `Redis worker error: Timeout reading from socket`
- The same Redis client configuration was used for both:
  - normal request/state operations
  - blocking queue consumption via `BRPOPLPUSH`
- The client had `socket_timeout=5`, and the worker blocked for `timeout=5`, so an idle queue wait could be misclassified as a socket read failure.

## Final decision

Split Redis client usage by access pattern:

- keep a short-timeout client for ordinary request/state operations
- use a dedicated worker client with no socket read timeout for blocking queue reads

## Implementation design

- `services/trading-service/trading_service.py`
  - extracted `resolve_redis_connection_config()`
  - added `build_redis_client(socket_timeout=...)`
  - kept `get_redis_client()` for normal Redis operations with short request timeout
  - added `get_worker_redis_client()` with `socket_timeout=None`
  - moved `recover_processing_queue()` to the worker client
  - moved `analysis_worker_loop()` queue blocking reads to the worker client
  - added `close_redis_clients()` and `reset_redis_clients()`
  - startup now warms both clients
  - shutdown now closes both clients
- `services/trading-service/tests/mock_pipeline/test_redis_worker_client.py`
  - verifies normal and worker clients use different timeout profiles
  - verifies worker client caching behavior
  - verifies Redis address parsing remains correct

## Testing and validation

Validated locally with:

```bash
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/trading_service.py /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/tests/mock_pipeline/test_redis_worker_client.py
cd /Users/linyuxuan/workSpace/FinGOAT/services/trading-service && python -m unittest tests.mock_pipeline.test_redis_worker_client tests.mock_pipeline.test_mock_analysis_pipeline
```

Live validation with the project `.venv` and local Redis:

- started `uvicorn trading_service:app --host 0.0.0.0 --port 8001`
- confirmed `/health` returned `200 OK`
- observed worker startup and queue recovery
- watched multiple idle windows after startup with no recurrence of:
  - `Redis worker error: Timeout reading from socket`

## Outcome and follow-up

Status: implemented.

Remaining gap:

- broader end-to-end provider fidelity still needs its own final close-out after the latest runtime changes

## Additional follow-up: worker liveness and self-healing

Later investigation exposed a separate worker-runtime gap:

- Redis still contained pending analysis payloads
- the trading service health endpoint still returned `healthy`
- but the background worker was no longer consuming the queue

This indicated that the FastAPI process could stay alive while the background worker thread had silently stopped.

Implementation follow-up:

- `services/trading-service/trading_service.py`
  - added `ensure_worker_thread_running()`
  - startup now delegates worker boot to that helper
  - `/health` now reports `worker_alive`
  - `/health` also restarts the worker if it is found dead
  - `/api/v1/analyze` ensures the worker is running before enqueuing a new task

Validation:

```bash
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/trading_service.py
```

Live validation after restarting the trading service:

- `/health` returned:
  - `"worker_alive": true`
- the previously stuck queue started draining again
- Redis moved from:
  - `queue=2, processing=0`
  to:
  - `queue=1, processing=1`

Result:

- worker death is now visible
- common entry points can revive the worker without a full service restart
