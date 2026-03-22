import chromadb
import logging
import os
from urllib.parse import urlparse, urlunparse
from chromadb.config import Settings
from openai import OpenAI

DASHSCOPE_COMPAT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
OLLAMA_COMPAT_BASE_URL = "http://localhost:11434/v1"
MIN_EMBED_RETRY_LENGTH = 256
logger = logging.getLogger(__name__)

try:
    from langchain_community.embeddings import DashScopeEmbeddings
except Exception:  # pragma: no cover - optional dependency
    DashScopeEmbeddings = None


def normalize_provider_name(provider: str | None) -> str:
    normalized = (provider or "openai").lower()
    if normalized == "aliyun":
        return "dashscope"
    return normalized


def _ollama_embed_base_url(base_url: str | None) -> str:
    if not base_url:
        return OLLAMA_COMPAT_BASE_URL
    normalized = base_url.rstrip("/")
    if normalized.endswith("/v1"):
        return normalized
    return f"{normalized}/v1"


def _running_in_docker() -> bool:
    return os.path.exists("/.dockerenv")


def _normalize_ollama_embed_url(base_url: str | None) -> str:
    normalized = _ollama_embed_base_url(base_url)
    if not _running_in_docker():
        return normalized
    parsed = urlparse(normalized)
    if parsed.hostname not in {"localhost", "127.0.0.1"}:
        return normalized
    host = parsed.netloc
    port = f":{parsed.port}" if parsed.port else ""
    if "@" in host:
        userinfo = host.split("@", 1)[0] + "@"
    else:
        userinfo = ""
    rewritten = parsed._replace(netloc=f"{userinfo}host.docker.internal{port}")
    return urlunparse(rewritten)


def _resolve_embedding_settings(config):
    provider = normalize_provider_name((config or {}).get("llm_provider", os.getenv("LLM_PROVIDER", "openai")))
    provider_base_url = (config or {}).get("backend_url") or os.getenv("LLM_BASE_URL")
    provider_api_key = (config or {}).get("llm_api_key") or os.getenv("LLM_API_KEY", "")

    embed_model = os.getenv("EMBED_MODEL")
    embed_base_url = os.getenv("EMBED_BASE_URL")
    embed_api_key = os.getenv("EMBED_API_KEY")

    if provider == "dashscope":
        return (
            os.getenv("DASHSCOPE_EMBED_MODEL", "") or "text-embedding-v4",
            os.getenv("DASHSCOPE_EMBED_BASE_URL", "") or provider_base_url or DASHSCOPE_COMPAT_BASE_URL,
            os.getenv("DASHSCOPE_EMBED_API_KEY", "") or os.getenv("DASHSCOPE_API_KEY", "") or provider_api_key,
        )

    if provider == "ollama":
        return (
            embed_model or os.getenv("OLLAMA_EMBED_MODEL", "") or "nomic-embed-text",
            _normalize_ollama_embed_url(embed_base_url or provider_base_url),
            embed_api_key or provider_api_key or os.getenv("OLLAMA_API_KEY", "") or "ollama",
        )

    return (
        embed_model or "text-embedding-3-small",
        embed_base_url or provider_base_url or "https://api.openai.com/v1",
        embed_api_key or os.getenv("OPENAI_API_KEY", "") or provider_api_key,
    )


class FinancialSituationMemory:
    def __init__(self, name, config):
        # Let embeddings follow the selected provider unless explicitly overridden.
        embed_model, embed_base_url, embed_api_key = _resolve_embedding_settings(config)

        self.provider = normalize_provider_name((config or {}).get("llm_provider", os.getenv("LLM_PROVIDER", "openai")))
        self.embedding = embed_model
        self.embed_base_url = embed_base_url
        self.client = OpenAI(base_url=embed_base_url, api_key=embed_api_key)
        self.native_embedding = self._build_native_embedding_client(embed_model, embed_api_key)
        self.chroma_client = chromadb.Client(Settings(allow_reset=True))
        # Avoid collision when collection already exists (reuse instead of failing)
        try:
            self.situation_collection = self.chroma_client.create_collection(name=name)
        except Exception:
            self.situation_collection = self.chroma_client.get_or_create_collection(name=name)

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

    def get_embedding(self, text):
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

    def add_situations(self, situations_and_advice):
        """Add financial situations and their corresponding advice. Parameter is a list of tuples (situation, rec)"""

        situations = []
        advice = []
        ids = []
        embeddings = []

        offset = self.situation_collection.count()

        for i, (situation, recommendation) in enumerate(situations_and_advice):
            situations.append(situation)
            advice.append(recommendation)
            ids.append(str(offset + i))
            try:
                embeddings.append(self.get_embedding(situation))
            except Exception as exc:
                if not self._should_degrade_memory_failure(exc):
                    raise
                logger.warning(
                    "Skipping memory add for provider %s because embeddings are unavailable: %s",
                    self.provider,
                    exc,
                )
                return

        self.situation_collection.add(
            documents=situations,
            metadatas=[{"recommendation": rec} for rec in advice],
            embeddings=embeddings,
            ids=ids,
        )

    def get_memories(self, current_situation, n_matches=1):
        """Find matching recommendations using configured embeddings."""
        try:
            query_embedding = self.get_embedding(current_situation)
        except Exception as exc:
            if not self._should_degrade_memory_failure(exc):
                raise
            logger.warning(
                "Skipping memory retrieval for provider %s because embeddings are unavailable: %s",
                self.provider,
                exc,
            )
            return []

        results = self.situation_collection.query(
            query_embeddings=[query_embedding],
            n_results=n_matches,
            include=["metadatas", "documents", "distances"],
        )

        matched_results = []
        for i in range(len(results["documents"][0])):
            matched_results.append(
                {
                    "matched_situation": results["documents"][0][i],
                    "recommendation": results["metadatas"][0][i]["recommendation"],
                    "similarity_score": 1 - results["distances"][0][i],
                }
            )

        return matched_results


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

    # ---- Embedding methods (ported from FinancialSituationMemory) ----

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


if __name__ == "__main__":
    # Example usage
    matcher = FinancialSituationMemory()

    # Example data
    example_data = [
        (
            "High inflation rate with rising interest rates and declining consumer spending",
            "Consider defensive sectors like consumer staples and utilities. Review fixed-income portfolio duration.",
        ),
        (
            "Tech sector showing high volatility with increasing institutional selling pressure",
            "Reduce exposure to high-growth tech stocks. Look for value opportunities in established tech companies with strong cash flows.",
        ),
        (
            "Strong dollar affecting emerging markets with increasing forex volatility",
            "Hedge currency exposure in international positions. Consider reducing allocation to emerging market debt.",
        ),
        (
            "Market showing signs of sector rotation with rising yields",
            "Rebalance portfolio to maintain target allocations. Consider increasing exposure to sectors benefiting from higher rates.",
        ),
    ]

    # Add the example situations and recommendations
    matcher.add_situations(example_data)

    # Example query
    current_situation = """
    Market showing increased volatility in tech sector, with institutional investors 
    reducing positions and rising interest rates affecting growth stock valuations
    """

    try:
        recommendations = matcher.get_memories(current_situation, n_matches=2)

        for i, rec in enumerate(recommendations, 1):
            print(f"\nMatch {i}:")
            print(f"Similarity Score: {rec['similarity_score']:.2f}")
            print(f"Matched Situation: {rec['matched_situation']}")
            print(f"Recommendation: {rec['recommendation']}")

    except Exception as e:
        print(f"Error during recommendation: {str(e)}")
