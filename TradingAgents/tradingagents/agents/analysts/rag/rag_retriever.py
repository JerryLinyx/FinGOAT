"""RAG Retriever for Fundamentals Analyst.

This module provides retrieval-augmented generation capabilities for
fundamental analysis by retrieving relevant financial documents, SEC filings,
earnings transcripts, and analyst reports.
"""

import os
import chromadb
from chromadb.config import Settings
from openai import OpenAI
from typing import List, Dict, Any, Optional
from pathlib import Path
from datetime import datetime


MAX_EMBED_TOKENS = 8000
FALLBACK_CHAR_LIMIT = 8000


class FundamentalsRAGRetriever:
    """RAG retriever for fundamental analysis context."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the RAG retriever.
        
        Args:
            config: Optional configuration dictionary
        """
        # Embedding configuration
        embed_model = os.getenv("EMBED_MODEL", "text-embedding-3-small")
        embed_base_url = os.getenv("EMBED_BASE_URL", "https://api.openai.com/v1")
        embed_api_key = (
            os.getenv("EMBED_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or os.getenv("LLM_API_KEY", "")
        )
        
        self.embedding = embed_model
        self.client = OpenAI(base_url=embed_base_url, api_key=embed_api_key)
        
        # Use persistent ChromaDB storage
        project_dir = config.get("project_dir", ".") if config else "."
        chroma_db_path = Path(project_dir) / "chroma_db"
        chroma_db_path.mkdir(parents=True, exist_ok=True)
        
        self.chroma_client = chromadb.PersistentClient(path=str(chroma_db_path))
        
        # Create or get collection for fundamentals knowledge base
        collection_name = "fundamentals_knowledge_base"
        try:
            self.collection = self.chroma_client.create_collection(name=collection_name)
        except Exception:
            self.collection = self.chroma_client.get_or_create_collection(name=collection_name)
        
        # Output directory for saving RAG context
        self.output_dir = Path(
            config.get("project_dir", ".") if config else "."
        ) / "rag_outputs" / "fundamentals"
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def get_embedding(self, text: str) -> List[float]:
        """Get embedding for text.
        
        Args:
            text: Text to embed
            
        Returns:
            Embedding vector
        """
        text_to_embed = self._truncate_to_tokens(text, MAX_EMBED_TOKENS)
        
        response = self.client.embeddings.create(
            model=self.embedding,
            input=text_to_embed
        )
        return response.data[0].embedding
    
    def _truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        """Truncate text to fit within token budget.
        
        Args:
            text: Text to truncate
            max_tokens: Maximum tokens allowed
            
        Returns:
            Truncated text
        """
        try:
            import tiktoken
            
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
            return text[:FALLBACK_CHAR_LIMIT]
    
    def retrieve(
        self,
        ticker: str,
        query: Optional[str] = None,
        top_k: int = 5,
        filters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Retrieve relevant context for fundamental analysis.
        
        Args:
            ticker: Stock ticker symbol
            query: Optional custom query. If None, generates query from ticker
            top_k: Number of results to retrieve
            filters: Optional metadata filters
            
        Returns:
            Dictionary with retrieved context and metadata
        """
        # Generate query if not provided
        if query is None:
            query = f"{ticker} fundamental analysis financial statements SEC filings earnings reports company profile"
        
        # Get embedding for query
        query_embedding = self.get_embedding(query)
        
        # Build where clause for filtering
        # Include both ticker-specific and GENERAL documents
        if filters is None:
            where_clause = None  # Don't filter - get all relevant documents
        else:
            where_clause = filters
        
        # Query the collection
        try:
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
                where=where_clause,
                include=["documents", "metadatas", "distances"]
            )
            
            # Format results
            retrieved_docs = []
            if results["documents"] and len(results["documents"][0]) > 0:
                for i in range(len(results["documents"][0])):
                    doc = results["documents"][0][i]
                    metadata = results["metadatas"][0][i] if results["metadatas"] else {}
                    distance = results["distances"][0][i] if results["distances"] else 1.0
                    
                    retrieved_docs.append({
                        "content": doc,
                        "metadata": metadata,
                        "similarity_score": 1 - distance,
                        "rank": i + 1
                    })
            
            # Format context for injection into prompt
            context_text = self._format_context(retrieved_docs)
            
            return {
                "context": context_text,
                "documents": retrieved_docs,
                "query": query,
                "ticker": ticker,
                "num_results": len(retrieved_docs)
            }
            
        except Exception as e:
            # If retrieval fails, return empty context
            print(f"Warning: RAG retrieval failed: {e}")
            return {
                "context": "",
                "documents": [],
                "query": query,
                "ticker": ticker,
                "num_results": 0,
                "error": str(e)
            }
    
    def _format_context(self, documents: List[Dict[str, Any]]) -> str:
        """Format retrieved documents into context string.
        
        Args:
            documents: List of retrieved documents
            
        Returns:
            Formatted context string
        """
        if not documents:
            return ""
        
        context_parts = [
            "=== RELEVANT CONTEXT FROM KNOWLEDGE BASE ===\n"
        ]
        
        for doc in documents:
            rank = doc.get("rank", 0)
            similarity = doc.get("similarity_score", 0.0)
            content = doc.get("content", "")
            metadata = doc.get("metadata", {})
            
            doc_type = metadata.get("doc_type", "unknown")
            source = metadata.get("source", "unknown")
            date = metadata.get("date", "unknown")
            
            context_parts.append(
                f"\n[Document {rank}] (Similarity: {similarity:.3f})\n"
                f"Type: {doc_type} | Source: {source} | Date: {date}\n"
                f"{'-' * 60}\n"
                f"{content}\n"
            )
        
        context_parts.append("\n=== END OF CONTEXT ===\n")
        
        return "\n".join(context_parts)
    
    def save_context_to_file(
        self,
        rag_result: Dict[str, Any],
        ticker: str,
        trade_date: str
    ) -> str:
        """Save RAG context to a text file.
        
        Args:
            rag_result: Result from retrieve() method
            ticker: Stock ticker symbol
            trade_date: Trading date
            
        Returns:
            Path to saved file
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"rag_context_{ticker}_{trade_date}_{timestamp}.txt"
        filepath = self.output_dir / filename
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write("=" * 80 + "\n")
            f.write(f"RAG CONTEXT FOR FUNDAMENTALS ANALYSIS\n")
            f.write("=" * 80 + "\n\n")
            f.write(f"Ticker: {ticker}\n")
            f.write(f"Trade Date: {trade_date}\n")
            f.write(f"Generated: {datetime.now().isoformat()}\n")
            f.write(f"Query: {rag_result.get('query', 'N/A')}\n")
            f.write(f"Number of Results: {rag_result.get('num_results', 0)}\n")
            f.write("\n" + "=" * 80 + "\n\n")
            
            if rag_result.get("error"):
                f.write(f"ERROR: {rag_result['error']}\n\n")
            
            f.write(rag_result.get("context", "No context retrieved.\n"))
            
            # Add detailed document information
            if rag_result.get("documents"):
                f.write("\n" + "=" * 80 + "\n")
                f.write("DETAILED DOCUMENT INFORMATION\n")
                f.write("=" * 80 + "\n\n")
                
                for doc in rag_result["documents"]:
                    f.write(f"\nDocument {doc.get('rank', 0)}:\n")
                    f.write(f"  Similarity Score: {doc.get('similarity_score', 0.0):.4f}\n")
                    f.write(f"  Metadata: {doc.get('metadata', {})}\n")
                    f.write(f"  Content Length: {len(doc.get('content', ''))} characters\n")
        
        return str(filepath)
    
    def add_documents(
        self,
        documents: List[str],
        metadatas: List[Dict[str, Any]],
        ids: Optional[List[str]] = None
    ):
        """Add documents to the knowledge base.
        
        Args:
            documents: List of document texts
            metadatas: List of metadata dictionaries
            ids: Optional list of document IDs
        """
        if len(documents) != len(metadatas):
            raise ValueError("documents and metadatas must have the same length")
        
        embeddings = [self.get_embedding(doc) for doc in documents]
        
        if ids is None:
            offset = self.collection.count()
            ids = [str(offset + i) for i in range(len(documents))]
        
        self.collection.add(
            documents=documents,
            metadatas=metadatas,
            embeddings=embeddings,
            ids=ids
        )


if __name__ == "__main__":
    # Example usage
    retriever = FundamentalsRAGRetriever()
    
    # Example: Add some documents
    example_docs = [
        "Apple Inc. reported strong Q4 earnings with revenue growth of 15% year-over-year.",
        "Microsoft's cloud services division showed exceptional growth, driving overall profitability."
    ]
    
    example_metadatas = [
        {"ticker": "AAPL", "doc_type": "earnings", "date": "2024-01-01", "source": "example"},
        {"ticker": "MSFT", "doc_type": "earnings", "date": "2024-01-01", "source": "example"}
    ]
    
    # retriever.add_documents(example_docs, example_metadatas)
    
    # Example: Retrieve context
    result = retriever.retrieve("AAPL", top_k=3)
    print(result["context"])

