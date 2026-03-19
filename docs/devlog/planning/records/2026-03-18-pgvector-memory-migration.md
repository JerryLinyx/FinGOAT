# pgvector Memory Store Migration

## 1. Background

ChromaDB was used in in-memory mode (`Settings(allow_reset=True)`) — data lost on every restart,
no user isolation. 5 agent memory roles shared process-level ChromaDB collections, meaning:

- All reflective memory (post-decision lessons) was ephemeral — lost on every service restart
- Multiple users shared the same in-process collections — memories could cross-contaminate

## 2. Changes

### 2.1 PostgreSQL image

`docker-compose.yml`: `postgres:15.14-alpine3.21` → `pgvector/pgvector:pg15`

Drop-in replacement image that includes the `vector` extension pre-compiled. The healthcheck, volume, and all other configuration are unchanged.

### 2.2 POSTGRES_DSN in trading-service

`docker-compose.yml`: Added `POSTGRES_DSN=postgresql://postgres:${POSTGRES_PASSWORD:-2233}@postgres:5432/fingoat_db` to trading-service environment. Also added `depends_on: postgres: condition: service_healthy` so the service waits for DB readiness.

### 2.3 Schema migration (Go)

`backend/config/migrate.go`: New `pgvectorMigrate()` function called from `MigrateDB()`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS user_memory_entries (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_role      VARCHAR(32) NOT NULL,   -- e.g. "bull_memory", "trader_memory"
    ticker          VARCHAR(16),             -- optional, for future per-ticker filtering
    situation       TEXT NOT NULL,           -- concatenation of 4 analyst reports
    recommendation  TEXT NOT NULL,           -- LLM reflection on decision quality
    embedding       vector,                  -- dimensionless: supports 768/1024/1536-dim
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_user_role ON user_memory_entries (user_id, agent_role);
```

Note: `embedding vector` (no fixed dimension) supports all three embedding providers without zero-padding, at the cost of precluding HNSW/IVFFlat ANN indexes. Exact cosine search is used instead — acceptable at current scale.

### 2.4 PgVectorMemoryStore (Python)

`TradingAgents/tradingagents/agents/utils/memory.py`: New `PgVectorMemoryStore` class.

**Interface** (identical to `FinancialSituationMemory`):
```python
store.add_situations([(situation_str, recommendation_str), ...])
results = store.get_memories(current_situation_str, n_matches=2)
# results: [{"matched_situation": str, "recommendation": str, "similarity_score": float}]
```

**Key design:**
- Owns its embedding client directly (same `_resolve_embedding_settings` call + same attrs as `FinancialSituationMemory`) — no partial construction hacks
- Uses `psycopg2` for synchronous PostgreSQL access (consistent with rest of TradingAgents sync code)
- Cosine similarity: `similarity = 1 - (embedding <=> query_vector)` via pgvector operator
- Passes `numpy.array(embedding)` for pgvector type compatibility

### 2.5 Fallback behavior

| Condition | Behavior |
|-----------|----------|
| `POSTGRES_DSN` env var unset | Falls back to `FinancialSituationMemory` (ChromaDB, in-memory) |
| `user_id` is `None` | Falls back to `FinancialSituationMemory` (ChromaDB, in-memory) |
| `psycopg2.connect()` fails | Logs warning, falls back to `FinancialSituationMemory` |
| Embedding unavailable (Ollama) | Skips memory op, logs warning (same as before) |

### 2.6 trading_graph.py

All 5 memory instances switched from `FinancialSituationMemory` to `PgVectorMemoryStore`:
```python
_user_id = self.config.get("user_id")
self.bull_memory = PgVectorMemoryStore("bull_memory", self.config, user_id=_user_id)
# ... (bear, trader, invest_judge, risk_manager)
```

`user_id` is already in `self.config` — set by `build_config()` in `trading_service.py` from `request.user_id`, which is injected by the Go backend JWT middleware.

### 2.7 Python dependencies

`langchain-v1/requirements.txt`: Added `psycopg2-binary>=2.9.9` and `pgvector>=0.3.0`.

## 3. What Changed for Users

- **Memory persists across restarts** — agents accumulate lessons over time
- **Memory is user-scoped** — no cross-user contamination in multi-user deployments
- **Ollama users unaffected** — embedding degradation path unchanged; memory skipped gracefully when Ollama embedding model unavailable

## 4. Verification Steps

```bash
# 1. Rebuild with new image
docker compose build --no-cache postgres backend trading-service

# 2. Start postgres, verify extension exists
docker compose up -d postgres
docker compose up -d backend   # triggers MigrateDB() which calls pgvectorMigrate()
docker compose exec postgres psql -U postgres -d fingoat_db -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"

# 3. Verify table was created
docker compose exec postgres psql -U postgres -d fingoat_db -c "\d user_memory_entries"

# 4. Verify Python imports work
docker compose exec trading-service python -c "from tradingagents.agents.utils.memory import PgVectorMemoryStore; print('OK')"

# 5. After a full analysis run, verify rows were stored
docker compose exec postgres psql -U postgres -d fingoat_db \
  -c "SELECT user_id, agent_role, LENGTH(situation), created_at FROM user_memory_entries LIMIT 10;"
```

## 5. Phase 2 (Future)

Post-hoc evaluation system: 5-trading-day price window, ±2% threshold, `validated`/`invalidated` lifecycle.
Deferred until sufficient real memory data exists to validate the logic.

The `ticker` column on `user_memory_entries` is already present for this future use.

## 6. Deployment Risk Identified During Review

The current Go migration path calls `pgvectorMigrate()` unconditionally during backend startup:

- `MigrateDB()` always executes `CREATE EXTENSION IF NOT EXISTS vector`
- backend startup aborts via `log.Fatalf(...)` if the connected PostgreSQL instance does not support the `vector` extension

This is stricter than the Python-side store behavior, which already supports graceful fallback:

- `PgVectorMemoryStore` falls back to in-memory `FinancialSituationMemory` when `POSTGRES_DSN` is unset
- it also falls back when `psycopg2.connect()` fails

### Fix Applied

pgvector support is now capability-gated rather than mandatory:

1. Added `features.require_pgvector: false` to backend config
2. Added `REQUIRE_PGVECTOR=true|false` env override
3. Backend startup now logs a warning and continues when pgvector migration fails in non-required environments
4. When pgvector is explicitly required, startup still fails fast
5. `PgVectorMemoryStore` fallback behavior remains the runtime safety net
