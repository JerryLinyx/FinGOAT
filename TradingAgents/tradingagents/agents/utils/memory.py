import chromadb
import os
from chromadb.config import Settings
from openai import OpenAI

MAX_EMBED_TOKENS = 8000
FALLBACK_CHAR_LIMIT = 8000  # used if tokenizer unavailable; keep conservative to avoid hitting token cap


class FinancialSituationMemory:
    def __init__(self, name, config):
        # Embedding is decoupled from chat provider; use a shared, stable embedding space.
        embed_model = os.getenv("EMBED_MODEL", "text-embedding-3-small")
        embed_base_url = os.getenv("EMBED_BASE_URL", "https://api.openai.com/v1")
        embed_api_key = (
            os.getenv("EMBED_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or os.getenv("LLM_API_KEY", "")
        )

        self.embedding = embed_model
        self.client = OpenAI(base_url=embed_base_url, api_key=embed_api_key)
        self.chroma_client = chromadb.Client(Settings(allow_reset=True))
        # Avoid collision when collection already exists (reuse instead of failing)
        try:
            self.situation_collection = self.chroma_client.create_collection(name=name)
        except Exception:
            self.situation_collection = self.chroma_client.get_or_create_collection(name=name)

    def get_embedding(self, text):
        """Get OpenAI embedding for a text"""

        text_to_embed = self._truncate_to_tokens(text, MAX_EMBED_TOKENS)

        response = self.client.embeddings.create(
            model=self.embedding, input=text_to_embed
        )
        return response.data[0].embedding

    def _truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        """Truncate text to fit within a token budget; fallback to char limit if tokenizer missing."""
        try:
            import tiktoken

            # Try to pick encoding based on embedding model; fallback to cl100k_base
            try:
                enc = tiktoken.encoding_for_model(self.embedding)
            except Exception:
                enc = tiktoken.get_encoding("cl100k_base")

            tokens = enc.encode(text)
            if len(tokens) <= max_tokens:
                return text
            tokens = tokens[:max_tokens]
            return enc.decode(tokens)
        except Exception:
            # Fallback: simple char truncation to avoid repeated failures
            return text[:FALLBACK_CHAR_LIMIT]

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
            embeddings.append(self.get_embedding(situation))

        self.situation_collection.add(
            documents=situations,
            metadatas=[{"recommendation": rec} for rec in advice],
            embeddings=embeddings,
            ids=ids,
        )

    def get_memories(self, current_situation, n_matches=1):
        """Find matching recommendations using OpenAI embeddings"""
        query_embedding = self.get_embedding(current_situation)

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
