# pgvector Memory Store Migration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ephemeral ChromaDB in-memory store with PostgreSQL + pgvector, adding user isolation and cross-run persistence for all 5 agent memory roles.

**Architecture:** A new `user_memory_entries` table stores embedding vectors alongside user_id and agent_role, enabling per-user memory isolation. A new `PgVectorMemoryStore` class provides the identical `add_situations` / `get_memories` interface as the existing `FinancialSituationMemory`, falling back transparently to ChromaDB when `POSTGRES_DSN` is unset (local dev without DB).

**Tech Stack:** Python (psycopg2-binary, pgvector), PostgreSQL 15 + pgvector extension (pgvector/pgvector:pg15 Docker image), Go GORM raw SQL migration

---

## Context

**Current problem:**
- `chromadb.Client(Settings(allow_reset=True))` — in-memory only, data lost every restart
- No user isolation: all users share the same ChromaDB process-level collections
- 5 instances per analysis: `bull_memory`, `bear_memory`, `trader_memory`, `invest_judge_memory`, `risk_manager_memory`

**Interface being preserved (DO NOT change):**
```python
# add_situations takes a list of (situation, recommendation) tuples
memory.add_situations([(situation_str, recommendation_str)])

# get_memories returns list of dicts
results = memory.get_memories(current_situation_str, n_matches=2)
# Each result: {"matched_situation": str, "recommendation": str, "similarity_score": float}
```

**Where FinancialSituationMemory is instantiated:**
- `TradingAgents/tradingagents/graph/trading_graph.py` lines 103–107:
  ```python
  self.bull_memory = FinancialSituationMemory("bull_memory", self.config)
  self.bear_memory = FinancialSituationMemory("bear_memory", self.config)
  self.trader_memory = FinancialSituationMemory("trader_memory", self.config)
  self.invest_judge_memory = FinancialSituationMemory("invest_judge_memory", self.config)
  self.risk_manager_memory = FinancialSituationMemory("risk_manager_memory", self.config)
  ```

**Embedding providers and dimensions:**
| Provider | Model | Dimension |
|----------|-------|-----------|
| openai | text-embedding-3-small | 1536 |
| dashscope | text-embedding-v4 | 1024 |
| ollama | nomic-embed-text | 768 |

pgvector column uses `vector` (no fixed dimension) to support all providers without padding.

---

## File Map

| File | Change |
|------|--------|
| `docker-compose.yml` | Switch postgres image → `pgvector/pgvector:pg15`; add `POSTGRES_DSN` to trading-service env |
| `backend/config/migrate.go` | Add raw SQL: `CREATE EXTENSION IF NOT EXISTS vector` + `CREATE TABLE IF NOT EXISTS user_memory_entries` |
| `TradingAgents/tradingagents/agents/utils/memory.py` | Add `PgVectorMemoryStore` class; keep `FinancialSituationMemory` unchanged |
| `TradingAgents/tradingagents/graph/trading_graph.py` | Import `PgVectorMemoryStore`; use it instead of `FinancialSituationMemory` when conditions met |
| `langchain-v1/requirements.txt` | Add `psycopg2-binary>=2.9.9` and `pgvector>=0.3.0` |
| `docs/devlog/planning/records/2026-03-18-pgvector-memory-migration.md` | New devlog record |
| `docs/devlog/planning/task-backlog.md` | Mark new item as [x] |

---

## Task 1: Switch Docker PostgreSQL image + wire POSTGRES_DSN

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1.1: Change postgres image**

In `docker-compose.yml` line 4, change:
```yaml
# FROM:
    image: postgres:15.14-alpine3.21
# TO:
    image: pgvector/pgvector:pg15
```

`pgvector/pgvector:pg15` is the official pgvector image, a drop-in replacement that includes the `vector` extension pre-compiled.

- [ ] **Step 1.2: Add POSTGRES_DSN to trading-service**

In the `trading-service` environment block (after line 105 `DEBUG=true`), add:
```yaml
      - POSTGRES_DSN=postgresql://postgres:${POSTGRES_PASSWORD:-2233}@postgres:5432/fingoat_db
```

This DSN is the same credentials used by the Go backend. The trading-service needs it to write/read memory entries.

Also add `depends_on` for postgres (it currently lacks it):
```yaml
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
```

- [ ] **Step 1.3: Verify docker-compose syntax**

```bash
cd /Users/linyuxuan/workSpace/FinGOAT
docker compose config --quiet
```

Expected: No errors (exit 0).

---

## Task 2: Add pgvector schema migration in Go

**Files:**
- Modify: `backend/config/migrate.go`

The Go backend runs `MigrateDB()` on every startup. We add raw SQL calls to create the extension and table after `AutoMigrate`. The `IF NOT EXISTS` guards make it idempotent.

- [ ] **Step 2.1: Add pgvectorMigrate function**

Add the following function to `migrate.go` (after line 29 but before `migrateLegacyUserPasswordColumn`):

```go
// pgvectorMigrate creates the pgvector extension and user_memory_entries table.
// Safe to re-run (all statements are idempotent).
func pgvectorMigrate() error {
	// Enable the pgvector extension (requires pgvector/pgvector:pg15 image).
	if err := global.DB.Exec("CREATE EXTENSION IF NOT EXISTS vector").Error; err != nil {
		return fmt.Errorf("failed to create vector extension: %w", err)
	}

	// user_memory_entries: per-user, per-role persistent vector memory.
	// Column `embedding` uses dimensionless vector to support OpenAI (1536),
	// DashScope (1024), and Ollama (768) without zero-padding.
	if err := global.DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_memory_entries (
			id              BIGSERIAL PRIMARY KEY,
			user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			agent_role      VARCHAR(32) NOT NULL,
			ticker          VARCHAR(16),
			situation       TEXT NOT NULL,
			recommendation  TEXT NOT NULL,
			embedding       vector,
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`).Error; err != nil {
		return fmt.Errorf("failed to create user_memory_entries: %w", err)
	}

	if err := global.DB.Exec(`
		CREATE INDEX IF NOT EXISTS idx_memory_user_role
		ON user_memory_entries (user_id, agent_role)
	`).Error; err != nil {
		return fmt.Errorf("failed to create idx_memory_user_role: %w", err)
	}

	return nil
}
```

- [ ] **Step 2.2: Call pgvectorMigrate from MigrateDB**

In `MigrateDB()`, after the `log.Println("Database migration completed successfully")` line, append:
```go
	if err := pgvectorMigrate(); err != nil {
		log.Fatalf("Failed to run pgvector migration: %v", err)
	}
```

Actually, insert it **before** that log line so the success message is accurate. Change:
```go
	if err := migrateLegacyUserPasswordColumn(); err != nil {
		log.Fatalf("Failed to migrate legacy user password data: %v", err)
	}
	log.Println("Database migration completed successfully")
```
to:
```go
	if err := migrateLegacyUserPasswordColumn(); err != nil {
		log.Fatalf("Failed to migrate legacy user password data: %v", err)
	}
	if err := pgvectorMigrate(); err != nil {
		log.Fatalf("Failed to run pgvector migration: %v", err)
	}
	log.Println("Database migration completed successfully")
```

- [ ] **Step 2.3: Add fmt import**

`migrate.go` currently imports only `"log"`. Add `"fmt"`:
```go
import (
	"fmt"
	"log"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
)
```

- [ ] **Step 2.4: Verify Go compiles**

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/backend
go build ./...
```

Expected: No errors.

---

## Task 3: Add PgVectorMemoryStore to memory.py

**Files:**
- Modify: `TradingAgents/tradingagents/agents/utils/memory.py`

Add `PgVectorMemoryStore` class at the end of the file, before `if __name__ == "__main__":`. The class has the **identical public interface** as `FinancialSituationMemory`.

- [ ] **Step 3.1: Add PgVectorMemoryStore class**

Append the following to `memory.py` after line 215 (after the closing line of `get_memories`) and before `if __name__ == "__main__":`.

**Design note:** `PgVectorMemoryStore` owns its embedding client directly (same pattern as `FinancialSituationMemory`) rather than delegating through a partially-constructed helper object. This avoids brittle `__new__`-based construction. The embedding-related attrs and methods are a straight port from `FinancialSituationMemory`.

```python
class PgVectorMemoryStore:
    """
    PostgreSQL + pgvector backed memory store with user isolation.

    Drop-in replacement for FinancialSituationMemory. Falls back to
    FinancialSituationMemory (ChromaDB) when POSTGRES_DSN is unset or
    user_id is None — allows local development without a running DB.

    Note: the `embedding` column uses dimensionless `vector` type to support
    OpenAI (1536-dim), DashScope (1024-dim), and Ollama (768-dim) without
    zero-padding. This precludes ANN indexes (HNSW/IVFFlat); exact cosine
    search is used instead (acceptable for <10,000 rows per user).

    Public interface (identical to FinancialSituationMemory):
        add_situations([(situation, recommendation), ...])
        get_memories(current_situation, n_matches=1) -> list[dict]
    """

    def __init__(self, name: str, config: dict, user_id: int | None = None):
        self.name = name  # agent_role label (e.g. "bull_memory")
        self.user_id = user_id
        self._conn = None
        self._fallback: FinancialSituationMemory | None = None

        dsn = os.getenv("POSTGRES_DSN")

        if not dsn or not user_id:
            # Graceful fallback: no DB configured or anonymous run.
            logger.info(
                "PgVectorMemoryStore[%s]: POSTGRES_DSN=%s user_id=%s — "
                "falling back to in-memory ChromaDB",
                name,
                "set" if dsn else "unset",
                user_id,
            )
            self._fallback = FinancialSituationMemory(name, config)
            return

        try:
            import psycopg2
            from pgvector.psycopg2 import register_vector

            self._conn = psycopg2.connect(dsn)
            register_vector(self._conn)
            self._conn.autocommit = True
        except Exception as exc:
            logger.warning(
                "PgVectorMemoryStore[%s]: DB connection failed (%s) — "
                "falling back to in-memory ChromaDB",
                name,
                exc,
            )
            self._fallback = FinancialSituationMemory(name, config)
            return

        # Own the embedding client directly — same setup as FinancialSituationMemory.__init__
        # but without allocating a ChromaDB collection.
        embed_model, embed_base_url, embed_api_key = _resolve_embedding_settings(config)
        self.provider = normalize_provider_name(
            (config or {}).get("llm_provider", os.getenv("LLM_PROVIDER", "openai"))
        )
        self.embedding = embed_model
        self.embed_base_url = embed_base_url
        self.client = OpenAI(base_url=embed_base_url, api_key=embed_api_key)
        self.native_embedding = self._build_native_embedding_client(embed_model, embed_api_key)

    # ---- Embedding methods (ported verbatim from FinancialSituationMemory) ----

    def _build_native_embedding_client(self, embed_model: str, embed_api_key: str):
        if self.provider != "dashscope" or DashScopeEmbeddings is None:
            return None
        try:
            return DashScopeEmbeddings(
                model=embed_model,
                dashscope_api_key=embed_api_key,
            )
        except Exception as exc:
            logger.warning(
                "DashScopeEmbeddings unavailable, falling back to OpenAI-compatible embeddings: %s",
                exc,
            )
            return None

    def get_embedding(self, text: str):
        """Get an embedding, shrinking oversized inputs only when the provider rejects them."""
        if self.native_embedding is not None:
            try:
                return self.native_embedding.embed_query(text)
            except Exception as exc:
                if not self._should_retry_with_shorter_input(exc, text):
                    raise
                text = text[: max(len(text) // 2, MIN_EMBED_RETRY_LENGTH)]
                return self.native_embedding.embed_query(text)

        text_to_embed = text
        while True:
            try:
                response = self.client.embeddings.create(
                    model=self.embedding, input=text_to_embed
                )
                return response.data[0].embedding
            except Exception as exc:
                if not self._should_retry_with_shorter_input(exc, text_to_embed):
                    raise
                next_length = max(len(text_to_embed) // 2, MIN_EMBED_RETRY_LENGTH)
                if next_length >= len(text_to_embed):
                    raise
                text_to_embed = text_to_embed[:next_length]

    def _should_retry_with_shorter_input(self, exc, text: str) -> bool:
        if len(text) <= MIN_EMBED_RETRY_LENGTH:
            return False
        message = str(exc)
        if "Range of input length should be [1, 8192]" in message:
            return True
        if "maximum context length" in message.lower():
            return True
        if self.provider == "dashscope" and "InvalidParameter" in message and "input length" in message:
            return True
        return False

    def _should_degrade_memory_failure(self, exc) -> bool:
        message = str(exc).lower()
        if self.provider == "ollama":
            ollama_embedding_errors = (
                "model",
                "not found",
                "incorrect api key",
                "invalid api key",
                "connection refused",
                "failed to establish a new connection",
                "max retries exceeded",
            )
            if any(token in message for token in ollama_embedding_errors):
                return True
        return False

    # ---- Storage methods ----

    def add_situations(self, situations_and_advice):
        """Persist (situation, recommendation) pairs to pgvector.

        Args:
            situations_and_advice: list of (situation_str, recommendation_str) tuples
        """
        if self._fallback is not None:
            return self._fallback.add_situations(situations_and_advice)

        import numpy as np

        with self._conn.cursor() as cur:
            for situation, recommendation in situations_and_advice:
                try:
                    embedding = self.get_embedding(situation)
                except Exception as exc:
                    if self._should_degrade_memory_failure(exc):
                        logger.warning(
                            "PgVectorMemoryStore[%s]: skipping add, embedding unavailable: %s",
                            self.name,
                            exc,
                        )
                        return
                    raise

                cur.execute(
                    """
                    INSERT INTO user_memory_entries
                        (user_id, agent_role, situation, recommendation, embedding)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        self.user_id,
                        self.name,
                        situation,
                        recommendation,
                        np.array(embedding),
                    ),
                )

    def get_memories(self, current_situation: str, n_matches: int = 1) -> list:
        """Retrieve similar past situations from pgvector.

        Returns list of dicts matching FinancialSituationMemory format:
            {"matched_situation": str, "recommendation": str, "similarity_score": float}
        """
        if self._fallback is not None:
            return self._fallback.get_memories(current_situation, n_matches)

        import numpy as np

        try:
            query_embedding = self.get_embedding(current_situation)
        except Exception as exc:
            if self._should_degrade_memory_failure(exc):
                logger.warning(
                    "PgVectorMemoryStore[%s]: skipping retrieval, embedding unavailable: %s",
                    self.name,
                    exc,
                )
                return []
            raise

        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT situation, recommendation,
                       1 - (embedding <=> %s) AS similarity
                FROM user_memory_entries
                WHERE user_id = %s AND agent_role = %s
                ORDER BY embedding <=> %s
                LIMIT %s
                """,
                (
                    np.array(query_embedding),
                    self.user_id,
                    self.name,
                    np.array(query_embedding),
                    n_matches,
                ),
            )
            rows = cur.fetchall()

        return [
            {
                "matched_situation": row[0],
                "recommendation": row[1],
                "similarity_score": float(row[2]),
            }
            for row in rows
        ]

    def close(self):
        """Close the DB connection. Call when the analysis run ends."""
        if self._conn and not self._conn.closed:
            self._conn.close()

    def __del__(self):
        self.close()
```

- [ ] **Step 3.2: Export PgVectorMemoryStore from agents __init__.py**

In `TradingAgents/tradingagents/agents/__init__.py`, add `PgVectorMemoryStore` to imports and `__all__`:
```python
from .utils.memory import FinancialSituationMemory, PgVectorMemoryStore
```
And in `__all__`:
```python
"PgVectorMemoryStore",
```

---

## Task 4: Wire PgVectorMemoryStore into trading_graph.py

**Files:**
- Modify: `TradingAgents/tradingagents/graph/trading_graph.py`

The 5 memory instances are created in `TradingAgentsGraph.__init__`. We replace them with `PgVectorMemoryStore`, passing `user_id` from `self.config`.

- [ ] **Step 4.1: Add import**

Find the import line (line 14):
```python
from tradingagents.agents.utils.memory import FinancialSituationMemory
```
Change to:
```python
from tradingagents.agents.utils.memory import FinancialSituationMemory, PgVectorMemoryStore
```

- [ ] **Step 4.2: Replace instantiation**

Find lines 103–107:
```python
        self.bull_memory = FinancialSituationMemory("bull_memory", self.config)
        self.bear_memory = FinancialSituationMemory("bear_memory", self.config)
        self.trader_memory = FinancialSituationMemory("trader_memory", self.config)
        self.invest_judge_memory = FinancialSituationMemory("invest_judge_memory", self.config)
        self.risk_manager_memory = FinancialSituationMemory("risk_manager_memory", self.config)
```

Replace with:
```python
        _user_id = self.config.get("user_id")
        self.bull_memory = PgVectorMemoryStore("bull_memory", self.config, user_id=_user_id)
        self.bear_memory = PgVectorMemoryStore("bear_memory", self.config, user_id=_user_id)
        self.trader_memory = PgVectorMemoryStore("trader_memory", self.config, user_id=_user_id)
        self.invest_judge_memory = PgVectorMemoryStore("invest_judge_memory", self.config, user_id=_user_id)
        self.risk_manager_memory = PgVectorMemoryStore("risk_manager_memory", self.config, user_id=_user_id)
```

`user_id` is already in `self.config` — it's set by `build_config()` in `trading_service.py` from `request.user_id`.

---

## Task 5: Add Python dependencies

**Files:**
- Modify: `langchain-v1/requirements.txt`

- [ ] **Step 5.1: Add psycopg2-binary and pgvector**

In `requirements.txt`, find the `# Storage & Cache` section:
```
# Storage & Cache
chromadb>=1.0.12
redis>=6.2.0
```

Add:
```
# Storage & Cache
chromadb>=1.0.12
redis>=6.2.0
psycopg2-binary>=2.9.9
pgvector>=0.3.0
```

---

## Task 6: Write devlog record

**Files:**
- Create: `docs/devlog/planning/records/2026-03-18-pgvector-memory-migration.md`
- Modify: `docs/devlog/planning/task-backlog.md`

- [ ] **Step 6.1: Create devlog record**

Create `docs/devlog/planning/records/2026-03-18-pgvector-memory-migration.md` with:

```markdown
# pgvector Memory Store Migration

## 1. Background

ChromaDB was used in in-memory mode (`Settings(allow_reset=True)`) — data lost on every restart,
no user isolation. 5 agent memory roles shared process-level ChromaDB collections.

## 2. Changes

### 2.1 PostgreSQL image
`docker-compose.yml`: `postgres:15.14-alpine3.21` → `pgvector/pgvector:pg15` (drop-in, includes vector extension).

### 2.2 Schema migration (Go)
`migrate.go`: `pgvectorMigrate()` runs on startup:
- `CREATE EXTENSION IF NOT EXISTS vector`
- `CREATE TABLE IF NOT EXISTS user_memory_entries` with columns: `id`, `user_id` (FK), `agent_role`, `ticker`, `situation`, `recommendation`, `embedding vector`, `created_at`
- Index on `(user_id, agent_role)` for fast per-user retrieval

### 2.3 PgVectorMemoryStore (Python)
`memory.py`: new `PgVectorMemoryStore` class.
- Identical interface to `FinancialSituationMemory` (`add_situations`, `get_memories`)
- Falls back to `FinancialSituationMemory` (ChromaDB) when `POSTGRES_DSN` unset or `user_id` is None
- Uses psycopg2 + pgvector Python library for sync DB access
- Embedding logic reused from `FinancialSituationMemory` (same `_resolve_embedding_settings` + `get_embedding`)
- Cosine similarity via pgvector `<=>` operator: `similarity = 1 - (embedding <=> query_vec)`

### 2.4 trading_graph.py
5 memory instances switched from `FinancialSituationMemory` to `PgVectorMemoryStore`, passing `user_id` from config.

### 2.5 Dependencies
`requirements.txt`: added `psycopg2-binary>=2.9.9`, `pgvector>=0.3.0`.

## 3. Fallback Behavior

| Condition | Behavior |
|-----------|----------|
| `POSTGRES_DSN` unset | Falls back to ChromaDB (in-memory, no persistence) |
| `user_id` is None | Falls back to ChromaDB |
| DB connection fails | Logs warning, falls back to ChromaDB |
| Embedding unavailable (Ollama) | Skips memory op (same as before) |

## 4. What Changed for Users

- Memory now persists across restarts — agents remember past reflections
- Memory is user-scoped — no cross-user contamination
- Ollama users: memory still degrades gracefully (no change)

## 5. Phase 2 (Future)

Post-hoc evaluation system: 5-trading-day price window, ±2% threshold, validated/invalidated lifecycle.
Deferred until sufficient real memory data exists to validate the logic.
```

- [ ] **Step 6.2: Add to task-backlog.md**

In `task-backlog.md` under `## P1`, add:
```markdown
- [x] Migrate agent memory from ephemeral ChromaDB to PostgreSQL + pgvector with user isolation
  - Record: `records/2026-03-18-pgvector-memory-migration.md`
```

---

## Verification

- [ ] **V1: Docker rebuild compiles without errors**

```bash
cd /Users/linyuxuan/workSpace/FinGOAT
docker compose build --no-cache trading-service backend postgres
```

Expected: All 3 services build successfully.

- [ ] **V2: Postgres starts with pgvector**

```bash
docker compose up -d postgres
sleep 5
docker compose exec postgres psql -U postgres -d fingoat_db -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

Expected: Row showing `vector` extension after `docker compose up -d backend` runs migrate.

- [ ] **V3: user_memory_entries table exists**

```bash
docker compose up -d backend
sleep 10
docker compose exec postgres psql -U postgres -d fingoat_db -c "\d user_memory_entries"
```

Expected: Table with columns including `embedding` of type `vector`.

- [ ] **V4: Python imports work**

```bash
docker compose exec trading-service python -c "from tradingagents.agents.utils.memory import PgVectorMemoryStore; print('OK')"
```

Expected: `OK`

- [ ] **V5: Analysis run stores memory**

Run an analysis via the frontend with a logged-in user. After completion:
```bash
docker compose exec postgres psql -U postgres -d fingoat_db -c "SELECT user_id, agent_role, LENGTH(situation), created_at FROM user_memory_entries LIMIT 10;"
```

Expected: Rows showing 5 agent roles, matching the user's ID, with non-zero situation length.

- [ ] **V6: Memory persists across restart**

```bash
docker compose restart trading-service
# Run another analysis — get_memories should find prior entries if same user runs again
```

Expected: Log output shows memory retrieval returning results (previously these were always empty).
